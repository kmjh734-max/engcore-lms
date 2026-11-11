"use server";

import {
  debitLessonCredits,
  LESSON_CREDIT_FEATURES,
  lessonCreditShortfall,
} from "@/lib/credits/lesson-credits";
import { flushAiUsage, withAiUsage } from "@/lib/ai-usage/context";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import {
  ANALYSIS_REPORT_FORMAT_VERSION,
  capImplyTags,
  capMarkupStars,
  generateAnalysisReport,
  type AnalysisReportData,
} from "@/lib/lesson-materials/generate-analysis-report";
import { generateSentenceMarkup } from "@/lib/lesson-materials/generate-analysis-markup";
import { verifyAnalysisMarkups } from "@/lib/lesson-materials/analysis-markup-verify";
import { hasAnyMarkup } from "@/lib/lesson-materials/analysis-markup";
import { syncReportSpotsWithTeacherNotes } from "@/lib/lesson-materials/analysis-spot-sync";
import type { TeacherNotes } from "@/lib/lesson-materials/teacher-notes";
import { onePageSentences } from "@/lib/lesson-materials/one-page";

function analysisSourceHash(lines: Array<string | null | undefined>): string {
  const joined = lines
    .map((l) => String(l ?? "").replace(/\s+/g, " ").trim())
    .join("\n");
  return createHash("sha256").update(joined).digest("hex").slice(0, 32);
}

type Role = "admin" | "teacher";

async function requireRole(role: Role) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== role) {
    return { profile: null as null, error: "권한이 없습니다." };
  }
  if (role === "teacher" && profile.is_active === false) {
    return { profile: null as null, error: "비활성화된 계정입니다." };
  }
  if (!profile.academy_id) {
    return { profile: null as null, error: "소속 학원 정보가 없습니다." };
  }
  return { profile, error: null as null };
}

export async function generateAndSaveAnalysisReportAction(
  role: Role,
  input: {
    projectId: string;
    headerLabel?: string;
    /**
     * 제작 버튼으로 연 경우: 원문과 형식이 저장된 분석서와 같으면 새로 만들지 않고 그대로 쓴다
     * (같은 지문으로 여러 번 제작해도 비용이 들지 않게). "다시 만들기"는 이 값 없이 부른다.
     */
    onlyIfChanged?: boolean;
  }
): Promise<
  | { ok: true; report: AnalysisReportData; reused?: boolean }
  | { ok: false; message: string }
