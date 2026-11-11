"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import {
  generateLessonMaterialsOrganizationDraftAction as generateAdminOrganizationDraft,
  saveLessonMaterialsFromWizard as saveAdminLessonMaterialsFromWizard,
} from "@/app/admin/lesson-materials/actions";
import {
  generateLessonMaterialsOrganizationDraftAction as generateTeacherOrganizationDraft,
  saveLessonMaterialsFromWizard as saveTeacherLessonMaterialsFromWizard,
} from "@/app/teacher/lesson-materials/actions";
import { LessonMaterialLogicalFlow } from "@/components/lesson-materials/LessonMaterialLogicalFlow";
import { LessonMaterialComicFrame } from "@/components/lesson-materials/LessonMaterialComicFrame";
import type { LessonMaterialAnalysisCard } from "@/lib/lesson-materials/generate-organization";
import { translateLessonMaterialLinesAction } from "@/lib/lesson-materials/line-actions";
import {
  splitEnglishSentences,
  splitKoreanSentences,
  splitPassageIntoLinePairs,
} from "@/lib/lesson-materials/split-sentences";
import { runWithConcurrency } from "@/lib/run-with-concurrency";
import { postJson } from "@/lib/lesson-materials/post-json";
import { PASSAGE_PREP_CONCURRENCY } from "@/lib/lesson-materials/test-book";
import { askCreditConfirm } from "@/lib/credits/confirm-store";
import { MockPassagePickerModal, type PickedMockPassage } from "@/components/mock-passages/MockPassagePickerModal";
import { PassageSheet } from "@/components/passages/PassageSheet";

/**
 * 삽화 일괄 생성 때 동시에 보내는 요청 수. 이미지 생성은 분당 장수 제한이 낮아서
 * 지문 수만큼 한꺼번에 보내면 429를 받고, 그러면 서버가 다음(구형) 모델로 넘어간다.
 */
const ILLUSTRATION_CONCURRENCY = 3;

type PassageDraft = {
  english: string;
  korean: string;
  source: string;
};

type PassageLine = {
  english: string;
  korean: string;
};

type PassageWorkbench = {
  english: string;
  korean: string;
  title: string;
  titleEn: string;
  source: string;
  lines: PassageLine[];
  selected: number[];
  editingEnglish: number[];
  analysisCards: LessonMaterialAnalysisCard[] | null;
  illustrationPrompt: string;
  illustrationUrl: string | null;
  comicCaptions: string[];
  generatingOrganization: boolean;
  generatingIllustration: boolean;
};

const EN_MAX = 2320;

function emptyWorkbench(english = "", korean = ""): PassageWorkbench {
  return {
    english,
    korean,
    title: "",
    titleEn: "",
    source: "",
    lines: [],
    selected: [],
    editingEnglish: [],
    analysisCards: null,
    illustrationPrompt: "",
    illustrationUrl: null,
    comicCaptions: [],
    generatingOrganization: false,
    generatingIllustration: false,
  };
}

function allIndexes(count: number) {
  return Array.from({ length: count }, (_, i) => i);
}

