"use client";

import { DictationPassageLineView } from "@/components/listening/DictationPassageLine";
import { StudentAudioBar } from "@/components/listening/StudentAudioBar";
import { Icon } from "@/components/layout/NavIcon";
import { Button } from "@/components/ui/Button";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  DictationBlankInputClient,
  DictationPassageLineClient,
  DictationStartPayloadClient,
} from "@/lib/listening/dictation/types";
import type { DictationBlankScoreResult } from "@/lib/listening/dictation/types";

type DictationUiState =
  | "loading"
  | "ready"
  | "error"
  | "submitting"
  | "submitted_pass"
  | "submitted_fail";

interface DictationSectionProps {
  setId: string;
  questionId: string;
  audioUrl: string | null;
  passScore: number;
  enabled: boolean;
  onPassed: (score?: number) => void;
  prefetched?: DictationStartPayloadClient | null;
  /** 스케줄 일일 과제 — 통과 점수를 배정 기준으로 맞춤 */
  dailyTaskId?: string;
  /** 카드 맨 아래(이전·다음 문제 버튼 등) */
  footer?: ReactNode;
}

/** 받아쓰기 카드 틀 — 머리글(아이콘·제목·통과 기준)과 본문 */
export function DictationCard({
  passScore,
  headerRight,
  children,
}: {
  passScore: number;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex h-full flex-col gap-3.5 rounded-lg border border-slate-200 bg-white p-4 shadow-card sm:px-6 sm:py-[22px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon name="keyboard" size={18} className="text-brand-700" />
          <h2 className="text-[15px] font-bold text-slate-900">받아쓰기</h2>
          <span className="inline-flex h-[22px] items-center rounded bg-brand-50 px-2 text-xs font-semibold text-brand-700">
            {passScore}점 이상 통과
          </span>
        </div>
        {headerRight}
      </div>
      {children}
    </section>
  );
}

function SpeedToggle({
  value,
  onChange,
}: {
  value: number;
  onChange: (rate: number) => void;
}) {
  return (
    <div
      className="flex overflow-hidden rounded-md border border-slate-200"
      role="group"
      aria-label="재생 속도"
    >
      {[0.8, 1].map((rate) => {
        const active = value === rate;
        return (
          <button
            key={rate}
            type="button"
            onClick={() => onChange(rate)}
            aria-pressed={active}
            className={`px-2.5 py-1 text-xs font-semibold tabular-nums transition ${
              active
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            }`}
          >
            {rate === 1 ? "1.0x" : `${rate}x`}
          </button>
        );
      })}
    </div>
  );
}

export function DictationSection({
  setId,
  questionId,
  audioUrl,
  passScore,
  enabled,
  onPassed,
  prefetched,
  dailyTaskId,
  footer,
}: DictationSectionProps) {
  const [uiState, setUiState] = useState<DictationUiState>(
    prefetched?.attemptId ? "ready" : "loading"
  );
  const [attemptId, setAttemptId] = useState<string | null>(
    prefetched?.attemptId ?? null
  );
  const [passageLines, setPassageLines] = useState<DictationPassageLineClient[]>(
    prefetched?.passageLines ?? []
  );
  const [blankInputs, setBlankInputs] = useState<DictationBlankInputClient[]>(
    prefetched?.blanks ?? []
  );
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [score, setScore] = useState<number | null>(null);
  const [results, setResults] = useState<DictationBlankScoreResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(0.8);
  const loadGeneration = useRef(0);
  const onPassedRef = useRef(onPassed);
  onPassedRef.current = onPassed;

  const resultsById = useMemo(() => {
    const map = new Map<string, DictationBlankScoreResult>();
    for (const r of results) map.set(r.id, r);
    return map;
  }, [results]);

  const allBlankIds = useMemo(() => {
    const ids: string[] = [];
    for (const line of passageLines) {
      for (const id of line.blankIds) ids.push(id);
    }
    if (ids.length === 0) return blankInputs.map((b) => b.id);
    return ids;
  }, [passageLines, blankInputs]);

  const filledCount = allBlankIds.filter(
    (id) => (answers[id] ?? "").trim().length > 0
  ).length;

  function applyPayload(payload: DictationStartPayloadClient) {
    setAttemptId(payload.attemptId);
    setPassageLines(payload.passageLines);
    setBlankInputs(payload.blanks);
    setAnswers({});
    setUiState("ready");
  }

  const loadBlanks = useCallback(
    async (opts?: { retry?: boolean; prefetchedPayload?: DictationStartPayloadClient | null }) => {
      if (!enabled) return;

      if (opts?.prefetchedPayload?.attemptId && !opts.retry) {
        if (!opts.prefetchedPayload.blanks?.length) {
          void loadBlanks({ retry: true });
          return;
        }
        applyPayload(opts.prefetchedPayload);
        return;
      }

      const gen = ++loadGeneration.current;
      setUiState("loading");
      setError(null);
      setResults([]);
      setScore(null);

      try {
        const url = opts?.retry
          ? "/api/listening/dictation/generate"
          : "/api/listening/dictation/start";

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setId, questionId, dailyTaskId }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          message?: string;
          alreadyPassed?: boolean;
          score?: number;
        } & Partial<DictationStartPayloadClient>;

        if (gen !== loadGeneration.current) return;

        if (data.ok && data.alreadyPassed) {
          onPassedRef.current(data.score);
          setUiState("submitted_pass");
          setScore(data.score ?? null);
          return;
        }

        if (!data.ok || !data.attemptId || !data.passageLines?.length) {
          setError(data.message ?? "받아쓰기를 불러오지 못했어요.");
          setUiState("error");
          return;
        }

        const blanks = data.blanks ?? [];
        if (blanks.length === 0) {
          if (!opts?.retry) {
            await loadBlanks({ retry: true });
            return;
          }
          setError(data.message ?? "받아쓰기 빈칸을 불러오지 못했어요.");
          setUiState("error");
          return;
        }

        applyPayload({
          attemptId: data.attemptId,
          passageLines: data.passageLines,
          blanks,
        });
      } catch (e) {
        if (gen !== loadGeneration.current) return;
        setError(
          e instanceof Error
            ? e.message
            : "받아쓰기를 불러오는 중 문제가 생겼어요."
        );
        setUiState("error");
      }
    },
    [enabled, setId, questionId, dailyTaskId]
  );

  useEffect(() => {
    if (!enabled) return;
    void loadBlanks({ prefetchedPayload: prefetched ?? null });
  }, [enabled, questionId, prefetched, loadBlanks]);

  async function handleSubmit() {
    if (!attemptId) return;
    if (allBlankIds.length === 0) {
      setError("채점할 빈칸이 없어요. 다시 하기를 눌러 주세요.");
      return;
    }

    setUiState("submitting");
    setError(null);
    let data: {
      ok?: boolean;
      message?: string;
      score?: number;
      passed?: boolean;
      results?: DictationBlankScoreResult[];
    };
    try {
      const res = await fetch("/api/listening/dictation/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attemptId,
          studentAnswers: answers,
          passScore,
          dailyTaskId,
        }),
      });
      data = await res.json();
    } catch {
      // 인터넷이 끊겨도 「제출 중」에 멈추지 않게 — 쓴 답은 그대로 두고 다시 누르게 한다
      setError("인터넷 연결을 확인하고 다시 제출해 주세요. 쓴 답은 그대로 있어요.");
      setUiState("ready");
      return;
    }

    if (!data.ok) {
      setError(data.message ?? "제출하지 못했어요. 다시 눌러 주세요.");
      setUiState("ready");
      return;
    }

    const scoreValue = data.score ?? 0;
    setScore(scoreValue);
    setResults(data.results ?? []);
    // UI 통과 기준(배정 점수)으로 한 번 더 확인
    const passedClient = scoreValue >= passScore;
    if (passedClient) {
      setUiState("submitted_pass");
      onPassed(scoreValue);
    } else {
      setUiState("submitted_fail");
    }
  }

  async function handleRetry() {
    await loadBlanks({ retry: true });
  }

  /** Enter → 다음 빈칸으로 */
  function handleScriptKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    const target = e.target as HTMLElement;
    if (target.tagName !== "INPUT") return;
    e.preventDefault();
    const inputs = Array.from(
      e.currentTarget.querySelectorAll<HTMLInputElement>("input:not([disabled])")
    );
    const idx = inputs.indexOf(target as HTMLInputElement);
    const next = inputs[idx + 1];
    if (next) next.focus();
  }

  const inputDisabled =
    uiState === "submitting" ||
    uiState === "submitted_pass" ||
    uiState === "submitted_fail";
  const showResults =
    uiState === "submitted_pass" || uiState === "submitted_fail";
  const hasScript =
    (uiState === "ready" ||
      uiState === "submitting" ||
      uiState === "submitted_pass" ||
      uiState === "submitted_fail") &&
    passageLines.length > 0;
  const wrongResults = showResults ? results.filter((r) => !r.isCorrect) : [];

  if (!enabled) return null;

  return (
    <DictationCard
      passScore={passScore}
      headerRight={
        audioUrl ? (
          <SpeedToggle value={playbackRate} onChange={setPlaybackRate} />
        ) : undefined
      }
    >
      <p className="text-[13px] leading-relaxed text-slate-500">
        대본의 빈칸에 들은 단어를 입력하세요. 모르는 빈칸은 비워 두고 제출해도
        돼요. 통과하면 다음 문제로 넘어갈 수 있어요.
      </p>

      {audioUrl && (
        <StudentAudioBar
          key={audioUrl}
          src={audioUrl}
          variant="dark"
          playbackRate={playbackRate}
        />
      )}

      {uiState === "loading" && (
        <div
          className="space-y-3 rounded-lg border border-slate-200 px-4 py-4"
          aria-busy="true"
        >
          <p className="text-[13px] text-slate-500">받아쓰기를 준비하고 있어요…</p>
          <div className="h-3.5 w-11/12 animate-pulse rounded bg-slate-100" />
          <div className="h-3.5 w-3/4 animate-pulse rounded bg-slate-100" />
          <div className="h-3.5 w-5/6 animate-pulse rounded bg-slate-100" />
        </div>
      )}

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5">
          <p className="text-sm text-rose-700" role="alert">
            {error}
          </p>
          {uiState === "error" && (
            <Button variant="secondary" size="sm" onClick={() => void loadBlanks()}>
              <Icon name="rotate" size={14} />
              다시 불러오기
            </Button>
          )}
        </div>
      )}

      {hasScript && (
        <>
          <div
            className="space-y-0.5 rounded-lg border border-slate-200 px-4 py-3 sm:px-[18px] sm:py-4"
            onKeyDown={handleScriptKeyDown}
          >
            {passageLines.map((line, i) => (
              <DictationPassageLineView
                key={i}
                line={line}
                answers={answers}
                onAnswerChange={(id, value) =>
                  setAnswers((prev) => ({ ...prev, [id]: value }))
                }
                disabled={inputDisabled}
                resultsById={resultsById}
                showResults={showResults}
              />
            ))}
          </div>

          {allBlankIds.length === 0 ? (
            <p className="text-sm text-amber-700">
              빈칸을 불러오지 못했어요. 다시 하기를 누르거나 선생님께
              말씀해 주세요.
            </p>
          ) : (
            <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
              <span className="tabular-nums">
                빈칸 {allBlankIds.length}개 중 {filledCount}개 입력
              </span>
              {!inputDisabled && (
                <span className="hidden sm:inline">Enter로 다음 빈칸</span>
              )}
            </div>
          )}

          {score != null && (
            <div
              className={`rounded-lg border px-4 py-3 text-sm ${
                uiState === "submitted_pass"
                  ? "border-green-200 bg-green-50"
                  : "border-amber-200 bg-amber-50"
              }`}
            >
              <p
                className={`flex items-center gap-1.5 font-bold tabular-nums ${
                  uiState === "submitted_pass" ? "text-green-700" : "text-amber-700"
                }`}
              >
                {uiState === "submitted_pass" && (
                  <Icon name="check" size={16} strokeWidth={2.6} />
                )}
                <span className="text-lg">{score}점</span>
                <span className="text-sm font-semibold opacity-80">/ 100점</span>
              </p>
              {uiState === "submitted_fail" && (
                <p className="mt-1 text-amber-700">
                  {passScore}점이 안 됐어요. 빈칸을 새로 바꿔서 다시 해 볼까요?
                </p>
              )}
              {uiState === "submitted_pass" && (
                <p className="mt-1 text-green-700">
                  통과했어요. 다음 문제로 넘어갈 수 있어요.
                </p>
              )}
              {wrongResults.length > 0 && (
                <ul className="mt-2.5 space-y-1 border-t border-black/5 pt-2.5 text-xs text-slate-600">
                  {wrongResults.map((r) => (
                    <li key={r.id}>
                      정답 <span className="font-semibold text-slate-900">{r.correctAnswer}</span>
                      {r.studentAnswer ? (
                        <span className="text-slate-500"> · 내 입력 {r.studentAnswer}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      <div className="min-h-2 flex-1" />

      {hasScript && (uiState === "ready" || uiState === "submitting") && (
        <Button
          onClick={() => void handleSubmit()}
          disabled={uiState === "submitting"}
          className="h-11 w-full text-[15px]"
        >
          {uiState === "submitting" ? "채점 중…" : "받아쓰기 제출"}
        </Button>
      )}

      {uiState === "submitted_fail" && (
        <Button
          variant="secondary"
          onClick={() => void handleRetry()}
          className="h-11 w-full text-[15px]"
        >
          <Icon name="rotate" size={16} />
          빈칸 바꿔서 다시 하기
        </Button>
      )}

      {footer}
    </DictationCard>
  );
}