> {
  const { profile, error } = await requireRole(role);
  if (error) return { ok: false, message: error };

  const projectId = input.projectId?.trim();
  if (!projectId) return { ok: false, message: "프로젝트 ID가 없습니다." };

  const supabase = await createClient();
  let pq = supabase
    .from("lesson_material_projects")
    .select("id,title,analysis_report_json,tn:lesson_pack_json->teacherNotes")
    .eq("id", projectId)
    .eq("academy_id", profile!.academy_id!)
    .is("deleted_at", null);
  if (role === "teacher") {
    pq = pq.or(`teacher_id.eq.${profile!.id},created_by.eq.${profile!.id}`);
  }
  const { data: project, error: pErr } = await pq.maybeSingle();
  if (pErr || !project) {
    return { ok: false, message: "프로젝트를 찾을 수 없습니다." };
  }

  const { data: items, error: iErr } = await supabase
    .from("lesson_material_items")
    .select("id,english_text,korean_text,order_index")
    .eq("project_id", projectId)
    .order("order_index", { ascending: true });
  if (iErr) return { ok: false, message: iErr.message };

  const prev = (project.analysis_report_json ?? {}) as Partial<AnalysisReportData>;
  // 빈칸 추론·함축 의미는 수업용 자료(교사용 해설)가 고른 자리와 같게 보여 준다(2026-11-11, 저장본은 그대로)
  const withTeacherSpots = (r: AnalysisReportData) =>
    syncReportSpotsWithTeacherNotes(
      r,
      (project as { tn?: TeacherNotes | null }).tn,
      onePageSentences((items ?? []).filter((it) => String(it.english_text ?? "").trim())).map((x) => x.english)
    );
  const headerLabel =
    input.headerLabel?.trim() ||
    prev.headerLabel ||
    "26년도 1학기 중간고사 대비";

  const sourceHash = analysisSourceHash((items ?? []).map((it) => it.english_text));
  if (
    input.onlyIfChanged &&
    (prev.sentences?.length ?? 0) > 0 &&
    prev.sourceHash === sourceHash &&
    prev.formatVersion === ANALYSIS_REPORT_FORMAT_VERSION
  ) {
    return { ok: true, report: withTeacherSpots({ ...(prev as AnalysisReportData), headerLabel }), reused: true };
  }

  // 새로 만들 때만 크레딧을 쓴다. 모자라면 만들지 않고 안내한다.
  const shortfall = await lessonCreditShortfall(profile!.academy_id!, LESSON_CREDIT_FEATURES.analysisReport);
  if (shortfall) return { ok: false, message: shortfall };

  try {
    const generated = await withAiUsage(
      {
        academyId: profile!.academy_id,
        actorId: profile!.id,
        featureKey: LESSON_CREDIT_FEATURES.analysisReport,
        usedFor: "analysis_report",
        projectId,
      },
      () =>
        generateAnalysisReport({
          title: project.title,
          headerLabel,
          lines: (items ?? []).map((it) => ({
            id: it.id,
            english: it.english_text,
            korean: it.korean_text,
          })),
        })
    );
    await flushAiUsage();
    /*
     * 선생님이 분석지에서 직접 고친 문장은 지문 전체를 다시 만들어도 그대로 둔다(선생님 2026-10-22).
     * 원문이 바뀐 문장은 새로 만든 것을 쓴다.
     */
    const plain = (s: { enChunks: Array<{ text: string }> }) => s.enChunks.map((c) => c.text).join(" ").replace(/\s+/g, " ").trim();
    const kept = new Map((prev.sentences ?? []).filter((s) => s.teacherEdited).map((s) => [s.itemId, s] as const));
    const report: AnalysisReportData = {
      ...generated,
      sentences: generated.sentences.map((s) => {
        const old = kept.get(s.itemId);
        return old && plain(old) === plain(s) ? old : s;
      }),
      sourceHash,
      formatVersion: ANALYSIS_REPORT_FORMAT_VERSION,
    };

    const { error: uErr } = await supabase
      .from("lesson_material_projects")
      .update({
        analysis_report_json: report,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);
    if (uErr) return { ok: false, message: uErr.message };
    await debitLessonCredits({
      academyId: profile!.academy_id!,
      actorId: profile!.id,
      featureKey: LESSON_CREDIT_FEATURES.analysisReport,
      projectId,
      note: `지문 분석서 · ${project.title}`,
    });

    revalidatePath(`/${role}/lesson-materials`);
    revalidatePath(`/${role}/lesson-materials/analysis-report`);
    revalidatePath(`/${role}/lesson-materials/project/${projectId}`);
    return { ok: true, report: withTeacherSpots(report) };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "분석서 생성 실패",
    };
  }
}

/**
 * 분석서의 문장 하나만 다시 만든다(문장 표시: 성분·괄호·이름표·번호 설명·해석·부연).
 * 선생님 말씀(2026-10-21): 지문 전체를 다시 만들면 맞던 문장까지 바뀌어 「또 다른 오류」가 생기고
 * 값도 지문마다 든다. 문장 하나만 고치고 값도 문장마다(lesson_analysis_sentence) 받는다.
 * 만들지 못하면 값을 받지 않고 그대로 둔다.
 */
