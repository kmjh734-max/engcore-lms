"use client";

import { sameCaseChoices } from "@/lib/lesson-materials/choice-case";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { writingConditionText } from "@/lib/lesson-materials/writing-grammar-condition";
import {
  circledHangul,
  circledLetter,
  circledNumber,
  flowRangeLabel,
  flowSentenceRanges,
  referenceMark,
  splitSentenceForSummary,
  splitSummaryByKeywords,
  stripMarkup,
  type OnePageContent,
  type OnePageFlowRange,
  type OnePageRun,
  type OnePageTestPassage,
  type OnePageTestRow,
} from "@/lib/lesson-materials/one-page";
import "./one-page-print-styles.css";

/**
 * 1장 요약직보자료·1장 테스트 인쇄 쪽. 지문 하나가 A4 한 쪽에 들어가도록 글자 크기를 줄여 맞추고
 * (FitSheet), 가장 작게 줄여도 넘치면 자르지 않고 다음 쪽으로 이어지게 둔다. 크기는 모두 em이라
 * 쪽의 글자 크기 하나만 바꾸면 전체가 함께 줄어든다. 최종통합자료에도 그대로 끼워 넣으므로
 * 스타일은 인쇄 루트 id가 아니라 op- 클래스에 건다.
 */

const A4_W_MM = 210;
const A4_H_MM = 297;
const PAD_Y_MM = 10;
const PAD_X_MM = 11;

