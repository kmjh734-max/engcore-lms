"use client";

import { useState } from "react";
import type { EgMeta } from "@/lib/eogudok/data";
import { EgTestPicker } from "./EgTestPicker";
import { egMinutes } from "@/lib/eogudok/test-sheet";

const ACCENT = { 1: "#3a2fd0", 2: "#0a7f6c", 3: "#c81f66" } as const;

function open(url: string) {
  window.open(url, "_blank", "noopener");
}

export function EogudokHome({ metas }: { metas: EgMeta[] }) {
  const [g, setG] = useState<1 | 2 | 3>(1);
  const [picked, setPicked] = useState<number[]>([]);
  const [testWeek, setTestWeek] = useState<number | null>(null);
  const [form, setForm] = useState<"A" | "B" | "C">("A");
  const [en, setEn] = useState(15);
  const [ko, setKo] = useState(15);
  const [gram, setGram] = useState(15);
  const [arr, setArr] = useState(6);
  const [tr, setTr] = useState(6);
  const [manual, setManual] = useState(false);
  const [pass, setPass] = useState(85);
  const meta = metas[g - 1];
  const c = ACCENT[g];
  const toggle = (n: number) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n].sort((a, b) => a - b)));
  const book = (mode: string, weeks: number[], front = false) =>
    open(`/api/eogudok/print?g=${g}&mode=${mode}&weeks=${weeks.join(",")}${front ? "&front=1" : ""}`);
  const testUrl = (w: number) => `/api/eogudok/test?g=${g}&w=${w}&form=${form}&en=${en}&ko=${ko}&gram=${gram}&arr=${arr}&tr=${tr}&pass=${pass}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {([1, 2, 3] as const).map((x) => (
          <button
            key={x}
            onClick={() => { setG(x); setPicked([]); setTestWeek(null); }}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${g === x ? "text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}
            style={g === x ? { background: ACCENT[x] } : undefined}
          >
            예비고{x}
          </button>
        ))}
        <span className="ml-2 text-xs text-slate-500">12주 한 권 {meta.totalPages}쪽</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button className="rounded-md bg-white px-3 py-1.5 text-sm ring-1 ring-slate-200" onClick={() => book("student", [], true)}>12주 한 권 · 학생용</button>
          <button className="rounded-md bg-white px-3 py-1.5 text-sm ring-1 ring-slate-200" onClick={() => book("teacher", [], true)}>12주 한 권 · 교사용</button>
          <button className="rounded-md bg-white px-3 py-1.5 text-sm ring-1 ring-slate-200" onClick={() => book("answers", [])}>정답 별책</button>
        </div>
      </div>

      {picked.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200">
          <b>{picked.map((n) => `${n}주`).join(" · ")}</b> 골라 한 번에 뽑기:
          <button className="rounded-md px-3 py-1 text-white" style={{ background: c }} onClick={() => book("student", picked)}>학생용</button>
          <button className="rounded-md bg-white px-3 py-1 ring-1 ring-slate-300" onClick={() => book("teacher", picked)}>교사용</button>
          <button className="rounded-md bg-white px-3 py-1 ring-1 ring-slate-300" onClick={() => book("answers", picked)}>정답</button>
          <button className="ml-auto text-xs text-slate-500" onClick={() => setPicked([])}>선택 지우기</button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
        {meta.weeks.map((w) => (
          <div key={w.n} className="border-b border-slate-100 last:border-0">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3">
              <input type="checkbox" checked={picked.includes(w.n)} onChange={() => toggle(w.n)} className="h-4 w-4" />
              <div className="w-12 text-2xl font-extralight" style={{ color: c }}>{String(w.n).padStart(2, "0")}</div>
              <div className="min-w-[16rem] flex-1">
                <div className="text-sm font-semibold text-slate-900">{w.grammar}</div>
                <div className="text-xs text-slate-500">{w.reading} · {w.src} · p.{w.pages?.[0]}–{w.pages?.[1]}</div>
              </div>
              <div className="flex flex-wrap gap-1.5 text-sm">
                <button className="rounded-md px-2.5 py-1 text-white" style={{ background: c }} onClick={() => book("student", [w.n])}>학생용</button>
                <button className="rounded-md bg-white px-2.5 py-1 ring-1 ring-slate-300" onClick={() => book("teacher", [w.n])}>교사용</button>
                <button className="rounded-md bg-white px-2.5 py-1 ring-1 ring-slate-300" onClick={() => book("answers", [w.n])}>정답</button>
                <button
                  className={`rounded-md px-2.5 py-1 ring-1 ${testWeek === w.n ? "bg-amber-50 ring-amber-400" : "bg-white ring-slate-300"}`}
                  onClick={() => setTestWeek(testWeek === w.n ? null : w.n)}
                >
                  조교 테스트
                </button>
              </div>
            </div>
            {testWeek === w.n && (
              <div className="bg-amber-50/60">
              <div className="flex gap-1 px-4 pt-3 text-xs">
                <button className={`rounded-full px-3 py-1 ${!manual ? "bg-slate-800 text-white" : "bg-white ring-1 ring-slate-300"}`} onClick={() => setManual(false)}>자동으로 뽑기</button>
                <button className={`rounded-full px-3 py-1 ${manual ? "bg-slate-800 text-white" : "bg-white ring-1 ring-slate-300"}`} onClick={() => setManual(true)}>문항 직접 고르기</button>
              </div>
              {manual ? <EgTestPicker g={g} w={w.n} color={c} pass={pass} /> : (
              <div className="flex flex-wrap items-end gap-4 bg-amber-50/60 px-4 py-3 text-sm">
                <label className="flex flex-col text-xs text-slate-600">형
                  <select className="mt-1 rounded border px-2 py-1 text-sm" value={form} onChange={(e) => setForm(e.target.value as "A" | "B" | "C")}>
                    <option>A</option><option>B</option><option>C</option>
                  </select>
                </label>
                {[
                  ["단어 뜻 쓰기 (영→한)", en, setEn, w.vocabCount],
                  ["단어 쓰기 (한→영)", ko, setKo, w.vocabCount],
                  ["어법 고르기", gram, setGram, Math.min(20, w.grammarCount)],
                  ["패턴 영작(배열)", arr, setArr, w.arrangeCount ?? 0],
                  ["독해 문장 해석", tr, setTr, w.translateCount ?? 0],
                ].map(([label, v, set, max]) => (
                  <label key={label as string} className="flex flex-col text-xs text-slate-600">{label as string}
                    <input type="number" min={0} max={max as number} value={v as number} onChange={(e) => (set as (n: number) => void)(Number(e.target.value))} className="mt-1 w-20 rounded border px-2 py-1 text-sm" />
                  </label>
                ))}
                <label className="flex flex-col text-xs text-slate-600">통과 기준(%)
                  <input type="number" min={50} max={100} value={pass} onChange={(e) => setPass(Number(e.target.value))} className="mt-1 w-20 rounded border px-2 py-1 text-sm" />
                </label>
                <button className="rounded-md px-3 py-1.5 font-semibold text-white" style={{ background: c }} onClick={() => open(testUrl(w.n))}>
                  {form}형 테스트지 뽑기
                </button>
                <span className="text-xs font-semibold text-slate-700">
                  {Math.min(en + ko, w.vocabCount) + Math.min(gram, w.grammarCount) + Math.min(arr, w.arrangeCount ?? 0) + Math.min(tr, w.translateCount ?? 0)}문항 · 약{" "}
                  {egMinutes(Math.min(en + ko, w.vocabCount), Math.min(gram, w.grammarCount), Math.min(arr, w.arrangeCount ?? 0), Math.min(tr, w.translateCount ?? 0))}분
                </span>
                <span className="text-xs text-slate-500">단어 {w.vocabCount} · 어법 {w.grammarCount} · 배열 {w.arrangeCount ?? 0} · 해석 {w.translateCount ?? 0}개 중에서 뽑습니다. 형이 다르면 문항이 다릅니다(재시험용).</span>
              </div>
              )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
