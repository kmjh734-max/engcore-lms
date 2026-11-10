import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOwnAnalysis, requireExamStaff } from "@/lib/exam-analysis/access";
import { categoryOfName, EXAM_LEVELS } from "@/lib/exam-analysis/types";
import { mockPassageShortLabel } from "@/lib/mock-passages";

export const runtime = "nodejs";

/**
 * 문항표 한 줄 고치기 { typeName?, level?, points?, source? } — 선생님이 바로잡은 값
 *
 * source는 출처를 손으로 다는 것이다. 글자로 대조해 잡히는 것만 자동으로 달리는데,
 * 학교가 지문을 바꿔 쓰거나 부교재에서 가져오면 잡히지 않는다. 손으로 단 것은
 * 다시 대조해도 덮어쓰지 않는다(source_edited).
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string; itemId: string }> }) {
  const auth = await requireExamStaff();
  if ("error" in auth) return auth.error;
  const { id, itemId } = await context.params;
  if (!(await loadOwnAnalysis(id, auth.profile.academy_id))) {
    return NextResponse.json({ ok: false, message: "분석을 찾을 수 없어요." }, { status: 404 });
  }
  const admin = createAdminClient();
  const { data: item } = await admin
    .from("school_exam_items")
    .select("id, is_subjective")
    .eq("id", itemId)
    .eq("analysis_id", id)
    .maybeSingle();
  if (!item) return NextResponse.json({ ok: false, message: "문항을 찾을 수 없어요." }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as {
    typeName?: string;
    level?: string;
    points?: number | null;
    difficultyReason?: string | null;
    isDecisive?: boolean;
    source?: {
      kind: "auto" | "textbook" | "mock" | "sub_material" | "outside" | "material" | "custom";
      passageId?: string;
      label?: string;
    };
  };
  const patch: Record<string, unknown> = { edited: true };
  if (typeof body.typeName === "string" && body.typeName.trim()) {
    patch.type_name = body.typeName.trim().slice(0, 40);
    patch.category = categoryOfName(patch.type_name as string, item.is_subjective);
  }
  if (typeof body.level === "string" && (EXAM_LEVELS as readonly string[]).includes(body.level)) {
    patch.level = body.level;
    patch.difficulty = body.level === "상" ? 4 : body.level === "하" ? 2 : 3;
  }
  if (body.points === null || (typeof body.points === "number" && body.points >= 0 && body.points <= 100)) {
    patch.points = body.points;
  }
  if ("difficultyReason" in body) {
    patch.difficulty_reason = typeof body.difficultyReason === "string" ? body.difficultyReason.trim() : null;
  }
  if ("isDecisive" in body) {
    patch.is_decisive = Boolean(body.isDecisive);
  }
  if (body.source) {
    const kind = body.source.kind;
    const label = (body.source.label ?? "").trim();
    if (kind === "auto") {
      // 자동 대조로 되돌린다 — 다음 대조 때 다시 채워진다
      patch.source_edited = false;
      patch.source_kind = null;
      patch.source_label = null;
    } else if (kind === "textbook") {
      let tbLabel = label || "교과서";
      let tbId: string | null = null;
      if (body.source.passageId) {
        const { data: tb } = await admin
          .from("textbook_passages")
          .select("id, subject, publisher, lesson, part")
          .eq("id", String(body.source.passageId))
          .maybeSingle();
        if (tb) {
          tbId = tb.id;
          tbLabel = label || `${tb.publisher} ${tb.subject} ${tb.lesson} ${tb.part}`;
        }
      }
      patch.source_edited = true;
      patch.source_kind = "textbook";
      patch.matched_textbook_id = tbId;
      patch.matched_textbook_label = tbLabel;
      patch.source_label = tbLabel;
      patch.matched_mock_id = null;
      patch.matched_mock_label = null;
    } else if (kind === "mock") {
      let mkLabel = label || "모의고사";
      let mkId: string | null = null;
      if (body.source.passageId) {
        const { data: mk } = await admin
          .from("mock_exam_passages")
          .select("id, year, month, grade, kind, item_no")
          .eq("id", String(body.source.passageId))
          .maybeSingle();
        if (mk) {
          mkId = mk.id;
          mkLabel = label || mockPassageShortLabel(mk);
        }
      }
      patch.source_edited = true;
      patch.source_kind = "mock";
      patch.matched_mock_id = mkId;
      patch.matched_mock_label = mkLabel;
      patch.source_label = mkLabel;
      patch.matched_textbook_id = null;
      patch.matched_textbook_label = null;
    } else if (kind === "sub_material") {
      // 부교재 (EBS, 수능특강, 올림포스 등)
      patch.source_edited = true;
      patch.source_kind = "sub_material";
      patch.source_label = label || "부교재";
      patch.matched_textbook_id = null;
      patch.matched_textbook_label = null;
      patch.matched_mock_id = null;
      patch.matched_mock_label = null;
    } else if (kind === "outside") {
      patch.source_edited = true;
      patch.source_kind = "outside";
      patch.source_label = label || "외부지문";
      patch.matched_textbook_id = null;
      patch.matched_textbook_label = null;
      patch.matched_mock_id = null;
      patch.matched_mock_label = null;
      patch.matched_item_id = null;
      patch.matched_label = null;
    } else if (kind === "custom") {
      patch.source_edited = true;
      patch.source_kind = "custom";
      patch.source_label = label || "기타";
      patch.matched_textbook_id = null;
      patch.matched_textbook_label = null;
      patch.matched_mock_id = null;
      patch.matched_mock_label = null;
    }
  }

  await admin.from("school_exam_items").update(patch).eq("id", itemId);

  // 총점 다시 계산
  const { data: rows } = await admin.from("school_exam_items").select("points").eq("analysis_id", id);
  const total = (rows ?? []).reduce((s, r) => s + (Number(r.points) || 0), 0);
  await admin.from("school_exam_analyses").update({ total_points: Math.round(total * 10) / 10 }).eq("id", id);
  return NextResponse.json({ ok: true });
}
