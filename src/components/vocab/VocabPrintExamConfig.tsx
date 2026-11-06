"use client";

import type {
  ExamColumnCount,
  ExamLineSpacing,
  ExamPrintConfig,
  ExamPrintLayout,
  ExamPrintSettings,
} from "@/lib/vocab/vocab-print-exam-config";
import type { VocabPassageGroup } from "@/lib/vocab/vocab-print-types";
import {
  EXAM_COLUMN_LABELS,
  EXAM_LINE_SPACING_LABELS,
  clampExamConfigToPool,
  examSharedTotal,
  resolveExamRange,
} from "@/lib/vocab/vocab-print-exam-config";

interface VocabPrintExamConfigProps {
  settings: ExamPrintSettings;
  onChange: (settings: ExamPrintSettings) => void;
  onReshuffle: () => void;
  /** 단어장 전체 단어 수(번호는 1~wordCount) */
  wordCount: number;
  /** 범위 안에서 동의어·반의어가 적힌 단어 수 */
  relationCounts: { syn: number; ant: number };
  /** 수업자료 단어장이면 지문별 번호 구간 — 있으면 지문으로도 범위를 고른다 */
  passageGroups?: VocabPassageGroup[];
}

const ROWS = [
  { label: "단어제시", mc: "word_mc" as const, sa: "word_sa" as const },
  { label: "의미제시", mc: "meaning_mc" as const, sa: "meaning_sa" as const },
  { label: "예문제시", mc: "example_mc" as const, sa: "example_sa" as const },
  { label: "동의어", mc: "syn_mc" as const, sa: "syn_sa" as const, rel: "syn" as const },
  { label: "반의어", mc: "ant_mc" as const, sa: "ant_sa" as const, rel: "ant" as const },
];

const COLUMNS: ExamColumnCount[] = [1, 2, 3, 4];
const SPACINGS: ExamLineSpacing[] = ["compact", "normal", "wide"];

