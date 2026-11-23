"use client";

import { useEffect, useRef, useState } from "react";
import { choiceTexts, type QuestionDraft } from "@/components/question-generator/QuestionEditFields";

/**
 * 「바로 편집」 — 문제지 모양 그대로 칸을 눌러 고친다(지인에듀 「문서 편집」을 본떠, 선생님 2026-11-23).
 * 칸을 벗어나면 그 문항만 저장한다. 객관식은 ①~⑤ 기호를 누르면 그 보기가 정답이 된다.
 */

const MARKS = ["①", "②", "③", "④", "⑤", "⑥", "⑦"];

type Row = QuestionDraft & { id: string; passage_original?: string | null };

function Cell({
  value,
  onCommit,
  className,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [v, setV] = useState(value);
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setV(value);
  }, [value]);
  return (
    <textarea
      rows={1}
      value={v}
      placeholder={placeholder}
      onChange={(e) => {
        dirty.current = true;
        setV(e.target.value);
      }}
      onBlur={() => {
        if (dirty.current && v !== value) onCommit(v);
        dirty.current = false;
      }}
      className={`block w-full resize-none rounded-md border border-transparent bg-transparent px-1.5 py-1 outline-none transition [field-sizing:content] hover:border-slate-200 hover:bg-slate-50/60 focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100 ${className ?? ""}`}
    />
  );
}

export function InlineQuestionEditor({
  q,
  no,
  onSave,
}: {
  q: Row;
  no: number;
  /** 고친 칸만 보낸다. 실패하면 메시지를 돌려준다 */
  onSave: (id: string, patch: Partial<QuestionDraft>) => Promise<string | null>;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const texts = choiceTexts(q.choices);
  const answerNo = Number(String(q.correct_answer ?? "").replace(/[^\d]/g, ""));
  const mcq = texts.length > 0;

  async function save(patch: Partial<QuestionDraft>) {
    setState("saving");
    const err = await onSave(q.id, patch);
    setMsg(err);
    setState(err ? "error" : "saved");
    if (!err) setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1500);
  }

  const passage = (q.passage_modified || q.passage_original || "").trim();

  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-1">
        <span className="pt-1 text-sm font-bold text-slate-900">{no}.</span>
        <Cell
          value={q.instruction ?? ""}
          onCommit={(v) => void save({ instruction: v })}
          className="text-sm font-semibold text-slate-900"
          placeholder="발문"
        />
        <span
          className={`shrink-0 pt-1 text-[11px] font-semibold ${
            state === "saving" ? "text-slate-400" : state === "saved" ? "text-emerald-600" : state === "error" ? "text-rose-600" : "text-transparent"
          }`}
        >
          {state === "saving" ? "저장 중…" : state === "saved" ? "✓ 저장" : state === "error" ? "저장 못 함" : "·"}
        </span>
      </div>
      {msg ? <p className="text-[11px] text-rose-600">{msg}</p> : null}
      {passage ? (
        <div className="rounded-lg bg-slate-50 p-1.5">
          <Cell
            value={passage}
            onCommit={(v) => void save({ passage_modified: v })}
            className="font-serif text-sm leading-relaxed text-slate-800"
            placeholder="지문"
          />
        </div>
      ) : null}
      {(q.question_text ?? "").trim() ? (
        <div className="rounded-md border border-slate-300 p-1">
          <Cell
            value={q.question_text ?? ""}
            onCommit={(v) => void save({ question_text: v })}
            className="whitespace-pre-wrap font-serif text-sm text-slate-800"
            placeholder="조건·보기·요약문"
          />
        </div>
      ) : null}
      {mcq ? (
        <ul className="space-y-0.5">
          {texts.map((t, i) => {
            const on = answerNo === i + 1;
            return (
              <li key={i} className="flex items-start gap-1">
                <button
                  type="button"
                  title={`${MARKS[i]}를 정답으로`}
                  onClick={() => {
                    if (!on) void save({ correct_answer: i + 1 });
                  }}
                  className={`mt-0.5 h-6 w-6 shrink-0 rounded-full text-sm font-bold ${
                    on ? "bg-emerald-500 text-white" : "text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  {MARKS[i] ?? i + 1}
                </button>
                <Cell
                  value={t}
                  onCommit={(v) => {
                    const next = texts.map((x, k) => (k === i ? v : x));
                    void save({ choices: next.map((text, k) => ({ text, number: k + 1 })) });
                  }}
                  className="text-sm text-slate-800"
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex items-start gap-1">
          <span className="shrink-0 whitespace-nowrap pt-1 text-xs font-bold text-emerald-700">정답</span>
          <Cell
            value={String(q.correct_answer ?? "")}
            onCommit={(v) => void save({ correct_answer: v })}
            className="text-sm text-slate-800"
          />
        </div>
      )}
      <div className="flex items-start gap-1 border-t border-slate-100 pt-1">
        <span className="shrink-0 whitespace-nowrap pt-1 text-xs font-bold text-slate-500">해설</span>
        <Cell
          value={q.explanation ?? ""}
          onCommit={(v) => void save({ explanation: v })}
          className="text-xs leading-relaxed text-slate-600"
          placeholder="해설"
        />
      </div>
    </div>
  );
}