export async function regenerateAnalysisSentenceAction(
  role: Role,
  input: { projectId: string; itemId: string }
): Promise<{ ok: true; report: AnalysisReportData } | { ok: false; message: string }> {
  const { profile, error } = await requireRole(role);
  if (error) return { ok: false, message: error };
  const projectId = input.projectId?.trim();
  if (!projectId || !input.itemId) return { ok: false, message: "문장을 골라 주세요." };

  const supabase = await createClient();
  let pq = supabase
    .from("lesson_material_projects")
    .select("id,title,analysis_report_json")
    .eq("id", projectId)
    .eq("academy_id", profile!.academy_id!)
    .is("deleted_at", null);
  if (role === "teacher") {
    pq = pq.or(`teacher_id.eq.${profile!.id},created_by.eq.${profile!.id}`);
  }
  const { data: project } = await pq.maybeSingle();
  if (!project) return { ok: false, message: "프로젝트를 찾을 수 없습니다." };
  const prev = project.analysis_report_json as AnalysisReportData | null;
  const index = prev?.sentences?.findIndex((s) => s.itemId === input.itemId) ?? -1;
  if (!prev || index < 0) return { ok: false, message: "분석서에서 그 문장을 찾지 못했습니다. 분석서를 먼저 만들어 주세요." };

  const { data: items, error: iErr } = await supabase
    .from("lesson_material_items")
    .select("id,english_text,korean_text,order_index")
    .eq("project_id", projectId)
    .order("order_index", { ascending: true });
  if (iErr) return { ok: false, message: iErr.message };
  const lines = (items ?? []).filter((it) => String(it.english_text ?? "").trim());
  const line = lines.find((it) => it.id === input.itemId);
  if (!line) return { ok: false, message: "그 문장의 원문을 찾지 못했습니다." };

  const shortfall = await lessonCreditShortfall(profile!.academy_id!, LESSON_CREDIT_FEATURES.analysisSentence);
  if (shortfall) return { ok: false, message: shortfall };
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { ok: false, message: "OPENAI_API_KEY가 설정되어 있지 않습니다." };

  try {
    const built = await withAiUsage(
      {
        academyId: profile!.academy_id,
        actorId: profile!.id,
        featureKey: LESSON_CREDIT_FEATURES.analysisSentence,
        usedFor: "analysis_report_sentence",
        projectId,
      },
      async () => {
        const signal = AbortSignal.timeout(110_000);
        const one = await generateSentenceMarkup({
          apiKey,
          passage: lines.map((l) => String(l.english_text).trim()).join(" "),
          sentence: String(line.english_text).trim(),
          sentenceNumber: lines.indexOf(line) + 1,
          totalSentences: lines.length,
          koreanHint: line.korean_text,
          signal,
        });
        if (!one?.markup || !hasAnyMarkup(one.markup)) return null;
        // 지문 전체 만들기와 같은 검수(번호 설명·해석)를 거친다. 검수가 실패하면 만든 것을 그대로 쓴다.
        let markup = one.markup;
        try {
          const verified = await verifyAnalysisMarkups({ apiKey, markups: [markup], references: [line.korean_text], signal });
          markup = verified.markups[0] ?? markup;
        } catch {
          /* 넘어간다 */
        }
        return { markup, contextNote: one.contextNote };
      }
    );
    await flushAiUsage();
    if (!built) return { ok: false, message: "이 문장을 다시 만들지 못했습니다. 잠시 뒤 다시 눌러 주세요. (값은 받지 않았습니다)" };

    const sentences = prev.sentences.map((s, i) =>
      i === index
        ? {
            ...s,
            // 문장 하나 다시 만들기는 선생님이 고친 것까지 새로 만든다(직접 누른 것이므로)
            teacherEdited: undefined,
            originalMarkup: undefined,
            markup: built.markup,
            contextNote: built.contextNote?.trim() || s.contextNote,
            easyUnderstanding: built.contextNote?.trim() || s.easyUnderstanding,
          }
        : s
    );
    // 별표·함축 의미 꼬리표는 지문 전체에서 개수를 맞춘다(지문 전체 만들기와 같은 규칙)
    const capped = capImplyTags(capMarkupStars(sentences.map((s) => s.markup ?? null)));
    const report: AnalysisReportData = {
      ...prev,
      sentences: sentences.map((s, i) => ({ ...s, markup: capped[i] ?? undefined })),
      updatedAt: new Date().toISOString(),
    };
    const { error: uErr } = await supabase
      .from("lesson_material_projects")
      .update({ analysis_report_json: report, updated_at: new Date().toISOString() })
      .eq("id", projectId);
    if (uErr) return { ok: false, message: uErr.message };
    await debitLessonCredits({
      academyId: profile!.academy_id!,
      actorId: profile!.id,
      featureKey: LESSON_CREDIT_FEATURES.analysisSentence,
      projectId,
      note: `지문 분석서 문장 다시 만들기 · ${project.title} · ${index + 1}번 문장`,
    });
    revalidatePath(`/${role}/lesson-materials/analysis-report`);
    return { ok: true, report };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "문장을 다시 만들지 못했습니다." };
  }
}

