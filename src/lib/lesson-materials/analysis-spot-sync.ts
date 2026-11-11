import { resolveMarkupSpan, type AnalysisSentenceMarkup } from "@/lib/lesson-materials/analysis-markup";
import type { AnalysisReportData } from "@/lib/lesson-materials/generate-analysis-report";
import { teacherNotesSourceHash, type TeacherNotes } from "@/lib/lesson-materials/teacher-notes";

/**
 * 지문분석서의 빈칸 추론·함축 의미 자리를 수업용 자료(교사용 해설 출제 자리)와 같게(선생님 2026-11-11 「지문분석서에 있는
 * 함축·빈칸추론이 현재 업데이트한 수업용자료랑 맥을 같게」). 같은 지문의 교사용 해설이 지금 원문으로 만들어져 있으면
 * 분석서의 두 꼬리표를 지우고 해설의 자리(blank → 빈칸 추론, implication → 함축 의미 + 뜻 한 줄)로 바꿔 보여 준다.
 * 저장본은 그대로 두고 읽을 때만 — 해설을 다시 만들면 분석서도 따라간다. 해설이 없거나 옛 원문이면 분석서 그대로.
 */
const SYNCED_TAGS = ["빈칸 추론", "함축 의미"] as const;
const KIND_TAG = { blank: "빈칸 추론", implication: "함축 의미" } as const;

const norm = (s: string) => s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();

export function syncReportSpotsWithTeacherNotes(
  report: AnalysisReportData,
  notes: TeacherNotes | null | undefined,
  english: string[]
): AnalysisReportData {
  if (!notes || !Array.isArray(notes.spots) || notes.sourceHash !== teacherNotesSourceHash(english)) return report;
  const spots = notes.spots.filter((s) => s.kind === "blank" || s.kind === "implication");
  const sentences = report.sentences.map((s) => {
    const m = s.markup as AnalysisSentenceMarkup | null | undefined;
    if (!m) return s;
    return {
      ...s,
      markup: {
        ...m,
        tags: (m.tags ?? []).filter((t) => !(SYNCED_TAGS as readonly string[]).includes(t)),
        tagSpans: (m.tagSpans ?? []).filter((t) => !(SYNCED_TAGS as readonly string[]).includes(t.tag)),
      },
    };
  });
  for (const spot of spots) {
    const q = String(spot.q ?? "").trim();
    if (!q) continue;
    const want = norm(english[spot.sentence] ?? "");
    // 해설의 문장 번호와 같은 분석서 문장(원문 대조), 없으면 그 어구가 든 첫 문장
    const order = sentences
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => !!s.markup)
      .sort((a, b) => Number(norm(b.s.markup!.text) === want) - Number(norm(a.s.markup!.text) === want));
    for (const { s } of order) {
      const m = s.markup as AnalysisSentenceMarkup;
      const span = resolveMarkupSpan(m.text, q, 1);
      if (!span) continue;
      const tag = KIND_TAG[spot.kind as "blank" | "implication"];
      if (!m.tags.includes(tag)) m.tags = [...m.tags, tag];
      m.tagSpans = [...(m.tagSpans ?? []), { tag, span, ...(spot.note ? { paraphrase: spot.note } : {}) }];
      break;
    }
  }
  return { ...report, sentences };
}
