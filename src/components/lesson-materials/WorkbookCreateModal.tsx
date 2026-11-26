"use client";

import { openNewDocument } from "@/components/lesson-materials/open-new-document";

import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { HoverPreview, PreviewShot } from "@/components/ui/HoverPreview";
import { workbookTypePreview } from "@/lib/type-previews";
import { askCreditConfirm } from "@/lib/credits/confirm-store";
import {
  DEFAULT_WORKBOOK_BLANK_OPTIONS,
  DEFAULT_WORKBOOK_GIST_OPTIONS,
  DEFAULT_WORKBOOK_GRAMMAR_FIX_OPTIONS,
  GIST_KIND_LABEL,
  MAX_GIST_COUNT,
  clampGistCount,
  gistOptionsParam,
  type WorkbookGistOptions,
  DEFAULT_WORKBOOK_TF_OPTIONS,
  GRAMMAR_FIX_ERROR_COUNTS,
  MAX_TF_COUNT,
  WORKBOOK_TYPE_CATALOG,
  clampGrammarFixErrors,
  clampTfCount,
  type WorkbookGrammarFixOptions,
  defaultWorkbookTitle,
  estimateBlankCountPreview,
  getWorkbookTypeMeta,
  isTbWorkbookType,
  TB_PAID_WORKBOOK_TYPES,
  WORKBOOK_RULE_TYPES,
  sortWorkbookTypesByPrintOrder,
  type WorkbookBlankFillOptions,
  type WorkbookData,
  type WorkbookTfOptions,
  type WorkbookTypeId,
} from "@/lib/lesson-materials/workbook-types";
import { DEFAULT_VOCAB_EXAM, type VocabExamOptions } from "@/lib/lesson-materials/test-book";
import { workbookExistingTypesForAdd } from "@/lib/lesson-materials/workbook-merge";
import { VocabExamControls } from "@/components/lesson-materials/test-book/TestBookControls";
import { useVocabExamCaps } from "@/components/lesson-materials/test-book/useVocabExamCaps";

export const WORKBOOK_SESSION_KEY = "lesson-materials-workbook-v6";

export function saveWorkbookToSession(workbook: WorkbookData) {
  try {
    localStorage.setItem(WORKBOOK_SESSION_KEY, JSON.stringify(workbook));
  } catch {
    /* ignore */
  }
}