export const ONE_PAGE_CSS = `
.op-sheet{position:relative;box-sizing:border-box;width:${A4_W_MM}mm;height:${A4_H_MM}mm;padding:${PAD_Y_MM}mm ${PAD_X_MM}mm;background:#fff;color:#111827;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.op-sheet--grow{height:auto;min-height:${A4_H_MM}mm;overflow:visible;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.op-body{line-height:1.45;word-break:keep-all;overflow-wrap:break-word}
.op-en{font-family:"Times New Roman",Georgia,"Noto Serif",serif}
.op-sans{font-family:ui-sans-serif,system-ui,sans-serif}
.op-head{display:flex;align-items:center;gap:.75em;padding:.5em .9em;border:1px solid #e3dcf7;background:#f6f3fe;border-radius:.75em}
.op-head .op-no{font-size:2em;font-weight:900;color:#6b4fd3;line-height:1;font-variant-numeric:tabular-nums}
.op-head h1{flex:1;min-width:0;margin:0;font-size:1.4em;font-weight:800;line-height:1.25}
.op-head .op-src{font-size:.8em;color:#6b7280;white-space:nowrap}
.op-head img{height:2.4em;width:auto;max-width:30mm;object-fit:contain}
.op-meta{margin:.65em 0 0;display:grid;grid-template-columns:auto 1fr;column-gap:.7em;row-gap:.3em}
.op-meta dt{font-weight:700;color:#9ca3af;white-space:nowrap}
.op-meta dt b{color:#6b4fd3;margin-right:.3em}
.op-meta dd{margin:0}
.op-just{text-align:justify}
.op-kw{font-weight:700;text-decoration:underline;text-underline-offset:.16em}
.op-ko{color:#4b5563;font-size:.86em;margin-top:.12em;line-height:1.4}
.op-h{display:flex;align-items:baseline;gap:.55em;margin:.85em 0 .4em;padding-bottom:.28em;border-bottom:1px solid #e5e7eb;font-size:1em;font-weight:700;color:#374151;break-after:avoid}
.op-h::before{content:"";align-self:stretch;width:3px;border-radius:2px;background:#7c6ae0}
.op-legend{margin-left:auto;font-weight:500;font-size:.8em;color:#6b7280}
.op-passage{text-align:justify;line-height:2.75;font-size:1.05em;margin:0}
.op-sn{font-family:ui-sans-serif,system-ui,sans-serif;font-size:.86em;color:#4b5563;margin-right:.18em}
ruby.op-voc{ruby-position:under;ruby-align:center;font-weight:700;white-space:nowrap}
ruby.op-voc rt{font-family:ui-sans-serif,system-ui,sans-serif;font-size:.58em;font-weight:500;color:#0f766e;line-height:1.12;letter-spacing:0}
/* 동의어·반의어를 두 줄로. rt 안에서는 display:block도 <br>도 안 먹어서(실측),
   inline-block 감싸개를 하나 두고 그 안에서 줄을 나눈다. */
ruby.op-voc rt .op-vocw{display:inline-block;text-align:center}
ruby.op-voc rt .op-vocw i{display:block;font-style:normal;white-space:nowrap}
.op-g{text-decoration:underline;text-decoration-color:#dc2626;text-decoration-thickness:1.4px;text-underline-offset:.2em}
.op-x{background:#e3ecff;border-radius:2px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.op-r{text-decoration:underline;text-decoration-style:dotted;text-decoration-color:#b45309;text-decoration-thickness:1.2px;text-underline-offset:.2em}
/* ㉠·ⓐ 같은 동그라미 글자는 영문 글꼴에 없어 대체 글꼴로 떨어진다. 한글 글꼴을 먼저 준다
   (선생님 지적 2026-09-29: 1장 테스트지에서 ㄱㄴㄷ이 작게 아래로 내려온다) */
.op-gm,.op-xm,.op-rm{font-family:"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",ui-sans-serif,system-ui,sans-serif;font-size:.74em;font-weight:700;vertical-align:.55em;line-height:0;margin-right:.08em}
.op-gm{color:#dc2626}.op-xm{color:#2563eb}.op-rm{color:#b45309}
/* 목록·범례에서 줄 안에 그대로 놓는 기호 — 글줄에 맞춰 세운다 */
.op-mk{font-size:1em;vertical-align:baseline;line-height:1;margin-right:.12em}
.op-bk{background:#ffe680;box-shadow:0 1.3px 0 #a16207,0 -1.3px 0 #a16207;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.op-em{font-family:ui-sans-serif,system-ui,sans-serif;font-weight:900;color:#111827;font-size:1.05em;margin-right:.15em}
.op-ins{font-family:ui-sans-serif,system-ui,sans-serif;font-weight:800;font-size:.62em;color:#b91c1c;border:1px solid #b91c1c;border-radius:3px;padding:0 .25em;margin-right:.3em;white-space:nowrap;vertical-align:.12em;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.op-refs{margin:0;line-height:1.5;font-size:.92em;text-align:justify}
.op-refs .op-rsep{color:#d1d5db;margin:0 .35em}
.op-flow{display:flex;align-items:stretch;gap:.3em}
.op-fbox{flex:1 1 0;min-width:0;border:1px solid #e3dcf7;border-radius:.55em;padding:.45em .55em;text-align:left}
.op-fbox b{display:block;font-size:.76em;line-height:1.24;text-align:left}
.op-fbox span{display:block;font-size:.7em;color:#5b6472;margin-top:.2em;line-height:1.3;text-align:left}
.op-fbox--end{background:#f6f3fe;border-color:#c4b5fd}
.op-farr{align-self:center;color:#a78bfa;font-size:.9em}
/* .op-fbox span(작은 블록 글씨)보다 세게 걸어 단계 번호 옆에 같은 크기로 둔다 */
.op-fbox span.op-fsn{display:inline;font-size:1em;font-weight:700;color:inherit;margin:0 0 0 .5em;white-space:nowrap;line-height:inherit}
/* 문장별 정리(정수학원 새 모양): 왼쪽 문장 줄, 오른쪽 도식화 칸을 근거 문장과 같은 높이에 */
.op-sl{display:grid;grid-template-columns:minmax(0,1fr) 12.5em;column-gap:1.1em}
.op-sl-s{grid-column:1;padding:.2em 0 .35em;border-bottom:1px dashed #e5e7eb;min-width:0}
.op-sl-s--last{border-bottom:0}
.op-sl-s .op-passage{line-height:2.5}
.op-sl-i{margin:.05em 0 0 1.2em}
.op-sl-i li{margin:.12em 0;font-size:.88em;padding-left:2.9em;text-indent:-2.9em}
.op-slt{display:inline-block;text-indent:0;width:2.5em;font-size:.82em;font-weight:700;color:#6b7280;font-family:ui-sans-serif,system-ui,sans-serif}
.op-sl-f{grid-column:2;position:relative;display:flex;flex-direction:column;justify-content:center;padding:.45em 0;min-width:0}
.op-sl-f .op-fbox{flex:none}
.op-sl-f .op-farr{position:absolute;top:-.55em;left:50%;transform:translateX(-50%);line-height:1;font-size:.85em}
.op-sl-fh{grid-column:2;grid-row:1}
.op-grid2{display:grid;grid-template-columns:1fr 1fr;column-gap:1.3em}
.op-list{margin:0;padding:0;list-style:none}
.op-list li{margin:.25em 0;line-height:1.42;font-size:.94em;padding-left:1.3em;text-indent:-1.3em}
.op-list .op-tag{display:inline-block;text-indent:0;font-size:.82em;font-weight:700;color:#6b4fd3;background:#f1edfd;border-radius:.3em;padding:0 .35em;margin:0 .3em}
.op-strike{color:#9ca3af;text-decoration:line-through}
.op-given{border:1px solid #cabff3;background:#f6f3fe;border-radius:.4em;padding:.35em .7em;margin:.15em 0 .4em}
.op-oitem{padding-left:2.1em;text-indent:-2.1em;margin:.28em 0;text-align:justify}
.op-oitem b{font-family:ui-sans-serif,system-ui,sans-serif;font-weight:800;margin-right:.3em}
.op-ansline{margin-top:.5em;color:#6b4fd3;font-weight:700;font-family:ui-sans-serif,system-ui,sans-serif}
.op-ansline i{display:inline-block;width:3.2em;border-bottom:1.3px solid #374151;margin:0 .35em;vertical-align:-.1em}
.op-blank{display:inline-block;border-bottom:1.2px solid #111827;margin:0 .25em;vertical-align:-.12em;height:1em}
.op-tf li{margin:.28em 0;padding-left:1.8em;text-indent:-1.8em}
.op-num{font-family:ui-sans-serif,system-ui,sans-serif;font-weight:700;color:#6b4fd3;margin-right:.3em}
.op-tfmark{font-family:ui-sans-serif,system-ui,sans-serif;color:#9ca3af;margin-left:.3em}
.op-two{display:grid;grid-template-columns:1fr 1fr;column-gap:1.5em;align-items:start}
.op-choice{text-align:justify;line-height:1.62;margin:0}
.op-choice sup{font-family:ui-sans-serif,system-ui,sans-serif;font-size:.68em;margin-right:.05em}
.op-choice b{font-weight:800;white-space:nowrap}
.op-ts{text-align:justify;line-height:1.72;margin:0 0 .08em;font-size:1.02em}
.op-ts .op-tsn{font-family:ui-sans-serif,system-ui,sans-serif;font-weight:900;color:#b91c1c;margin-right:.28em}
.op-ts sup{font-family:ui-sans-serif,system-ui,sans-serif;font-size:.62em;font-weight:700;color:#b91c1c;margin-left:.04em}
.op-tc{font-weight:800;white-space:nowrap}
.op-tr{text-underline-offset:.18em}
.op-tx{background:#fef3c7;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.op-ti{font-weight:800;border-bottom:1.6px dotted #b91c1c}
.op-tt{margin:.12em 0 .3em 1.4em;padding:.25em .6em;border-left:1.6px solid #d1d5db;background:#f9fafb;break-inside:avoid}
.op-ttq{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;font-size:.82em;font-weight:800;color:#374151;line-height:1.45}
.op-ttc{font-weight:600;color:#6b7280}
.op-ttw{margin:.1em 0 0;font-family:ui-sans-serif,system-ui,sans-serif;font-size:.82em;font-weight:500;line-height:1.45}
.op-ttl{border-bottom:1.1px solid #9ca3af;height:1.1em;margin-top:.15em}
.op-timp{margin:.05em 0 .22em 1.4em;display:flex;align-items:flex-end;gap:.35em;font-size:.82em}
.op-timp i{flex-grow:1;border-bottom:1.1px dotted #9ca3af;height:.95em}
.op-timp .op-ttq{font-size:1em;flex-shrink:0}
.op-tref{margin:.05em 0 .22em 1.4em;display:flex;flex-wrap:wrap;align-items:flex-end;gap:.2em 1.1em;font-size:.82em}
.op-tref .op-ttq{font-size:1em}
.op-trb{display:flex;align-items:flex-end;gap:.25em;min-width:13em;flex:1 1 13em}
.op-trb sup{font-family:ui-sans-serif,system-ui,sans-serif;font-size:.8em;font-weight:700;color:#b91c1c;flex-shrink:0}
.op-trb em{font-style:normal;font-weight:700;flex-shrink:0}
.op-trb i{flex-grow:1;border-bottom:1.1px dotted #9ca3af;height:.95em}
.op-tex{display:grid;grid-template-columns:1fr 1fr;column-gap:1.2em;font-size:.88em}
.op-tex > div{display:flex;align-items:flex-end;gap:.28em;line-height:1.75}
.op-tex sup{font-family:ui-sans-serif,system-ui,sans-serif;font-size:.78em;font-weight:700;color:#b45309;flex-shrink:0}
.op-tex em{font-style:normal;font-weight:700;flex-shrink:0}
.op-tex i{flex-grow:1;border-bottom:1.1px dotted #9ca3af;height:.95em}
.op-w{margin-top:.5em;break-inside:avoid}
.op-w .op-chunks{font-family:ui-sans-serif,system-ui,sans-serif;font-weight:700;font-size:.95em;line-height:1.45;padding-left:1.35em;text-indent:-1.35em}
.op-w .op-wko{background:#f3f4f6;border-radius:.35em;padding:.22em .6em;margin:.25em 0 0 1.35em;font-size:.85em;color:#4b5563}
.op-w .op-wline{border-bottom:1.2px dashed #9ca3af;height:2.1em;margin-left:1.35em}
.op-ans{break-inside:avoid;border:1px solid #e5e7eb;border-radius:.5em;padding:.45em .8em;margin-bottom:.7em}
.op-ans h3{margin:0 0 .3em;font-size:1.02em;font-weight:800}
.op-ans h3 span{color:#6b4fd3;margin-right:.4em}
.op-arow{display:grid;grid-template-columns:6.2em 1fr;column-gap:.5em;margin:.14em 0;line-height:1.45}
.op-arow dt{font-weight:700;color:#6b7280}
/* 정답 줄이 길면 접힌다. 안 접히면 쪽을 넘쳐 나가고, 넘친 만큼 인쇄가 통째로
   줄어들어 오른쪽·아래에 큰 여백이 생긴다(선생님 지적 2026-09-30). */
.op-arow dd{margin:0;min-width:0;overflow-wrap:anywhere}
.op-ai{display:inline-block;margin-right:1.1em;white-space:normal;overflow-wrap:anywhere}
.op-ai b{font-family:ui-sans-serif,system-ui,sans-serif;color:#6b4fd3;margin-right:.3em}
.op-sheet section,.op-sheet .op-grid2,.op-sheet .op-flow,.op-sheet .op-meta,.op-sheet .op-head{break-inside:avoid;page-break-inside:avoid}
.op-list li,.op-tf li,.op-oitem{break-inside:avoid;page-break-inside:avoid}
.op-label{position:absolute;bottom:2mm;right:3mm;font-size:9px;color:#94a3b8}
@media print{.op-label{display:none}}
`;