export async function saveAnalysisReportAction(
  role: Role,
  input: { projectId: string; report: AnalysisReportData }
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { profile, error } = await requireRole(role);
  if (error) return { ok: false, message: error };

  const projectId = input.projectId?.trim();
  if (!projectId) return { ok: false, message: "프로젝트 ID가 없습니다." };

  const supabase = await createClient();
  let pq = supabase
    .from("lesson_material_projects")
    .select("id")
    .eq("id", projectId)
    .eq("academy_id", profile!.academy_id!)
    .is("deleted_at", null);
  if (role === "teacher") {
    pq = pq.or(`teacher_id.eq.${profile!.id},created_by.eq.${profile!.id}`);
  }
  const { data: project } = await pq.maybeSingle();
  if (!project) return { ok: false, message: "프로젝트를 찾을 수 없습니다." };

  const report: AnalysisReportData = {
    ...input.report,
    updatedAt: new Date().toISOString(),
  };

  const { error: uErr } = await supabase
    .from("lesson_material_projects")
    .update({
      analysis_report_json: report,
      updated_at: new Date().toISOString(),
    })
    .eq("id", projectId);
  if (uErr) return { ok: false, message: uErr.message };

  revalidatePath(`/${role}/lesson-materials`);
  revalidatePath(`/${role}/lesson-materials/analysis-report`);
  return { ok: true };
}

/**
 * 분석지 문장 「오류 신고」(선생님 2026-10-22 시안 승인). 값은 받지 않는다. 세션 시작 점검이 안 본 신고를 띄우고,
 * 확인한 것은 그 분석지를 고치고 코드 검사·채점 문장에 넣는다.
 */
export async function reportAnalysisErrorAction(
  role: Role,
  input: {
    projectId: string;
    sentenceIndex: number;
    itemId?: string;
    sentenceText: string;
    categories: string[];
    memo: string;
  }
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { profile, error } = await requireRole(role);
  if (error) return { ok: false, message: error };
  const projectId = input.projectId?.trim();
  if (!projectId) return { ok: false, message: "프로젝트 ID가 없습니다." };
  const categories = (input.categories ?? []).map((c) => String(c).slice(0, 20)).slice(0, 6);
  const memo = String(input.memo ?? "").trim().slice(0, 1000);
  if (!categories.length && !memo) return { ok: false, message: "틀린 곳을 고르거나 한 줄 적어 주세요." };

  const supabase = await createClient();
  let pq = supabase
    .from("lesson_material_projects")
    .select("id")
    .eq("id", projectId)
    .eq("academy_id", profile!.academy_id!)
    .is("deleted_at", null);
  if (role === "teacher") {
    pq = pq.or(`teacher_id.eq.${profile!.id},created_by.eq.${profile!.id}`);
  }
  const { data: project } = await pq.maybeSingle();
  if (!project) return { ok: false, message: "프로젝트를 찾을 수 없습니다." };

  const { error: iErr } = await createAdminClient()
    .from("analysis_error_reports")
    .insert({
      academy_id: profile!.academy_id!,
      project_id: projectId,
      item_id: input.itemId ?? null,
      sentence_index: Math.max(0, Math.floor(Number(input.sentenceIndex) || 0)),
      sentence_text: String(input.sentenceText ?? "").slice(0, 2000),
      categories,
      memo,
      reporter_id: profile!.id,
    });
  if (iErr) return { ok: false, message: "신고를 보내지 못했습니다. 잠시 뒤 다시 눌러 주세요." };
  return { ok: true };
}
