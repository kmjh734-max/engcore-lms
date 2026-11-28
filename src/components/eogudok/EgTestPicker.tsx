"use client";

import { useEffect, useMemo, useState } from "react";
import type { EgTest } from "@/lib/eogudok/data";
import { egMinutes } from "@/lib/eogudok/test-sheet";

type VocabMode = "" | "en" | "ko";

/** 조교 테스트 「직접 고르기」 — 그 주 문항 전체에서 체크한 것만으로 시험지를 만든다. */
export function EgTestPicker({ g, w, color, pass }: { g: number; w: number; color: string; pass: number }) {
  const [data, setData] = useState<EgTest | null>(null);
  const [vmode, setVmode] = useState<VocabMode[]>([]);
  const [gram, setGram] = useState<Set<number>>(new Set());
  const [arr, setArr] = useState<Set<number>>(new Set());
  const [tr, setTr] = useState<Set<number>>(new Set());

  useEffect(() => {
    setData(null);
    fetch(`/api/eogudok/test-data?g=${g}&w=${w}`)
      .then((r) => r.json())
      .then((d: EgTest) => {
        setData(d);
        setVmode(d.vocab.map((_, i) => (i < 15 ? "en" : "ko")));
        setGram(new Set(d.grammar.slice(0, 15).map((_, i) => i)));
        setArr(new Set((d.arrange ?? []).slice(0, 6).map((_, i) => i)));
        setTr(new Set((d.translate ?? []).slice(0, 6).map((_, i) => i)));
      });
  }, [g, w]);

  const counts = useMemo(() => {
    const en = vmode.filter((m) => m === "en").length;
    const ko = vmode.filter((m) => m === "ko").length;
    return { en, ko, total: en + ko + gram.size + arr.size + tr.size };
  }, [vmode, gram, arr, tr]);

  if (!data) return <div className="px-4 py-3 text-sm text-slate-500">문항을 불러오는 중…</div>;

  const toggle = (set: Set<number>, fn: (s: Set<number>) => void, i: number) => {
    const n = new Set(set);
    if (n.has(i)) n.delete(i); else n.add(i);
    fn(n);
  };
  const ids = (pred: (m: VocabMode) => boolean) => vmode.map((m, i) => (pred(m) ? i : -1)).filter((i) => i >= 0).join(".");
  const pick = `en=${ids((m) => m === "en")};ko=${ids((m) => m === "ko")};gram=${[...gram].sort((a, b) => a - b).join(".")};arr=${[...arr].sort((a, b) => a - b).join(".")};tr=${[...tr].sort((a, b) => a - b).join(".")}`;
  const url = `/api/eogudok/test?g=${g}&w=${w}&pass=${pass}&pick=${encodeURIComponent(pick)}`;

  const box = "max-h-72 overflow-y-auto rounded-md bg-white p-2 ring-1 ring-slate-200";
  const head = (t: string, n: number, all: number) => (
    <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-700">
      <span>{t}</span>
      <span style={{ color }}>{n} / {all}</span>
    </div>
  );

  return (
    <div className="space-y-3 px-4 py-3 text-sm">
      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          {head(`단어 — 영→한 ${counts.en} · 한→영 ${counts.ko}`, counts.en + counts.ko, data.vocab.length)}
          <div className={box}>
            {data.vocab.map((v, i) => (
              <div key={i} className="flex items-center gap-2 border-b border-slate-50 py-0.5 last:border-0">
                <select
                  value={vmode[i]}
                  onChange={(e) => setVmode((p) => p.map((m, k) => (k === i ? (e.target.value as VocabMode) : m)))}
                  className="rounded border px-1 py-0.5 text-xs"
                >
                  <option value="">안 씀</option>
                  <option value="en">영→한</option>
                  <option value="ko">한→영</option>
                </select>
                <b className="w-32 shrink-0 font-medium">{v.en}</b>
                <span className="truncate text-slate-500">{v.ko}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          {head("어법 고르기", gram.size, data.grammar.length)}
          <div className={box}>
            {data.grammar.map((q, i) => (
              <label key={i} className="flex gap-2 border-b border-slate-50 py-1 last:border-0">
                <input type="checkbox" checked={gram.has(i)} onChange={() => toggle(gram, setGram, i)} className="mt-1" />
                <span className="text-xs leading-5">{q.q.replace("[ ____ ]", `[${q.choices[0]} / ${q.choices[1]}]`)}</span>
              </label>
            ))}
          </div>
        </div>
        <div>
          {head("패턴 영작(배열)", arr.size, data.arrange?.length ?? 0)}
          <div className={box}>
            {(data.arrange ?? []).map((a, i) => (
              <label key={i} className="flex gap-2 border-b border-slate-50 py-1 last:border-0">
                <input type="checkbox" checked={arr.has(i)} onChange={() => toggle(arr, setArr, i)} className="mt-1" />
                <span className="text-xs leading-5">{a.ko}<br /><span className="text-slate-500">{a.bogi}</span></span>
              </label>
            ))}
          </div>
        </div>
        <div>
          {head("독해 문장 해석", tr.size, data.translate?.length ?? 0)}
          <div className={box}>
            {(data.translate ?? []).map((t, i) => (
              <label key={i} className="flex gap-2 border-b border-slate-50 py-1 last:border-0">
                <input type="checkbox" checked={tr.has(i)} onChange={() => toggle(tr, setTr, i)} className="mt-1" />
                <span className="text-xs leading-5">{t.en}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button className="rounded-md px-3 py-1.5 font-semibold text-white" style={{ background: color }} onClick={() => window.open(url, "_blank", "noopener")}>
          고른 {counts.total}문항으로 테스트지 뽑기
        </button>
        <span className="text-xs text-slate-500">약 {egMinutes(counts.en + counts.ko, gram.size, arr.size, tr.size)}분 · 통과 기준 {pass}% → {Math.ceil((counts.total * pass) / 100)}개 이상</span>
      </div>
    </div>
  );
}