// ---------------------------------------------------------------- 한 쪽 맞추기

// 선생님 요청: 분량이 많으면 억지로 줄이지 말고 두 쪽으로 넘긴다(읽을 수 있는 크기를 지킨다).
const FIT_MIN = 0.88;
/** 짧은 지문은 글자를 조금 키워 아래 빈 곳을 줄인다. */
const FIT_MAX = 1.12;

/**
 * A4 한 쪽. 쪽에 들어가는 가장 큰 글자 크기를 이분 탐색으로 찾는다(짧으면 조금 키우고 넘치면
 * 줄인다). 가장 작게 줄여도 넘치면 쪽 높이를 풀어(op-sheet--grow) 인쇄에서 다음 쪽으로
 * 이어진다. fitKey가 바뀌면 다시 잰다.
 */
export function FitSheet({
  baseFontPx,
  fitKey,
  label,
  isLast,
  variant,
  maxScale = FIT_MAX,
  children,
}: {
  baseFontPx: number;
  fitKey: string;
  label?: string;
  isLast?: boolean;
  /** 모양 CSS(one-page-print-styles.css)가 요약·테스트를 가르는 데 쓴다. */
  variant?: "summary" | "test";
  /** 키울 수 있는 한도. 쪽을 나눠 싣는 문장별 버전은 쪽마다 글자 크기가 달라지지 않게 1로 둔다. */
  maxScale?: number;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; grow: boolean }>({ scale: 1, grow: false });

  const measure = useCallback(() => {
    const sheet = sheetRef.current;
    const body = bodyRef.current;
    if (!sheet || !body || sheet.offsetWidth === 0) return;
    const pxPerMm = sheet.offsetWidth / A4_W_MM;
    // 화면과 인쇄의 반올림 차이로 넘치지 않게 조금 남긴다.
    const avail = (A4_H_MM - PAD_Y_MM * 2) * pxPerMm * 0.985;
    const fits = (s: number) => {
      body.style.fontSize = `${baseFontPx * s}px`;
      return body.scrollHeight <= avail;
    };
    let scale = maxScale;
    let grow = false;
    if (!fits(maxScale)) {
      if (!fits(FIT_MIN)) {
        scale = FIT_MIN;
        grow = true;
      } else {
        let lo = FIT_MIN;
        let hi = maxScale;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          if (fits(mid)) lo = mid;
          else hi = mid;
        }
        scale = Math.floor(lo * 1000) / 1000;
      }
    }
    body.style.fontSize = `${baseFontPx * scale}px`;
    setFit((prev) => (prev.scale === scale && prev.grow === grow ? prev : { scale, grow }));
  }, [baseFontPx, maxScale]);

  useLayoutEffect(() => {
    measure();
  }, [measure, fitKey]);

  useEffect(() => {
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) measure();
    });
    return () => {
      alive = false;
    };
  }, [measure, fitKey]);

  return (
    <article
      ref={sheetRef}
      className={`op-sheet one-page-a4-sheet shadow-xl print:shadow-none ${variant ? `op-sheet--${variant}` : ""} ${
        fit.grow ? "op-sheet--grow" : ""
      } ${isLast ? "one-page-a4-sheet--last" : ""}`}
    >
      <div ref={bodyRef} className="op-body" style={{ fontSize: `${baseFontPx * fit.scale}px` }}>
        {children}
      </div>
      {label ? <span className="op-label">{label}</span> : null}
    </article>
  );
}

// ---------------------------------------------------------------- 1장 요약직보자료

export type OnePageSummaryInput = {
  id: string;
  title: string;
  titleEn: string | null;
  source: string | null;
  sentences: Array<{ english: string; korean: string }>;
  content: OnePageContent;
};

/** 머리말 번호. B 모양만 "지문 01"로 찍는다(앞말은 모양 CSS가 감추거나 보인다). */
function SheetNo({ index }: { index: number }) {
  return (
    <span className="op-no">
      <span className="op-no-pre">지문 </span>
      {String(index + 1).padStart(2, "0")}
    </span>
  );
}

/** 번호를 왼쪽 여백에 따로 세운 절(모양 A·B·C). */
function NumberedSection({
  no,
  className,
  children,
}: {
  no: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`op-s ${className ?? ""}`}>
      <div className="op-gut">
        <i>{no}</i>
      </div>
      <div className="op-s-body">{children}</div>
    </section>
  );
}

