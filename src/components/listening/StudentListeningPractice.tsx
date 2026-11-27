"use client";

import Link from "next/link";
import { ReportProblemButton } from "@/components/ui/ReportProblemButton";
import { DictationCard, DictationSection } from "@/components/listening/DictationSection";
import { StudentAudioBar } from "@/components/listening/StudentAudioBar";
import { Icon } from "@/components/layout/NavIcon";
import { Button } from "@/components/ui/Button";
import { isLabelOnlyChoiceSet } from "@/lib/listening/balance-correct-answer";
import { responseBlankLine } from "@/lib/listening/question-display";
import type {
  DictationSetSettings,
  DictationStartPayloadClient,
} from "@/lib/listening/dictation/types";
import { DEFAULT_DICTATION_SETTINGS } from "@/lib/listening/dictation/types";
import { shouldHideTextChoicesForFigure } from "@/lib/listening/figure-choice-display";
import { normalizeTableData } from "@/lib/listening/table-data";
import { ListeningTableDisplay } from "@/components/listening/ListeningTableDisplay";
import type { ListeningTableData } from "@/lib/listening/types";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

const CIRCLED = ["①", "②", "③", "④", "⑤"];

export interface StudentListeningQuestion {
  id: string;
  /** 문항이 속한 세트 (하루 과제가 세트 경계를 넘는 경우 문항마다 다를 수 있음) */
  setId?: string;
  setTitle?: string;
  order_index: number;
  question_type: string;
  instruction: string;
  question_text: string;
  choices: string[];
  correct_answer: number;
  audio_url: string | null;
  script_text?: string;
  script_translation?: string;
  answer_clue?: string;
  explanation?: string;
  table_data?: ListeningTableData | null;
  needs_image_choices?: boolean;
  choice_image_urls?: string[];
}

interface QuestionDictationStatus {
  passed: boolean;
  bestScore: number | null;
  attemptCount: number;
}

interface SchedulePracticeMode {
  dailyTaskId: string;
  requireDictationPass: boolean;
  dictationPassScore: number;
  initialProgress?: Record<
    string,
    { objectiveCompleted: boolean; dictationCompleted: boolean; completed: boolean }
  >;
}

interface StudentListeningPracticeProps {
  setId: string;
  setTitle: string;
  questions: StudentListeningQuestion[];
  dictationSettings?: Partial<DictationSetSettings>;
  scheduleMode?: SchedulePracticeMode;
  /** 뒤로 가기 링크 */
  backHref?: string;
  backLabel?: string;
  /** 제목 아래 작은 안내(하루 과제 정보 등) */
  metaLine?: string;
}