export function LessonMaterialsInputWizard({
  role,
  folderId = null,
  folderLabel = null,
  textbookOpen = false,
  outsideOpen = false,
  vocabAuto = false,
}: {
  role: "admin" | "teacher";
  /** 자료함에서 고른 폴더("unfiled"는 미분류). 없으면 미분류에 넣는다. */
  folderId?: string | null;
  /** 저장 위치로 보여 줄 폴더 이름 */
  folderLabel?: string | null;
  /** 교과서 본문을 열어 준 학원인지 — 아니면 교과서 단추를 아예 안 보인다 */
  textbookOpen?: boolean;
  /** 외부지문(수능특강 등)을 열어 준 학원인지 */
  outsideOpen?: boolean;
  /** 저장 때 같은 이름의 단어장도 만든다(단어 탭을 켠 학원) */
  vocabAuto?: boolean;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  /** 저장 뒤 수업용 자료·단어장을 자동으로 만드는 중 */
  const [autoMsg, setAutoMsg] = useState<string | null>(null);
  const [passages, setPassages] = useState<PassageDraft[]>([
    { english: "", korean: "", source: "" },
  ]);
  const [workbenches, setWorkbenches] = useState<PassageWorkbench[]>([]);
  const [activePassage, setActivePassage] = useState(0);
  const [translating, setTranslating] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [prepLoading, setPrepLoading] = useState(false);
  const [prepProgress, setPrepProgress] = useState({ done: 0, total: 0, label: "" });

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedProjectId, setSavedProjectId] = useState<string | null>(null);
  const [savedItemsCount, setSavedItemsCount] = useState<number>(0);
  const [savedProjectIds, setSavedProjectIds] = useState<string[]>([]);
  /** 지문 불러오기 창: 모의고사·교과서·외부지문 중 어느 쪽으로 열지 */
  const [mockOpen, setMockOpen] = useState<null | "mock" | "textbook" | "outside">(null);

  const saveAction =
    role === "admin"
      ? saveAdminLessonMaterialsFromWizard
      : saveTeacherLessonMaterialsFromWizard;

  const generateAction =
    role === "admin"
      ? generateAdminOrganizationDraft
      : generateTeacherOrganizationDraft;

  const totalEnCount = useMemo(
    () => passages.reduce((sum, p) => sum + (p.english?.length ?? 0), 0),
    [passages]
  );

  const wb = workbenches[activePassage] ?? null;
  const multi = workbenches.length > 1;

  function patchWorkbench(index: number, patch: Partial<PassageWorkbench>) {
    setWorkbenches((prev) => {
      const next = [...prev];
      const cur = next[index];
      if (!cur) return prev;
      next[index] = { ...cur, ...patch };
      return next;
    });
  }

  function updateLine(lineIdx: number, patch: Partial<PassageDraft>) {
    setWorkbenches((prev) => {
      const next = [...prev];
      const cur = next[activePassage];
      if (!cur) return prev;
      const lines = [...cur.lines];
      lines[lineIdx] = { ...lines[lineIdx]!, ...patch };
      next[activePassage] = { ...cur, lines };
      return next;
    });
  }

  async function fillKoreanForLines(current: PassageLine[]) {
    const needIdx = current
      .map((l, i) => ({ i, english: l.english.trim(), korean: l.korean.trim() }))
      .filter((x) => x.english.length > 0 && x.korean.length === 0);
    if (needIdx.length === 0) return current;

    setTranslating(true);
    try {
      const res = await translateLessonMaterialLinesAction({
        lines: needIdx.map((x) => x.english),
      });
      if (!res.ok) {
        setError(res.message);
        return current;
      }
      const byNeed = new Map(needIdx.map((x, j) => [x.i, res.korean[j] ?? ""]));
      return current.map((l, i) =>
        byNeed.has(i) ? { ...l, korean: byNeed.get(i) ?? l.korean } : l
      );
    } finally {
      setTranslating(false);
    }
  }

  /** 모의고사 지문 모음에서 고른 지문: 빈 칸을 지우고 뒤에 붙인다 */
  function addMockPassages(list: PickedMockPassage[]) {
    setPassages((prev) => {
      const kept = prev.filter((p) => p.english.trim() || p.korean.trim());
      // 교재에 실린 해석이 있으면 같이 채운다(다시 번역하지 않는다)
      const added = list.map((m) => ({ english: m.text.slice(0, EN_MAX), korean: (m.korean ?? "").trim(), source: m.label }));
      return [...kept, ...added];
    });
    setMockOpen(null);
  }

  function canGoNext() {
    return passages.some((p) => (p.english ?? "").trim().length >= 30);
  }

  async function runOrganizationForIndex(index: number): Promise<{
    illustrationPrompt: string;
    comicCaptions: string[];
  } | null> {
    const cur = workbenches[index];
    const english = cur?.english?.trim() || "";
    const korean = cur?.korean?.trim() || "";
    const prevTitle = cur?.title || "";
    const prevTitleEn = cur?.titleEn || "";
    if (!english) {
      setError("지문 영어가 비어 있습니다.");
      return null;
    }

    patchWorkbench(index, { generatingOrganization: true });
    setError(null);
    try {
      const res = await generateAction({
        items: [{ english, korean }],
      });
      if (!res.ok) {
        setError(res.message);
        return null;
      }
      const comicCaptions = res.comicCaptions ?? [];
      patchWorkbench(index, {
        title: res.passageTitle || prevTitle || "",
        titleEn: res.passageTitleEn || prevTitleEn || "",
        analysisCards: res.analysisCards,
        illustrationPrompt: res.illustrationPrompt,
        comicCaptions,
        generatingOrganization: false,
      });
      return {
        illustrationPrompt: res.illustrationPrompt,
        comicCaptions,
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : "분석 생성에 실패했습니다.");
      return null;
    } finally {
      patchWorkbench(index, { generatingOrganization: false });
    }
  }

  function resolveIllustrationPrompt(board: PassageWorkbench): string {
    const direct = board.illustrationPrompt.trim();
    if (direct.length >= 8) return direct;
    const hint = board.english.trim().slice(0, 600);
    if (hint.length >= 20) {
      return `One continuous 2x2 educational manhwa about this passage idea. Same characters in all panels. Soft narrative arc. No text, no speech bubbles in the art. Passage: ${hint}`;
    }
    return "";
  }

  /**
   * 지문 하나의 삽화를 만든다. 실패하면 사유를 돌려주고, 오류 표시는 호출부가 한다.
   * 일괄 생성은 여러 지문을 함께 돌리므로, 여기서 공용 오류를 지우거나 덮으면
   * 나중에 시작한 지문이 앞 지문의 실패를 지운다.
   */
  async function runIllustrationForIndex(
    index: number,
    overrides?: { illustrationPrompt?: string; comicCaptions?: string[] }
  ): Promise<string | null> {
    const cur = workbenches[index];
    if (!cur) {
      return "지문 정보가 없습니다. 이전 단계로 돌아가 다시 시도해 주세요.";
    }

    const prompt = (
      overrides?.illustrationPrompt?.trim() ||
      resolveIllustrationPrompt(cur)
    ).trim();
    const captions =
      overrides?.comicCaptions && overrides.comicCaptions.length > 0
        ? [...overrides.comicCaptions]
        : cur.comicCaptions.length > 0
          ? [...cur.comicCaptions]
          : [
              "이게 정말 맞을까?",
              "잠깐, 문제가 보이네",
              "다시 생각해 보자",
              "이제 이해가 됐어!",
            ];

    if (prompt.length < 8) {
      return "삽화에 쓸 내용이 없습니다. 「논리 흐름 재생성」을 한 뒤 다시 눌러 주세요.";
    }

    // Persist resolved prompt so later clicks keep working
    if (!cur.illustrationPrompt.trim() && prompt) {
      patchWorkbench(index, { illustrationPrompt: prompt });
    }

    patchWorkbench(index, { generatingIllustration: true });
    try {
      const res = await fetch("/api/lesson-materials/illustration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          illustrationPrompt: prompt,
          passageHint: cur.english.slice(0, 800),
          captions,
        }),
      });
      let img: { ok: true; url: string } | { ok: false; message: string };
      try {
        img = (await res.json()) as typeof img;
      } catch {
        return `삽화 응답을 읽지 못했습니다 (HTTP ${res.status}). 잠시 후 다시 시도해 주세요.`;
      }
      if (!res.ok || !img.ok) {
        return !img.ok ? img.message : `삽화 생성 실패 (HTTP ${res.status})`;
      }
      patchWorkbench(index, { illustrationUrl: img.url });
      return null;
    } catch (e) {
      return e instanceof Error
        ? `삽화 생성 중 오류: ${e.message}`
        : "삽화 생성 중 오류가 발생했습니다.";
    } finally {
      patchWorkbench(index, { generatingIllustration: false });
    }
  }

  async function handleNext() {
    setError(null);
    if (!canGoNext()) {
      setError("영어 지문을 최소 30자 이상 입력해 주세요.");
      return;
    }

    const filled = passages
      .map((p) => ({
        english: p.english.trim(),
        korean: p.korean.trim(),
        source: p.source.trim(),
      }))
      .filter((p) => p.english.length > 0);

    if (filled.length === 0) {
      setError("문장으로 나눌 영어 지문이 없습니다.");
      return;
    }

    const boards: PassageWorkbench[] = filled.map((p) => {
      const lines = splitPassageIntoLinePairs(p);
      return {
        ...emptyWorkbench(p.english, p.korean),
        source: p.source,
        lines,
        selected: allIndexes(lines.length),
      };
    });

    // Stay on step 1 with loading until AI (title/flow) finishes for all passages
    setPrepLoading(true);
    setPrepProgress({
      done: 0,
      total: boards.length,
      label: "지문 번역·분석 중…",
    });
    setWorkbenches(boards);
    setActivePassage(0);

    let failed = false;
    let completed = 0;
    try {
      // Parallel per-passage: line translation + organization can run together,
      // and multiple passages run concurrently for faster prep.
      await Promise.all(
        boards.map(async (_board, i) => {
          try {
            const [withKorean, orgRes] = await Promise.all([
              fillKoreanForLines(boards[i]!.lines),
              generateAction({
                items: [
                  {
                    english: boards[i]!.english,
                    korean: boards[i]!.korean,
                  },
                ],
              }),
            ]);

            boards[i] = {
              ...boards[i]!,
              lines: withKorean,
              selected: allIndexes(withKorean.length),
              generatingOrganization: false,
            };

            if (!orgRes.ok) {
              failed = true;
              setError(orgRes.message);
            } else {
              boards[i] = {
                ...boards[i]!,
                title: orgRes.passageTitle || "",
                titleEn: orgRes.passageTitleEn || "",
                analysisCards: orgRes.analysisCards,
                illustrationPrompt: orgRes.illustrationPrompt,
                comicCaptions: orgRes.comicCaptions ?? [],
              };
            }
          } catch (e) {
            failed = true;
            setError(e instanceof Error ? e.message : "분석 생성 실패");
            boards[i] = { ...boards[i]!, generatingOrganization: false };
          } finally {
            completed += 1;
            setPrepProgress({
              done: completed,
              total: boards.length,
              label: `지문 ${completed}/${boards.length} 준비됨`,
            });
          }
        })
      );

      setWorkbenches(boards.map((b) => ({ ...b })));
      if (!failed) {
        setStep(2);
      }
    } finally {
      setPrepLoading(false);
    }
  }

  function splitLineCard(idx: number) {
    const target = wb?.lines[idx];
    if (!target || !wb) return;
    const parts = splitEnglishSentences(target.english);
    if (parts.length <= 1) {
      setError("더 나눌 문장이 없습니다. 이미 한 줄입니다.");
      return;
    }
    const krParts = splitKoreanSentences(target.korean);
    const inserts = parts.map((english, i) => ({
      english,
      korean:
        krParts.length === parts.length
          ? (krParts[i] ?? "")
          : i === 0
            ? target.korean
            : "",
    }));
    const lines = [...wb.lines];
    lines.splice(idx, 1, ...inserts);
    const editing = wb.editingEnglish
      .filter((i) => i !== idx)
      .map((i) => (i > idx ? i + inserts.length - 1 : i));
    patchWorkbench(activePassage, {
      lines,
      selected: allIndexes(lines.length),
      editingEnglish: editing,
    });
  }

  async function translateOneLine(idx: number) {
    const target = wb?.lines[idx];
    if (!target?.english.trim()) return;
    setTranslating(true);
    setError(null);
    try {
      const res = await translateLessonMaterialLinesAction({
        lines: [target.english],
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      updateLine(idx, { korean: res.korean[0] ?? "" });
    } finally {
      setTranslating(false);
    }
  }

  async function handleBulkTranslate() {
    setBulkBusy(true);
    setError(null);
    try {
      for (let pi = 0; pi < workbenches.length; pi++) {
        const board = workbenches[pi]!;
        const withKorean = await fillKoreanForLines(board.lines);
        patchWorkbench(pi, {
          lines: withKorean,
          selected: allIndexes(withKorean.length),
        });
      }
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleBulkIllustrations() {
    // 누르자마자 지문마다 그려져 값이 나가서 당황한다(선생님 2026-10-26). 장 수와 값을 먼저 보여 준다.
    if (workbenches.length === 0) return;
    if (
      !(await askCreditConfirm({
        title: "삽화 일괄 생성",
        description: "지문마다 내용에 맞는 삽화를 한 장씩 그립니다. 이미 그린 삽화도 새로 그립니다.",
        subject: `지문 ${workbenches.length}개 · 삽화 ${workbenches.length}장`,
        items: [{ feature: "lesson_illustration", quantity: workbenches.length }],
        sample: "illustration",
      }))
    ) {
      return;
    }
    setBulkBusy(true);
    setError(null);
    try {
      // 삽화만 생성 — 제목·논리흐름은 재생성하지 않음.
      // 지문끼리는 독립이라 함께 띄운다. 서버는 요청 하나에 삽화 하나라 바꿀 것이 없다.
      const failures = await runWithConcurrency(
        workbenches.map((_, pi) => pi),
        ILLUSTRATION_CONCURRENCY,
        async (pi) => {
          const reason = await runIllustrationForIndex(pi);
          return reason ? `지문 ${pi + 1}: ${reason}` : null;
        }
      );
      const failed = failures.filter((row): row is string => row !== null);
      if (failed.length > 0) {
        setError(`삽화 ${failed.length}개를 만들지 못했습니다. ${failed.join(" / ")}`);
      }
    } finally {
      setBulkBusy(false);
    }
  }

  function insertLineAfter(idx: number) {
    if (!wb) return;
    const lines = [...wb.lines];
    lines.splice(idx + 1, 0, { english: "", korean: "" });
    const editing = wb.editingEnglish.map((i) => (i > idx ? i + 1 : i));
    editing.push(idx + 1);
    patchWorkbench(activePassage, {
      lines,
      selected: allIndexes(lines.length),
      editingEnglish: editing,
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const createdIds: string[] = [];
      let totalItems = 0;

      // 1번 지문부터 저장한다. 새 지문은 폴더 맨 뒤에 붙으므로(project-order.ts) 이 순서대로
      // 1번이 위, 마지막 지문이 아래에 놓인다. (예전에는 새 지문이 맨 위에 붙어 거꾸로 저장했다.)
      for (const board of workbenches) {
        const items = board.selected
          .slice()
          .sort((a, b) => a - b)
          .map((idx) => board.lines[idx]!)
          .map((p) => ({ english: p.english, korean: p.korean }))
          .filter((it) => it.english.trim().length > 0);

        if (items.length === 0) continue;

        const res = await saveAction({
          items,
          projectTitle: board.title.trim() || null,
          projectTitleEn: board.titleEn.trim() || null,
          projectSource: board.source.trim() || null,
          analysisCards: board.analysisCards ?? undefined,
          illustrationPrompt:
            board.illustrationPrompt.trim().length > 0
              ? board.illustrationPrompt
              : null,
          illustrationUrl: board.illustrationUrl,
          illustrationCaptions:
            board.comicCaptions.length > 0 ? board.comicCaptions : null,
          folderId,
        });
        if (!res.ok) {
          setError(res.message);
          return;
        }
        if (res.projectId) createdIds.push(res.projectId);
        totalItems += items.length;
      }

      if (createdIds.length === 0) {
        setError("저장할 문장이 없습니다. 체크박스를 확인해 주세요.");
        return;
      }
      // 저장 완료 화면과 이어지는 링크는 입력 순서(1번부터)를 쓴다.
      // 위에서 이미 1번 지문부터 저장했으므로 그대로 둔다. 예전에 거꾸로 저장하던
      // 때의 뒤집기가 남아 있어, 「지문 1 프로젝트 열기」가 마지막 지문을 열었다.
      // 지문을 넣으면 수업용 자료 파일과 같은 이름의 단어장을 바로 만든다(선생님 2026-11-11).
      // 수업용 자료는 파일만 만들고(값은 열 때 묻는다), 단어장은 단어 정리를 만들어 등록한다(값 없음 — 단어 탭과 같음).
      const autoName =
        (folderId && folderId !== "unfiled" && folderLabel?.trim()) ||
        workbenches.find((b) => b.title.trim())?.title.trim() ||
        `수업자료_${new Date().toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" }).replace(/\D/g, "")}`;
      const autoErrors: string[] = [];
      try {
        setAutoMsg("수업용 자료 파일을 만들고 있습니다…");
        const doc = await postJson<{ ok: true; id: string; name: string } | { ok: false; message: string }>(
          "/api/lesson-materials/documents/open",
          { op: "create", role, kind: "lesson_pack", projectIds: createdIds, name: autoName }
        );
        if (!doc.ok) autoErrors.push(`수업용 자료: ${doc.message}`);
        const setName = doc.ok ? doc.name : autoName;
        let done = 0;
        if (!vocabAuto) throw null;
        setAutoMsg(`단어장을 만들고 있습니다… (0/${createdIds.length})`);
        await runWithConcurrency(createdIds, PASSAGE_PREP_CONCURRENCY, async (id) => {
          try {
            const r = await postJson<{ ok: boolean; message?: string }>("/api/lesson-materials/test-book", { role, op: "prepareWorkbook", projectId: id, lessonTab: true });
            if (!r.ok) autoErrors.push(`단어 정리: ${r.message ?? ""}`);
          } catch (e) {
            autoErrors.push(`단어 정리: ${e instanceof Error ? e.message : "실패"}`);
          }
          setAutoMsg(`단어장을 만들고 있습니다… (${++done}/${createdIds.length})`);
        });
        const reg = await postJson<{ ok: boolean; message?: string }>("/api/lesson-materials/test-book", {
          role,
          op: "registerVocab",
          id: doc.ok ? doc.id : undefined,
          title: setName,
          projectIds: createdIds,
          lessonTab: true,
        });
        if (!reg.ok) autoErrors.push(`단어장: ${reg.message ?? ""}`);
      } catch (e) {
        if (e !== null) autoErrors.push(e instanceof Error ? e.message : "자동 만들기 실패");
      } finally {
        setAutoMsg(null);
      }
      if (autoErrors.length) setError(`지문은 저장했습니다. 다만 ${autoErrors.join(" · ")}`);

      setSavedProjectIds(createdIds);
      setSavedProjectId(createdIds[0] ?? null);
      setSavedItemsCount(totalItems);
      setStep(3);
    } finally {
      setSaving(false);
    }
  }

  function resetToStep1() {
    setStep(1);
    setWorkbenches([]);
    setActivePassage(0);
    setSavedProjectId(null);
    setSavedProjectIds([]);
    setSavedItemsCount(0);
  }

  return (
    <div className="relative px-4">
      {prepLoading ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-200">
          <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
            <p className="text-center text-lg font-bold text-slate-900">
              자료 준비 중
            </p>
            <p className="mt-2 text-center text-sm text-slate-600">
              {prepProgress.label || "잠시만 기다려 주세요…"}
            </p>
            <div className="mt-6 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-violet-600 transition-all duration-300"
                style={{
                  width: `${
                    prepProgress.total > 0
                      ? Math.round(
                          (prepProgress.done / prepProgress.total) * 100
                        )
                      : 0
                  }%`,
                }}
              />
            </div>
            <p className="mt-3 text-center text-2xl font-bold text-violet-700">
              {prepProgress.total > 0
                ? Math.round((prepProgress.done / prepProgress.total) * 100)
                : 0}
              %
            </p>
            <p className="mt-1 text-center text-xs text-slate-400">
              완료된 뒤에 편집 화면으로 이동합니다
            </p>
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">자료 입력</h1>
              <p className="mt-2 text-sm text-slate-600">
                영어 지문을 넣고, 필요하면 한글 해석도 직접 입력하세요. 지문이
                2개 이상이면 다음 단계에서 번호로 구분됩니다.
              </p>
            </div>
            <div className="shrink-0 text-right text-xs text-slate-500">
              총 {totalEnCount}자
            </div>
          </div>

          {error ? <Alert variant="error">{error}</Alert> : null}

          <PassageSheet
            rows={passages}
            onChange={setPassages}
            makeRow={() => ({ english: "", korean: "", source: "" })}
            footer={(addRow) => (
              <div className="flex w-full items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={addRow}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-white py-3 text-sm font-semibold text-slate-500 hover:border-slate-300 hover:text-slate-700"
                >
                  <span aria-hidden>+</span> 지문 추가하기
                </button>
                <button
                  type="button"
                  onClick={() => setMockOpen("mock")}
                  className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-violet-200 bg-white px-5 py-3 text-sm font-semibold text-violet-700 hover:border-violet-300 hover:bg-violet-50/50"
                >
                  모의고사 지문 불러오기
                </button>
                {textbookOpen ? (
                  <button
                    type="button"
                    onClick={() => setMockOpen("textbook")}
                    className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-violet-200 bg-white px-5 py-3 text-sm font-semibold text-violet-700 hover:border-violet-300 hover:bg-violet-50/50"
                  >
                    교과서 지문 불러오기
                  </button>
                ) : null}
                {outsideOpen ? (
                  <button
                    type="button"
                    onClick={() => setMockOpen("outside")}
                    className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-violet-200 bg-white px-5 py-3 text-sm font-semibold text-violet-700 hover:border-violet-300 hover:bg-violet-50/50"
                  >
                    외부지문 불러오기
                  </button>
                ) : null}

                <div className="shrink-0">
                  <Button
                    type="button"
                    size="md"
                    variant="secondary"
                    onClick={() => void handleNext()}
                    disabled={!canGoNext() || prepLoading}
                  >
                    {prepLoading ? "준비 중…" : "다음 단계로 →"}
                  </Button>
                </div>
              </div>
            )}
            columns={[
              {
                key: "english",
                label: "영어 지문",
                english: true,
                width: "54%",
                maxLength: EN_MAX,
                placeholder: "영어 지문을 붙여 넣으세요. 엑셀에서 여러 행을 복사해 붙여도 돼요.",
                help: "지문 한 편을 한 행에 넣어요. 지문이 여러 개면 행을 늘리세요.",
              },
              {
                key: "korean",
                label: "한국어 해석 (선택)",
                width: "28%",
                placeholder: "없으면 비워 두세요",
                help: "비워 두면 다음 단계에서 문장마다 해석을 채워요.",
              },
              {
                key: "source",
                label: "지문 출처 (선택)",
                singleLine: true,
                placeholder: "예: H1_2503_31",
                help: "자료함에서 지문 이름 앞에 보여요.",
              },
            ]}
          />

        </div>
      ) : null}

      {mockOpen ? (
        <MockPassagePickerModal
          initialSource={mockOpen}
          allowTextbook={textbookOpen}
          allowOutside={outsideOpen}
          onPick={addMockPassages}
          onClose={() => setMockOpen(null)}
        />
      ) : null}

      {step === 2 && wb ? (
        <div className="mx-auto max-w-6xl space-y-4">
          {multi ? (
            <div className="flex justify-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1.5 shadow-sm">
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                  disabled={activePassage <= 0}
                  onClick={() => setActivePassage((v) => Math.max(0, v - 1))}
                  aria-label="이전 지문"
                >
                  ‹
                </button>
                {workbenches.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setActivePassage(i)}
                    className={
                      i === activePassage
                        ? "flex h-9 w-9 items-center justify-center rounded-full bg-violet-600 text-sm font-bold text-white"
                        : "flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-slate-600 hover:bg-slate-100"
                    }
                  >
                    {i + 1}
                  </button>
                ))}
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                  disabled={activePassage >= workbenches.length - 1}
                  onClick={() =>
                    setActivePassage((v) =>
                      Math.min(workbenches.length - 1, v + 1)
                    )
                  }
                  aria-label="다음 지문"
                >
                  ›
                </button>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold tracking-wider text-slate-400">
                  TITLE
                </span>
                <button
                  type="button"
                  className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[11px] font-semibold text-violet-700 disabled:opacity-50"
                  disabled={wb.generatingOrganization || bulkBusy}
                  onClick={() => void runOrganizationForIndex(activePassage)}
                >
                  {wb.generatingOrganization ? "생성 중…" : "제목 재생성 ▾"}
                </button>
              </div>
              <input
                className="mt-1 w-full border-0 bg-transparent text-lg font-bold text-slate-900 outline-none placeholder:text-slate-300"
                value={wb.title}
                onChange={(e) =>
                  patchWorkbench(activePassage, { title: e.target.value })
                }
                placeholder="한국어 제목"
              />
              <div className="mt-2 flex items-center gap-2">
                <span className="shrink-0 text-[10px] font-bold tracking-wider text-slate-400">
                  EN
                </span>
                <input
                  className="w-full border-0 bg-transparent text-base font-semibold text-slate-700 outline-none placeholder:text-slate-300"
                  value={wb.titleEn}
                  onChange={(e) =>
                    patchWorkbench(activePassage, { titleEn: e.target.value })
                  }
                  placeholder="English title"
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-500">
                  출처
                </span>
                <input
                  className="min-w-[180px] flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
                  value={wb.source}
                  onChange={(e) =>
                    patchWorkbench(activePassage, { source: e.target.value })
                  }
                  placeholder="예: H1_2503_31"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                className="bg-violet-600 hover:bg-violet-700"
                disabled={bulkBusy}
                onClick={() => void handleBulkIllustrations()}
              >
                {bulkBusy ? "처리 중…" : "삽화 일괄 생성 ▾"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={bulkBusy || translating}
                onClick={() => void handleBulkTranslate()}
              >
                {translating || bulkBusy ? "번역 중…" : "전체 일괄 번역 ▾"}
              </Button>
            </div>
          </div>

          {error ? <Alert variant="error">{error}</Alert> : null}

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
              <LessonMaterialLogicalFlow
                cards={wb.analysisCards}
                loading={wb.generatingOrganization && !wb.analysisCards}
                regenerating={wb.generatingOrganization}
                onRegenerate={() => void runOrganizationForIndex(activePassage)}
              />

              <section className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-bold text-slate-900">
                  4컷 만화 삽화
                  {multi ? (
                    <span className="ml-2 text-xs font-medium text-slate-500">
                      지문 {activePassage + 1}
                    </span>
                  ) : null}
                </h3>
                <div className="mt-3">
                  <LessonMaterialComicFrame
                    imageUrl={wb.illustrationUrl}
                    emptyHint={
                      wb.generatingIllustration
                        ? "4컷 만화를 그리는 중입니다. 최대 1분 정도 걸릴 수 있습니다."
                        : "「삽화 만들기」를 누르면 생성됩니다."
                    }
                  />
                </div>
                {wb.comicCaptions.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    <div className="text-xs font-semibold text-slate-600">
                      말풍선 대사 (수정 후 삽화 만들기)
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {wb.comicCaptions.map((c, i) => (
                        <input
                          key={i}
                          className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-800"
                          value={c}
                          onChange={(e) => {
                            const v = e.target.value;
                            const next = [...wb.comicCaptions];
                            next[i] = v;
                            patchWorkbench(activePassage, {
                              comicCaptions: next,
                            });
                          }}
                          placeholder={`${i + 1}컷 대사`}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="bg-brand-600 hover:bg-brand-700"
                    disabled={
                      wb.generatingIllustration ||
                      wb.generatingOrganization ||
                      bulkBusy ||
                      (!wb.illustrationPrompt.trim() &&
                        wb.english.trim().length < 20)
                    }
                    onClick={() =>
                      void (async () => {
                        setError(null);
                        setError(
                          await runIllustrationForIndex(activePassage, {
                            illustrationPrompt: wb.illustrationPrompt,
                            comicCaptions: wb.comicCaptions,
                          })
                        );
                      })()
                    }
                  >
                    {wb.generatingIllustration
                      ? "생성 중…"
                      : wb.illustrationUrl
                        ? "삽화만 다시 그리기"
                        : "삽화 만들기"}
                  </Button>
                </div>
              </section>
            </div>

            <section className="mt-5 space-y-3">
              {wb.lines.map((p, idx) => {
                const isChecked = wb.selected.includes(idx);
                const isEditing = wb.editingEnglish.includes(idx);
                return (
                  <div
                    key={idx}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                            {multi
                              ? `지문${activePassage + 1} · 문장 ${idx + 1}`
                              : `문장 ${idx + 1}`}
                          </span>
                          <span className="text-xs text-slate-500">
                            한줄해석
                          </span>
                        </div>

                        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
                          <div className="rounded-xl bg-rose-50 p-3">
                            <div className="text-xs font-bold text-rose-600">
                              영어
                            </div>
                            {isEditing ? (
                              <textarea
                                className="mt-1 min-h-[56px] w-full resize-y rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm leading-relaxed text-rose-900"
                                value={p.english}
                                onChange={(e) =>
                                  updateLine(idx, { english: e.target.value })
                                }
                              />
                            ) : (
                              <div className="mt-1 whitespace-pre-wrap text-sm text-rose-900">
                                {p.english?.trim()
                                  ? p.english
                                  : "영어 지문이 비어 있습니다."}
                              </div>
                            )}
                          </div>

                          <div className="rounded-xl border border-slate-200 bg-white p-3">
                            <div className="text-xs font-bold text-slate-600">
                              한국어 해석
                            </div>
                            <textarea
                              className="mt-2 min-h-[56px] w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-800"
                              placeholder="자동 번역 버튼을 누르거나 직접 입력"
                              value={p.korean}
                              onChange={(e) =>
                                updateLine(idx, { korean: e.target.value })
                              }
                            />
                          </div>

                          <div className="flex items-start justify-end">
                            <input
                              type="checkbox"
                              className="mt-2 h-4 w-4"
                              checked={isChecked}
                              onChange={() => {
                                const set = new Set(wb.selected);
                                if (set.has(idx)) set.delete(idx);
                                else set.add(idx);
                                patchWorkbench(activePassage, {
                                  selected: [...set],
                                });
                              }}
                            />
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600"
                            onClick={() => {
                              const set = new Set(wb.editingEnglish);
                              if (set.has(idx)) set.delete(idx);
                              else set.add(idx);
                              patchWorkbench(activePassage, {
                                editingEnglish: [...set],
                              });
                            }}
                          >
                            ✏️ {isEditing ? "영어 편집 완료" : "영어 편집하기"}
                          </button>
                          <button
                            type="button"
                            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600"
                            onClick={() => splitLineCard(idx)}
                          >
                            ✂️ 영어 나누기
                          </button>
                          <button
                            type="button"
                            className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs text-brand-700 disabled:opacity-50"
                            disabled={translating || !p.english.trim()}
                            onClick={() => void translateOneLine(idx)}
                          >
                            🇰🇷 한글 해석 (자동)
                          </button>
                          <button
                            type="button"
                            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600"
                            onClick={() => insertLineAfter(idx)}
                          >
                            🧩 정리 추가하기
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <Button type="button" variant="ghost" onClick={resetToStep1}>
                ← 이전 단계
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={
                  saving ||
                  bulkBusy ||
                  translating ||
                  workbenches.every((b) => b.selected.length === 0)
                }
                onClick={() => void handleSave()}
                className="min-w-[220px]"
              >
                {saving ? (autoMsg ?? "저장 중…") : "자료 저장 완료 →"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">저장 완료</h2>
          <p className="mt-2 text-sm text-slate-600">
            {savedProjectIds.length > 1
              ? `지문 ${savedProjectIds.length}개를 각각 프로젝트로 저장했습니다.`
              : "한줄해석으로 나눠 저장했습니다. 자료함에서 확인할 수 있습니다."}{" "}
            (문장 {savedItemsCount}개)
          </p>
          {error ? <Alert variant="error" className="mt-4">{error}</Alert> : null}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <Button type="button" variant="ghost" onClick={resetToStep1}>
              다시 입력
            </Button>
            <button
              type="button"
              // 브라우저가 들고 있던 옛 목록이 보이지 않도록 아예 새로 연다
              onClick={() =>
                window.location.assign(
                  role === "admin" ? "/admin/lesson-materials" : "/teacher/lesson-materials"
                )
              }
              className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700"
            >
              자료함으로 이동
            </button>
          </div>

          {savedProjectId ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {savedProjectIds.map((id, i) => (
                <Link
                  key={id}
                  href={
                    role === "admin"
                      ? `/admin/lesson-materials/project/${id}`
                      : `/teacher/lesson-materials/project/${id}`
                  }
                  className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800"
                >
                  {savedProjectIds.length > 1
                    ? `지문 ${i + 1} 프로젝트 열기 →`
                    : "프로젝트 열기 →"}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