function RunText({ run }: { run: OnePageRun }) {
  const markers = (
    <>
      {run.grammarStart.map((g) => (
        <span key={`g${g}`} className="op-gm">
          {circledLetter(g)}
        </span>
      ))}
      {run.expressionStart.map((x) => (
        <span key={`x${x}`} className="op-xm">
          {circledHangul(x)}
        </span>
      ))}
      {run.referenceStart.map((r) => (
        <span key={`r${r}`} className="op-rm">
          {referenceMark(r)}
        </span>
      ))}
    </>
  );
  const cls = `${run.grammar.length ? "op-g" : ""} ${run.expression.length ? "op-x" : ""} ${
    run.reference.length ? "op-r" : ""
  } ${run.exam.length ? "op-bk" : ""}`.trim();
  return (
    <>
      {markers}
      {cls ? <span className={cls}>{run.text}</span> : run.text}
    </>
  );
}

/**
 * 낱말 아래 적을 동·반의어. 선생님 요청대로 동의어·반의어를 2개씩 싣는다(있는 만큼).
 * 주석이 낱말보다 넓으면 그만큼 낱말 양옆이 벌어지므로, 주석 글자는 본문의 절반 크기로 두고
 * 쪽 맞추기(자동 축소)가 남은 넓이를 흡수한다.
 */
function vocabNote(v: OnePageContent["vocab"][number]): { syn: string; ant: string } {
  const syn = v.synonyms.slice(0, 2);
  const ant = v.antonyms.slice(0, 2);
  return {
    syn: syn.length ? `≒ ${syn.join(", ")}` : "",
    ant: ant.length ? `↔ ${ant.join(", ")}` : "",
  };
}

export type OnePageSummaryLayout = "classic" | "sentence";

/** 도식화 칸 위 번호: 단계 번호 · 근거 문장(확실할 때만) */
function FlowNo({ index, range }: { index: number; range?: OnePageFlowRange }) {
  return (
    <span className="op-fno">
      {index + 1}
      {range?.sure ? <span className="op-fsn">문장 {flowRangeLabel(range)}</span> : null}
    </span>
  );
}

/** 원문 한 문장(번호·출제 표시·어법/표현/지칭 표시·낱말 아래 동·반의어) */
function SummarySentence({ content: c, english, si }: { content: OnePageContent; english: string; si: number }) {
  /*
   * 문장 앞에 찍는 출제 표시. 선생님 요청(2026-09-17): 순서 배열은 빼고, 문장 삽입은
   * 작은 기호 대신 [문장삽입 유력]이라고 문장 앞에 붙여 눈에 띄게 한다.
   */
  const inserts = (c.examPoints ?? []).filter((e) => e.kind === "insert" && e.sentenceIndex === si);
  return (
    <>
      {inserts.map((_, k) => (
        <span key={`e${k}`} className="op-ins">
          [문장삽입 유력]
        </span>
      ))}
      <span className="op-sn">{circledNumber(si)}</span>
      {splitSentenceForSummary(english, si, c).map((seg, gi) => {
        const runs = seg.runs.map((run, ri) => <RunText key={ri} run={run} />);
        if (seg.vocab === null) return <Fragment key={gi}>{runs}</Fragment>;
        const note = vocabNote(c.vocab[seg.vocab]!);
        return (
          <ruby key={gi} className="op-voc">
            <span>{runs}</span>
            {/* 동의어 한 줄, 반의어 한 줄 — 한 줄에 몰면 낱말 양옆이 벌어진다(선생님 요청) */}
            <rt>
              <span className="op-vocw">
                {note.syn ? <i>{note.syn}</i> : null}
                {note.ant ? <i>{note.ant}</i> : null}
              </span>
            </rt>
          </ruby>
        );
      })}
    </>
  );
}

/**
 * 문장별 정리(선생님 요청 2026-10-05, 정수학원 먼저). 문장마다 바로 아래에 그 문장의
 * 어법 포인트·중요 표현 바꿔 쓰기·지칭을 적고, 도식화는 오른쪽 칸에 근거 문장과 같은 높이로 둔다.
 * 문장 하나가 그리드 한 줄이고, 도식화 칸은 근거 문장 줄들에 걸친다.
 */
