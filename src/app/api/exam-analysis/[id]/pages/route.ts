import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { flushAiUsage, setAiUsage } from "@/lib/ai-usage/context";
import { loadOwnAnalysis, requireExamStaff } from "@/lib/exam-analysis/access";
import { readExamImage } from "@/lib/exam-analysis/read-page";

export const runtime = "nodejs";
export const maxDuration = 300;

const isJpegDataUrl = (s: unknown): s is string =>
  typeof s === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(s) && s.length < 4_000_000;

/**
 * 한 쪽 읽기 { pageNo, image } 또는 두 단으로 나눈 것 { pageNo, halves: [왼쪽, 오른쪽] }.
 * 한 번에 다 못 읽으면 complete:false — 화면이 쪽을 두 단으로 잘라 다시 보낸다.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireExamStaff();
  if ("error" in auth) return auth.error;
  const { id } = await context.params;
  const analysis = await loadOwnAnalysis(id, auth.profile.academy_id);
  if (!analysis) return NextResponse.json({ ok: false, message: "분석을 찾을 수 없어요." }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { pageNo?: number; image?: unknown; halves?: unknown[] };
  const pageNo = Math.floor(Number(body.pageNo) || 0);
  if (pageNo < 1 || pageNo > analysis.page_count) {
    return NextResponse.json({ ok: false, message: "쪽 번호가 올바르지 않아요." }, { status: 400 });
  }

  /*
   * 선생님 물음(2026-10-01): 원가가 제대로 책정되고 있는가.
   * 시험지 읽기는 시험분석에서 값이 가장 큰 호출인데(쪽마다 그림을 높은 해상도로 본다)
   * 여기에 테두리가 없어 학원도 기능도 안 붙었고, 밀어 넣지도 않아 기록이 통째로
   * 빠질 수 있었다. 그래서 시험분석 원가에는 읽기 값이 들어 있지 않았다.
   * 값은 분석이 끝날 때 한 번만 받으므로, 읽기는 같은 기능에 원가로만 붙인다.
   */
  /*
   * 값은 분석(analyze)에서 받으므로, 분석을 끝내지 않고 쪽 읽기만 되풀이하면 값 없이 원가만 나간다(2026-11-28).
   * 분석이 시작된 뒤에는 읽지 않고, 이미 읽어 둔 쪽은 다시 읽지 않으며(두 단 다시 읽기는 그대로),
   * 분석 하나에서 읽는 횟수에 테두리를 둔다(쪽마다 한 번 + 두 단 한 번, 한 번에 호출 둘까지).
   */
  if (analysis.status !== "reading") {
    return NextResponse.json({ ok: false, message: "이미 분석을 시작한 시험지예요. 새로 올려 주세요." }, { status: 409 });
  }
  const admin = createAdminClient();
  const { data: prev } = await admin
    .from("school_exam_pages")
    .select("text")
    .eq("analysis_id", id)
    .eq("page_no", pageNo)
    .maybeSingle();
  const wantsHalves = Array.isArray(body.halves);
  if (prev && !wantsHalves && String(prev.text ?? "").trim()) {
    return NextResponse.json({ ok: true, complete: true });
  }
  const { count: readCalls } = await admin
    .from("ai_usage_logs")
    .select("id", { count: "exact", head: true })
    .eq("academy_id", auth.profile.academy_id)
    .eq("project_id", id)
    .eq("used_for", "exam_page_read")
    .gte("created_at", new Date(Date.now() - 3 * 86_400_000).toISOString());
  if ((readCalls ?? 0) >= analysis.page_count * 6 + 4) {
    return NextResponse.json(
      { ok: false, message: "이 시험지는 더 읽을 수 없어요. 새로 올려 분석해 주세요." },
      { status: 429 }
    );
  }

  setAiUsage({
    academyId: auth.profile.academy_id,
    actorId: auth.profile.id,
    featureKey: "school_exam_analysis",
    usedFor: "exam_page_read",
    projectId: id,
  });

  try {
    let text = "";
    let complete = true;
    if (Array.isArray(body.halves) && body.halves.length === 2 && body.halves.every(isJpegDataUrl)) {
      const [left, right] = await Promise.all([
        readExamImage(body.halves[0] as string, `시험지 ${pageNo}쪽 (왼쪽 단)`),
        readExamImage(body.halves[1] as string, `시험지 ${pageNo}쪽 (오른쪽 단)`),
      ]);
      text = `${left.text}\n\n${right.text}`.trim();
    } else if (isJpegDataUrl(body.image)) {
      const r = await readExamImage(body.image, `시험지 ${pageNo}쪽`);
      text = r.text;
      complete = r.complete;
    } else {
      return NextResponse.json({ ok: false, message: "쪽 그림이 없어요." }, { status: 400 });
    }

    // 덜 읽었어도 일단 저장해 둔다(두 단으로 다시 읽으면 더 긴 쪽으로 바꾼다)
    if (!prev || text.length >= String(prev.text ?? "").length) {
      await admin.from("school_exam_pages").upsert({ analysis_id: id, page_no: pageNo, text });
    }
    await flushAiUsage();
    return NextResponse.json({ ok: true, complete });
  } catch (e) {
    console.error("[exam-analysis/pages]", e);
    // 못 읽었어도 부른 값은 나갔다. 기록은 남긴다.
    await flushAiUsage();
    return NextResponse.json({ ok: false, message: "이 쪽을 읽지 못했어요. 다시 시도해 주세요." }, { status: 502 });
  }
}