export function VocabPrintExamConfig({
  settings,
  onChange,
  onReshuffle,
  wordCount,
  relationCounts,
  passageGroups = [],
}: VocabPrintExamConfigProps) {
  const { counts, layout } = settings;
  const range = resolveExamRange(settings, wordCount);
  const maxPool = Math.max(0, range.to - range.from + 1);
  const ranged = maxPool < wordCount;

  const total = examSharedTotal(counts);
  const overPool = total > maxPool;

  function setCounts(next: ExamPrintConfig) {
    onChange({
      ...settings,
      counts: clampExamConfigToPool(next, maxPool),
    });
  }

  function setLayout(next: Partial<ExamPrintLayout>) {
    // 단 구성·문항 간격만 바꿀 때는 같은 시험지를 유지한다.
    // 섞기를 켜고 끌 때만 새 순서를 만든다.
    const shuffleToggled =
      "shuffle" in next &&
      next.shuffle !== undefined &&
      next.shuffle !== layout.shuffle;
    onChange({
      ...settings,
      layout: { ...layout, ...next },
      shuffleSeed: shuffleToggled ? Date.now() : settings.shuffleSeed,
    });
  }

  function setCount(key: keyof ExamPrintConfig, raw: string) {
    const n = Number.parseInt(raw, 10);
    const value = Number.isFinite(n) && n > 0 ? Math.min(n, Math.max(maxPool, 0)) : 0;
    setCounts({ ...counts, [key]: value });
  }

  /**
   * 범위를 바꾼다. 범위 단어를 한 유형으로 전부 내던 중이면(예: 뜻 쓰기 240) 새 범위 단어 수로 따라가고,
   * 아니면 새 범위 단어 수를 넘는 만큼만 줄인다.
   */
  function setRange(from: number, to: number) {
    const next = { ...settings, rangeFrom: from, rangeTo: to };
    const r = resolveExamRange(next, wordCount);
    const pool = Math.max(0, r.to - r.from + 1);
    const used = (Object.keys(counts) as (keyof ExamPrintConfig)[]).filter((k) => counts[k] > 0);
    let nextCounts = counts;
    if (used.length === 1 && counts[used[0]] === maxPool) {
      nextCounts = { ...counts, [used[0]]: pool };
    }
    onChange({ ...next, counts: clampExamConfigToPool(nextCounts, pool) });
  }

  function readNo(raw: string): number {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, wordCount) : 0;
  }

  return (
    <div className="w-full space-y-3">
      <div className="space-y-1.5">
        <span className="text-[13px] font-medium text-slate-600">출제 범위 (단어 번호)</span>
        <div className="flex items-center gap-1.5 text-[13px] text-slate-700">
          <input
            type="number"
            min={1}
            max={wordCount}
            value={settings.rangeFrom || ""}
            placeholder="1"
            onChange={(e) => setRange(readNo(e.target.value), settings.rangeTo)}
            className="w-16 rounded-md border border-slate-300 px-2 py-1.5 text-center text-sm tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
          <span>번 ~</span>
          <input
            type="number"
            min={1}
            max={wordCount}
            value={settings.rangeTo || ""}
            placeholder={String(wordCount)}
            onChange={(e) => setRange(settings.rangeFrom, readNo(e.target.value))}
            className="w-16 rounded-md border border-slate-300 px-2 py-1.5 text-center text-sm tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
          <span>번</span>
          {ranged ? (
            <button
              type="button"
              onClick={() => setRange(0, 0)}
              className="ml-auto rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              전체
            </button>
          ) : null}
        </div>
        <p className="text-xs text-slate-500">
          {range.from}~{range.to}번 단어 {maxPool}개에서 내요. 비워 두면 단어장 전체({wordCount}개).
        </p>
      </div>
      {passageGroups.length > 1 ? (
        <PassageRangePicker groups={passageGroups} range={range} onPick={(from, to) => setRange(from, to)} />
      ) : null}

      <p className="border-t border-slate-200 pt-3 text-[13px] font-medium text-slate-600">
        문항 수 · 단어·의미·예문은 합계 {maxPool}문항까지, 동의어·반의어는 따로 더할 수 있어요 (예문 문항은 마지막에 1단)
      </p>
      <p
        className={`text-xs font-medium ${
          overPool ? "text-amber-700" : "text-slate-500"
        }`}
      >
        현재 합계 {Math.min(total, maxPool)} / {maxPool}문항
        {overPool ? " · 단어 수보다 많을 수 없어 알아서 줄여요." : ""}
      </p>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-[13px] text-slate-500">
            <th className="pb-2 text-left font-medium" />
            <th className="pb-2 text-center font-semibold">객관식</th>
            <th className="pb-2 text-center font-semibold">주관식</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.label}>
              <td className="py-1.5 pr-3 text-[13px] font-medium text-slate-700">
                {row.label}
                {"rel" in row && row.rel ? (
                  <span className="block text-[11px] font-normal text-slate-400">
                    적힌 단어 {relationCounts[row.rel]}개
                  </span>
                ) : null}
              </td>
              <td className="px-1 py-1.5 text-center">
                <input
                  type="number"
                  min={0}
                  max={maxPool || 0}
                  value={counts[row.mc] || ""}
                  onChange={(e) => setCount(row.mc, e.target.value)}
                  className="w-16 rounded-md border border-slate-300 px-2 py-1.5 text-center text-sm tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
              </td>
              <td className="px-1 py-1.5 text-center">
                {"rel" in row ? (
                  // 동의어·반의어는 객관식만(수업용 자료 단어 시험지와 같게, 선생님 2026-10-29)
                  <span className="text-xs text-slate-300">—</span>
                ) : (
                  <input
                    type="number"
                    min={0}
                    max={maxPool || 0}
                    value={counts[row.sa] || ""}
                    onChange={(e) => setCount(row.sa, e.target.value)}
                    className="w-16 rounded-md border border-slate-300 px-2 py-1.5 text-center text-sm tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
        <span className="w-full text-[13px] font-medium text-slate-600">
          단 구성 (단어·의미)
        </span>
        {COLUMNS.map((col) => (
          <button
            key={col}
            type="button"
            onClick={() => setLayout({ columns: col })}
            className={`rounded-md border px-3 py-1.5 text-[13px] font-semibold ${
              layout.columns === col
                ? "border-brand-600 bg-brand-50 text-brand-700"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {EXAM_COLUMN_LABELS[col]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="w-full text-[13px] font-medium text-slate-600">문항 간격</span>
        {SPACINGS.map((spacing) => (
          <button
            key={spacing}
            type="button"
            onClick={() => setLayout({ lineSpacing: spacing })}
            className={`rounded-md border px-3 py-1.5 text-[13px] font-semibold ${
              layout.lineSpacing === spacing
                ? "border-brand-600 bg-brand-50 text-brand-700"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {EXAM_LINE_SPACING_LABELS[spacing]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[13px] text-slate-700">
          <input
            type="checkbox"
            checked={layout.shuffle}
            onChange={(e) => setLayout({ shuffle: e.target.checked })}
            className="h-4 w-4 accent-brand-600"
          />
          무작위 순서로 내기
        </label>
        {layout.shuffle ? (
          <button
            type="button"
            onClick={onReshuffle}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
          >
            순서 다시 섞기
          </button>
        ) : null}
        <p className="w-full text-xs text-slate-500">
          {layout.shuffle
            ? "범위 안에서 단어를 무작위로 골라 섞어 내요."
            : "범위 안 단어를 번호 순서대로 내요."}
        </p>
      </div>
    </div>
  );
}

/**
 * 지문(출처)별로 범위 고르기(선생님 2026-11-06). 단어장이 지문 차례로 들어 있어 지문 몇 개는 늘 이어진 번호다 —
 * 고르면 위 단어 번호 칸이 그 지문들의 처음·끝 번호로 바뀐다.
 */
function PassageRangePicker({
  groups,
  range,
  onPick,
}: {
  groups: VocabPassageGroup[];
  range: { from: number; to: number };
  onPick: (from: number, to: number) => void;
}) {
  const startAt = groups.findIndex((g) => g.from === range.from);
  const endAt = groups.findIndex((g) => g.to === range.to);
  const matched = startAt >= 0 && endAt >= startAt;
  const a = matched ? startAt : -1;
  const b = matched ? endAt : -1;
  const short = (label: string) => label.replace(/^\d{4}년\s*/, "").replace(/학력평가\s*/, "");
  const pick = (na: number, nb: number) => {
    if (na < 0 && nb < 0) return;
    const s = na < 0 ? nb : na;
    const e = nb < 0 ? na : nb;
    const lo = Math.min(s, e);
    const hi = Math.max(s, e);
    onPick(groups[lo].from, groups[hi].to);
  };
  const selectClass =
    "min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[13px] text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100";
  return (
    <div className="space-y-1.5">
      <span className="text-[13px] font-medium text-slate-600">출제 범위 (지문별)</span>
      <div className="flex items-center gap-1.5">
        <select aria-label="처음 지문" value={a} onChange={(e) => pick(Number(e.target.value), b)} className={selectClass}>
          <option value={-1}>처음 지문</option>
          {groups.map((g, i) => (
            <option key={i} value={i}>
              {short(g.label)} ({g.to - g.from + 1})
            </option>
          ))}
        </select>
        <span className="text-[13px] text-slate-500">~</span>
        <select aria-label="끝 지문" value={b} onChange={(e) => pick(a, Number(e.target.value))} className={selectClass}>
          <option value={-1}>끝 지문</option>
          {groups.map((g, i) => (
            <option key={i} value={i}>
              {short(g.label)} ({g.to - g.from + 1})
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap gap-1">
        {groups.map((g, i) => {
          const on = matched && i >= a && i <= b;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPick(g.from, g.to)}
              title={`${g.label} · ${g.from}~${g.to}번`}
              className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${
                on ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {short(g.label)}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-slate-500">지문을 누르면 그 지문 단어만, 처음·끝을 고르면 그 사이 지문 단어로 내요.</p>
    </div>
  );
}
