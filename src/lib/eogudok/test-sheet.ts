import type { EgGrade, EgTest, EgWeek } from "./data";

/**
 * 조교 1:1 주간 테스트 시안 — 그 주 VOCA LIST 30낱말과 어법 두 칸 고르기 문항에서 형(A·B·C)마다 다르게 뽑는다.
 * 문항을 새로 만들지 않고 책에 있는 것만 섞는다. 같은 학년·주·형이면 언제 뽑아도 같은 시험지.
 */

export type EgPick = { en: number[]; ko: number[]; gram: number[]; arr: number[]; tr: number[] };
export type EgTestOpts = { form: "A" | "B" | "C"; en2ko: number; ko2en: number; gram: number; arr: number; tr: number; passPct: number; pick?: EgPick | null };

/** 문항당 예상 시간(초): 단어 20 · 어법 30 · 배열 90 · 해석 90 → 5분 단위로 올림 */
export function egMinutes(words: number, gram: number, arr: number, tr: number) {
  const sec = words * 20 + gram * 30 + arr * 90 + tr * 90;
  return Math.max(5, Math.ceil(sec / 300) * 5);
}

/** "en=1.4;ko=2;gram=0.3;arr=;tr=5" → 고른 문항 번호(0부터) */
export function parsePick(v: string | null): EgPick | null {
  if (!v) return null;
  const out: EgPick = { en: [], ko: [], gram: [], arr: [], tr: [] };
  for (const part of v.split(";")) {
    const [k, list] = part.split("=");
    if (k in out && list) out[k as keyof EgPick] = list.split(".").map(Number).filter((n) => Number.isInteger(n) && n >= 0);
  }
  return out;
}

const COLOR: Record<EgGrade, string> = { 1: "#3a2fd0", 2: "#0a7f6c", 3: "#c81f66" };
const TINT: Record<EgGrade, string> = { 1: "#f1f0fd", 2: "#ebf7f3", 3: "#fdeff4" };