export function loadWorkbookFromSession(): WorkbookData | null {
  try {
    const raw = localStorage.getItem(WORKBOOK_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WorkbookData;
  } catch {
    return null;
  }
}

/** Build workbook preview URL (opens in a new tab like lesson-pack). */
export function buildWorkbookHref(
  role: "admin" | "teacher",
  opts: {
    projectIds: string[];
    selectedTypes: WorkbookTypeId[];
    tfOptions: WorkbookTfOptions;
    blankOptions: WorkbookBlankFillOptions;
    grammarFixOptions?: WorkbookGrammarFixOptions;
    vocabFixOptions?: WorkbookGrammarFixOptions;
    /** 어휘 선택·수정 낱말 수준 */
    vocabWordLevel?: "normal" | "hard";
    /** 테스트 교재에서 옮긴 유형의 난이도(지금은 바꿔 말하기만 달라진다) */
    tbLevel?: "basic" | "up";
    /** 단어 시험 유형마다 문항 수 */
    vocabExam?: VocabExamOptions;
    /** 제목·주제·요지 해석: 갈래마다 개수 */
    gistOptions?: WorkbookGistOptions;
    title: string;
    /** 저장된 결과(어법·어휘·빈칸·어순)가 있어도 새 문항으로 만든다. */
    regenerate?: boolean;
  }
) {
  const base =
    role === "admin"
      ? "/admin/lesson-materials/workbook"
      : "/teacher/lesson-materials/workbook";
  const types = sortWorkbookTypesByPrintOrder(opts.selectedTypes);
  const params = new URLSearchParams();
  params.set("ids", opts.projectIds.join(","));
  params.set("types", types.join(","));
  params.set("count", String(clampTfCount(opts.tfOptions.count)));
  params.set("lang", opts.tfOptions.language);
  params.set("diff", opts.tfOptions.difficulty);
  params.set("blankHint", opts.blankOptions.hintType);
  params.set("blankTr", opts.blankOptions.showTranslation ? "1" : "0");
  params.set("blankLayout", opts.blankOptions.translationLayout);
  params.set("blankDensity", opts.blankOptions.density ?? "high");
  if (types.includes("grammar_fix")) {
    const gf = opts.grammarFixOptions ?? DEFAULT_WORKBOOK_GRAMMAR_FIX_OPTIONS;
    params.set("gfMode", gf.mode);
    params.set("gfErrors", String(clampGrammarFixErrors(gf.errorCount)));
  }
  if (types.includes("vocab_fix")) {
    const vf = opts.vocabFixOptions ?? DEFAULT_WORKBOOK_GRAMMAR_FIX_OPTIONS;
    params.set("vfMode", vf.mode);
    params.set("vfErrors", String(clampGrammarFixErrors(vf.errorCount)));
  }
  if (types.includes("vocab_choice") || types.includes("vocab_fix")) {
    params.set("vcLevel", opts.vocabWordLevel ?? "normal");
  }
  if (opts.tbLevel === "up" && types.some(isTbWorkbookType)) params.set("tbLevel", "up");
  if (types.includes("gist_ko")) params.set("gist", gistOptionsParam(opts.gistOptions ?? DEFAULT_WORKBOOK_GIST_OPTIONS));
  if (types.includes("tb_vocab_exam") && opts.vocabExam) {
    params.set("vx", Object.entries(opts.vocabExam.counts).map(([k, n]) => `${k}:${n}`).join(","));
  }
  params.set("title", opts.title.trim() || defaultWorkbookTitle());
  params.set("fresh", "1");
  if (opts.regenerate) params.set("regen", "1");
  return `${base}?${params.toString()}`;
}

/** 고른 갈래 가운데 값이 나가는 것(지문 n개). 만들기 창과 유형 추가 창이 같은 계산을 쓴다. */
export function workbookPaidItems(types: WorkbookTypeId[], n: number): Array<{ feature: string; quantity: number }> {
  const paid: Array<{ feature: string; quantity: number }> = [];
  if (types.includes("grammar_choice") || types.includes("grammar_fix"))
    paid.push({ feature: "lesson_workbook_grammar_choice", quantity: n });
  if (types.includes("vocab_choice") || types.includes("vocab_fix"))
    paid.push({ feature: "lesson_workbook_vocab_choice", quantity: n });
  if (types.includes("tf")) paid.push({ feature: "lesson_workbook_tf", quantity: n });
  if (types.includes("gist_ko")) paid.push({ feature: "lesson_workbook_gist", quantity: n });
  // 한 줄 해석·전체 영작·제시어 배열도 모델을 부른다(2026-09-29부터 값을 받는다)
  if (
    types.includes("one_line_ko") ||
    // 해석 적기를 끊어 읽기로 골라도 문장마다와 같은 값(선생님 2026-10-27)
    (types.includes("tb_chunk_line") && !types.some((t) => isTbWorkbookType(t) && t !== "tb_chunk_line")) ||
    types.includes("full_en_writing") ||
    types.includes("word_order_writing") ||
    types.includes("key_word_order")
  )
    paid.push({ feature: "lesson_workbook_line_translation", quantity: n });
  // 중요문장 어순배열은 어순배열과 같은 값(둘 다 골라도 한 번)
  if (types.includes("word_order_writing") || types.includes("key_word_order"))
    paid.push({ feature: "lesson_workbook_word_order", quantity: n });
  // 요약문·도식화·지칭·함축·바꿔 말하기·단어 시험(·다른 유형과 함께 고른 끊어 읽기)은 고른 유형마다 지문당
  // 값을 받는다. 연결어·글의 순서·문장 삽입은 규칙으로만 만들어 받지 않는다(선생님 2026-10-28 — 예전에는 무엇을
  // 골라도 묶음 값 200). 끊어 읽기만이면 위 한 줄 해석 값으로 받는다.
  const tbPaid = types.filter(
    (t) =>
      TB_PAID_WORKBOOK_TYPES.has(t) &&
      (t !== "tb_chunk_line" || types.some((o) => isTbWorkbookType(o) && o !== "tb_chunk_line"))
  ).length;
  if (tbPaid) paid.push({ feature: "lesson_workbook_tb_type", quantity: n * tbPaid });
  // 빈칸 채우기·문장 순서 배열·연결어·글의 순서·문장 삽입은 유형마다 지문당 5(선생님 2026-10-28)
  const rulePaid = types.filter((t) => WORKBOOK_RULE_TYPES.has(t)).length;
  if (rulePaid) paid.push({ feature: "lesson_workbook_rule_type", quantity: n * rulePaid });
  return paid;
}

type Step = "types" | "options";

export function WorkbookCreateModal({
  role,
  projectIds,
  open,
  onClose,
  mode = "create",
  existingTypes,
  onAdd,
}: {
  role: "admin" | "teacher";
  projectIds: string[];
  open: boolean;
  onClose: () => void;
  /**
   * "add"면 만들어 둔 워크북에 유형을 더하는 창(선생님 2026-10-24). 이미 있는 유형은 막아 두고,
   * 제목은 묻지 않으며, 새 파일을 열지 않고 onAdd에 만든 조건(주소 쿼리)을 넘긴다.
   * "regen"은 반대로 이미 있는 유형만 골라 새로 만들어 그 자리에 바꿔 넣는다(선생님 2026-10-24:
   * 업데이트하거나 마음에 안 드는 부분 다시 만들기). 흐름은 add와 같고 「새 문항으로」가 기본 켬이다.
   */
  mode?: "create" | "add" | "regen";
  /** 유형 추가 창: 워크북에 이미 있는 유형 */
  existingTypes?: WorkbookTypeId[];
  /** 유형 추가 창: 값 확인까지 끝난 뒤 만든 조건을 받는다(ids·types·옵션·fresh=1·regen) */
  onAdd?: (query: string) => void | Promise<void>;
}) {
  const adding = mode === "add" || mode === "regen";
  const regen = mode === "regen";
  const existing = useMemo(() => workbookExistingTypesForAdd(existingTypes ?? []), [existingTypes]);
  /** 이 창에서 고를 수 없는 유형: 추가는 이미 있는 것, 다시 만들기는 없는 것 */
  const blocked = (id: WorkbookTypeId) => (regen ? !existing.has(id) : existing.has(id));
  const [step, setStep] = useState<Step>("types");
  /*
   * 선생님 지적(2026-09-29): "과금 표시가 아래창으로 떠서 중복으로 뜨니 불편해."
   * 값 확인 창이 이 창 위에 겹쳐 떠서 창이 둘로 보였다. 묻는 동안에는 이 창을 접는다.
   */
  const [asking, setAsking] = useState(false);
  /** 마우스를 올린 유형: 실제 워크북을 찍은 그림을 옆에 띄운다(선생님 2026-10-26) */
  const [hover, setHover] = useState<{ id: WorkbookTypeId; box: DOMRect } | null>(null);
  const [selected, setSelected] = useState<Set<WorkbookTypeId>>(
    () => new Set(adding ? [] : ["tf"])
  );
  const [tfOptions, setTfOptions] = useState<WorkbookTfOptions>(
    DEFAULT_WORKBOOK_TF_OPTIONS
  );
  const [blankOptions, setBlankOptions] = useState<WorkbookBlankFillOptions>(
    DEFAULT_WORKBOOK_BLANK_OPTIONS
  );
  const [grammarFixOptions, setGrammarFixOptions] = useState<WorkbookGrammarFixOptions>(
    DEFAULT_WORKBOOK_GRAMMAR_FIX_OPTIONS
  );
  const [vocabFixOptions, setVocabFixOptions] = useState<WorkbookGrammarFixOptions>(
    DEFAULT_WORKBOOK_GRAMMAR_FIX_OPTIONS
  );
  const [vocabWordLevel, setVocabWordLevel] = useState<"normal" | "hard">("normal");
  // 테스트 교재 유형 난이도 UP은 바꿔 말하기에만 있었다 — 바꿔 말하기를 빼며 늘 기본(2026-10-21)
  const tbLevel = "basic" as "basic" | "up";
  const [vocabExam, setVocabExam] = useState<VocabExamOptions>(DEFAULT_VOCAB_EXAM);
  const [gistOptions, setGistOptions] = useState<WorkbookGistOptions>(DEFAULT_WORKBOOK_GIST_OPTIONS);
  /** 해석 적기: 문장마다(한줄해석) / 끊어 읽기(직독직해) */
  const [lineMode, setLineMode] = useState<"full" | "chunk">("full");
  const [title, setTitle] = useState(() => defaultWorkbookTitle());
  const [regenerate, setRegenerate] = useState(mode === "regen");
  const [error, setError] = useState<string | null>(null);

  const readySelected = useMemo(
    () =>
      sortWorkbookTypesByPrintOrder(
        [...selected].filter(
          (id) => WORKBOOK_TYPE_CATALOG.find((c) => c.id === id)?.ready
        )
      ),
    [selected]
  );
  const hasPendingSelected = useMemo(
    () =>
      [...selected].some(
        (id) => WORKBOOK_TYPE_CATALOG.find((c) => c.id === id)?.ready === false
      ),
    [selected]
  );
  const wantTf = selected.has("tf");
  const wantBlank = selected.has("blank_fill");
  const wantSentenceOrder = selected.has("sentence_order");
  const wantGrammarFix = selected.has("grammar_fix");
  const wantVocabFix = selected.has("vocab_fix");
  const wantVocabChoice = selected.has("vocab_choice");
  const wantLineKo = selected.has("one_line_ko");
  const wantFullEn = selected.has("full_en_writing");
  const wantWordOrder = selected.has("word_order_writing");
  const wantKeyWordOrder = selected.has("key_word_order");
  const wantVocabExam = selected.has("tb_vocab_exam");
  /** 고른 지문의 단어 수·유형마다 최대 문항 수(만들기 전에 보인다, 값 없음) */
  const vocabCaps = useVocabExamCaps(role, projectIds, open && wantVocabExam);
  const wantGist = selected.has("gist_ko");

  if (!open || asking) return null;

  function toggleType(id: WorkbookTypeId, ready: boolean) {
    if (!ready || (adding && blocked(id))) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function goNext() {
    setError(null);
    if (selected.size === 0) {
      setError("문제 유형을 하나 이상 선택해 주세요.");
      return;
    }
    if (hasPendingSelected) {
      setError(
        "준비 중인 유형이 포함되어 있습니다. 준비된 유형만 선택해 주세요."
      );
      return;
    }
    if (readySelected.length === 0) {
      setError("생성 가능한 유형을 선택해 주세요.");
      return;
    }
    setStep("options");
  }

  async function handleStart() {
    setError(null);
    if (projectIds.length === 0) {
      setError("선택된 자료가 없습니다.");
      return;
    }
    if (wantGist && gistOptions.title + gistOptions.topic + gistOptions.gist === 0) {
      setError("제목·주제·요지 해석은 적어도 한 갈래의 개수를 1 이상으로 해 주세요.");
      return;
    }
    // 해석 적기를 끊어 읽기로 고르면 직독직해 유형으로 만든다
    const types = lineMode === "chunk" ? readySelected.map((t) => (t === "one_line_ko" ? "tb_chunk_line" : t)) : readySelected;
    const href = buildWorkbookHref(role, {
      projectIds: [...projectIds],
      selectedTypes: types,
      tfOptions: {
        ...tfOptions,
        count: clampTfCount(tfOptions.count),
      },
      blankOptions,
      grammarFixOptions,
      vocabFixOptions,
      vocabWordLevel,
      tbLevel,
      vocabExam,
      gistOptions,
      title: title.trim() || defaultWorkbookTitle(),
      regenerate,
    });
    // 고른 갈래 가운데 값이 나가는 것만 묻는다(한줄해석·영작 등은 값이 들지 않는다).
    const paid = workbookPaidItems(types, projectIds.length || 1);
    setAsking(true);
    const go = await askCreditConfirm({
      title: regen ? "워크북에서 다시 만들 유형" : adding ? "워크북에 더할 유형" : "워크북",
      description: regen
        ? "고른 유형을 새로 만들어 지금 워크북의 그 자리에 바꿔 넣습니다. 고른 갈래 가운데 값이 나가는 것만 아래에 적었습니다."
        : adding
          ? "만들어 둔 워크북에 유형을 더합니다. 고른 갈래 가운데 값이 나가는 것만 아래에 적었습니다."
          : "학생이 직접 써 보는 연습지를 만듭니다. 고른 갈래 가운데 값이 나가는 것만 아래에 적었습니다.",
      subject: `${adding ? "워크북의 지문" : "고른 지문"} ${projectIds.length}개 · 갈래 ${types.length}가지`,
      contents: types.map((t) => getWorkbookTypeMeta(t)?.title ?? t),
      items: paid,
      sample: "workbook",
    });
    setAsking(false);
    if (!go) return;

    if (adding) {
      // 새 파일을 열지 않는다. 워크북 화면이 이 조건으로 더할 유형만 만들어 파일에 합친다.
      await onAdd?.(href.slice(href.indexOf("?") + 1));
      onClose();
      setStep("types");
      return;
    }

    // 워크북도 파일로 저장한다. 제목이 곧 파일 이름이고, 만든 조건(유형·옵션)을 함께 둔다.
    const err = await openNewDocument(role, "workbook", [...projectIds], {
      name: title.trim() || defaultWorkbookTitle(),
      query: href.slice(href.indexOf("?") + 1),
    });
    if (err) {
      setError(err);
      return;
    }
    onClose();
    setStep("types");
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between bg-gradient-to-r from-orange-400 via-rose-400 to-violet-500 px-5 py-4 text-white">
          <div className="flex items-center gap-2">
            <span className="text-lg" aria-hidden>
              📘
            </span>
            <h2 className="text-base font-bold">{regen ? "워크북 다시 만들기" : adding ? "워크북에 유형 추가" : "워크북 만들기"}</h2>
          </div>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-lg leading-none hover:bg-white/20"
            onClick={onClose}
            aria-label="닫기"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {step === "types" ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {regen ? (
                <p className="text-[11px] text-slate-500 sm:col-span-2">
                  이 워크북에 들어 있는 유형만 고를 수 있습니다. 고른 유형은 지문 {projectIds.length}개로 새로 만들어 그 자리에 바꿔 넣고, 다른 유형과 고친 내용은 그대로 둡니다.
                </p>
              ) : adding ? (
                <p className="text-[11px] text-slate-500 sm:col-span-2">
                  이미 들어 있는 유형은 고를 수 없습니다. 더한 유형은 지금 워크북의 지문 {projectIds.length}개로 만들어 뒤에 붙습니다.
                </p>
              ) : null}
              {WORKBOOK_TYPE_CATALOG.filter((t) => !t.hidden).map((t) => {
                const on = selected.has(t.id);
                const have = adding && blocked(t.id);
                return (
                  // 꺼진 버튼은 마우스 이벤트가 안 와서, 고를 수 없는 유형도 미리보기가 뜨게 감싼 칸에서 받는다
                  <div
                    key={t.id}
                    className="flex"
                    onMouseEnter={(e) => setHover({ id: t.id, box: e.currentTarget.getBoundingClientRect() })}
                    onMouseLeave={() => setHover(null)}
                  >
                    <button
                      type="button"
                      disabled={!t.ready || have}
                      onClick={() => toggleType(t.id, t.ready)}
                      className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition disabled:pointer-events-none ${
                        !t.ready || have
                          ? "cursor-not-allowed border-slate-100 bg-slate-50 opacity-60"
                          : on
                            ? "border-violet-400 bg-violet-50 ring-1 ring-violet-300"
                            : "border-slate-200 bg-white hover:border-violet-200"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] font-bold ${
                          on && t.ready
                            ? "border-violet-600 bg-violet-600 text-white"
                            : "border-slate-300 bg-white text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">
                            {t.title}
                          </span>
                          {!t.ready ? (
                            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                              준비 중
                            </span>
                          ) : have ? (
                            <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                              {regen ? "없음" : "이미 있음"}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                          {t.subtitle}
                        </span>
                      </span>
                    </button>
                  </div>
                );
              })}
              {hover ? <WorkbookTypeHover id={hover.id} box={hover.box} /> : null}
            </div>
          ) : (
            <div className="space-y-5">
              {adding ? null : (
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-slate-600">
                    워크북 제목
                  </span>
                  <input
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
              )}

              <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={regenerate}
                  onChange={(e) => setRegenerate(e.target.checked)}
                />
                <span className="text-xs text-slate-700">
                  <span className="font-bold">새 문항으로 다시 만들기</span>
                  <span className="block text-[11px] text-slate-500">
                    {regen
                      ? "켜면 어법·어휘·빈칸·어순배열과 요약·지칭 같은 재료를 처음부터 새로 만들어 다른 문항이 나옵니다(시간과 값이 더 듭니다). 끄면 전에 만든 재료를 다시 써서 T/F·해석처럼 매번 새로 만드는 유형만 달라집니다."
                      : "끄면 전에 만든 문항 재료를 다시 써서 빠르게 만듭니다. 켜면 어법·어휘·빈칸·어순배열을 처음부터 새로 만들어 시간과 비용이 더 듭니다."}
                  </span>
                </span>
              </label>

              {wantBlank ? (
                <div className="space-y-3">
                  <p className="text-sm font-bold text-slate-900">
                    빈칸 채우기 개수
                  </p>
                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <OptionRow tone="violet" label="밀도">
                      <div className="space-y-2">
                        <TogglePair
                          tone="violet"
                          left={{ id: "standard", label: "기본" }}
                          right={{ id: "high", label: "많이" }}
                          value={blankOptions.density}
                          onChange={(density) =>
                            setBlankOptions((o) => ({
                              ...o,
                              density: density as "standard" | "high",
                            }))
                          }
                        />
                        <p className="text-[11px] text-violet-600">
                          지문 길이와 힌트 설정에 따라 빈칸 수가 자동으로
                          조절됩니다.
                        </p>
                        {(() => {
                          const { low, high } =
                            estimateBlankCountPreview(blankOptions);
                          return (
                            <p className="text-[11px] font-semibold text-slate-600">
                              {projectIds.length > 1
                                ? `지문별 길이에 따라 약 ${low}~${high}개의 빈칸이 생성됩니다.`
                                : low === high
                                  ? `선택한 지문에는 약 ${low}개의 빈칸이 생성됩니다.`
                                  : `선택한 지문에는 약 ${low}~${high}개의 빈칸이 생성됩니다.`}
                            </p>
                          );
                        })()}
                      </div>
                    </OptionRow>
                  </div>

                  <p className="text-sm font-bold text-slate-900">
                    빈칸 채우기 힌트 설정
                  </p>
                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <OptionRow tone="violet" label="힌트">
                      <TogglePair
                        tone="violet"
                        left={{ id: "first_letter", label: "첫 스펠링 표기" }}
                        right={{ id: "none", label: "힌트 없음" }}
                        value={blankOptions.hintType}
                        onChange={(hintType) =>
                          setBlankOptions((o) => ({
                            ...o,
                            hintType: hintType as "first_letter" | "none",
                          }))
                        }
                      />
                    </OptionRow>
                  </div>

                  <p className="text-sm font-bold text-slate-900">
                    빈칸 채우기 해설 설정
                  </p>
                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <OptionRow tone="violet" label="해석">
                      <div className="space-y-2">
                        <TogglePair
                          tone="violet"
                          left={{ id: "on", label: "해석 제공" }}
                          right={{ id: "off", label: "해석 미제공" }}
                          value={blankOptions.showTranslation ? "on" : "off"}
                          onChange={(v) =>
                            setBlankOptions((o) => ({
                              ...o,
                              showTranslation: v === "on",
                            }))
                          }
                        />
                        <p className="text-[11px] text-violet-600">
                          문제 하단에 한글 해석 표시
                        </p>
                      </div>
                    </OptionRow>
                  </div>

                  <p className="text-sm font-bold text-slate-900">
                    빈칸 채우기 레이아웃
                  </p>
                  <div
                    className={`overflow-hidden rounded-xl border border-slate-200 ${
                      !blankOptions.showTranslation
                        ? "pointer-events-none opacity-50"
                        : ""
                    }`}
                  >
                    <OptionRow tone="violet" label="배치">
                      <TogglePair
                        tone="violet"
                        left={{ id: "chunk", label: "영어, 한글별 청크 배치" }}
                        right={{
                          id: "sentence_pair",
                          label: "영어, 한글 1줄씩 배치",
                        }}
                        value={blankOptions.translationLayout}
                        onChange={(translationLayout) =>
                          setBlankOptions((o) => ({
                            ...o,
                            translationLayout:
                              translationLayout as WorkbookBlankFillOptions["translationLayout"],
                          }))
                        }
                      />
                    </OptionRow>
                  </div>
                </div>
              ) : null}

              {wantTf ? (
                <div className="space-y-3">
                  <p className="text-sm font-bold text-slate-900">T/F 옵션</p>
                  <div className="space-y-0 overflow-hidden rounded-xl border border-slate-200">
                    <OptionRow tone="coral" label="T/F 선택지 갯수">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={MAX_TF_COUNT}
                          className="w-16 rounded border border-slate-200 px-2 py-1 text-sm"
                          value={tfOptions.count}
                          onChange={(e) =>
                            setTfOptions((o) => ({
                              ...o,
                              count: clampTfCount(e.target.value),
                            }))
                          }
                        />
                        <button
                          type="button"
                          className="rounded-md bg-rose-500 px-2.5 py-1 text-[11px] font-bold text-white"
                          onClick={() =>
                            setTfOptions((o) => ({ ...o, count: MAX_TF_COUNT }))
                          }
                        >
                          최대 갯수
                        </button>
                        <span className="text-[11px] text-rose-600">
                          지문 1개당 T/F 선택지 {tfOptions.count}개
                        </span>
                      </div>
                    </OptionRow>

                    <OptionRow tone="coral" label="T/F 선택지 언어">
                      <TogglePair
                        tone="coral"
                        left={{ id: "en", label: "English" }}
                        right={{ id: "ko", label: "한국어" }}
                        value={tfOptions.language}
                        onChange={(language) =>
                          setTfOptions((o) => ({
                            ...o,
                            language: language as "en" | "ko",
                          }))
                        }
                      />
                    </OptionRow>

                    <OptionRow tone="coral" label="T/F 문제 난이도">
                      <TogglePair
                        tone="coral"
                        left={{ id: "normal", label: "일반" }}
                        right={{ id: "hard", label: "난이도 UP" }}
                        value={tfOptions.difficulty}
                        onChange={(difficulty) =>
                          setTfOptions((o) => ({
                            ...o,
                            difficulty: difficulty as "normal" | "hard",
                          }))
                        }
                      />
                    </OptionRow>
                  </div>
                </div>
              ) : null}

              {wantGrammarFix ? (
                <FixOptions
                  title="어법 수정 옵션"
                  subject="어법상 틀린"
                  options={grammarFixOptions}
                  onChange={setGrammarFixOptions}
                />
              ) : null}

              {wantVocabChoice || wantVocabFix ? (
                <div className="space-y-3">
                  <p className="text-sm font-bold text-slate-900">어휘 선택 · 수정 옵션</p>
                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <OptionRow tone="violet" label="어휘 난이도">
                      <div className="space-y-2">
                        <TogglePair
                          tone="violet"
                          left={{ id: "normal", label: "일반" }}
                          right={{ id: "hard", label: "난이도 UP" }}
                          value={vocabWordLevel}
                          onChange={(v) => setVocabWordLevel(v === "hard" ? "hard" : "normal")}
                        />
                        <p className="text-[11px] text-violet-600">
                          {vocabWordLevel === "normal"
                            ? "EngCore 고교기본까지의 낱말 자리에, 중학 수준의 쉬운 반대말로 묻습니다."
                            : "고2~수능 수준의 어려운 낱말 자리를 앞세워 묻습니다."}
                        </p>
                      </div>
                    </OptionRow>
                  </div>
                </div>
              ) : null}

              {wantVocabExam ? (
                <div className="space-y-2">
                  <p className="text-sm font-bold text-slate-900">단어 시험 옵션</p>
                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="mb-2 text-[11px] text-slate-500">유형마다 문항 수(0이면 빼기) · 고른 지문의 단어를 합쳐 한 시험으로 냅니다.</p>
                    <VocabExamControls value={vocabExam} onChange={setVocabExam} caps={vocabCaps} />
                  </div>
                </div>
              ) : null}


              {wantVocabFix ? (
                <FixOptions
                  title="어휘 수정 옵션"
                  subject="문맥상 쓰임이 적절하지 않은"
                  options={vocabFixOptions}
                  onChange={setVocabFixOptions}
                />
              ) : null}

              {wantSentenceOrder ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <p className="text-sm font-bold text-slate-900">
                    문장 순서 배열
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                    저장된 원문 문장을 그대로 섞어 출제합니다. 문제지에 한글
                    해석은 표시되지 않으며, 문장이 2개 이하인 지문은 자동으로
                    제외됩니다.
                  </p>
                </div>
              ) : null}

              {wantGist ? (
                <div className="space-y-3">
                  <p className="text-sm font-bold text-slate-900">제목·주제·요지 해석</p>
                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    {(Object.keys(GIST_KIND_LABEL) as Array<keyof typeof GIST_KIND_LABEL>).map((k) => (
                      <OptionRow key={k} tone="violet" label={`${GIST_KIND_LABEL[k]} 개수`}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {Array.from({ length: MAX_GIST_COUNT + 1 }, (_, n) => (
                            <button
                              key={n}
                              type="button"
                              onClick={() => setGistOptions((o) => ({ ...o, [k]: clampGistCount(n) }))}
                              className={`rounded-md px-3 py-1 text-xs font-bold ${
                                gistOptions[k] === n ? "bg-violet-600 text-white" : "border border-slate-200 bg-white text-slate-600"
                              }`}
                            >
                              {n === 0 ? "안 냄" : `${n}개`}
                            </button>
                          ))}
                        </div>
                      </OptionRow>
                    ))}
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-600">
                    지문의 제목·주제·요지를 지문 문장을 베끼지 않고 바꿔 쓴 영어로 주고, 학생이 우리말로 해석합니다. 제목은 명사구,
                    요지는 완전한 문장으로 나오며 정답지에는 우리말 해석이 실립니다.
                  </p>
                </div>
              ) : null}
              {wantLineKo ? (
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <p className="text-sm font-bold text-slate-900">해석 적기</p>
                  <TogglePair
                    tone="violet"
                    left={{ id: "full", label: "문장마다" }}
                    right={{ id: "chunk", label: "끊어 읽기(직독직해)" }}
                    value={lineMode}
                    onChange={(v) => setLineMode(v === "chunk" ? "chunk" : "full")}
                  />
                </div>
              ) : null}

              {wantFullEn ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <p className="text-sm font-bold text-slate-900">통문장 영작</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                    저장된 한글 해석을 제시하고 학생이 영어 원문 전체를
                    씁니다. 해석은 한줄해석과 같은 것을 씁니다.
                  </p>
                </div>
              ) : null}

              {wantWordOrder ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <p className="text-sm font-bold text-slate-900">
                    어순배열 영작
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                    저장된 한글 해석과 의미 단위(구·절)로 묶인 영어 청크를 보고
                    완전한 영어 문장을 씁니다.
                  </p>
                </div>
              ) : null}

              {wantKeyWordOrder ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <p className="text-sm font-bold text-slate-900">
                    중요문장 어순배열
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                    지문마다 외울 만한 문장만 골라 어순배열로 냅니다. 주제문·핵심
                    주장 3개까지, 가목적어·가주어·강조구문·도치처럼 구조가 복잡한
                    문장 2개까지(지문당 최대 5문장). 분석서를 만든 지문은 분석서의
                    「주제문」·「서술형 대비」 표시를 먼저 따릅니다.
                  </p>
                </div>
              ) : null}
            </div>
          )}

          {error ? (
            <div className="mt-4">
              <Alert variant="error">{error}</Alert>
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
          {step === "types" ? (
            <>
              <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                ← 취소
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={selected.size === 0}
                onClick={goNext}
              >
                다음 →
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setStep("types")}
              >
                ← 이전
              </Button>
              <Button type="button" size="sm" onClick={handleStart}>
                {regen ? "다시 만들기" : adding ? "유형 추가" : "워크북 생성"}
              </Button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

function WorkbookTypeHover({ id, box }: { id: WorkbookTypeId; box: DOMRect }) {
  const shot = workbookTypePreview(id);
  const meta = getWorkbookTypeMeta(id);
  if (!shot || !meta) return null;
  return (
    <HoverPreview anchor={box} width={540} height={480}>
      <p className="text-[15px] font-bold text-slate-900">{meta.title}</p>
      <p className="mb-2 mt-0.5 text-[12.5px] text-slate-500">{meta.subtitle}</p>
      <PreviewShot src={shot.src} w={shot.w} h={shot.h} alt={`${meta.title} 예시`} />
    </HoverPreview>
  );
}

/** 어법 수정·어휘 수정 공통 옵션: 출제 방식(밑줄 표시/없음)과 지문당 틀린 곳 수. */
function FixOptions({
  title,
  subject,
  options,
  onChange,
}: {
  title: string;
  subject: string;
  options: WorkbookGrammarFixOptions;
  onChange: (next: WorkbookGrammarFixOptions) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-bold text-slate-900">{title}</p>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <OptionRow tone="violet" label="출제 방식">
          <div className="space-y-2">
            <TogglePair
              tone="violet"
              left={{ id: "underline", label: "밑줄 표시" }}
              right={{ id: "find", label: "밑줄 없음" }}
              value={options.mode}
              onChange={(mode) =>
                onChange({ ...options, mode: mode === "find" ? "find" : "underline" })
              }
            />
            <p className="text-[11px] text-violet-600">
              {options.mode === "underline"
                ? `밑줄 친 여러 곳 중 ${subject} 것을 찾아 고칩니다.`
                : `밑줄 없이 지문 전체에서 ${subject} 곳을 찾아 고칩니다.`}
            </p>
          </div>
        </OptionRow>
        <OptionRow tone="violet" label="틀린 곳 수">
          <div className="flex flex-wrap items-center gap-2">
            {GRAMMAR_FIX_ERROR_COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onChange({ ...options, errorCount: n })}
                className={`rounded-md px-3 py-1 text-xs font-bold ${
                  options.errorCount === n
                    ? "bg-violet-600 text-white"
                    : "border border-slate-200 bg-white text-slate-600"
                }`}
              >
                {n}개
              </button>
            ))}
            <span className="text-[11px] text-slate-500">
              지문 1개당, 고칠 자리가 모자란 지문은 적게 나옵니다.
            </span>
          </div>
        </OptionRow>
      </div>
    </div>
  );
}

function OptionRow({
  label,
  tone,
  children,
}: {
  label: string;
  tone: "coral" | "violet";
  children: ReactNode;
}) {
  const bg = tone === "coral" ? "bg-rose-50/80" : "bg-violet-50/80";
  return (
    <div
      className={`flex flex-col gap-2 border-b border-slate-100 px-3 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between ${bg}`}
    >
      <span className="shrink-0 text-xs font-bold text-slate-700">{label} :</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function TogglePair({
  left,
  right,
  value,
  onChange,
  tone,
}: {
  left: { id: string; label: string };
  right: { id: string; label: string };
  value: string;
  onChange: (id: string) => void;
  tone: "coral" | "violet";
}) {
  const active =
    tone === "coral"
      ? "bg-rose-500 text-white"
      : "bg-violet-600 text-white";
  const idle = "bg-white text-slate-600 ring-1 ring-slate-200";
  return (
    <div className="flex flex-wrap gap-1.5">
      {[left, right].map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={`rounded-md px-3 py-1 text-xs font-bold ${
            value === opt.id ? active : idle
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