export function StudentListeningPractice({
  setId,
  setTitle,
  questions,
  dictationSettings: dictationSettingsProp,
  scheduleMode,
  backHref = "/student/listening",
  backLabel = "듣기학습",
  metaLine,
}: StudentListeningPracticeProps) {
  const router = useRouter();
  const dictationSettings: DictationSetSettings = {
    ...DEFAULT_DICTATION_SETTINGS,
    ...dictationSettingsProp,
  };

  const initialObjective = useMemo(() => {
    const m: Record<string, boolean> = {};
    if (scheduleMode?.initialProgress) {
      for (const [qid, p] of Object.entries(scheduleMode.initialProgress)) {
        if (p.objectiveCompleted) m[qid] = true;
      }
    }
    return m;
  }, [scheduleMode]);

  const initialDictation = useMemo(() => {
    const m: Record<string, QuestionDictationStatus> = {};
    if (scheduleMode?.initialProgress) {
      for (const [qid, p] of Object.entries(scheduleMode.initialProgress)) {
        // 문항 완전 완료일 때만 다음 문항 해금 (dictationCompleted 단독으로는 부족)
        if (p.completed) {
          m[qid] = { passed: true, bestScore: null, attemptCount: 1 };
        }
      }
    }
    return m;
  }, [scheduleMode]);

  const [index, setIndex] = useState(0);
  const [progressSaveFailed, setProgressSaveFailed] = useState(false);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [objectiveSubmitted, setObjectiveSubmitted] =
    useState<Record<string, boolean>>(initialObjective);
  const [dictationByQuestion, setDictationByQuestion] = useState<
    Record<string, QuestionDictationStatus>
  >(initialDictation);
  const [, setShowScript] = useState(false);
  const [dictationKey, setDictationKey] = useState(0);
  const [dictationPrefetch, setDictationPrefetch] = useState<
    Record<string, DictationStartPayloadClient | null>
  >({});
  const dictationPrefetching = useRef<Set<string>>(new Set());
  const dictationPrefetchedIds = useRef<Set<string>>(new Set());
  const objectiveAudioRef = useRef<HTMLAudioElement | null>(null);

  function pauseObjectiveAudio() {
    const el = objectiveAudioRef.current;
    if (!el) return;
    el.pause();
    try {
      el.currentTime = 0;
    } catch {
      /* ignore */
    }
  }

  const q = questions[index];
  const selected = q ? answers[q.id] : undefined;
  const table = q ? normalizeTableData(q.table_data) : null;
  const figureUrls = (q?.choice_image_urls ?? [])
    .map((u) => String(u).trim())
    .filter(Boolean);
  // 선택지가 ①~⑤ 번호뿐이면(그림 속 라벨·표 행·짧은 대화 5개) 번호만 보인다 — "① ①"처럼 겹쳐 보이지 않게
  const hideFigureTextChoices = q
    ? shouldHideTextChoicesForFigure({
        choiceImageUrls: figureUrls,
        choices: q.choices,
        needsImageChoices: q.needs_image_choices,
      }) || isLabelOnlyChoiceSet(q.choices)
    : false;
  // 응답 문항의 빈칸 줄 — 번호가 아니라 이름·지시문으로 (중3 17번 응답, 20번은 상황에 맞는 말)
  const blankLine = q ? responseBlankLine(q) : null;
  const questionSetId = q?.setId || setId;

  function resolveSetId(questionId: string): string {
    return questions.find((item) => item.id === questionId)?.setId || setId;
  }

  const reportScheduleProgress = useCallback(
    async (
      questionId: string,
      patch: {
        objectiveCompleted: boolean;
        selectedAnswer?: number | null;
        dictationCompleted?: boolean;
        dictationScore?: number;
      }
    ) => {
      if (!scheduleMode) return;
      const body = JSON.stringify({
        dailyTaskId: scheduleMode.dailyTaskId,
        questionId,
        objectiveCompleted: patch.objectiveCompleted,
        selectedAnswer: patch.selectedAnswer ?? undefined,
        dictationCompleted: patch.dictationCompleted,
        dictationScore: patch.dictationScore,
      });
      // 와이파이가 잠깐 끊겨도 진행이 사라지지 않게 두 번 더 보낸다. 끝내 안 되면 알려 준다
      // (전에는 실패해도 화면은 「완료」로 넘어가고 서버엔 미완료로 남았다)
      for (const wait of [0, 800, 2000]) {
        if (wait) await new Promise((r) => setTimeout(r, wait));
        try {
          const res = await fetch("/api/listening/daily-task/progress", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          });
          const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
          if (res.ok && data.ok !== false) {
            return;
          }
        } catch {
          /* 다시 보낸다 */
        }
      }
      setProgressSaveFailed(true);
    },
    [scheduleMode]
  );

  const loadDictationStatus = useCallback(async () => {
    if (scheduleMode) return;
    const res = await fetch(`/api/listening/dictation/status?setId=${setId}`);
    const data = (await res.json()) as {
      ok?: boolean;
      questions?: Record<string, QuestionDictationStatus>;
    };
    if (data.ok && data.questions) {
      setDictationByQuestion(data.questions);
    }
  }, [setId]);

  useEffect(() => {
    void loadDictationStatus();
  }, [loadDictationStatus]);

  useEffect(() => {
    if (!scheduleMode || questions.length === 0) return;
    const firstOpen = questions.findIndex((item) => {
      const p = scheduleMode.initialProgress?.[item.id];
      if (p?.completed) return false;
      return true;
    });
    if (firstOpen > 0) setIndex(firstOpen);
  }, [scheduleMode, questions]);

  const warmupDictation = useCallback(
    async (questionId: string) => {
      if (!dictationSettings.dictation_enabled) return;
      await fetch("/api/listening/dictation/warmup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setId: resolveSetId(questionId),
          questionId,
        }),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolveSetId uses questions/setId
    [setId, questions, dictationSettings.dictation_enabled]
  );

  const prefetchDictationStart = useCallback(
    async (questionId: string) => {
      if (!dictationSettings.dictation_enabled) return;
      if (dictationPrefetchedIds.current.has(questionId)) return;
      if (dictationPrefetching.current.has(questionId)) return;
      dictationPrefetching.current.add(questionId);

      try {
        const res = await fetch("/api/listening/dictation/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            setId: resolveSetId(questionId),
            questionId,
            dailyTaskId: scheduleMode?.dailyTaskId,
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          alreadyPassed?: boolean;
          score?: number;
          attemptId?: string;
          passageLines?: DictationStartPayloadClient["passageLines"];
          blanks?: DictationStartPayloadClient["blanks"];
        };
        if (data.ok && data.alreadyPassed) {
          dictationPrefetchedIds.current.add(questionId);
          setDictationByQuestion((prev) => ({
            ...prev,
            [questionId]: {
              passed: true,
              bestScore: data.score ?? null,
              attemptCount: 1,
            },
          }));
          return;
        }
        if (
          data.ok &&
          data.attemptId &&
          data.passageLines?.length &&
          (data.blanks?.length ?? 0) > 0
        ) {
          dictationPrefetchedIds.current.add(questionId);
          setDictationPrefetch((prev) => ({
            ...prev,
            [questionId]: {
              attemptId: data.attemptId!,
              passageLines: data.passageLines!,
              blanks: data.blanks ?? [],
            },
          }));
        }
      } finally {
        dictationPrefetching.current.delete(questionId);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setId, questions, dictationSettings.dictation_enabled, scheduleMode?.dailyTaskId]
  );

  useEffect(() => {
    if (!dictationSettings.dictation_enabled) return;
    for (const item of questions) {
      void warmupDictation(item.id);
    }
  }, [questions, dictationSettings.dictation_enabled, warmupDictation]);

  useEffect(() => {
    if (!dictationSettings.dictation_enabled) return;
    if (!q) return;
    if (!objectiveSubmitted[q.id]) {
      void warmupDictation(q.id);
      void prefetchDictationStart(q.id);
    }
    const next = questions[index + 1];
    if (next && !objectiveSubmitted[next.id]) {
      void warmupDictation(next.id);
      void prefetchDictationStart(next.id);
    }
  }, [
    q?.id,
    index,
    questions,
    dictationSettings.dictation_enabled,
    objectiveSubmitted,
    warmupDictation,
    prefetchDictationStart,
  ]);

  const dictationRequired =
    dictationSettings.dictation_enabled && questions.length > 0;

  const currentDictationPassed = q
    ? (dictationByQuestion[q.id]?.passed ?? false)
    : false;

  const objectiveDone = q ? !!objectiveSubmitted[q.id] : false;

  const isCorrect =
    objectiveDone && q && selected != null && selected === q.correct_answer;
  const isWrong =
    objectiveDone && q && selected != null && selected !== q.correct_answer;

  const canGoNext = useMemo(() => {
    if (!q || index >= questions.length - 1) return false;
    if (!objectiveDone) return false;
    if (
      dictationRequired &&
      dictationSettings.dictation_lock_next_until_pass &&
      !currentDictationPassed
    ) {
      return false;
    }
    return true;
  }, [
    q,
    index,
    questions.length,
    objectiveDone,
    dictationRequired,
    dictationSettings.dictation_lock_next_until_pass,
    currentDictationPassed,
  ]);

  function isQuestionFullyDone(questionId: string): boolean {
    if (!objectiveSubmitted[questionId]) return false;
    if (!dictationRequired) return true;
    return !!dictationByQuestion[questionId]?.passed;
  }

  function priorQuestionsBlocked(targetIndex: number): boolean {
    if (scheduleMode) {
      for (let i = 0; i < targetIndex; i++) {
        if (!isQuestionFullyDone(questions[i]!.id)) return true;
      }
      return false;
    }
    if (!dictationRequired || !dictationSettings.dictation_lock_next_until_pass) {
      return false;
    }
    for (let i = 0; i < targetIndex; i++) {
      if (!isQuestionFullyDone(questions[i]!.id)) return true;
    }
    return false;
  }

  const allComplete =
    questions.length > 0 &&
    questions.every((item) => {
      if (!objectiveSubmitted[item.id]) return false;
      if (!dictationRequired) return true;
      if (!dictationSettings.dictation_lock_next_until_pass) return true;
      return dictationByQuestion[item.id]?.passed;
    }) &&
    // 진행 데이터에만 있고 화면에 없는 미완료 문항이 있으면 완료로 보지 않음
    !(
      scheduleMode?.initialProgress &&
      Object.entries(scheduleMode.initialProgress).some(
        ([qid, p]) =>
          !p.completed && !questions.some((item) => item.id === qid)
      )
    );

  const scheduleRedirectStarted = useRef(false);
  // 이미 끝낸 과제를 「복습하기」로 열었을 때는 목록으로 보내지 않는다 — 이 화면에서 막 끝냈을 때만
  const completeOnOpen = useRef<boolean | null>(null);
  if (completeOnOpen.current === null) completeOnOpen.current = allComplete;

  useEffect(() => {
    if (!scheduleMode || !allComplete || scheduleRedirectStarted.current) return;
    if (completeOnOpen.current) return;
    // 진행 저장이 안 된 채로 목록에 가면 그 문항이 미완료로 남는다 — 안내를 보고 다시 하게 둔다
    if (progressSaveFailed) return;
    scheduleRedirectStarted.current = true;
    const timer = setTimeout(() => {
      router.push("/student/listening");
    }, 1200);
    return () => clearTimeout(timer);
  }, [allComplete, scheduleMode, router, progressSaveFailed]);

  const missingIncomplete =
    scheduleMode?.initialProgress &&
    Object.entries(scheduleMode.initialProgress).filter(
      ([qid, p]) =>
        !p.completed && !questions.some((item) => item.id === qid)
    );

  if (!q) {
    return (
      <div className="space-y-4">
        <Link
          href={backHref}
          className="inline-flex w-fit items-center gap-1 text-[13px] font-medium text-slate-500 transition hover:text-slate-800"
        >
          <Icon name="left" size={16} />
          {backLabel}
        </Link>
        <div className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 bg-white px-6 py-12 text-center shadow-card">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Icon name="headphones" size={22} />
          </span>
          <p className="text-sm font-semibold text-slate-700">문항이 없어요.</p>
        </div>
        {missingIncomplete && missingIncomplete.length > 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            남은 문항을 불러오지 못했어요. 페이지를 새로고침하거나 선생님께
            말씀해 주세요.
          </p>
        )}
      </div>
    );
  }

  const displayChoices = q.choices
    .map((text, i) => ({ text: text.trim(), num: i + 1 }))
    .filter((c) => c.text);

  function selectAnswer(num: number) {
    if (objectiveDone) return;
    setAnswers((prev) => ({ ...prev, [q.id]: num }));
  }

  function submitObjective() {
    if (selected == null) return;
    pauseObjectiveAudio();
    setObjectiveSubmitted((prev) => ({ ...prev, [q.id]: true }));
    setShowScript(false);
    const alreadyDictationPassed = !!dictationByQuestion[q.id]?.passed;
    if (scheduleMode) {
      void reportScheduleProgress(q.id, {
        objectiveCompleted: true,
        selectedAnswer: selected,
        dictationCompleted: !dictationRequired || alreadyDictationPassed,
        dictationScore:
          !dictationRequired || alreadyDictationPassed
            ? (dictationByQuestion[q.id]?.bestScore ??
              scheduleMode.dictationPassScore)
            : undefined,
      });
      if (!dictationRequired && !alreadyDictationPassed) {
        setDictationByQuestion((prev) => ({
          ...prev,
          [q.id]: { passed: true, bestScore: null, attemptCount: 1 },
        }));
      }
    }
    if (dictationRequired && !alreadyDictationPassed) {
      setDictationKey((k) => k + 1);
      void prefetchDictationStart(q.id);
    }
  }

  function handleDictationPassed(dictationScore?: number) {
    setDictationByQuestion((prev) => ({
      ...prev,
      [q.id]: {
        passed: true,
        bestScore: dictationScore ?? prev[q.id]?.bestScore ?? null,
        attemptCount: (prev[q.id]?.attemptCount ?? 0) + 1,
      },
    }));
    if (scheduleMode) {
      void reportScheduleProgress(q.id, {
        objectiveCompleted: true,
        selectedAnswer: answers[q.id] ?? selected ?? null,
        dictationCompleted: true,
        dictationScore: dictationScore ?? scheduleMode.dictationPassScore,
      });
    } else {
      void loadDictationStatus();
    }
  }

  function goPrev() {
    if (index > 0) {
      pauseObjectiveAudio();
      setIndex(index - 1);
      setShowScript(false);
    }
  }

  function goNext() {
    if (!canGoNext) return;
    const next = index + 1;
    if (priorQuestionsBlocked(next)) return;
    pauseObjectiveAudio();
    setIndex(next);
    setShowScript(false);
  }

  function tryGoToIndex(nextIndex: number) {
    if (nextIndex < 0 || nextIndex >= questions.length) return;
    if (priorQuestionsBlocked(nextIndex)) return;
    pauseObjectiveAudio();
    setIndex(nextIndex);
    setShowScript(false);
  }

  const passScore = dictationSettings.dictation_pass_score;
  const lastIndex = questions.length - 1;
  const nextLockedByGate = !canGoNext && index < lastIndex;
  const showPassHint =
    !canGoNext && objectiveDone && dictationRequired && !currentDictationPassed;
  const blockedHere = priorQuestionsBlocked(index) && index > 0;
  const displayTitle = q.setTitle?.trim() || setTitle;
  const bestDictationScore = dictationByQuestion[q.id]?.bestScore ?? null;

  const navFooter = (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="secondary"
          onClick={goPrev}
          disabled={index === 0}
          className="pl-2.5 pr-3.5"
        >
          <Icon name="left" size={16} strokeWidth={2} />
          이전 문제
        </Button>
        {canGoNext ? (
          <Button onClick={goNext} className="pl-3.5 pr-2.5">
            다음 문제
            <Icon name="chevron" size={16} strokeWidth={2} />
          </Button>
        ) : (
          <button
            type="button"
            disabled
            title={
              showPassHint
                ? `받아쓰기 ${passScore}점 이상 필요`
                : undefined
            }
            className="inline-flex h-9 cursor-not-allowed items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-slate-200 bg-slate-100 px-3.5 text-sm font-semibold text-slate-400"
          >
            {nextLockedByGate && <Icon name="lock" size={16} strokeWidth={2} />}
            다음 문제
          </button>
        )}
      </div>
      {showPassHint && (
        <p className="text-right text-xs text-amber-700">
          받아쓰기 {passScore}점 이상이면 다음 문제로 넘어갈 수 있어요.
        </p>
      )}
      {blockedHere && (
        <p className="text-xs text-rose-700">
          이전 문항 받아쓰기를 통과한 뒤에 진행할 수 있어요.
        </p>
      )}
    </div>
  );

  const navigator =
    questions.length > 1 ? (
      <nav
        aria-label="문항 이동"
        className="-mx-4 min-w-0 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 lg:max-w-[55%] lg:pb-0"
      >
        <ol className="flex w-max gap-1.5">
          {questions.map((item, i) => {
            const current = i === index;
            const done =
              !!dictationByQuestion[item.id]?.passed || isQuestionFullyDone(item.id);
            const answered = !!objectiveSubmitted[item.id];
            const blocked = priorQuestionsBlocked(i);
            const tone = current
              ? "bg-brand-600 text-white"
              : done
                ? "bg-green-50 text-green-700"
                : answered
                  ? "bg-amber-50 text-amber-700"
                  : "bg-slate-100 text-slate-400";
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => tryGoToIndex(i)}
                  disabled={blocked}
                  aria-current={current ? "step" : undefined}
                  aria-label={`${item.order_index}번${
                    done ? " · 완료" : answered ? " · 받아쓰기 남음" : ""
                  }`}
                  className={`flex h-[34px] min-w-[34px] items-center justify-center rounded-md px-1.5 text-[13px] font-semibold tabular-nums transition disabled:cursor-not-allowed ${tone} ${
                    !current && !blocked ? "hover:ring-2 hover:ring-slate-200" : ""
                  }`}
                >
                  {item.order_index}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    ) : null;

  const questionCard = (
    <section className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-card sm:px-6 sm:py-[22px]">
      <div className="flex items-start gap-2.5">
        <span className="text-lg font-extrabold leading-[23px] tabular-nums text-brand-600">
          {q.order_index}
        </span>
        {q.instruction && (
          <p className="flex-1 text-[15px] font-semibold leading-[23px] text-slate-900">
            {q.instruction}
          </p>
        )}
        <span className="ml-auto shrink-0">
          <ReportProblemButton
            kind="listening"
            setId={questionSetId}
            targetId={q.id}
            targetLabel={`${q.order_index}번 ${q.instruction ?? ""}`.slice(0, 120)}
          />
        </span>
      </div>

      {q.audio_url ? (
        <StudentAudioBar
          key={q.audio_url}
          src={q.audio_url}
          audioRef={objectiveAudioRef}
          showSpeed
        />
      ) : (
        <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-700">
          <Icon name="alert" size={16} />
          음원이 아직 준비되지 않았어요.
        </p>
      )}

      {table && <ListeningTableDisplay table={table} />}

      {!table && figureUrls.length === 1 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={figureUrls[0]}
            alt="문항 그림"
            className="mx-auto max-h-[min(70vh,28rem)] w-auto max-w-full object-contain"
          />
        </div>
      )}

      {blankLine && !table && (
        <p className="rounded-lg bg-slate-50 px-4 py-3 font-mono text-base text-slate-900">
          {blankLine}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {displayChoices.map(({ text, num }) => {
          const isSelected = selected === num;
          const choiceCorrect = objectiveDone && num === q.correct_answer;
          const choiceWrong = objectiveDone && isSelected && num !== q.correct_answer;
          const perChoiceImg =
            !table && figureUrls.length > 1 ? figureUrls[num - 1] : undefined;
          const tone = choiceWrong
            ? {
                row: "border-rose-600 bg-rose-50",
                mark: "text-rose-700",
                text: "font-semibold text-rose-700",
              }
            : choiceCorrect
              ? {
                  row: "border-green-700 bg-green-50",
                  mark: "text-green-700",
                  text: "font-semibold text-green-700",
                }
              : isSelected
                ? {
                    row: "border-brand-600 bg-brand-50",
                    mark: "text-brand-600",
                    text: "font-bold text-brand-700",
                  }
                : {
                    row: objectiveDone
                      ? "border-slate-200 bg-white"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                    mark: "text-slate-500",
                    text: "font-medium text-slate-700",
                  };
          return (
            <li key={num}>
              <button
                type="button"
                onClick={() => selectAnswer(num)}
                disabled={objectiveDone}
                aria-pressed={isSelected}
                className={`flex min-h-[50px] w-full items-center gap-3 rounded-md border-[1.5px] px-3.5 py-2.5 text-left transition disabled:cursor-default sm:min-h-[46px] ${tone.row}`}
              >
                <span
                  className={`shrink-0 text-[17px] font-semibold leading-none sm:text-base ${tone.mark}`}
                >
                  {CIRCLED[num - 1] ?? `${num}.`}
                </span>
                <span
                  className={`min-w-0 flex-1 text-[15px] leading-snug sm:text-sm ${tone.text}`}
                >
                  {hideFigureTextChoices ? null : text}
                  {perChoiceImg ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={perChoiceImg}
                      alt=""
                      className={`block max-h-28 w-auto rounded border border-slate-200 ${
                        hideFigureTextChoices ? "" : "mt-2"
                      }`}
                    />
                  ) : null}
                </span>
                {choiceCorrect && (
                  <span className="inline-flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap rounded bg-white/70 px-2 text-xs font-semibold text-green-700">
                    <Icon name="check" size={12} strokeWidth={2.6} />
                    {isSelected ? "내 답 · 정답" : "정답"}
                  </span>
                )}
                {choiceWrong && (
                  <span className="inline-flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap rounded bg-white/70 px-2 text-xs font-semibold text-rose-700">
                    <Icon name="x" size={12} strokeWidth={2.6} />
                    내 답
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {!objectiveDone && (
        <Button
          onClick={submitObjective}
          disabled={selected == null}
          className="h-[50px] w-full text-base sm:h-11 sm:text-[15px]"
        >
          답안 제출
        </Button>
      )}

      {objectiveDone && (
        <div className="flex flex-col gap-1.5 rounded-lg bg-slate-50 px-4 py-3.5 text-[13px] leading-relaxed text-slate-700">
          <p>
            {selected != null && (
              <>
                <b className="font-bold text-slate-900">내 답</b>{" "}
                {CIRCLED[selected - 1] ?? selected}
                {isCorrect && (
                  <span className="ml-1.5 font-semibold text-green-700">정답</span>
                )}
                {isWrong && (
                  <span className="ml-1.5 font-semibold text-rose-700">오답</span>
                )}
                <span className="mx-2 text-slate-300">|</span>
              </>
            )}
            <b className="font-bold text-slate-900">정답</b>{" "}
            {CIRCLED[q.correct_answer - 1] ?? q.correct_answer}
          </p>
          {q.answer_clue && !table && (
            <p>
              <b className="font-bold text-slate-900">정답 근거</b> {q.answer_clue}
            </p>
          )}
          {q.explanation && (
            <p>
              <b className="font-bold text-slate-900">해설</b> {q.explanation}
            </p>
          )}
        </div>
      )}
    </section>
  );

  let dictationCard: ReactNode = null;
  if (dictationRequired) {
    if (!objectiveDone) {
      dictationCard = (
        <DictationCard passScore={passScore}>
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-6 py-8 text-center sm:py-10 lg:flex-1">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-400 ring-1 ring-slate-200">
              <Icon name="lock" size={20} />
            </span>
            <p className="text-sm font-semibold text-slate-700">
              문제를 먼저 풀면 받아쓰기가 열려요
            </p>
            <p className="text-[13px] text-slate-500">
              답안을 제출하면 같은 음원으로 받아쓰기를 해요.
            </p>
          </div>
          {navFooter}
        </DictationCard>
      );
    } else if (!currentDictationPassed) {
      dictationCard = (
        <DictationSection
          key={`${q.id}-${dictationKey}`}
          setId={questionSetId}
          questionId={q.id}
          audioUrl={q.audio_url}
          passScore={passScore}
          enabled
          onPassed={handleDictationPassed}
          prefetched={dictationPrefetch[q.id] ?? null}
          dailyTaskId={scheduleMode?.dailyTaskId}
          footer={navFooter}
        />
      );
    } else {
      dictationCard = (
        <DictationCard passScore={passScore}>
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-green-200 bg-green-50 px-6 py-8 text-center sm:py-10 lg:flex-1">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-green-700 ring-1 ring-green-200">
              <Icon name="check" size={22} strokeWidth={2.4} />
            </span>
            <p className="text-sm font-bold text-green-700">받아쓰기 통과</p>
            {bestDictationScore != null && (
              <p className="text-[13px] tabular-nums text-green-700">
                최고 {bestDictationScore}점
              </p>
            )}
          </div>
          {navFooter}
        </DictationCard>
      );
    }
  }

  return (
    <div className="space-y-5">
      {progressSaveFailed && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <Icon name="alert" size={16} className="mt-0.5" />
          <span>
            풀이 기록이 저장되지 않았어요. 인터넷 연결을 확인한 뒤 화면을 새로 고쳐 저장 안 된 문항을 다시 풀어 주세요.
          </span>
        </div>
      )}
      {missingIncomplete && missingIncomplete.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <Icon name="alert" size={16} className="mt-0.5" />
          <span>
            남은 문항 중 {missingIncomplete.length}개를 화면에 불러오지 못했어요.
            새로고침 후에도 같으면 선생님께 말씀해 주세요.
          </span>
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
        <div className="flex min-w-0 flex-col gap-2">
          <Link
            href={backHref}
            className="inline-flex w-fit items-center gap-1 text-[13px] font-medium text-slate-500 transition hover:text-slate-800"
          >
            <Icon name="left" size={16} />
            {backLabel}
          </Link>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
              {displayTitle}
            </h1>
            <span className="text-sm tabular-nums text-slate-500">
              {index + 1}번 / 총 {questions.length}문항
              {q.question_type ? ` · ${q.question_type}` : ""}
            </span>
          </div>
          {metaLine && <p className="text-xs text-slate-500">{metaLine}</p>}
        </div>
        {navigator}
      </div>

      {allComplete && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-700"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-700 text-white">
            <Icon name="check" size={14} strokeWidth={3} />
          </span>
          {scheduleMode
            ? completeOnOpen.current
              ? "이미 끝낸 과제예요. 다시 들으며 복습할 수 있어요."
              : progressSaveFailed
                ? "다 풀었어요. 다만 저장이 안 된 문항이 있어요 — 위 안내를 봐 주세요."
                : "오늘 듣기학습을 모두 끝냈어요. 잠시 후 목록으로 이동해요."
            : "모든 문항의 문제와 받아쓰기를 끝냈어요."}
        </div>
      )}

      {dictationRequired ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {questionCard}
          {dictationCard}
        </div>
      ) : (
        <div className="max-w-3xl space-y-4">
          {questionCard}
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-card sm:px-6">
            {navFooter}
          </div>
        </div>
      )}
    </div>
  );
}