function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
function shuffle<T>(a: T[], r: () => number): T[] {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function egTestHtml(g: EgGrade, wk: EgWeek, t: EgTest, o: EgTestOpts): string {
  const r = rng(`g${g}w${wk.n}${o.form}`);
  const pk = o.pick;
  const at = <T,>(arr: T[], ids: number[]) => ids.map((i) => arr[i]).filter(Boolean);
  const words = shuffle(t.vocab, r);
  const en2ko = pk ? at(t.vocab, pk.en) : words.slice(0, o.en2ko);
  const ko2en = pk ? at(t.vocab, pk.ko) : words.slice(o.en2ko, o.en2ko + o.ko2en);
  const gram = (pk ? at(t.grammar, pk.gram) : shuffle(t.grammar, r).slice(0, o.gram)).map((q) => {
    const flip = r() < 0.5;
    return { ...q, choices: (flip ? [q.choices[1], q.choices[0]] : q.choices) as [string, string] };
  });
  const arr = pk ? at(t.arrange ?? [], pk.arr) : shuffle(t.arrange ?? [], r).slice(0, o.arr);
  const tr = pk ? at(t.translate ?? [], pk.tr) : shuffle(t.translate ?? [], r).slice(0, o.tr);
  const total = en2ko.length + ko2en.length + gram.length + arr.length + tr.length;
  const pass = Math.ceil((total * o.passPct) / 100);
  const minutes = egMinutes(en2ko.length + ko2en.length, gram.length, arr.length, tr.length);
  const c = COLOR[g], tint = TINT[g];
  let no = 0;
  const p1 = en2ko.map((v) => `<li><i>${String(++no).padStart(2, "0")}</i><b>${esc(v.en)}</b><span class="ln"></span></li>`).join("");
  const p2 = ko2en.map((v) => `<li><i>${String(++no).padStart(2, "0")}</i><b class="ko">${esc(v.ko)}</b><span class="ln"></span></li>`).join("");
  const p3 = gram
    .map((q) => `<li><i>${String(++no).padStart(2, "0")}</i><span>${esc(q.q).replace("[ ____ ]", `<span class="ch"><b>${esc(q.choices[0])}</b><b>${esc(q.choices[1])}</b></span>`)}</span></li>`)
    .join("");
  const p4 = arr
    .map((a) => `<li><i>${String(++no).padStart(2, "0")}</i><div><div class="ko">${esc(a.ko)}${a.change ? ' <small>(필요하면 형태를 바꿀 것)</small>' : ""}</div><div class="bogi">${esc(a.bogi)}</div><div class="ln2"></div></div></li>`)
    .join("");
  const p5 = tr
    .map((x) => `<li><i>${String(++no).padStart(2, "0")}</i><div><div class="en">${esc(x.en)}</div><div class="ln2"></div><div class="ln2"></div></div></li>`)
    .join("");
  const longStart = en2ko.length + ko2en.length + gram.length;
  no = 0;
  const key = [
    ...en2ko.map((v) => `<span><i>${++no}</i>${esc(v.ko)}</span>`),
    ...ko2en.map((v) => `<span><i>${++no}</i>${esc(v.en)}</span>`),
    ...gram.map((q) => `<span><i>${++no}</i>${esc(q.ans)}</span>`),
  ].join("");
  const keyLong = [
    ...arr.map((a, k) => `<li><i>${longStart + k + 1}</i>${esc(a.ans)}</li>`),
    ...tr.map((x, k) => `<li><i>${longStart + arr.length + k + 1}</i>${esc(x.ko)}</li>`),
  ].join("");
  const head = (title: string) => `
  <div class="top"><div><div class="brand">어구독 <em>WEEKLY TEST</em></div><h1>예비고${g} · WEEK ${String(wk.n).padStart(2, "0")} <small>${esc(wk.grammar)}</small></h1></div>
  <div class="form"><b>${pk ? "선택" : o.form}</b>${pk ? "" : "형"}<small>${title}</small></div></div>`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>어구독 조교 테스트 예비고${g} W${wk.n} ${o.form}형</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<style>
@page{size:A4;margin:12mm 14mm}*{box-sizing:border-box}body{margin:0;background:#e9e9ee;font-family:Pretendard,sans-serif;color:#1d1f24;word-break:keep-all}
.page{width:210mm;min-height:297mm;margin:8mm auto;background:#fff;padding:13mm 14mm 12mm;position:relative}
@media print{body{background:#fff}.page{margin:0;padding:0;width:auto;min-height:0;break-after:page}.page:last-child{break-after:auto}.bar{display:none}.foot{position:static!important;margin-top:6mm}}
ol.w li,ol.g li,ol.l li,h2,.key span,ol.kl li{break-inside:avoid}h2{break-after:avoid}
.top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1.4pt solid ${c};padding-bottom:3mm}
.brand{font-size:8.5pt;letter-spacing:.2em;color:${c};font-weight:700}.brand em{font-style:normal;font-weight:400}
h1{margin:1.5mm 0 0;font-size:16pt;font-weight:800}h1 small{font-size:9.5pt;font-weight:500;color:#555;margin-left:2mm}
.form{text-align:right;color:${c};font-size:10pt}.form b{font-size:26pt;font-weight:200;line-height:1}.form small{display:block;color:#777;font-size:8pt}
table.info{width:100%;border-collapse:collapse;margin:3.5mm 0 4mm;font-size:9pt}table.info td{border:.5pt solid #bbb;padding:2.2mm 2.5mm;height:9mm}
table.info td.k{background:${tint};color:${c};font-weight:700;width:15mm;text-align:center}
.score b{font-size:13pt}.pass{color:${c};font-weight:700}
h2{font-size:10.5pt;margin:4mm 0 2mm;display:flex;gap:2mm;align-items:center}h2 span{background:${c};color:#fff;border-radius:10px;padding:.5mm 2.5mm;font-size:8pt;letter-spacing:.1em}
h2 small{font-weight:500;color:#777;font-size:8.5pt}
ol{list-style:none;margin:0;padding:0}ol.w{display:grid;grid-template-columns:1fr 1fr;column-gap:8mm;row-gap:1.2mm}
ol.w li{display:grid;grid-template-columns:7mm auto 1fr;align-items:end;gap:2mm;font-size:10.5pt;padding:1.3mm 0}
ol.w li b{font-weight:600}ol.w li b.ko{font-weight:500;font-size:9.5pt}.ln{border-bottom:.5pt solid #999;height:5mm}
i{font-style:normal;color:${c};font-weight:700;font-size:8.5pt}
ol.g li{display:grid;grid-template-columns:7mm 1fr;gap:1mm;font-size:10pt;line-height:1.65;padding:1.2mm 0;border-bottom:.3pt dashed #ddd}
.ch{white-space:nowrap;border:.6pt solid #888;border-radius:2px;margin:0 1mm}.ch b{font-weight:600;padding:0 1.6mm}.ch b+b{border-left:.6pt solid #888}
.foot{position:absolute;bottom:7mm;left:14mm;right:14mm;display:flex;justify-content:space-between;font-size:7.5pt;color:#999}
.key{display:grid;grid-template-columns:repeat(3,1fr);gap:1.5mm 5mm;font-size:9.5pt}.key span{border-bottom:.3pt solid #eee;padding:1mm 0}.key i{display:inline-block;width:7mm}
.page{display:flow-root}ol.l li{display:grid;grid-template-columns:7mm 1fr;gap:1mm;font-size:10pt;line-height:1.6;padding:1.6mm 0;break-inside:avoid}
ol.l .ko{font-weight:600}ol.l .ko small{font-weight:500;color:#888;font-size:8pt}ol.l .en{line-height:1.6}
.bogi{border:.5pt solid #bbb;border-radius:2px;padding:1.2mm 2.5mm;margin:1mm 0;font-size:9.5pt;background:${tint}}.ln2{border-bottom:.5pt solid #999;height:7.5mm}
ol.kl{margin-top:4mm;font-size:9.5pt;line-height:1.55}ol.kl li{display:grid;grid-template-columns:7mm 1fr;padding:1mm 0;border-bottom:.3pt solid #eee}
.bar{position:fixed;top:12px;right:12px}.bar button{background:${c};color:#fff;border:0;border-radius:8px;padding:9px 14px;font:600 13px Pretendard;cursor:pointer}
</style></head><body>
<div class="bar"><button onclick="window.print()">인쇄 · PDF 저장</button></div>
<section class="page">${head("학생용")}
<table class="info"><tr><td class="k">이름</td><td></td><td class="k">반</td><td style="width:28mm"></td><td class="k">날짜</td><td style="width:28mm"></td></tr>
<tr><td class="k">시간</td><td colspan="5">제한 시간 <b>${minutes}분</b> &nbsp;·&nbsp; 시작 ____ : ____ &nbsp; 끝 ____ : ____</td></tr>
<tr><td class="k">점수</td><td class="score"><b>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;/ ${total}</b> <span class="pass">통과 ${pass}개 이상</span></td><td class="k">결과</td><td>□ 통과 □ 재시험</td><td class="k">확인</td><td></td></tr></table>
${p1 ? `<h2><span>PART 1</span>단어 뜻 쓰기 <small>영어 → 우리말 · ${en2ko.length}문항</small></h2><ol class="w">${p1}</ol>` : ""}
${p2 ? `<h2><span>PART 2</span>단어 쓰기 <small>우리말 → 영어 · ${ko2en.length}문항</small></h2><ol class="w">${p2}</ol>` : ""}
${p3 ? `<h2><span>PART 3</span>어법 — 알맞은 것 고르기 <small>${gram.length}문항</small></h2><ol class="g">${p3}</ol>` : ""}
${p4 ? `<h2><span>PART 4</span>패턴 영작 — 〈보기〉의 말을 모두 배열 <small>${arr.length}문항</small></h2><ol class="l">${p4}</ol>` : ""}
${p5 ? `<h2><span>PART 5</span>독해 문장 해석 — 이번 주 지문 <small>${tr.length}문항</small></h2><ol class="l">${p5}</ol>` : ""}
<div class="foot"><span>정수학원 영어과 · 어구독 (겨울주간지)</span><span>예비고${g} W${String(wk.n).padStart(2, "0")} ${o.form}형</span></div></section>
<section class="page">${head("조교용 정답")}
<p style="font-size:9pt;color:#666;margin:3mm 0">통과 기준 ${pass}/${total} (${o.passPct}%) · 재시험은 다른 형(${o.form === "A" ? "B" : "A"}형)으로</p>
<div class="key">${key}</div>${keyLong ? `<ol class="kl">${keyLong}</ol>` : ""}
<div class="foot"><span>정수학원 영어과 · 어구독 (겨울주간지)</span><span>조교용 — 학생에게 주지 마세요</span></div></section>
</body></html>`;
}