function SentenceLayout({
  project,
  ranges,
  legend,
  from = 0,
  to = project.sentences.length,
}: {
  project: OnePageSummaryInput;
  ranges: OnePageFlowRange[] | null;
  legend: ReactNode;
  /** 이 쪽에 싣는 문장(from 이상 to 미만). 둘째 쪽부터는 「원문 (이어서)」로 시작한다. */
  from?: number;
  to?: number;
}) {
  const c = project.content;
  const references = c.references ?? [];
  const n = project.sentences.length;
  // 제목 줄이 그리드 첫 줄이라 문장 si는 (si - from + 2)번째 줄
  const row = (si: number) => si - from + 2;
  /*
   * 도식화 단계는 근거 문장이 시작하는 쪽에 싣고, 쪽을 넘어가는 범위는 그 쪽 끝에서 자른다.
   * 범위를 못 찾으면(문장이 단계보다 적다) 위에서부터 한 줄씩 놓는다.
   */
  const flowHere = c.flow
    .map((f, i) => {
      const r = ranges?.[i];
      const start = r ? r.from : Math.min(i, n - 1);
      const end = r ? Math.min(r.to, to - 1) : start;
      return { f, i, r, start, end };
    })
    .filter((x) => x.start >= from && x.start < to);
  return (
    <NumberedSection no={1}>
      <div className="op-sl">
        <h2 className="op-h" style={{ gridColumn: 1, gridRow: 1 }}>
          {from > 0 ? "원문 (이어서)" : "원문"}
          {from > 0 ? null : legend}
        </h2>
        {flowHere.length > 0 ? <h2 className="op-h op-sl-fh">도식화</h2> : null}
        {project.sentences.slice(from, to).map((s, k) => {
          const si = from + k;
          const grammar = c.grammar.map((g, i) => ({ g, i })).filter((x) => x.g.sentenceIndex === si);
          const paras = c.paraphrases.map((p, i) => ({ p, i })).filter((x) => x.p.sentenceIndex === si);
          const refs = references.map((r, i) => ({ r, i })).filter((x) => x.r.sentenceIndex === si);
          const has = grammar.length + paras.length + refs.length > 0;
          return (
            <div key={si} className={`op-sl-s ${si === to - 1 ? "op-sl-s--last" : ""}`} style={{ gridRow: row(si) }}>
              <p className="op-passage op-en">
                <SummarySentence content={c} english={s.english} si={si} />
              </p>
              {has ? (
                <ol className="op-list op-sl-i">
                  {grammar.map(({ g, i }) => (
                    <li key={`g${i}`}>
                      <span className="op-slt">어법</span>
                      <span className="op-gm op-mk">{circledLetter(i)}</span>{" "}
                      <span className="op-en">
                        [<b>{g.right || g.target}</b>
                        {g.wrong ? <> / {g.wrong}</> : null}]
                      </span>
                      {g.point ? <span className="op-tag">{g.point}</span> : " "}
                      {g.explanation}
                    </li>
                  ))}
                  {paras.map(({ p, i }) => (
                    <li key={`x${i}`}>
                      <span className="op-slt">표현</span>
                      <span className="op-xm op-mk">{circledHangul(i)}</span>{" "}
                      <b className="op-en">{p.expression}</b>
                      {p.meaningKo ? <span className="op-mean"> ({p.meaningKo})</span> : null}
                      <span className="op-to"> → </span>
                      <span className="op-en">{p.paraphrases.join(", ")}</span>
                    </li>
                  ))}
                  {refs.map(({ r, i }) => (
                    <li key={`r${i}`}>
                      <span className="op-slt">지칭</span>
                      <span className="op-rm op-mk">{referenceMark(i)}</span>{" "}
                      <b className="op-en">{r.surface}</b>
                      <span className="op-to"> → </span>
                      <span className="op-en">{r.referent}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          );
        })}
        {flowHere.map(({ f, i, r, start, end }) => {
          return (
            <div key={i} className="op-sl-f" style={{ gridRow: `${row(start)} / ${row(end) + 1}` }}>
              {i > 0 ? <span className="op-farr">↓</span> : null}
              <div className={`op-fbox ${i === c.flow.length - 1 ? "op-fbox--end" : ""}`}>
                <FlowNo index={i} range={r} />
                <b className="op-en">{f.en}</b>
                <span className="op-fko">{f.ko}</span>
              </div>
            </div>
          );
        })}
      </div>
    </NumberedSection>
  );
}

/** el의 위쪽이 root 위쪽에서 얼마나 떨어졌는지(px, 확대·축소 transform의 영향을 받지 않는다) */
function offsetTopIn(el: HTMLElement, root: HTMLElement): number {
  let y = 0;
  let cur: HTMLElement | null = el;
  while (cur && cur !== root) {
    y += cur.offsetTop;
    cur = cur.offsetParent as HTMLElement | null;
  }
  return y;
}

const SUMMARY_FONT_PX = 11.5;

/**
 * 문장별 버전의 쪽들. 문장마다 정리가 붙어 길어지므로 한 쪽에 몰아 넣지 않고 A4 쪽으로 나눈다
 * (선생님 지적 2026-10-05: 미리보기가 A4를 넘고 인쇄가 이상하다). 보이지 않는 틀에 한 번
 * 통째로 그려 문장 줄마다 높이를 재고, 쪽에 들어가는 만큼씩 문장을 나눠 싣는다.
 * 첫 쪽에만 머리말·주제·요약문을 두고, 다음 쪽은 「원문 (이어서)」로 시작한다.
 */
function SentencePagedSheets({
  project,
  ranges,
  top,
  legend,
  label,
  isLast,
  fitKey,
}: {
  project: OnePageSummaryInput;
  ranges: OnePageFlowRange[] | null;
  top: ReactNode;
  legend: ReactNode;
  label: string;
  isLast?: boolean;
  fitKey: string;
}) {
  const n = project.sentences.length;
  const measureRef = useRef<HTMLElement>(null);
  const [pages, setPages] = useState<Array<[number, number]>>(() => [[0, n]]);

  const measure = useCallback(() => {
    const sheet = measureRef.current;
    if (!sheet || sheet.offsetWidth === 0) return;
    const rows = Array.from(sheet.querySelectorAll<HTMLElement>(".op-sl-s"));
    const grid = sheet.querySelector<HTMLElement>(".op-sl");
    const section = grid?.closest<HTMLElement>(".op-s") ?? grid;
    if (rows.length !== n || !grid || !section) return;
    const pxPerMm = sheet.offsetWidth / A4_W_MM;
    const pad = PAD_Y_MM * pxPerMm;
    const avail = (A4_H_MM - PAD_Y_MM * 2) * pxPerMm * 0.97;
    const tops = rows.map((el) => offsetTopIn(el, sheet) - pad);
    const gridBottom = offsetTopIn(grid, sheet) + grid.offsetHeight - pad;
    const bottoms = tops.map((_, i) => (i < n - 1 ? tops[i + 1]! : gridBottom));
    // 이어지는 쪽 위에 붙는 것: 절 위 여백 + 「원문 (이어서)」 제목 줄
    const sectionTop = offsetTopIn(section, sheet) - pad;
    const overhead = tops[0]! - sectionTop + parseFloat(getComputedStyle(section).marginTop || "0");
    const out: Array<[number, number]> = [];
    let start = 0;
    while (start < n) {
      const base = out.length === 0 ? 0 : tops[start]! - overhead;
      let end = start + 1;
      while (end < n && bottoms[end]! - base <= avail) end++;
      out.push([start, end]);
      start = end;
    }
    setPages((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
  }, [n]);

  useLayoutEffect(() => {
    measure();
  }, [measure, fitKey]);
  useEffect(() => {
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) measure();
    });
    return () => {
      alive = false;
    };
  }, [measure, fitKey]);

  return (
    <>
      {pages.map(([from, to], pi) => (
        <FitSheet
          key={pi}
          baseFontPx={SUMMARY_FONT_PX}
          maxScale={1}
          fitKey={`${fitKey}|${from}-${to}`}
          isLast={isLast && pi === pages.length - 1}
          label={pages.length > 1 ? `${label} (${pi + 1}/${pages.length})` : label}
          variant="summary"
        >
          {pi === 0 ? top : null}
          <SentenceLayout project={project} ranges={ranges} legend={legend} from={from} to={to} />
        </FitSheet>
      ))}
      <div className="pointer-events-none absolute left-0 top-0 h-0 w-0 overflow-hidden print:hidden" aria-hidden>
        <article ref={measureRef} className="op-sheet op-sheet--summary op-sheet--grow opacity-0">
          <div className="op-body" style={{ fontSize: `${SUMMARY_FONT_PX}px` }}>
            {top}
            <SentenceLayout project={project} ranges={ranges} legend={legend} />
          </div>
        </article>
      </div>
    </>
  );
}

export function OnePageSummarySheet({
  index,
  project,
  logoSrc,
  isLast,
  designKey = "",
  layout = "classic",
}: {
  index: number;
  project: OnePageSummaryInput;
  logoSrc?: string | null;
  isLast?: boolean;
  /** 모양·글꼴이 바뀌면 한 쪽 맞추기를 다시 한다. */
  designKey?: string;
  /** classic: 원문 한 덩어리 + 아래 정리표. sentence: 문장마다 아래에 정리, 도식화는 오른쪽(정수학원). */
  layout?: OnePageSummaryLayout;
}) {
  const c = project.content;
  const ranges = flowSentenceRanges(c.flow, project.sentences);
  const references = c.references ?? [];
  const examPoints = c.examPoints ?? [];
  const title = (project.titleEn ?? "").trim() || c.titleEn || project.title;
  const summaryParts = splitSummaryByKeywords(c.summaryEn, c.summaryKeywords);
  let secNo = 0;
  const nextSec = () => ++secNo;
  const source = project.source?.trim();
  const legend = (
    <span className="op-legend">
      <span className="op-gm op-mk">
        ⓐ
      </span>
      어법 포인트 ·{" "}
      <span className="op-xm op-mk">
        ㉠
      </span>
      바꿔 쓰기 표현 ·{" "}
      <span className="op-rm op-mk">
        1
      </span>
      지칭어 · 낱말 아래 <span className="op-lg-v">≒ 동의어 ↔ 반의어</span>
      {examPoints.length > 0 ? (
        <>
          {" · 출제 자리: "}
          <span className="op-bk">형광</span> 빈칸 추론 · <b>[문장삽입 유력]</b> 문장 삽입
        </>
      ) : null}
    </span>
  );
  const fitKey = `${project.id}|${c.createdAt}|${logoSrc ?? ""}|${designKey}|${layout}`;
  const top = (
    <>
      <header className="op-head">
        <SheetNo index={index} />
        <div className="op-head-m">
          <span className="op-kicker">{source ? `${source} · ` : ""}1장 요약자료</span>
          <h1 className="op-en">{title}</h1>
        </div>
        {logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoSrc} alt="" />
        ) : null}
      </header>

      <dl className="op-meta">
        <dt>
          <b>1.</b>한글 주제
        </dt>
        <dd>{c.topicKo}</dd>
        <dt>
          <b>2.</b>영어 제목
        </dt>
        <dd className="op-en">{c.titleEn}</dd>
        <dt>
          <b>3.</b>요약문
        </dt>
        <dd>
          <p className="op-en op-just" style={{ margin: 0 }}>
            {summaryParts.map((p, i) =>
              p.keywordIndex === null ? (
                <Fragment key={i}>{p.text}</Fragment>
              ) : (
                <span key={i} className="op-kw">
                  {p.text}
                </span>
              )
            )}
          </p>
          <p className="op-ko" style={{ marginBottom: 0 }}>
            {c.summaryKo}
          </p>
        </dd>
      </dl>
    </>
  );
  if (layout === "sentence") {
    return (
      <SentencePagedSheets
        project={project}
        ranges={ranges}
        top={top}
        legend={legend}
        label={project.title}
        isLast={isLast}
        fitKey={fitKey}
      />
    );
  }
  return (
    <FitSheet baseFontPx={SUMMARY_FONT_PX} fitKey={fitKey} isLast={isLast} label={project.title} variant="summary">
      {top}

      {layout === "classic" ? (
      <NumberedSection no={nextSec()}>
        <h2 className="op-h">
          원문
          {legend}
        </h2>
        <p className="op-passage op-en">
          {project.sentences.map((s, si) => (
            <Fragment key={si}>
              <SummarySentence content={c} english={s.english} si={si} />{" "}
            </Fragment>
          ))}
        </p>
      </NumberedSection>
      ) : null}


      {layout === "classic" && c.flow.length > 0 ? (
        <NumberedSection no={nextSec()}>
          <h2 className="op-h">도식화</h2>
          <div className="op-flow">
            {c.flow.map((f, i) => (
              <Fragment key={i}>
                {i > 0 ? <span className="op-farr">→</span> : null}
                <div className={`op-fbox ${i === c.flow.length - 1 ? "op-fbox--end" : ""}`}>
                  <FlowNo index={i} range={ranges?.[i]} />
                  <b className="op-en">{f.en}</b>
                  <span className="op-fko">{f.ko}</span>
                </div>
              </Fragment>
            ))}
          </div>
        </NumberedSection>
      ) : null}

      {layout === "classic" ? (
      <NumberedSection no={nextSec()}>
        <div className="op-grid2">
          <section>
            <h2 className="op-h">중요 어법 포인트</h2>
            <ol className="op-list">
              {c.grammar.map((g, i) => (
                <li key={i}>
                  <span className="op-gm op-mk">
                    {circledLetter(i)}
                  </span>{" "}
                  {/* 워크북 어법 선택과 같은 표기: [정답 / 오답], 정답만 굵게 */}
                  <span className="op-en">
                    [<b>{g.right || g.target}</b>
                    {g.wrong ? <> / {g.wrong}</> : null}]
                  </span>
                  {g.point ? <span className="op-tag">{g.point}</span> : " "}
                  {g.explanation}
                </li>
              ))}
            </ol>
          </section>
          <section>
            <h2 className="op-h">중요 표현 바꿔 쓰기</h2>
            <ol className="op-list">
              {c.paraphrases.map((p, i) => (
                <li key={i}>
                  <span className="op-xm op-mk">
                    {circledHangul(i)}
                  </span>{" "}
                  <b className="op-en">{p.expression}</b>
                  {p.meaningKo ? <span className="op-mean"> ({p.meaningKo})</span> : null}
                  <span className="op-to"> → </span>
                  <span className="op-en">{p.paraphrases.join(", ")}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </NumberedSection>
      ) : null}

      {layout === "classic" && references.length > 0 ? (
        <NumberedSection no={nextSec()}>
          <h2 className="op-h">지칭 정리</h2>
          <p className="op-refs">
            {references.map((r, i) => (
              <Fragment key={i}>
                {i > 0 ? <span className="op-rsep">/</span> : null}
                <span className="op-rm" style={{ verticalAlign: ".35em" }}>
                  {referenceMark(i)}
                </span>
                <b className="op-en">{r.surface}</b>
                <span className="op-to"> → </span>
                <span className="op-en">{r.referent}</span>
              </Fragment>
            ))}
          </p>
        </NumberedSection>
      ) : null}
    </FitSheet>
  );
}

// ---------------------------------------------------------------- 1장 테스트

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="op-h">{children}</h2>;
}

/** 본문 한 문장 — 고르는 자리·지칭어·중요표현·함축의미 표시를 그대로 그린다. */
function TestSentence({ row }: { row: OnePageTestRow }) {
  return (
    <p className="op-ts op-en">
      <b className="op-tsn">{String(row.no).padStart(2, "0")}</b>
      {row.segments.map((seg, i) => {
        if (seg.type === "text") return <Fragment key={i}>{stripMarkup(seg.text)}</Fragment>;
        if (seg.type === "choice") {
          return (
            <Fragment key={i}>
              <b className="op-tc">
                [{sameCaseChoices(seg.leftText, seg.rightText).join(" / ")}]
              </b>
              <sup>{seg.number})</sup>
            </Fragment>
          );
        }
        if (seg.type === "ref") {
          return (
            <Fragment key={i}>
              <u className="op-tr">{seg.text}</u>
              <sup>{seg.mark}</sup>
            </Fragment>
          );
        }
        if (seg.type === "expr") {
          return (
            <Fragment key={i}>
              <span className="op-tx">{seg.text}</span>
              <sup>{seg.mark}</sup>
            </Fragment>
          );
        }
        return (
          <span key={i} className="op-ti">
            {seg.text}
          </span>
        );
      })}
    </p>
  );
}

/** 문장에 딸린 문항들(지칭·함축의미·영작). 올인원처럼 그 문장 바로 아래에 둔다. */
function TestTasks({ row }: { row: OnePageTestRow }) {
  return (
    <>
      {row.imps.map((m, i) => (
        <div key={`i${i}`} className="op-timp">
          <span className="op-ttq">
            ▸ 밑줄 친 <b className="op-en">{m.surface}</b> 이(가) 의미하는 바를 쓰시오
          </span>
          <i />
        </div>
      ))}
      {row.refs.length > 0 ? (
        <div className="op-tref">
          <span className="op-ttq">▸ 밑줄 친 말이 가리키는 것을 쓰시오</span>
          {row.refs.map((r) => (
            <span key={r.mark} className="op-trb">
              <sup>{r.mark}</sup>
              <em className="op-en">{r.surface}</em>
              <i />
            </span>
          ))}
        </div>
      ) : null}
      {row.writing ? (
        <div className="op-tt">
          <p className="op-ttq">
            ▸ 해석에 맞춰 영작하시오{" "}
            <span className="op-ttc">
              (제시어를 모두 쓰고 필요하면 어형 변화
              {row.writing.condition ? ` · ${writingConditionText(row.writing.condition)}` : ""})
            </span>{" "}
            {row.writing.korean}
          </p>
          <p className="op-ttw op-en">( {row.writing.words.join(" / ")} )</p>
          <div className="op-ttl" />
        </div>
      ) : null}
    </>
  );
}

export function OnePageTestSheet({
  index,
  passage,
  isLast,
  designKey = "",
}: {
  index: number;
  passage: OnePageTestPassage;
  isLast?: boolean;
  /** 모양·글꼴이 바뀌면 한 쪽 맞추기를 다시 한다. */
  designKey?: string;
}) {
  let no = 0;
  const next = () => ++no;
  const source = passage.source?.trim();
  return (
    <FitSheet
      baseFontPx={11}
      fitKey={`${passage.projectId}|${passage.sourceHash}|${passage.rows.length}|${passage.choiceAnswers.length}|${designKey}`}
      isLast={isLast}
      label={passage.title}
      variant="test"
    >
      <header className="op-head op-head--test">
        <SheetNo index={index} />
        <div className="op-head-m">
          <span className="op-kicker">{source ? `${source} · ` : ""}1장 테스트지</span>
          <h1 className="op-en">{passage.titleEn || passage.title}</h1>
        </div>
        <div className="op-head-r">
          <span className="op-nm">
            이름 <i />
          </span>
          <span className="op-nm">
            점수 <i className="op-nm-sc" />
          </span>
        </div>
      </header>

      <NumberedSection no={next()} className="op-q">
        <SectionTitle>
          본문
          {/* 실은 유형만 알린다(유형을 골라 뺄 수 있다) */}
          <span className="op-legend">
            {[
              passage.choiceAnswers.length > 0 ? <Fragment key="c">[ ] 안에서 알맞은 말 고르기</Fragment> : null,
              passage.rows.some((r) => r.refs.length) ? (
                <Fragment key="r">
                  <u>밑줄</u> 지칭어
                </Fragment>
              ) : null,
              passage.expressions.length > 0 ? (
                <Fragment key="e">
                  <span className="op-tx">표시</span> 중요표현
                </Fragment>
              ) : null,
              passage.rows.some((r) => r.imps.length) ? (
                <Fragment key="i">
                  <span className="op-ti">점선</span> 함축의미
                </Fragment>
              ) : null,
            ]
              .filter(Boolean)
              .map((node, i) => (
                <Fragment key={i}>
                  {i > 0 ? " · " : ""}
                  {node}
                </Fragment>
              ))}
          </span>
        </SectionTitle>
        {passage.rows.map((row) => (
          <Fragment key={row.no}>
            <TestSentence row={row} />
            <TestTasks row={row} />
          </Fragment>
        ))}
      </NumberedSection>

      {passage.expressions.length > 0 ? (
        <NumberedSection no={next()} className="op-q">
          <SectionTitle>중요표현</SectionTitle>
          <div className="op-tex">
            {passage.expressions.map((e) => (
              <div key={e.mark}>
                <sup>{e.mark}</sup>
                <em className="op-en">{e.surface}</em>
                <i />
              </div>
            ))}
          </div>
        </NumberedSection>
      ) : null}

      {passage.tf.length > 0 ? (
        <NumberedSection no={next()} className="op-q">
          <SectionTitle>내용 확인</SectionTitle>
          <ol className="op-list op-tf">
            {passage.tf.map((t, i) => (
              <li key={i} className="op-en">
                <span className="op-num">({i + 1})</span>
                <span className="op-tf-text">{t.statement}</span>
                {/* 문장 끝에 동그라미 칠 T · F */}
                <span className="op-tfm">
                  <i>T</i>
                  <i>F</i>
                </span>
              </li>
            ))}
          </ol>
        </NumberedSection>
      ) : null}

      {passage.summary ? (
        <NumberedSection no={next()} className="op-q">
          <SectionTitle>요약문 완성</SectionTitle>
          <p className="op-en op-just op-sumq" style={{ margin: 0 }}>
            {passage.summary.segments.map((seg, i) =>
              seg.type === "text" ? (
                <Fragment key={i}>{seg.text}</Fragment>
              ) : (
                <span
                  key={i}
                  className="op-blank"
                  style={{ width: `${Math.max(6, Math.min(14, seg.answer.length * 0.6 + 2.5))}em` }}
                >
                  <sup>{circledNumber(seg.number - 1)}</sup>
                </span>
              )
            )}
          </p>
          <p className="op-ko" style={{ marginBottom: 0 }}>
            {passage.summary.ko}
          </p>
        </NumberedSection>
      ) : null}
    </FitSheet>
  );
}

// ---------------------------------------------------------------- 정답

/** 시험지와 같은 차례로 번호를 매긴 정답 줄들(정답만 싣는다). */
function answerRows(p: OnePageTestPassage): Array<{ label: string; value: ReactNode }> {
  const rows: Array<{ label: string; value: ReactNode }> = [];
  let no = 0;
  const label = (name: string) => `${++no}. ${name}`;
  const items = (list: Array<[string, string]>, en = true) => (
    <span className={en ? "op-en" : undefined}>
      {list.map(([mark, text], i) => (
        <span key={i} className="op-ai">
          <b>{mark}</b>
          {text}
        </span>
      ))}
    </span>
  );

  if (p.choiceAnswers.length) {
    rows.push({
      label: label("어법·어휘 고르기"),
      value: items(p.choiceAnswers.map((a, i) => [String(i + 1), a])),
    });
  }
  const refs = p.rows.flatMap((r) => r.refs);
  if (refs.length) rows.push({ label: label("지칭"), value: items(refs.map((r) => [r.mark, r.answer])) });
  const imps = p.rows.flatMap((r) => r.imps);
  if (imps.length) {
    rows.push({
      label: label("함축의미"),
      value: (
        <span>
          {imps.map((m, i) => (
            <span key={i} style={{ display: "block" }}>
              <b className="op-en">{m.surface}</b> — {m.answer}
            </span>
          ))}
        </span>
      ),
    });
  }
  const writing = p.rows.map((r) => r.writing).filter((w): w is NonNullable<typeof w> => !!w);
  if (writing.length) {
    rows.push({
      label: label("영작"),
      value: (
        <span className="op-en">
          {writing.map((w, i) => (
            <span key={i} style={{ display: "block" }}>
              {i + 1}. {w.answer}
            </span>
          ))}
        </span>
      ),
    });
  }
  if (p.expressions.length) {
    rows.push({
      label: label("중요표현"),
      value: items(
        p.expressions.map((e) => [e.mark, e.answer]),
        false
      ),
    });
  }
  if (p.tf.length) rows.push({ label: label("내용 확인"), value: items(p.tf.map((t, i) => [`(${i + 1})`, t.answer]), false) });
  if (p.summary) {
    rows.push({
      label: label("요약문"),
      value: items(
        p.summary.segments
          .filter((s): s is Extract<typeof s, { type: "blank" }> => s.type === "blank")
          .map((s) => [circledNumber(s.number - 1), s.answer])
      ),
    });
  }
  return rows;
}

export function OnePageAnswerBlock({ index, passage }: { index: number; passage: OnePageTestPassage }) {
  return (
    <section className="op-ans" data-op-answer={passage.projectId}>
      <h3>
        <span>{String(index + 1).padStart(2, "0")}</span>
        <span className="op-en" style={{ color: "#111827" }}>
          {passage.titleEn || passage.title}
        </span>
      </h3>
      <dl style={{ margin: 0 }}>
        {answerRows(passage).map((r, i) => (
          <div key={i} className="op-arow">
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const ANSWER_FONT_PX = 10.5;

/**
 * 정답 쪽들. 지문별 정답 묶음을 숨은 틀에서 재어 쪽마다 들어가는 만큼 담는다(묶음은 쪽을
 * 넘기며 자르지 않는다).
 */
export function OnePageAnswerSheets({
  passages,
  indexOf,
  isLastGroup,
  designKey = "",
}: {
  passages: OnePageTestPassage[];
  /** 시험지에서의 지문 번호(0부터) */
  indexOf: (projectId: string) => number;
  isLastGroup?: boolean;
  /** 모양·글꼴이 바뀌면 쪽 나눔을 다시 잰다. */
  designKey?: string;
}) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<number[][]>(() => [passages.map((_, i) => i)]);
  const key = passages.map((p) => `${p.projectId}:${p.sourceHash}`).join(",");

  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root || root.offsetWidth === 0) return;
    const pxPerMm = root.offsetWidth / (A4_W_MM - PAD_X_MM * 2);
    const avail = (A4_H_MM - PAD_Y_MM * 2) * pxPerMm * 0.97;
    const title = root.querySelector("[data-op-answer-title]") as HTMLElement | null;
    const blocks = Array.from(root.querySelectorAll("[data-op-answer]")) as HTMLElement[];
    const out: number[][] = [];
    let cur: number[] = [];
    let used = title?.offsetHeight ?? 0;
    blocks.forEach((el, i) => {
      const style = getComputedStyle(el);
      const h = el.offsetHeight + parseFloat(style.marginBottom || "0");
      if (cur.length > 0 && used + h > avail) {
        out.push(cur);
        cur = [];
        used = 0;
      }
      cur.push(i);
      used += h;
    });
    if (cur.length) out.push(cur);
    setPages(out.length ? out : [[]]);
  }, [key, designKey]);

  if (passages.length === 0) return null;
  const titleEl = (
    <h2 className="op-h" data-op-answer-title style={{ marginTop: 0 }}>
      정답
    </h2>
  );
  return (
    <>
      {pages.map((chunk, pi) => (
        <article
          key={pi}
          className={`op-sheet one-page-a4-sheet shadow-xl print:shadow-none ${
            isLastGroup && pi === pages.length - 1 ? "one-page-a4-sheet--last" : ""
          }`}
        >
          <div className="op-body" style={{ fontSize: `${ANSWER_FONT_PX}px` }}>
            {pi === 0 ? titleEl : null}
            {chunk.map((i) => (
              <OnePageAnswerBlock key={passages[i]!.projectId} index={indexOf(passages[i]!.projectId)} passage={passages[i]!} />
            ))}
          </div>
          <span className="op-label">
            정답 {pi + 1} / {pages.length}
          </span>
        </article>
      ))}
      <div className="pointer-events-none absolute left-0 top-0 h-0 w-0 overflow-hidden print:hidden" aria-hidden>
        <div
          ref={measureRef}
          className="op-body font-print opacity-0"
          style={{ width: `${A4_W_MM - PAD_X_MM * 2}mm`, fontSize: `${ANSWER_FONT_PX}px` }}
        >
          {titleEl}
          {passages.map((p) => (
            <OnePageAnswerBlock key={p.projectId} index={indexOf(p.projectId)} passage={p} />
          ))}
        </div>
      </div>
    </>
  );
}
