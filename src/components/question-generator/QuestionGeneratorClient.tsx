"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  MAX_PASSAGES,
  MAX_SETS_PER_TYPE,
  MAX_TOTAL_QUESTIONS,
} from "@/lib/question-generator/constants";
import { emptyPassageInput } from "@/lib/question-generator/passages";
import { billingFeatureFor } from "@/lib/question-generator/billing-buckets";
import { MockPassagePickerModal, type PickedMockPassage } from "@/components/mock-passages/MockPassagePickerModal";
import { PassageSheet } from "@/components/passages/PassageSheet";
import { sampleLevelFor, typeSampleFor, type SampleLevel, type TypeSample } from "@/lib/question-generator/type-samples";
import {
  emptyCounts,
  QUESTION_TYPE_GROUPS,
  sanitizeCounts,
  sumCounts,
} from "@/lib/question-generator/question-types";
import { QgJobProgressBar } from "@/components/question-generator/QgJobProgressBar";
import { PassageSetPicker, defaultPassageSetKeys } from "@/components/question-generator/PassageSetPicker";
import { passageSetCounts, passageSetProblem, type PassageSetSize } from "@/lib/question-generator/passage-set";
import { useQgJobProgress } from "@/components/question-generator/useQgJobProgress";
import { askCreditConfirm } from "@/lib/credits/confirm-store";
import type {
  GenerationRequestConfig,
  PassageInput,
} from "@/lib/question-generator/types";

type Role = "admin" | "teacher";

interface PresetRow {
  id: string;
  name: string;
  description: string | null;
  config: { counts?: Record<string, number> };
  is_system: boolean;
  slug?: string | null;
}

const CATEGORY_ORDER = [
  "main_idea",
  "details",
  "inference",
  "grammar_vocabulary",
  "subjective",
] as const;

/**
 * 미리보기 본문. | 로 칸을 나눈 줄이 이어지면 진짜 표로 묶어 그린다(요약표 유형).
 * 선생님 요청(2026-09-28): 미리보기를 크게, 나오는 모양 그대로 보이게.
 */
function SampleLines({ lines }: { lines: string[] }) {
  type Block = { kind: "text"; text: string } | { kind: "table"; rows: string[][] };
  const blocks: Block[] = [];
  for (const raw of lines) {
    const line = raw.replace(/<\/?u>/g, "");
    if (line.includes("|")) {
      const cells = line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim());
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "table") last.rows.push(cells);
      else blocks.push({ kind: "table", rows: [cells] });
    } else {
      blocks.push({ kind: "text", text: line });
    }
  }

  return (
    <div className="mt-2 space-y-1.5">
      {blocks.map((b, i) =>
        b.kind === "text" ? (
          <p key={i} className="font-serif text-[13px] leading-relaxed text-slate-700">
            {b.text}
          </p>
        ) : (
          <table key={i} className="w-full border-collapse font-serif text-[11.5px]">
            <tbody>
              {b.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={`border border-slate-300 px-1.5 py-1 align-top leading-snug ${
                        ri === 0
                          ? "bg-slate-50 font-semibold text-slate-800"
                          : ci === 0
                            ? "w-[58px] bg-slate-50/70 text-center font-semibold text-slate-700"
                            : "text-slate-700"
                      }`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}

export type GrammarChoice = {
  label: string;
  form: string;
  hint: string;
  /** 고등 교과서 몇 종에 나오는 문법인지 */
  textbookBooks?: number;
};

/**
 * 조건 영작에 쓸 어법 범위 고르기.
 * 아무것도 고르지 않으면 지문에 실제로 있는 어법 가운데 알아서 고른다.
 * 이름만 늘어놓으면 무엇을 묻는 어법인지 알기 어려워 설명을 한 줄씩 함께 보여 준다.
 */
/** 제시어 배열을 지문 그대로 낼지 고쳐 써서 낼지 — 선생님 결정(2026-09-29) */
function WordOrderModeBox({
  mode,
  onMode,
}: {
  mode: "passage" | "paraphrase";
  onMode: (m: "passage" | "paraphrase") => void;
}) {
  return (
    <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
      <p className="mb-1 text-[11px] font-semibold text-slate-700">제시어 배열 문장</p>
      <div className="mb-1.5 flex gap-1">
        {(
          [
            { key: "passage" as const, label: "지문 그대로", hint: "지문에 있는 문장을 그대로 빈칸으로 냅니다" },
            { key: "paraphrase" as const, label: "고쳐 써서", hint: "중요한 문장을 교재 구문에 맞게 다듬어 냅니다" },
          ]
        ).map((m) => (
          <button
            key={m.key}
            type="button"
            title={m.hint}
            onClick={() => onMode(m.key)}
            aria-pressed={mode === m.key}
            className={`flex-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
              mode === m.key
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="text-[10.5px] leading-snug text-slate-500">
        {mode === "passage"
          ? "지문에 있는 문장만 씁니다. 원문이 그대로 정답이 됩니다."
          : "지문 문장을 교재 구문에 맞게 다듬어 냅니다. 원문과 달라집니다."}
      </p>
    </div>
  );
}

function GrammarScopeBox({
  choices,
  picked,
  onChange,
  open,
  onToggle,
  mode,
  onMode,
}: {
  choices: GrammarChoice[] | null;
  picked: string[];
  onChange: (next: string[]) => void;
  open: boolean;
  onToggle: () => void;
  mode: "passage" | "paraphrase";
  onMode: (m: "passage" | "paraphrase") => void;
}) {
  return (
    <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
      {/* 지정 문법을 어떻게 쓸지 — 선생님 요청(2026-09-29) */}
      <div className="mb-1.5 flex gap-1">
        {(
          [
            { key: "paraphrase" as const, label: "고쳐 써서", hint: "중요한 문장을 그 문법으로 바꿔 써서 냅니다" },
            { key: "passage" as const, label: "지문 그대로", hint: "그 문법이 이미 쓰인 문장을 찾아 냅니다" },
          ]
        ).map((m) => (
          <button
            key={m.key}
            type="button"
            title={m.hint}
            onClick={() => onMode(m.key)}
            aria-pressed={mode === m.key}
            className={`flex-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
              mode === m.key
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="mb-1.5 text-[10.5px] leading-snug text-slate-500">
        {mode === "paraphrase"
          ? "지문에 그 문법이 없어도 됩니다. 중요한 문장을 그 문법으로 바꿔 써서 빈칸에 넣습니다."
          : "그 문법이 이미 쓰인 문장만 씁니다. 지문에 없으면 그 문항은 건너뜁니다."}
      </p>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="min-w-0 text-[11px] text-slate-700">
          <b className="block text-slate-800">지정 문법 범위</b>
          {picked.length === 0
            ? "지문에 있는 어법 가운데 알아서 고릅니다."
            : `${picked.length}개로 좁힘 · ${picked.join(", ")}`}
        </span>
        <span className="shrink-0 text-xs text-slate-400">{open ? "▲" : "▼"}</span>
      </button>
      {open ? (
        choices === null ? (
          <p className="mt-1.5 text-[11px] text-slate-500">어법 목록을 불러오는 중이에요…</p>
        ) : (
          <>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="text-[10.5px] text-slate-500">
                고른 어법이 지문에 없으면 그 문항은 건너뜁니다.
              </span>
              <button
                type="button"
                onClick={() =>
                  onChange(picked.length > 0 ? [] : choices.map((c) => c.label))
                }
                className="shrink-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-slate-600 hover:bg-slate-50"
              >
                {picked.length > 0 ? "범위 풀기" : "모두 고르기"}
              </button>
            </div>
            <ul className="mt-1 max-h-[220px] space-y-0.5 overflow-y-auto rounded-md border border-slate-200 bg-white p-1">
              {choices.map((g) => {
                const on = picked.includes(g.label);
                return (
                  <li key={g.label}>
                    <label
                      className={`flex cursor-pointer items-start gap-1.5 rounded px-1.5 py-1 ${
                        on ? "bg-brand-50" : "hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          onChange(
                            on ? picked.filter((x) => x !== g.label) : [...picked, g.label]
                          )
                        }
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-brand-600"
                      />
                      <span className="min-w-0">
                        <span className="block text-[11px] font-semibold text-slate-900">
                          {g.label}
                          <span className="ml-1 font-normal text-slate-500">({g.form})</span>
                          {g.textbookBooks ? (
                            <span className="ml-1 rounded bg-amber-100 px-1 text-[9.5px] font-bold text-amber-800">
                              교과서 {g.textbookBooks}
                            </span>
                          ) : null}
                        </span>
                        <span className="block text-[10.5px] leading-snug text-slate-500">
                          {g.hint}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )
      ) : null}
    </div>
  );
}

/**
 * 대의·세부·추론·어법 칸은 하/상·(영)/(한) 표로 그린다. 표에 없는 유형(리얼영어 요약문 완성·답변 가능 개수·사례 분류 등, 2026-11-23)은
 * 칸 아래 「더 많은 유형」에 줄로 나온다. 표에 새 유형을 넣지 않아도 빠지지 않게 하려는 것(선생님 2026-11-24 「변형문제 보니깐 안 보여」).
 */
const FIXED_LAYOUT_KEYS = new Set<string>([
  "title:en:low:제목추론",
  "title:en:high:제목추론",
  "title:ko:low:제목추론",
  "title:ko:high:제목추론",
  "topic:en:low:주제추론",
  "topic:en:high:주제추론",
  "topic:ko:low:주제추론",
  "topic:ko:high:주제추론",
  "summary_mcq:ko:low:요지추론",
  "summary_mcq:ko:high:요지추론",
  "content_true:en:low:내용일치",
  "content_true:en:high:내용일치",
  "content_true:ko:low:내용일치",
  "content_true:ko:high:내용일치",
  "content_false:en:low:내용불일치",
  "content_false:en:high:내용불일치",
  "content_false:ko:low:내용불일치",
  "content_false:ko:high:내용불일치",
  "content_count:en:low:일치개수",
  "content_count:en:high:일치개수",
  "content_count:ko:low:일치개수",
  "content_count:ko:high:일치개수",
  "order:na:low:순서추론",
  "order:na:high:순서추론",
  "sentence_blank:en:low:빈칸추론",
  "sentence_blank:en:high:빈칸추론",
  "sentence_insertion:na:low:문장삽입",
  "sentence_insertion:na:high:문장삽입",
  "irrelevant_sentence:na:low:무관한문장",
  "irrelevant_sentence:na:high:무관한문장",
  "underlined_inference:en:default:함축의미추론",
  "underlined_inference:en:default:목적추론",
  "underlined_inference:en:default:심경추론",
  "sentence_blank:en:default:연결어빈칸",
  "grammar:na:default:어법추론",
  "grammar:na:default:어법개수",
  "vocabulary:na:default:어휘추론",
  "vocabulary:na:default:어휘개수",
  "summary_mcq:en:default:요지추론",
]);

export function QuestionGeneratorClient({
  role,
  basePath,
  textbookOpen = false,
  outsideOpen = false,
}: {
  role: Role;
  basePath: string;
  /** 교과서 본문을 열어 준 학원인지 — 아니면 교과서 갈래를 아예 안 보인다 */
  textbookOpen?: boolean;
  /** 외부지문(수능특강 등)을 열어 준 학원인지 */
  outsideOpen?: boolean;
}) {
  const [title, setTitle] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [grade, setGrade] = useState("고1");
  const [sourceType, setSourceType] = useState("");
  const [sourceDetail, setSourceDetail] = useState("");
  const [overallDifficulty, setOverallDifficulty] = useState("내신");
  const [passages, setPassages] = useState<PassageInput[]>([
    emptyPassageInput(),
  ]);
  const [counts, setCounts] = useState<Record<string, number>>(emptyCounts);
  /** 자료함에서 넘어온 지문 id. 생성한 자료가 자료함 변형문제 탭에도 보이게 함께 저장한다. */
  const [lessonProjectIds, setLessonProjectIds] = useState<string[]>([]);
  const [modeTab, setModeTab] = useState<string>("custom");
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({
    main_idea: true,
    details: true,
    inference: true,
    grammar_vocabulary: true,
    subjective: true,
  });
  const [presets, setPresets] = useState<PresetRow[]>([]);
  const [passageId, setPassageId] = useState<string | null>(null);
  /** 지문 불러오기 창: 모의고사·교과서·외부지문 중 어느 쪽으로 열지 */
  const [mockOpen, setMockOpen] = useState<null | "mock" | "textbook" | "outside">(null);
  /** 어법·어휘에서 지문을 바꿔 쓸지(기본은 원문 그대로) */
  const [paraphraseGV, setParaphraseGV] = useState(false);
  /** 1지문 다문항(세트) — 켜면 유형별 개수 대신 지문당 2·3문항 구성을 고른다 */
  const [setMode, setSetMode] = useState(false);
  const [setSize, setSetSize] = useState<PassageSetSize>(3);
  /** 세트 구성 A·B… — 지문 차례대로 번갈아 붙인다 */
  const [setVariantList, setSetVariantList] = useState<string[][]>(() => [defaultPassageSetKeys(3)]);
  const setKeys = setVariantList[0] ?? [];
  /**
   * 조건 영작에 쓸 어법 범위. 비워 두면 지문에 있는 것 가운데 알아서 고른다.
   * 선생님 요청(2026-09-28): 무작위로 해도 되고 정해 둔 범위로 해도 되게.
   */
  const [grammarScope, setGrammarScope] = useState<string[]>([]);
  const [grammarChoices, setGrammarChoices] = useState<GrammarChoice[] | null>(null);
  const [grammarScopeOpen, setGrammarScopeOpen] = useState(false);
  /** 지정 문법을 지문에서 찾을지, 고쳐 써서 만들지 (선생님 요청 2026-09-29) */
  const [grammarWritingMode, setGrammarWritingMode] = useState<"passage" | "paraphrase">("paraphrase");
  /** 제시어 배열을 지문 그대로 낼지 (선생님 결정 2026-09-29: 기본은 지문 그대로) */
  const [wordOrderMode, setWordOrderMode] = useState<"passage" | "paraphrase">("passage");
  /** 유형에 마우스를 올렸을 때 띄우는 예시 */
  const [sample, setSample] = useState<{ s: TypeSample; level: SampleLevel; x: number; y: number } | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presetName, setPresetName] = useState("");
  const [presetDesc, setPresetDesc] = useState("");
  const [showPresetForm, setShowPresetForm] = useState(false);
  const pdfOpenedForJob = useRef<string | null>(null);
  const searchParams = useSearchParams();
  const fromJobId = searchParams.get("fromJob");
  const fromJobLoaded = useRef(false);
  const skipDirtyOnce = useRef(false);

  function openPdfs(jobId: string) {
    window.location.assign(`${basePath}/generations/${jobId}/print?mode=exam`);
  }

  const { jobProgress, generating, pct, startTracking, dismiss } =
    useQgJobProgress({
      onTerminal: (job) => {
        if (pdfOpenedForJob.current === job.jobId) return;
        pdfOpenedForJob.current = job.jobId;
        if (job.status === "failed") {
          if (job.completed > 0) {
            setMessage(
              `일부 문항만 생성되었습니다 (${job.completed}/${job.total}). 성공한 문항으로 PDF를 엽니다.`
            );
            openPdfs(job.jobId);
          } else {
            setError("생성에 실패했습니다.");
          }
        } else if (job.completed > 0) {
          openPdfs(job.jobId);
        } else {
          setError("생성된 문항이 없습니다.");
        }
      },
    });

  const filledPassages = useMemo(
    () => passages.filter((p) => p.text.trim()),
    [passages]
  );
  /** 세트로 만들면 세트 구성이 곧 유형별 개수다 */
  const effectiveCounts = useMemo(
    () => (setMode ? passageSetCounts({ size: setSize, keys: setKeys }) : counts),
    [setMode, setSize, setKeys, counts]
    // 구성마다 문항 수가 같아 첫 구성으로 세면 문항 수·크레딧이 맞는다
  );
  const perPassageTotals = useMemo(() => sumCounts(effectiveCounts), [effectiveCounts]);
  const grandTotal = perPassageTotals.total * Math.max(1, filledPassages.length);
  /*
   * 값은 세 갈래로 받는다(일반·어법추론과 어법개수·서술형). 확인 창이 두 갈래만 세어
   * 서술형이 일반에 섞여 보이던 것을 고친다 — 실제 차감과 같은 잣대를 쓴다.
   */
  /*
   * 유형을 고르는 자리에서 바로 값이 보이게 한다. 문항 수만 보이고 크레딧은 만들기를
   * 누른 뒤에야 알 수 있어서, 고르는 동안 얼마가 드는지 몰랐다(2026-10-01 선생님 지적).
   */
  const [unitCosts, setUnitCosts] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/credits?limit=1", { cache: "no-store" });
        const json = (await res.json()) as {
          pricing?: Array<{ feature_key: string; credit_cost: number }>;
        };
        if (!alive) return;
        const map: Record<string, number> = {};
        for (const row of json.pricing ?? []) {
          map[row.feature_key] = Number(row.credit_cost ?? 0);
        }
        setUnitCosts(map);
      } catch {
        // 값을 못 읽으면 문항 수만 보인다 — 만들기 확인 창에서 다시 알려 준다
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const billingTotals = useMemo(() => {
    const per = Math.max(1, filledPassages.length);
    const sum: Record<string, number> = {};
    for (const [key, n] of Object.entries(effectiveCounts)) {
      const q = Number(n ?? 0);
      if (q <= 0) continue;
      const feature = billingFeatureFor(key);
      sum[feature] = (sum[feature] ?? 0) + q * per;
    }
    return sum;
  }, [effectiveCounts, filledPassages.length]);

  /** 고른 유형으로 이번에 나갈 크레딧. 값을 아직 못 읽었으면 null(문항 수만 보인다) */
  const creditTotal = useMemo(() => {
    if (Object.keys(unitCosts).length === 0) return null;
    let sum = 0;
    for (const [feature, quantity] of Object.entries(billingTotals)) {
      sum += (unitCosts[feature] ?? 0) * quantity;
    }
    return sum;
  }, [billingTotals, unitCosts]);

  const config: GenerationRequestConfig = useMemo(
    () => ({
      title,
      schoolName,
      grade,
      sourceType,
      sourceDetail,
      overallDifficulty,
      passage: filledPassages[0]?.text ?? "",
      passages,
      mode: modeTab === "custom" ? "custom" : "preset",
      presetId: modeTab.startsWith("preset:") ? modeTab.slice(7) : null,
      counts: effectiveCounts,
      ...(setMode
        ? {
            passageSet: {
              size: setSize,
              keys: setKeys,
              ...(setVariantList.length > 1 ? { variants: setVariantList } : {}),
            },
          }
        : {}),
      ...(paraphraseGV ? { paraphraseGrammarVocab: true } : {}),
      ...(grammarScope.length ? { grammarScope } : {}),
      ...((counts["writing:na:default:문법조건영작"] ?? 0) > 0 ? { grammarWritingMode } : {}),
      // 아래 wordOrderCount는 이 useMemo보다 뒤에 만들어지므로 여기서는 직접 센다
      ...((counts["writing:na:default:제시어배열기본"] ?? 0) +
        (counts["writing:na:default:제시어배열어형변화"] ?? 0) +
        (counts["writing:na:default:제시어배열단어추가"] ?? 0) >
      0
        ? { wordOrderMode }
        : {}),
      ...(lessonProjectIds.length ? { lessonProjectIds } : {}),
    }),
    [
      lessonProjectIds,
      paraphraseGV,
      grammarScope,
      grammarWritingMode,
      wordOrderMode,
      title,
      schoolName,
      grade,
      sourceType,
      sourceDetail,
      overallDifficulty,
      passages,
      filledPassages,
      modeTab,
      counts,
      effectiveCounts,
      setMode,
      setSize,
      setKeys,
      setVariantList,
    ]
  );

  // 조건 영작 어법 목록 — 범위를 펼칠 때 한 번만 불러온다
  const writingCount = counts["writing:na:default:문법조건영작"] ?? 0;
  /** 제시어 배열 세 유형을 하나라도 골랐나 */
  const wordOrderCount =
    (counts["writing:na:default:제시어배열기본"] ?? 0) +
    (counts["writing:na:default:제시어배열어형변화"] ?? 0) +
    (counts["writing:na:default:제시어배열단어추가"] ?? 0);
  useEffect(() => {
    if (writingCount === 0 || grammarChoices) return;
    fetch("/api/question-generator/grammar-scope")
      .then((r) => r.json())
      .then((d: { ok?: boolean; grammars?: GrammarChoice[] }) => {
        if (d.ok) setGrammarChoices(d.grammars ?? []);
      })
      .catch(() => undefined);
  }, [writingCount, grammarChoices]);

  useEffect(() => {
    fetch("/api/question-generator/presets")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setPresets(d.presets ?? []);
      })
      .catch(() => undefined);
  }, []);

  // 자료함에서 지문을 골라 "문제 제작"으로 연 경우(?fromLesson=id,id): 그 지문을 채운다.
  const fromLesson = searchParams.get("fromLesson");
  const fromLessonLoaded = useRef(false);
  useEffect(() => {
    if (!fromLesson || fromJobId || fromLessonLoaded.current) return;
    fromLessonLoaded.current = true;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/lesson-materials/passages?ids=${encodeURIComponent(fromLesson)}`
        );
        const d = (await res.json()) as {
          ok: boolean;
          message?: string;
          passages?: Array<{ title: string; source: string; text: string }>;
        };
        if (cancelled) return;
        if (!d.ok) {
          setError(d.message ?? "자료함 지문을 불러오지 못했습니다.");
          return;
        }
        const list = (d.passages ?? []).slice(0, MAX_PASSAGES);
        setLessonProjectIds(
          (d.passages ?? []).slice(0, MAX_PASSAGES).map((p) => (p as { id?: string }).id ?? "").filter(Boolean)
        );
        if (list.length === 0) {
          setError("불러올 영어 지문이 없습니다.");
          return;
        }
        setPassages(
          list.map((p) => ({
            ...emptyPassageInput(),
            title: p.title,
            sourceDetail: p.source,
            text: p.text,
          }))
        );
        setTitle(
          list.length > 1 ? `${list[0]!.title} 외 ${list.length - 1}지문` : list[0]!.title
        );
        setMessage(
          `자료함에서 고른 지문 ${list.length}개를 불러왔습니다. 문제 유형을 고르고 생성하세요.`
        );
      } catch {
        if (!cancelled) setError("자료함 지문을 불러오지 못했습니다.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fromLesson, fromJobId]);

  useEffect(() => {
    if (!fromJobId || fromJobLoaded.current) return;
    fromJobLoaded.current = true;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/question-generator/jobs/${fromJobId}`);
        const d = await res.json();
        if (!d.ok || cancelled) {
          if (!cancelled) setError(d.message ?? "자료를 불러오지 못했습니다.");
          return;
        }
        const cfg = (d.job?.request_config ?? {}) as GenerationRequestConfig;
        setTitle((cfg.title ?? "").trim() || "");
        setSchoolName(cfg.schoolName ?? "");
        setGrade(cfg.grade || "고1");
        setSourceType(cfg.sourceType ?? "");
        setSourceDetail(cfg.sourceDetail ?? "");
        setOverallDifficulty(cfg.overallDifficulty || "내신");
        setCounts(sanitizeCounts(cfg.counts, MAX_SETS_PER_TYPE));
        if (cfg.passageSet && !passageSetProblem(cfg.passageSet)) {
          setSetMode(true);
          setSetSize(cfg.passageSet.size);
          setSetVariantList(
            Array.isArray(cfg.passageSet.variants) && cfg.passageSet.variants.length > 0
              ? cfg.passageSet.variants
              : [cfg.passageSet.keys]
          );
        }
        setLessonProjectIds(Array.isArray(cfg.lessonProjectIds) ? cfg.lessonProjectIds : []);
        if (cfg.presetId) setModeTab(`preset:${cfg.presetId}`);
        else setModeTab("custom");

        const list = Array.isArray(cfg.passages) ? cfg.passages : [];
        const loaded: PassageInput[] = list
          .map((p) => ({
            clientId: p.clientId || emptyPassageInput().clientId,
            title: p.title ?? "",
            sourceDetail: p.sourceDetail ?? "",
            text: (p.text ?? "").trim(),
          }))
          .filter((p) => p.text);
        if (loaded.length === 0 && (cfg.passage ?? "").trim()) {
          loaded.push({
            ...emptyPassageInput(),
            text: cfg.passage.trim(),
            title: cfg.title ?? "",
            sourceDetail: cfg.sourceDetail ?? "",
          });
        }
        setPassages(loaded.length > 0 ? loaded : [emptyPassageInput()]);
        skipDirtyOnce.current = true;
        setDirty(false);
        setMessage(
          "복사한 자료의 지문·유형 설정을 불러왔습니다. 생성하면 이 자료에 바로 만들어집니다."
        );      } catch {
        if (!cancelled) setError("자료를 불러오지 못했습니다.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fromJobId]);

  useEffect(() => {
    if (skipDirtyOnce.current) {
      skipDirtyOnce.current = false;
      return;
    }
    setDirty(true);
  }, [config]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (jobProgress && !jobProgress.done) return;
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, jobProgress]);

  const saveDraft = useCallback(async () => {
    setMessage(null);
    setError(null);
    const res = await fetch("/api/question-generator/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passageId, config }),
    });
    const data = await res.json();
    if (!data.ok) {
      setError(data.message ?? "임시 저장 실패");
      return;
    }
    setPassageId(data.passageId);
    setSavedAt(data.savedAt);
    setDirty(false);
    setMessage("임시 저장되었습니다.");
  }, [passageId, config]);

  useEffect(() => {
    if (!dirty) return;
    const t = window.setTimeout(() => {
      void saveDraft();
    }, 2500);
    return () => window.clearTimeout(t);
  }, [dirty, saveDraft]);

  function setCount(key: string, value: number) {
    const n = Math.max(0, Math.min(MAX_SETS_PER_TYPE, Math.floor(value || 0)));
    setCounts((prev) => ({ ...prev, [key]: n }));
  }

  function applyCounts(next: Record<string, number>) {
    setCounts(sanitizeCounts(next, MAX_SETS_PER_TYPE));
  }

  /** 프리셋 키들을 현재 값에 +n (클릭할 때마다 누적) */
  function addCounts(entries: Array<[string, number]>) {
    setCounts((prev) => {
      const next = { ...prev };
      for (const [key, add] of entries) {
        if (!(key in next)) continue;
        next[key] = Math.min(
          MAX_SETS_PER_TYPE,
          Math.max(0, (next[key] ?? 0) + add)
        );
      }
      return next;
    });
    setModeTab("custom");
  }

  function applyDbPreset(p: PresetRow) {
    applyCounts(p.config?.counts ?? {});
    setModeTab(`preset:${p.id}`);
  }

  function resetAll() {
    setCounts(emptyCounts());
    setModeTab("custom");
    setMessage(null);
    setError(null);
  }

  /** 한 카테고리(대의 파악 등) 세트만 0으로 */
  function resetCategory(keys: string[]) {
    setCounts((prev) => {
      const next = { ...prev };
      for (const key of keys) {
        if (key in next) next[key] = 0;
      }
      return next;
    });
    setModeTab("custom");
  }

  /** 모의고사 지문 모음에서 고른 지문: 빈 행부터 채우고 모자라면 행을 늘린다 */
  function addMockPassages(list: PickedMockPassage[]) {
    setPassages((prev) => {
      const next = prev.filter((p) => p.text.trim());
      for (const m of list) {
        if (next.length >= MAX_PASSAGES) break;
        next.push({ ...emptyPassageInput(), title: m.shortLabel, sourceDetail: m.label, text: m.text });
      }
      return next.length ? next : [emptyPassageInput()];
    });
    setMockOpen(null);
  }

  async function savePreset() {
    if (!presetName.trim()) {
      setError("프리셋 이름을 입력해 주세요.");
      return;
    }
    const res = await fetch("/api/question-generator/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: presetName,
        description: presetDesc,
        config: { counts },
        isSystem: false,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      setError(data.message ?? "프리셋 저장 실패");
      return;
    }
    setPresets((prev) => [data.preset, ...prev]);
    setShowPresetForm(false);
    setPresetName("");
    setPresetDesc("");
    setMessage("프리셋이 저장되었습니다.");
  }

  async function startGenerate() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const setProblem = setMode
        ? passageSetProblem({ size: setSize, keys: setKeys, variants: setVariantList })
        : null;
      if (setProblem) {
        setError(setProblem);
        return;
      }
      if (perPassageTotals.total <= 0) {
        setError("생성할 문항을 1개 이상 선택해 주세요.");
        return;
      }
      if (filledPassages.length === 0) {
        setError("영어 지문을 1개 이상 입력해 주세요.");
        return;
      }
      if (grandTotal > MAX_TOTAL_QUESTIONS) {
        setError(
          `최대 ${MAX_TOTAL_QUESTIONS}문항까지 생성할 수 있습니다. (지문 ${filledPassages.length} × ${perPassageTotals.total} = ${grandTotal})`
        );
        return;
      }

      // 만들면 문항 수만큼 크레딧이 나간다. 시작하기 전에 값을 보여 주고 한 번 더 묻는다.
      const go = await askCreditConfirm({
        title: "변형문제",
        description: "고른 유형으로 지문마다 문항을 만듭니다. 문항 수만큼 크레딧이 나갑니다.",
        subject: `지문 ${filledPassages.length}개 × 지문당 ${perPassageTotals.total}문항 = 모두 ${grandTotal}문항`,
        // 갈래마다 값이 달라 따로 적는다. 가격표에 값이 없는 갈래는 확인 창이 알아서 뺀다.
        items: Object.entries(billingTotals)
          .filter(([, q]) => q > 0)
          .map(([feature, quantity]) => ({ feature, quantity })),
        // 2026-09-28에 뺐다가 2026-09-29에 되살린다. 손으로 그린 예시가 헷갈렸던 것이지
        // 미리보기 자체가 문제가 아니었다. 이제 실제 시험지를 찍은 사진을 보여 준다.
        sample: "question",
      });
      if (!go) return;

      const res = await fetch("/api/question-generator/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config,
          ...(fromJobId ? { reuseJobId: fromJobId } : {}),
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.message ?? "생성 요청 실패");
        return;
      }
      setDirty(false);
      pdfOpenedForJob.current = null;
      startTracking(
        data.jobId,
        grandTotal,
        title.trim() || "영어 변형문제"
      );
      // 서버는 바로 응답하고 뒤에서 만든다. 크레딧이 모자라면 여기서 안내한다.
      const started = await fetch(`/api/question-generator/jobs/${data.jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process" }),
      });
      if (!started.ok) {
        const info = (await started.json().catch(() => ({}))) as { message?: string };
        dismiss();
        setError(info.message ?? "생성을 시작하지 못했습니다.");
        return;
      }
      if (fromJobId && data.reused) {
        setMessage("복사한 자료에 문항을 생성합니다.");
      }
    } catch {
      setError("생성 요청에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const personalPresets = presets.filter((p) => !p.is_system);

  const sortedGroups = useMemo(
    () =>
      [...QUESTION_TYPE_GROUPS].sort(
        (a, b) =>
          CATEGORY_ORDER.indexOf(a.category as (typeof CATEGORY_ORDER)[number]) -
          CATEGORY_ORDER.indexOf(b.category as (typeof CATEGORY_ORDER)[number])
      ),
    []
  );

  return (
    <div className="pb-28">
      <PageHeader
        title="영어 변형문제 생성"
        description="왼쪽에서 유형 세트 수를 고르고, 오른쪽에 지문을 여러 개 넣으면 지문마다 같은 유형으로 생성됩니다."
        action={
          <Link
            href={basePath}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            ← 내 자료
          </Link>
        }
      />

      {jobProgress && (
        <QgJobProgressBar
          jobProgress={jobProgress}
          generating={generating}
          pct={pct}
          basePath={basePath}
          onOpenPdf={openPdfs}
          onDismiss={() => {
            dismiss();
            setError(null);
          }}
        />
      )}

      {error && !generating && (
        <div className="mb-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}
      {message && !generating && (
        <div className="mb-4">
          <Alert variant="success">{message}</Alert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:items-start">
        {/* 왼쪽: 유형별 세트 */}
        {/* 화면에 붙어 따라오는 칸이라, 세트 구성을 여럿 넣어 화면보다 길어지면 아래가 안 보였다 — 칸 안에서 스크롤한다 */}
        {/* 위 머리줄(h-14)이 화면에 붙어 있어, 그 아래에 붙이고 남은 높이만 쓴다 — 전에는 위는 머리줄에 가리고 아래는 화면 밖이었다(2026-10-13) */}
        <aside className="space-y-2 lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100vh-5.5rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain lg:pr-1">

          <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-card">
            <p className="px-1 pb-1.5 text-[11px] font-semibold text-slate-500">문항 만드는 방식</p>
            <div className="grid grid-cols-2 gap-1" role="group" aria-label="문항 만드는 방식">
              {[
                { on: false, label: "유형별로" },
                { on: true, label: "1지문 다문항" },
              ].map((m) => (
                <button
                  key={m.label}
                  type="button"
                  aria-pressed={setMode === m.on}
                  className={`rounded-lg px-2 py-1.5 text-xs font-semibold ${
                    setMode === m.on ? "bg-brand-700 text-white" : "border border-slate-200 bg-white text-slate-700"
                  }`}
                  onClick={() => setSetMode(m.on)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          {setMode ? (
            <PassageSetPicker
              size={setSize}
              variants={setVariantList}
              passageCount={filledPassages.length}
              onChange={(n, keys) => {
                setSetSize(n);
                setSetVariantList(keys);
              }}
            />
          ) : null}
          <section
            hidden={setMode}
            className="space-y-1.5"
            onMouseOver={(e) => {
              const row = (e.target as HTMLElement).closest?.("[data-qtype]") as HTMLElement | null;
              const s = row ? typeSampleFor(row.dataset.qtype) : null;
              if (!s) {
                if (!row) setSample(null);
                return;
              }
              // 목록을 가리지 않게 오른쪽 빈 곳에 띄운다
              const box = row!.getBoundingClientRect();
              setSample({ s, level: sampleLevelFor(row!.dataset.qtype), x: box.right + 12, y: box.top });
            }}
            onMouseLeave={() => setSample(null)}
          >
            <div className="flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold text-slate-900">
                유형별 세트 수
              </h2>
              <span className="text-xs text-slate-500">
                지문당 {perPassageTotals.total}문항
              </span>
            </div>
            <p className="px-1 text-[11px] text-slate-500">
              선택한 세트는 모든 지문에 동일하게 적용됩니다.
            </p>
            {sortedGroups.map((group) => {
              const selectedInGroup = group.options.reduce(
                (acc, o) => acc + (counts[o.key] ?? 0),
                0
              );
              const open = openCats[group.category] ?? true;
              const isMainIdea = group.category === "main_idea";
              const isDetails = group.category === "details";
              const isInference = group.category === "inference";
              const isGrammar = group.category === "grammar_vocabulary";
              return (
                <div
                  key={group.category}
                  className={`rounded-2xl border bg-white shadow-card ${
                    isMainIdea
                      ? "border-brand-300 ring-1 ring-brand-100"
                      : "border-slate-200"
                  }`}
                >
                  <div className="flex w-full items-center gap-1 px-2.5 py-1.5">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center justify-between text-left"
                      onClick={() =>
                        setOpenCats((prev) => ({
                          ...prev,
                          [group.category]: !open,
                        }))
                      }
                    >
                      <span className="text-sm font-semibold text-slate-900">
                        {group.label.replace(/^Section ·\s*/, "")}
                        {selectedInGroup > 0 && (
                          <span className="ml-2 rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold text-brand-800">
                            {selectedInGroup}
                          </span>
                        )}
                      </span>
                      <span className="ml-2 shrink-0 text-xs text-slate-400">
                        {open ? "▲" : "▼"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="shrink-0 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-default disabled:opacity-40"
                      disabled={selectedInGroup === 0}
                      onClick={() =>
                        resetCategory(group.options.map((o) => o.key))
                      }
                    >
                      초기화
                    </button>
                  </div>
                  {open && (
                    <div className="border-t border-slate-100 px-2 py-1.5">
                  {isMainIdea ? (
                    <div className="space-y-2">
                      <p className="text-[11px] leading-snug text-slate-500">
                        하/상 · (영)/(한)
                      </p>
                      {(
                        [
                          {
                            rowLabel: "제목",
                            keys: [
                              "title:en:low:제목추론",
                              "title:en:high:제목추론",
                              "title:ko:low:제목추론",
                              "title:ko:high:제목추론",
                            ],
                          },
                          {
                            rowLabel: "주제",
                            keys: [
                              "topic:en:low:주제추론",
                              "topic:en:high:주제추론",
                              "topic:ko:low:주제추론",
                              "topic:ko:high:주제추론",
                            ],
                          },
                          {
                            rowLabel: "요지",
                            keys: [
                              "summary_mcq:ko:low:요지추론",
                              "summary_mcq:ko:high:요지추론",
                            ],
                          },
                        ] as const
                      ).map((row) => (
                        <div key={row.rowLabel}>
                          <p className="mb-1 text-[11px] font-semibold text-slate-700">
                            {row.rowLabel}
                          </p>
                          <div className="grid grid-cols-2 gap-1">
                            {row.keys.map((key) => {
                              const opt = group.options.find(
                                (o) => o.key === key
                              );
                              if (!opt) return null;
                              const n = counts[key] ?? 0;
                              return (
                                <div
                                  key={key}
                                data-qtype={key}
                                  className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1"
                                >
                                  <span className="block truncate text-[11px] font-medium text-slate-800">
                                    {opt.label}
                                  </span>
                                  <div className="mt-0.5 flex items-center justify-between gap-0.5">
                                    <button
                                      type="button"
                                      className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-sm font-semibold text-slate-700"
                                      onClick={() => setCount(key, n - 1)}
                                    >
                                      −
                                    </button>
                                    <span className="min-w-[1.25rem] text-center text-xs font-bold tabular-nums text-slate-900">
                                      {n}
                                    </span>
                                    <button
                                      type="button"
                                      className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-sm font-semibold text-slate-700"
                                      onClick={() => setCount(key, n + 1)}
                                    >
                                      +
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full text-xs"
                        onClick={() =>
                          addCounts([
                            ["title:en:low:제목추론", 1],
                            ["title:en:high:제목추론", 1],
                            ["title:ko:low:제목추론", 1],
                            ["title:ko:high:제목추론", 1],
                            ["topic:en:low:주제추론", 1],
                            ["topic:en:high:주제추론", 1],
                            ["topic:ko:low:주제추론", 1],
                            ["topic:ko:high:주제추론", 1],
                            ["summary_mcq:ko:low:요지추론", 1],
                            ["summary_mcq:ko:high:요지추론", 1],
                          ])
                        }
                      >
                        모두 넣기 (+1)
                      </Button>
                    </div>
                  ) : isDetails ? (
                    <div className="space-y-2">
                      <p className="text-[11px] leading-snug text-slate-500">
                        하/상 · (영)/(한) · 효자·학력평가형 일치/불일치
                      </p>
                      {(
                        [
                          {
                            rowLabel: "일치",
                            keys: [
                              "content_true:en:low:내용일치",
                              "content_true:en:high:내용일치",
                              "content_true:ko:low:내용일치",
                              "content_true:ko:high:내용일치",
                            ],
                          },
                          {
                            rowLabel: "불일치",
                            keys: [
                              "content_false:en:low:내용불일치",
                              "content_false:en:high:내용불일치",
                              "content_false:ko:low:내용불일치",
                              "content_false:ko:high:내용불일치",
                            ],
                          },
                          {
                            rowLabel: "일치개수",
                            keys: [
                              "content_count:en:low:일치개수",
                              "content_count:en:high:일치개수",
                              "content_count:ko:low:일치개수",
                              "content_count:ko:high:일치개수",
                            ],
                          },
                        ] as const
                      ).map((row) => (
                        <div key={row.rowLabel}>
                          <p className="mb-1 text-[11px] font-semibold text-slate-700">
                            {row.rowLabel} 세트 수
                          </p>
                          <div className="grid grid-cols-2 gap-1">
                            {row.keys.map((key) => {
                              const opt = group.options.find(
                                (o) => o.key === key
                              );
                              if (!opt) return null;
                              const n = counts[key] ?? 0;
                              return (
                                <div
                                  key={key}
                                data-qtype={key}
                                  className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1"
                                >
                                  <span className="block truncate text-[11px] font-medium text-slate-800">
                                    {opt.label}
                                  </span>
                                  <div className="mt-0.5 flex items-center justify-between gap-0.5">
                                    <button
                                      type="button"
                                      className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-sm font-semibold text-slate-700"
                                      onClick={() => setCount(key, n - 1)}
                                    >
                                      −
                                    </button>
                                    <span className="min-w-[1.25rem] text-center text-xs font-bold tabular-nums text-slate-900">
                                      {n}
                                    </span>
                                    <button
                                      type="button"
                                      className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-sm font-semibold text-slate-700"
                                      onClick={() => setCount(key, n + 1)}
                                    >
                                      +
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full text-xs"
                        onClick={() =>
                          addCounts([
                            ["content_true:en:low:내용일치", 1],
                            ["content_true:en:high:내용일치", 1],
                            ["content_true:ko:low:내용일치", 1],
                            ["content_true:ko:high:내용일치", 1],
                            ["content_false:en:low:내용불일치", 1],
                            ["content_false:en:high:내용불일치", 1],
                            ["content_false:ko:low:내용불일치", 1],
                            ["content_false:ko:high:내용불일치", 1],
                            ["content_count:en:low:일치개수", 1],
                            ["content_count:en:high:일치개수", 1],
                            ["content_count:ko:low:일치개수", 1],
                            ["content_count:ko:high:일치개수", 1],
                          ])
                        }
                      >
                        모두 넣기 (+1)
                      </Button>
                    </div>
                  ) : isInference ? (
                    <div className="space-y-2">
                      <p className="text-[11px] leading-snug text-slate-500">
                        하/상 · 효자·학력평가형 (순서·빈칸·삽입·무관)
                      </p>
                      {(
                        [
                          {
                            rowLabel: "순서",
                            keys: [
                              "order:na:low:순서추론",
                              "order:na:high:순서추론",
                            ],
                          },
                          {
                            rowLabel: "문장빈칸",
                            keys: [
                              "sentence_blank:en:low:빈칸추론",
                              "sentence_blank:en:high:빈칸추론",
                            ],
                          },
                          {
                            rowLabel: "삽입",
                            keys: [
                              "sentence_insertion:na:low:문장삽입",
                              "sentence_insertion:na:high:문장삽입",
                            ],
                          },
                          {
                            rowLabel: "무관한 문장",
                            keys: [
                              "irrelevant_sentence:na:low:무관한문장",
                              "irrelevant_sentence:na:high:무관한문장",
                            ],
                          },
                        ] as const
                      ).map((row) => (
                        <div key={row.rowLabel}>
                          <p className="mb-1 text-[11px] font-semibold text-slate-700">
                            {row.rowLabel}
                          </p>
                          <div className="grid grid-cols-2 gap-1">
                            {row.keys.map((key) => {
                              const opt = group.options.find(
                                (o) => o.key === key
                              );
                              if (!opt) return null;
                              const n = counts[key] ?? 0;
                              return (
                                <div
                                  key={key}
                                data-qtype={key}
                                  className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1"
                                >
                                  <span className="block truncate text-[10px] font-medium text-slate-800">
                                    {opt.label}
                                  </span>
                                  <div className="mt-0.5 flex items-center justify-between gap-0.5">
                                    <button
                                      type="button"
                                      className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-sm font-semibold text-slate-700"
                                      onClick={() => setCount(key, n - 1)}
                                    >
                                      −
                                    </button>
                                    <span className="min-w-[1.25rem] text-center text-xs font-bold tabular-nums text-slate-900">
                                      {n}
                                    </span>
                                    <button
                                      type="button"
                                      className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-sm font-semibold text-slate-700"
                                      onClick={() => setCount(key, n + 1)}
                                    >
                                      +
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      <div>
                        <p className="mb-1 text-[11px] font-semibold text-slate-700">
                          함축의미추론
                          <span className="ml-1 font-normal text-slate-400">
                            (난이도 없음)
                          </span>
                        </p>
                        {(() => {
                          const key =
                            "underlined_inference:en:default:함축의미추론";
                          const n = counts[key] ?? 0;
                          return (
                            <div data-qtype={key} className="flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-1">
                              <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600">
                                영어 보기 · 없으면 생략
                              </span>
                              <button
                                type="button"
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-sm font-semibold text-slate-700"
                                onClick={() => setCount(key, n - 1)}
                              >
                                −
                              </button>
                              <span className="w-6 shrink-0 text-center text-sm font-bold tabular-nums text-slate-900">
                                {n}
                              </span>
                              <button
                                type="button"
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-sm font-semibold text-slate-700"
                                onClick={() => setCount(key, n + 1)}
                              >
                                +
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full text-xs"
                        onClick={() =>
                          addCounts([
                            ["order:na:low:순서추론", 1],
                            ["order:na:high:순서추론", 1],
                            ["sentence_blank:en:low:빈칸추론", 1],
                            ["sentence_blank:en:high:빈칸추론", 1],
                            ["sentence_insertion:na:low:문장삽입", 1],
                            ["sentence_insertion:na:high:문장삽입", 1],
                            ["irrelevant_sentence:na:low:무관한문장", 1],
                            ["irrelevant_sentence:na:high:무관한문장", 1],
                            [
                              "underlined_inference:en:default:함축의미추론",
                              1,
                            ],
                          ])
                        }
                      >
                        모두 넣기 (+1)
                      </Button>
                      <details className="rounded-lg border border-slate-100 bg-slate-50/50 px-2 py-1.5">
                        <summary className="cursor-pointer text-[11px] font-medium text-slate-500">
                          기타 (목적·심경·연결어)
                        </summary>
                        <div className="mt-1 space-y-0.5">
                          {[
                            "underlined_inference:en:default:목적추론",
                            "underlined_inference:en:default:심경추론",
                            "sentence_blank:en:default:연결어빈칸",
                          ].map((key) => {
                            const opt = group.options.find(
                              (o) => o.key === key
                            );
                            if (!opt) return null;
                            const n = counts[key] ?? 0;
                            return (
                              <div
                                key={key}
                                data-qtype={key}
                                className="flex items-center gap-1 rounded border border-slate-100 bg-white px-1.5 py-0.5"
                              >
                                <span className="min-w-0 flex-1 truncate text-[11px] text-slate-800">
                                  {opt.label}
                                </span>
                                <button
                                  type="button"
                                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-sm font-semibold text-slate-700"
                                  onClick={() => setCount(key, n - 1)}
                                >
                                  −
                                </button>
                                <span className="w-6 shrink-0 text-center text-sm font-bold tabular-nums text-slate-900">
                                  {n}
                                </span>
                                <button
                                  type="button"
                                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-sm font-semibold text-slate-700"
                                  onClick={() => setCount(key, n + 1)}
                                >
                                  +
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    </div>
                  ) : isGrammar ? (
                    <div className="space-y-1">
                      {(
                        [
                          {
                            key: "grammar:na:default:어법추론",
                            label: "어법 추론",
                          },
                          {
                            key: "grammar:na:default:어법개수",
                            label: "어법 개수",
                          },
                          {
                            key: "vocabulary:na:default:어휘추론",
                            label: "어휘 추론",
                          },
                          {
                            key: "vocabulary:na:default:어휘개수",
                            label: "어휘 개수",
                          },
                        ] as const
                      ).map((row) => {
                        const opt = group.options.find((o) => o.key === row.key);
                        if (!opt) return null;
                        const n = counts[row.key] ?? 0;
                        return (
                          <div
                            key={row.key}
                                data-qtype={row.key}
                            className="flex items-center gap-1 rounded border border-slate-100 bg-slate-50/80 px-1.5 py-0.5"
                          >
                            <span className="min-w-0 flex-1 truncate text-[11px] text-slate-800">
                              {row.label}
                            </span>
                            <button
                              type="button"
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-sm font-semibold text-slate-700"
                              onClick={() => setCount(row.key, n - 1)}
                            >
                              −
                            </button>
                            <span className="w-5 shrink-0 text-center text-xs font-bold tabular-nums text-slate-900">
                              {n}
                            </span>
                            <button
                              type="button"
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-sm font-semibold text-slate-700"
                              onClick={() => setCount(row.key, n + 1)}
                            >
                              +
                            </button>
                          </div>
                        );
                      })}
                      <label className="mt-1 flex items-start gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-[11px] text-slate-700">
                        <input
                          type="checkbox"
                          checked={paraphraseGV}
                          onChange={(e) => setParaphraseGV(e.target.checked)}
                          className="mt-0.5 h-3.5 w-3.5 accent-brand-600"
                        />
                        <span>
                          <b className="block text-slate-800">지문 바꿔 쓰기</b>
                          꺼 두면 지문이 원문 그대로 나오고, 밑줄 자리만 바뀝니다. 켜면 밑줄 자리를 만들려고 문장도 바꿔 씁니다.
                        </span>
                      </label>
                      <Button
                        type="button"
                        variant="secondary"
                        className="mt-1 w-full text-xs"
                        onClick={() =>
                          addCounts([
                            ["grammar:na:default:어법추론", 1],
                            ["grammar:na:default:어법개수", 1],
                            ["vocabulary:na:default:어휘추론", 1],
                            ["vocabulary:na:default:어휘개수", 1],
                          ])
                        }
                      >
                        모두 넣기 (+1)
                      </Button>
                    </div>
                  ) : (
                        <div className="space-y-0.5">
                          {group.options.map((opt) => {
                            const n = counts[opt.key] ?? 0;
                            return (
                              <div
                                key={opt.key}
                                data-qtype={opt.key}
                                className="flex items-center gap-1 rounded border border-slate-100 bg-slate-50/80 px-1.5 py-0.5"
                              >
                                <span className="min-w-0 flex-1 truncate text-[11px] text-slate-800">
                                  {opt.label}
                                </span>
                                <button
                                  type="button"
                                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-sm font-semibold text-slate-700"
                                  onClick={() => setCount(opt.key, n - 1)}
                                >
                                  −
                                </button>
                                <span className="w-5 shrink-0 text-center text-xs font-bold tabular-nums text-slate-900">
                                  {n}
                                </span>
                                <button
                                  type="button"
                                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-sm font-semibold text-slate-700"
                                  onClick={() => setCount(opt.key, n + 1)}
                                >
                                  +
                                </button>
                              </div>
                            );
                          })}
                          {group.category === "subjective" && wordOrderCount > 0 ? (
                            <WordOrderModeBox mode={wordOrderMode} onMode={setWordOrderMode} />
                          ) : null}
                          {group.category === "subjective" && writingCount > 0 ? (
                            <GrammarScopeBox
                              choices={grammarChoices}
                              picked={grammarScope}
                              onChange={setGrammarScope}
                              open={grammarScopeOpen}
                              onToggle={() => setGrammarScopeOpen((v) => !v)}
                              mode={grammarWritingMode}
                              onMode={setGrammarWritingMode}
                            />
                          ) : null}
                        </div>
                      )}
                      {(isMainIdea || isDetails || isInference || isGrammar) &&
                        (() => {
                          const extra = group.options.filter((o) => !FIXED_LAYOUT_KEYS.has(o.key));
                          if (extra.length === 0) return null;
                          return (
                            <div className="mt-2 space-y-0.5 border-t border-slate-100 pt-1.5">
                              <p className="mb-1 text-[11px] font-semibold text-slate-700">더 많은 유형</p>
                              {extra.map((opt) => {
                                const n = counts[opt.key] ?? 0;
                                return (
                                  <div
                                    key={opt.key}
                                    data-qtype={opt.key}
                                    className="flex items-center gap-1 rounded border border-slate-100 bg-slate-50/80 px-1.5 py-0.5"
                                  >
                                    <span className="min-w-0 flex-1 truncate text-[11px] text-slate-800">
                                      {opt.label}
                                    </span>
                                    <button
                                      type="button"
                                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-sm font-semibold text-slate-700"
                                      onClick={() => setCount(opt.key, n - 1)}
                                    >
                                      −
                                    </button>
                                    <span className="w-5 shrink-0 text-center text-xs font-bold tabular-nums text-slate-900">
                                      {n}
                                    </span>
                                    <button
                                      type="button"
                                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-sm font-semibold text-slate-700"
                                      onClick={() => setCount(opt.key, n + 1)}
                                    >
                                      +
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                    </div>
                  )}
                </div>
              );
            })}
            {personalPresets.length > 0 && (
              <select
                className="ui-select w-full"
                value={modeTab.startsWith("preset:") ? modeTab : ""}
                onChange={(e) => {
                  const id = e.target.value.replace("preset:", "");
                  const p = personalPresets.find((x) => x.id === id);
                  if (p) applyDbPreset(p);
                }}
              >
                <option value="">저장한 프리셋 불러오기…</option>
                {personalPresets.map((p) => (
                  <option key={p.id} value={`preset:${p.id}`}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </section>
        </aside>

        {/* 오른쪽: 기본 정보 + 지문들 */}
        <div className="min-w-0 space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
            <h2 className="mb-4 text-sm font-semibold text-slate-900">
              기본 정보
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="ui-label">자료 제목</span>
                <input
                  className="ui-input mt-1"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="예: 2026년 3월 고1 모의고사 변형"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="ui-label">출처</span>
                <input
                  className="ui-input mt-1"
                  value={sourceType}
                  onChange={(e) => setSourceType(e.target.value)}
                  placeholder="예: 2026년 3월 고1 모의고사"
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {savedAt
                ? `마지막 임시 저장: ${new Date(savedAt).toLocaleString("ko-KR")}`
                : "변경 사항은 자동으로 임시 저장됩니다."}
              {role === "admin" ? " · 관리자" : " · 강사"}
            </p>
          </section>

          <section className="space-y-1">
            <PassageSheet
              title="영어 지문"
              subtitle={`${filledPassages.length}/${passages.length}개 입력 · 최대 ${MAX_PASSAGES}개`}
              rows={passages.map((p) => ({ ...p, title: p.title ?? "", sourceDetail: p.sourceDetail ?? "" }))}
              onChange={setPassages}
              makeRow={() => ({ ...emptyPassageInput(), title: "", sourceDetail: "" })}
              maxRows={MAX_PASSAGES}
              footer={(addRow) => (
                <>
                  <Button type="button" variant="secondary" disabled={passages.length >= MAX_PASSAGES} onClick={addRow}>
                    + 지문 추가
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={filledPassages.length >= MAX_PASSAGES}
                    onClick={() => setMockOpen("mock")}
                  >
                    모의고사 지문 불러오기
                  </Button>
                  {textbookOpen ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={filledPassages.length >= MAX_PASSAGES}
                      onClick={() => setMockOpen("textbook")}
                    >
                      교과서 지문 불러오기
                    </Button>
                  ) : null}
                  {outsideOpen ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={filledPassages.length >= MAX_PASSAGES}
                      onClick={() => setMockOpen("outside")}
                    >
                      외부지문 불러오기
                    </Button>
                  ) : null}
                  <span className="text-xs text-slate-500">
                    {passages.length >= MAX_PASSAGES ? `최대 ${MAX_PASSAGES}개입니다.` : "아래에 새 행이 추가됩니다."}
                  </span>
                </>
              )}
              columns={[
                {
                  key: "text",
                  label: "영어 지문",
                  english: true,
                  width: "62%",
                  placeholder: "영어 지문을 그대로 붙여 넣으세요. 엑셀에서 여러 행을 복사해 붙여도 돼요.",
                  help: "지문 한 편을 한 행에 넣어요. 지문이 여러 개면 행을 늘리세요.",
                },
                {
                  key: "title",
                  label: "제목 (선택)",
                  singleLine: true,
                  placeholder: `${title || "자료"} · 1`,
                  help: "비우면 자료 제목 + 번호로 붙어요.",
                },
                {
                  key: "sourceDetail",
                  label: "지문 출처 (선택)",
                  singleLine: true,
                  placeholder: sourceDetail || "출처",
                  help: "비우면 위 「출처」를 써요.",
                },
              ]}
            />
          </section>

          {sample ? (
            <div
              className="pointer-events-none fixed z-50 w-[min(500px,calc(100vw-32px))] rounded-xl border border-slate-300 bg-white p-4 shadow-2xl"
              style={{
                left: Math.min(
                  sample.x,
                  Math.max(16, (typeof window === "undefined" ? 1200 : window.innerWidth) - 516)
                ),
                top: Math.max(12, Math.min(sample.y, (typeof window === "undefined" ? 800 : window.innerHeight) - 380)),
              }}
            >
              <p className="text-[15px] font-bold text-slate-900">{sample.s.name}</p>
              <p className="mt-0.5 text-[12.5px] text-slate-500">{sample.s.shape}</p>
              <p className="mt-2.5 rounded-lg bg-slate-50 px-3 py-2 text-[13px] font-semibold leading-snug text-slate-900">
                {sample.s.stem}
              </p>
              {sample.s.levels ? (
                <div className="mt-2 space-y-1">
                  {(["low", "high"] as const).map((lv) => (
                    <p
                      key={lv}
                      className={`rounded-lg px-2.5 py-1.5 text-[12.5px] ${
                        sample.level === lv ? "bg-brand-50 font-semibold text-brand-800" : "text-slate-500"
                      }`}
                    >
                      <b className="mr-1">{lv === "low" ? "하" : "상"}</b>
                      {sample.s.levels![lv]}
                    </p>
                  ))}
                </div>
              ) : null}
              <SampleLines lines={sample.s.lines} />
              {sample.s.levelNote ? (
                <p className="mt-2.5 border-t border-slate-100 pt-2 text-[11.5px] leading-snug text-slate-500">
                  {sample.s.levelNote}
                </p>
              ) : null}
            </div>
          ) : null}

          {mockOpen ? (
            <MockPassagePickerModal
              max={MAX_PASSAGES - filledPassages.length}
              initialSource={mockOpen}
              allowTextbook={textbookOpen}
              allowOutside={outsideOpen}
              onPick={addMockPassages}
              onClose={() => setMockOpen(null)}
            />
          ) : null}

          {showPresetForm && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-900">
                현재 유형 설정을 프리셋으로 저장
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  className="ui-input"
                  placeholder="프리셋 이름"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                />
                <input
                  className="ui-input"
                  placeholder="설명 (선택)"
                  value={presetDesc}
                  onChange={(e) => setPresetDesc(e.target.value)}
                />
              </div>
              <div className="mt-3 flex gap-2">
                <Button type="button" onClick={() => void savePreset()}>
                  저장
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowPresetForm(false)}
                >
                  취소
                </Button>
              </div>
            </section>
          )}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-20 lg:left-[244px] border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="text-sm text-slate-700">
            <span className="font-semibold text-slate-900">
              총 {grandTotal}문항
            </span>
            {creditTotal !== null && (
              <>
                <span className="mx-2 text-slate-300">|</span>
                <span className="font-semibold text-amber-700">
                  {creditTotal.toLocaleString("ko-KR")}크레딧
                </span>
              </>
            )}
            <span className="mx-2 text-slate-300">|</span>
            지문 {Math.max(filledPassages.length, 1)}개 × 지문당{" "}
            {perPassageTotals.total}
            <span className="mx-2 text-slate-300">|</span>
            객관식 {perPassageTotals.objective} · 주관식{" "}
            {perPassageTotals.subjective}
            {grandTotal > MAX_TOTAL_QUESTIONS && (
              <span className="ml-2 text-red-600">
                (최대 {MAX_TOTAL_QUESTIONS} 초과)
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void saveDraft()}
            >
              임시 저장
            </Button>
            <Button type="button" variant="ghost" onClick={resetAll}>
              유형 초기화
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowPresetForm(true)}
            >
              프리셋 저장
            </Button>
            <Button
              type="button"
              disabled={
                busy ||
                generating ||
                perPassageTotals.total === 0 ||
                filledPassages.length === 0
              }
              onClick={() => void startGenerate()}
            >
              {generating ? "생성 중…" : busy ? "요청 중…" : "변형문제 생성"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
