"use client";

import { Fragment, createContext, memo, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { isPrinting } from "@/lib/print/is-printing";
import {
  POS_NAME,
  circled,
  testBookTypeLabel,
  type TestBookOptions,
  type TestBookProjectInput,
  type TestBookTypeKey,
  type TestItem,
  type TestSection,
  type TestSeg,
  type TestSheet,
  type WordTest,
  type VocabExam,
  type VocabExamItem,
} from "@/lib/lesson-materials/test-book";
import { AnalysisMarkupSentence } from "@/components/lesson-materials/AnalysisMarkupSentence";
import { readAnalysisMarkup } from "@/lib/lesson-materials/analysis-markup";
import { SentenceNotes, sentenceNotesFor } from "@/components/lesson-materials/AnalysisSentenceNotes";
import { FrontCover } from "@/components/lesson-materials/integrated/BundleSheets";
import { coverPreset, type IntegratedCover } from "@/lib/lesson-materials/integrated";

/*
 * 테스트 교재 인쇄 쪽. 모든 쪽은 A4(210×297mm)이고, 내용 덩어리(block)의 높이를 재서
 * 넘치지 않게 쪽을 나눈다(PagedSheet). 백지노트는 정해진 두 쪽이다.
 */

const MM = 96 / 25.4;
const PAGE_H_MM = 297;
const PAD_Y_MM = 13;
const PAD_X_MM = 14;
/** 쪽 아래 꼬리말 자리 */
const FOOT_MM = 6;

export const TEST_BOOK_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Archivo:wght@600;800&display=swap";

export const TEST_BOOK_CSS = `
.tb-sheet{position:relative;box-sizing:border-box;width:210mm;height:${PAGE_H_MM}mm;padding:${PAD_Y_MM}mm ${PAD_X_MM}mm;background:#fff;color:#15171c;overflow:hidden;font-family:"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif;font-size:9.5pt;line-height:1.5;word-break:keep-all;overflow-wrap:break-word;-webkit-print-color-adjust:exact;print-color-adjust:exact;break-after:page;page-break-after:always}
.tb-en{font-family:"Source Serif 4","Times New Roman",Georgia,serif}
.tb-flow-psg{display:flex;align-items:baseline;justify-content:space-between;gap:3mm;margin:3.2mm 0 1.6mm;padding:0 0 .8mm;border-bottom:.8pt solid #15171c;font-size:10pt}.tb-flow-psg b{font-weight:800}.tb-flow-psg span{font-size:7.6pt;color:#6a707c;font-weight:600}
.tb-measure{position:absolute;left:-10000px;top:0;visibility:hidden;pointer-events:none}
.tb-measure .tb-sheet{height:auto;overflow:visible}
.tb-foot{position:absolute;left:${PAD_X_MM}mm;right:${PAD_X_MM}mm;bottom:5.5mm;display:flex;align-items:center;gap:4mm;font-size:7.2pt;color:#8a909b;border-top:.4pt solid #e1e4e9;padding-top:1.4mm}
/* 바닥줄에는 로고만(없으면 학원 이름) — 가로로 긴 글자 로고(윌링어학원)가 이름과 겹쳐 보였다(2026-10-27) */
.tb-foot .tb-brand{display:flex;align-items:center;color:#4b515c;font-weight:700;white-space:nowrap;line-height:1}
.tb-foot .tb-brand img{height:5.2mm;width:auto;max-width:28mm;object-fit:contain;display:block}
.tb-foot .tb-fmid{flex:1;min-width:0;display:flex;justify-content:center;gap:4mm;overflow:hidden;white-space:nowrap}
.tb-foot .tb-pgno{font-weight:700;color:#4b515c;white-space:nowrap}
.tb-sheet[data-page-no]::after{content:none}
.tb-b{display:flow-root;padding-bottom:2.6mm}
.tb-dh{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1.6pt solid #15171c;padding-bottom:2mm;margin-bottom:3mm}
.tb-dh h2{margin:0;font-size:16pt;font-weight:900;letter-spacing:-.02em;line-height:1.15}
.tb-dh h2 small{font-size:8.5pt;font-weight:500;color:#6a707c;margin-left:2mm;letter-spacing:0}
.tb-dh .tb-k{text-align:right;font-size:7.6pt;color:#6a707c;line-height:1.35}
.tb-dh .tb-k b{display:block;color:#15171c;font-size:9pt}
.tb-dh .tb-dh-name{display:flex;align-items:center;gap:2.5mm;border:1.4pt solid #15171c;border-radius:1.6mm;padding:1mm 3.5mm;line-height:1.1}
.tb-dh .tb-dh-name small{font-size:7.6pt;font-weight:800;color:#6a707c;letter-spacing:.06em}
.tb-dh .tb-dh-name b{font-size:22pt;font-weight:900;color:#15171c;letter-spacing:-.01em}
.tb-who{display:grid;grid-template-columns:1.3fr 1fr .9fr;gap:5mm;font-size:8.5pt;color:#6a707c}
.tb-who span{border-bottom:.6pt solid #c9cdd4;padding-bottom:1mm}
.tb-who .tb-who-name{margin-left:3mm;color:#15171c;font-size:10pt;font-weight:700}
.tb-tip{font-size:8pt;color:#6a707c}
.tb-star{color:#e8492b;font-weight:900}
/* 표를 줄마다 덩어리로 두려고 grid 줄을 쓴다 */
.tb-row{display:grid;border-bottom:.5pt solid #d3d7de;align-items:stretch}
.tb-row > div{padding:1.1mm 1.4mm;min-width:0}
.tb-row.tb-th{border-top:1.2pt solid #15171c;border-bottom:1.2pt solid #15171c;font-size:7.6pt;color:#6a707c;font-weight:500}
.tb-row.tb-th > div{padding:1mm 1.4mm}
.tb-vrow{grid-template-columns:6mm 36mm 9mm 34mm 1fr 1fr 30mm;font-size:8.3pt;line-height:1.35}
.tb-vrow .tb-w{font-weight:700;overflow-wrap:anywhere}
.tb-vrow .tb-pos{color:#6a707c;font-style:italic}
.tb-vrow .tb-nil{color:#c9cdd4}
.tb-vrow .tb-n{color:#8a909b;font-size:7.2pt;padding-top:1.5mm;white-space:nowrap}
.tb-q{display:flex;align-items:center;gap:2.2mm;border-top:1.2pt solid #15171c;padding-top:1.6mm;margin-bottom:1.6mm;font-size:10pt;font-weight:700}
.tb-q .tb-qn{display:inline-grid;place-items:center;min-width:6mm;height:6mm;padding:0 1mm;background:#15171c;color:#fff;font-size:8pt;font-weight:700}
.tb-q small{font-weight:400;color:#6a707c;font-size:8pt}
.tb-it{display:grid;grid-template-columns:7mm minmax(0,1fr);column-gap:1mm;margin-bottom:1.6mm;break-inside:avoid;page-break-inside:avoid}
.tb-it > .tb-i{color:#6a707c;font-size:8pt;padding-top:.6mm}
.tb-it .tb-txt{font-size:10pt;line-height:1.6}
.tb-ko{color:#5b616c;font-size:8.5pt;margin-top:.4mm}
.tb-line{height:7.5mm;border-bottom:.6pt solid #c9cdd4}
.tb-blank{display:inline-block;min-width:24mm;border-bottom:.8pt solid #15171c;margin:0 1mm;text-align:center;font-family:"Noto Sans KR",sans-serif;font-size:7.6pt;font-weight:700;color:#6a707c;vertical-align:-.3mm}
.tb-pick{white-space:nowrap;font-weight:600}
/* 워크북 쪽 안(2026-10-21): 워크북 글꼴 크기에 맞추고 문항 머리 막대는 뺀다 */
.tb-wb{font-size:12.5px;line-height:1.6;color:#15171c}
.tb-wb .tb-psg{font-size:13px}
/* 워크북 2단(좁은 단, 선생님 2026-10-27 「단어 2단으로 제작 시 깨짐」): 단어 시험 쓰기는 한 줄에 하나, 뜻이 길면 줄을 늘리고, 보기는 둘씩 두 줄 */
.tb-wb{container-type:inline-size}
@container (max-width: 125mm){
.tb-wb .tb-words{grid-template-columns:minmax(0,1fr)}
.tb-wb .tb-wq{height:auto;min-height:8.2mm;padding-top:1.2mm;align-items:baseline}
.tb-wb .tb-mc .tb-ch{grid-template-columns:repeat(2,minmax(0,1fr))}
}
.tb-wb .tb-ch > span{overflow-wrap:anywhere}
.tb-arow-plain > span{display:inline-block;margin-right:3mm}
.tb-arow-plain b{margin-right:1mm}
.tb-form i{font-style:italic;color:#6a707c}
.tb-form small{font-family:"Noto Sans KR",sans-serif;font-size:.78em;color:#6a707c;margin-left:.6mm}
.tb-u u{text-decoration:underline;text-decoration-thickness:.9pt;text-underline-offset:1.2pt}
/* 도식화: 흐름 칸을 화살표로 잇고 아래에 보기 */
.tb-flow{display:flex;flex-direction:column;gap:1mm;margin:1mm 0 2mm}
.tb-flow > div{display:grid;grid-template-columns:22mm 1fr;align-items:center;gap:2mm}
.tb-flow b{display:inline-grid;place-items:center;height:8mm;background:var(--tb-accent,#15171c);color:#fff;font-size:8.5pt;font-weight:800;border-radius:1.2mm}
.tb-flow span{height:8mm;border:.8pt solid #9aa0aa;border-radius:1.2mm}
.tb-flow i{font-style:normal;text-align:center;color:#9aa0aa;font-size:8pt;line-height:1;padding-left:9mm}
.tb-flowbox{border:.8pt solid #15171c;padding:1.6mm 2.4mm;display:grid;gap:.8mm;font-size:9pt}
/* 직독직해: 덩어리 아래에 뜻 쓸 칸 */
.tb-gloss{display:flex;flex-wrap:wrap;gap:1.6mm 1.2mm;margin-top:.4mm}
.tb-gloss > span{display:inline-flex;flex-direction:column;min-width:14mm}
.tb-gloss > span > b{font-weight:400;padding:0 .8mm;border-right:.6pt solid #c9cdd4;line-height:1.45}
.tb-gloss > span:last-child > b{border-right:0}
.tb-gloss > span > i{display:block;height:6.2mm;border-bottom:.6pt solid #9aa0aa;margin:0 .8mm}
.tb-pn{font-weight:700;margin-right:.6mm}
.tb-sup{font-family:"Noto Sans KR",sans-serif;font-size:6.5pt;font-weight:700;margin-left:.6mm;color:#15171c}
.tb-kol{font-family:"Noto Sans KR",sans-serif;font-size:8.5pt;font-weight:800;margin:2.5mm 0 1mm}
.tb-pick i{font-style:normal;font-weight:400;color:#8a909b;margin:0 .6mm}
.tb-chunks{display:flex;flex-wrap:wrap;gap:1.5mm;margin:1mm 0}
.tb-chunks span{border:.7pt solid #15171c;padding:.3mm 2mm;font-size:9pt}
.tb-lead{font-weight:600}
.tb-tag{display:inline-block;font-size:7.4pt;font-weight:700;color:#1d4ed8;border:.6pt solid #1d4ed8;padding:0 1.6mm;margin-bottom:.6mm}
.tb-tf{display:grid;grid-template-columns:7mm minmax(0,1fr) 16mm;column-gap:1mm;align-items:baseline;border-bottom:.5pt solid #d3d7de;padding:1mm 0}
.tb-tf .tb-tfbox{text-align:right;color:#6a707c;font-size:8.5pt}
.tb-box{border:.7pt solid #15171c;padding:1.2mm 3mm;display:flex;flex-wrap:wrap;gap:1mm 6mm;font-size:9pt;margin-bottom:2mm}
.tb-given{border:.7pt solid #15171c;background:#f4f5f7;padding:1.6mm 3mm;margin-bottom:2mm;font-size:10pt;line-height:1.6}
.tb-psg{font-size:10pt;line-height:1.85;text-align:justify;margin:0 0 1.5mm}
.tb-words{display:grid;grid-template-columns:1fr 1fr;column-gap:8mm}
.tb-wq{display:grid;grid-template-columns:7.5mm 1fr;column-gap:1mm;align-items:end;border-bottom:.6pt solid #c9cdd4;height:8.2mm;font-size:9.5pt}
.tb-wq .tb-i{color:#6a707c;font-size:8pt;white-space:nowrap}
.tb-mc{display:grid;grid-template-columns:6mm minmax(0,1fr);column-gap:1mm;margin-bottom:2mm}
.tb-mc .tb-ch{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.5mm 3mm;font-size:9pt;margin-top:.5mm}
.tb-rel{display:inline-block;border:.6pt solid #6a707c;color:#6a707c;font-size:7.6pt;padding:0 1.2mm;margin-left:1.5mm}
.tb-ss{display:grid;grid-template-columns:7mm minmax(0,1fr);column-gap:1mm;margin-bottom:2.2mm}
.tb-ss .tb-i{color:#8a909b;font-size:7.6pt;padding-top:.8mm}
.tb-ss .tb-en{font-size:10.5pt;line-height:1.62}
.tb-ss .tb-ko{font-size:9pt;color:#4b515c}
/* 계획표·이수표 */
.tb-fields{display:grid;grid-template-columns:1fr .8fr 1.8fr 1fr;gap:4mm;font-size:8.5pt;color:#6a707c;margin-bottom:1mm}
.tb-fields span{border-bottom:.6pt solid #c9cdd4;padding-bottom:1mm}
.tb-sub{display:flex;align-items:baseline;gap:2mm;font-size:10.5pt;font-weight:900;margin:2mm 0 1.4mm}
.tb-sub small{font-weight:400;font-size:8pt;color:#6a707c}
.tb-prow{grid-template-columns:9mm 25mm minmax(0,1fr) 54mm 25mm 15mm;font-size:8.1pt;min-height:9mm}
.tb-prow > div{border-left:.5pt solid #d3d7de;display:flex;align-items:center}
.tb-prow > div:first-child{border-left:0;justify-content:center}
.tb-date{color:#9aa0aa;letter-spacing:.02em}
.tb-prow > div.tb-psrc{flex-direction:column;align-items:flex-start;justify-content:center;line-height:1.3}
.tb-psrc b{font-size:7.4pt;color:#4b515c;font-weight:700}
.tb-todo{display:flex;flex-wrap:wrap;gap:.6mm 2.4mm;font-size:7.6pt;color:#4b515c}
.tb-todo span::before{content:"";display:inline-block;width:2.6mm;height:2.6mm;border:.6pt solid #4b515c;margin-right:.8mm;vertical-align:-.4mm}
.tb-crow{font-size:7.6pt;min-height:8.5mm}
.tb-crow > div{border-left:.5pt solid #d3d7de;display:flex;align-items:flex-end;justify-content:flex-end;color:#c9cdd4}
.tb-crow > div:first-child{border-left:0;justify-content:flex-start;align-items:center;color:#15171c}
.tb-crow.tb-th > div{justify-content:center;align-items:center;color:#6a707c}
/* 칸이 많으면(워크북 유형으로 만든 이수표) 이름이 두 줄로 — 옆 칸과 겹치지 않게 */
.tb-crow.tb-th > div{padding-left:.4mm;padding-right:.4mm;text-align:center;line-height:1.15;word-break:keep-all;min-width:0}
.tb-crow.tb-th > div:first-child{justify-content:flex-start}
.tb-rrow{grid-template-columns:24mm 30mm 25mm 18mm 1fr 1fr;font-size:8.1pt;min-height:8.5mm}
.tb-rrow > div{border-left:.5pt solid #d3d7de;display:flex;align-items:center}
.tb-rrow > div:first-child{border-left:0}
.tb-sign{display:flex;gap:8mm;font-size:8.5pt;color:#6a707c;margin-top:3mm}
.tb-sign span{flex:1;border-bottom:.6pt solid #c9cdd4;padding-bottom:1mm}
/* 백지노트 */
.tb-note{display:flex;flex-direction:column;height:100%}
/* 표지 01 색 번짐(시안 10-19 채택): 남색 위 주황·보라·청록 번짐, 낟알 */
/* 목차(통합자료 목차와 같은 꼴: 큰 세리프 CONTENTS, 색 번호, 묶음별 쪽 범위) */
.tb-contents{padding:22mm 20mm}
.tb-contents h2{margin:0;font-family:Georgia,"Times New Roman",serif;font-size:40pt;font-weight:900;line-height:1;letter-spacing:-.02em;color:#15171c}
.tb-contents .tb-cbar{margin-top:4mm;height:1.6mm;width:22mm;background:#15171c}
.tb-contents ol{list-style:none;margin:14mm 0 0;padding:0;display:grid;gap:6.5mm}
.tb-contents li{display:flex;align-items:flex-start;gap:6mm}
.tb-contents .tb-cno{width:14mm;font-family:Georgia,serif;font-size:22pt;font-weight:900;line-height:1}
.tb-contents .tb-cbody{flex:1;min-width:0;border-bottom:.5pt solid #d3d7de;padding-bottom:3.6mm}
.tb-contents .tb-crow{display:flex;justify-content:space-between;align-items:baseline;gap:4mm}
.tb-contents .tb-cen{font-family:Georgia,serif;font-size:13pt;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.tb-contents .tb-cpg{font-size:9.5pt;color:#6a707c;white-space:nowrap;font-variant-numeric:tabular-nums}
.tb-contents .tb-cko{margin-top:1mm;font-size:9.5pt;color:#6a707c}
.tb-contents .tb-cko b{color:#15171c;font-weight:700;margin-right:2mm}
.tb-contents .tb-cfoot{position:absolute;left:20mm;right:20mm;bottom:16mm;border-top:.5pt solid #c9cdd4;padding-top:3mm;text-align:right}
.tb-contents .tb-cfoot b{display:block;font-family:Georgia,serif;font-size:10pt}
.tb-contents .tb-cfoot span{font-size:8.5pt;color:#6a707c}
/* 간지: 왼쪽 색 띠, PART 번호, 영어·한글 제목, 지문별 시작 쪽 */
.tb-divider{padding:0}
.tb-divider .tb-dstrip{position:absolute;top:0;bottom:0;left:0;width:14mm;background:var(--tb-accent,#15171c)}
.tb-divider .tb-din{position:absolute;left:30mm;right:20mm;top:62mm}
.tb-divider .tb-dpart{font-size:13pt;font-weight:900;letter-spacing:.3em;color:var(--tb-accent,#15171c)}
.tb-divider h2{margin:4mm 0 0;font-family:Georgia,"Times New Roman",serif;font-size:32pt;font-weight:900;line-height:1.1;text-transform:uppercase;color:#15171c}
.tb-divider .tb-dbar{margin-top:6mm;height:1.2mm;width:30mm;background:var(--tb-accent,#15171c)}
.tb-divider .tb-dko{margin-top:6mm;font-size:19pt;font-weight:900;color:#2b2f38}
.tb-divider .tb-dsub{margin-top:2mm;font-size:10pt;color:#6a707c}
.tb-divider .tb-dlist{margin-top:12mm;display:grid;grid-template-columns:1fr 1fr;column-gap:8mm}
.tb-divider .tb-dlist div{display:grid;grid-template-columns:7mm 1fr 9mm;gap:1mm;align-items:baseline;border-bottom:.5pt solid #e1e4e9;padding:1.3mm 0;font-size:8.5pt}
.tb-divider .tb-dlist i{font-style:normal;color:var(--tb-accent,#15171c);font-weight:800;font-size:7.5pt}
.tb-divider .tb-dlist em{font-style:normal;text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
.tb-divider .tb-dlist small{display:block;color:#8a909b;font-size:7pt}
.tb-divider .tb-dfoot{position:absolute;left:30mm;right:20mm;bottom:16mm;border-top:.5pt solid #e1e4e9;padding-top:3mm;text-align:right;font-size:8.5pt;color:#6a707c}
.tb-divider .tb-dfoot b{display:block;color:#2b2f38;font-size:9.5pt}
/* 지문 간지: 위쪽 색 면에 큰 지문 번호, 아래에 제목·출처·이 묶음에서 이어질 쪽 */
.tb-pdiv{padding:0}
.tb-pdiv .tb-ptop{position:absolute;left:0;right:0;top:0;height:118mm;background:var(--tb-accent,#15171c);color:#fff;overflow:hidden}
.tb-pdiv .tb-ptop::after{content:"";position:absolute;right:-30mm;bottom:-46mm;width:120mm;height:120mm;border-radius:50%;background:rgba(255,255,255,.08)}
.tb-pdiv .tb-ppart{position:absolute;left:24mm;top:22mm;font-size:9pt;font-weight:800;letter-spacing:.28em;opacity:.85}
.tb-pdiv .tb-pno{position:absolute;left:20mm;bottom:8mm;font-family:Georgia,"Times New Roman",serif;font-size:120pt;font-weight:900;line-height:.8;letter-spacing:-.04em}
.tb-pdiv .tb-pno small{display:block;font-family:"Noto Sans KR",sans-serif;font-size:9pt;font-weight:700;letter-spacing:.3em;margin:0 0 4mm 2mm;opacity:.8}
.tb-pdiv .tb-pin{position:absolute;left:24mm;right:22mm;top:136mm}
.tb-pdiv .tb-psrc{font-size:9.5pt;font-weight:700;color:var(--tb-accent,#15171c);letter-spacing:.04em}
.tb-pdiv h2{margin:3mm 0 0;font-size:24pt;font-weight:900;line-height:1.25;letter-spacing:-.02em;color:#15171c}
.tb-pdiv .tb-pen{margin-top:2mm;font-family:Georgia,serif;font-size:12pt;color:#4b515c}
.tb-pdiv .tb-pbar{margin-top:8mm;height:1mm;width:24mm;background:var(--tb-accent,#15171c)}
.tb-pdiv .tb-pnext{margin-top:7mm;display:grid;gap:2mm;font-size:10pt;color:#2b2f38}
.tb-pdiv .tb-pnext div{display:flex;align-items:center;gap:3mm;border-bottom:.5pt solid #e1e4e9;padding-bottom:2mm}
.tb-pdiv .tb-pnext i{font-style:normal;display:inline-grid;place-items:center;width:5.5mm;height:5.5mm;background:var(--tb-accent,#15171c);color:#fff;font-size:7.5pt;font-weight:800}
.tb-pdiv .tb-pfoot{position:absolute;left:24mm;right:22mm;bottom:16mm;border-top:.5pt solid #e1e4e9;padding-top:3mm;display:flex;justify-content:space-between;font-size:8.5pt;color:#6a707c}
/* 묶음 색: 바깥 가장자리 띠 + 쪽 머리 꼬리표 + 문항 번호 칸 */
.tb-sheet.tb-part::before{content:"";position:absolute;top:0;bottom:0;left:0;width:2.4mm;background:var(--tb-accent,#15171c)}
/* 쪽 장식(색 띠·동그란 빛)은 글자 뒤로 — 쪽 바탕 위, 내용 아래(선생님 2026-10-21: 통합자료에서 배경이 글씨를 가림) */
.tb-sheet{isolation:isolate}
.tb-sheet.tb-part::before,.tb-sheet.tb-part::after{z-index:-1}
.tb-part .tb-dh{border-bottom-color:var(--tb-accent,#15171c)}
.tb-part .tb-dh h2::before{content:var(--tb-part,"");display:block;font-size:6.8pt;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:var(--tb-accent,#15171c);margin-bottom:1mm}
.tb-part .tb-q .tb-qn{background:var(--tb-accent,#15171c)}
.tb-part .tb-q{border-top-color:var(--tb-accent,#15171c)}
/* 분석 자료(분석서 문장 분석 부품을 그대로 쓴다) */
.tb-an-topic{border-left:3pt solid #15171c;padding:1mm 0 1mm 3mm;margin-bottom:2mm;font-size:9.5pt}
.tb-an-topic b{font-size:8pt;color:#6a707c;margin-right:2mm;letter-spacing:.06em}
.tb-an-s{padding:2mm 0;border-bottom:.5pt solid #e1e4e9}
.tb-annotes{margin:-1mm 0 2.4mm 9mm;border-left:2pt solid var(--tb-accent,#15171c);padding:1mm 0 1mm 2.6mm;display:grid;gap:.8mm;background:#f7f7fb}
.tb-annote{display:grid;grid-template-columns:15mm minmax(0,1fr);gap:2mm;align-items:baseline;font-size:8.6pt;line-height:1.45}
.tb-ankind{font-size:7.5pt;font-weight:800;color:var(--tb-accent,#15171c);letter-spacing:.04em}
.tb-an-s .tb-ko{font-size:9pt}
.tb-note .tb-psgbox{border-top:.8pt solid #15171c;padding-top:1.6mm;margin-bottom:3mm}
.tb-note .tb-lb{display:flex;justify-content:space-between;align-items:baseline;font-size:8pt;color:#6a707c;margin-bottom:1mm}
.tb-note .tb-lb b{color:#15171c;font-size:10pt}
.tb-note .tb-psgbox p{margin:0;font-size:10pt;line-height:2.05;text-align:justify}
.tb-fill{flex:1;display:flex;flex-direction:column;min-height:0;margin-bottom:3mm}
.tb-fill:last-child{margin-bottom:0}
.tb-gridlines{flex:1;border-top:1pt solid #15171c;position:relative}
/* 쓰기 줄은 그러데이션 대신 진짜 선(.tb-rl) — 그러데이션은 인쇄 때 프린터 해상도 그림으로 바뀌어 스풀링이 느리다(2026-11-09) */
.tb-rl{position:absolute;inset:0;overflow:hidden;pointer-events:none}
.tb-rl i{display:block;box-sizing:border-box;border-bottom:.5pt solid #c9cdd4}
.tb-rl b{position:absolute;top:0;bottom:0;border-left:.5pt solid #c9cdd4}
/* 백지노트(2026-10-27 시안 A안): 원문 문장 번호 · 문장별 정리 · 4단 정리 */
.tb-bn-psg p{margin:0;font-size:10pt;line-height:2.05;text-align:justify}
.tb-bn-psg sup{font-size:7.5pt;font-weight:800;color:var(--tb-accent,#15171c);margin:0 .6mm 0 .4mm;vertical-align:.25em}
.tb-bn-rows{flex:1;display:flex;flex-direction:column;border-top:1pt solid #15171c;min-height:0}
.tb-bn-rows > div{flex:1;min-height:7mm;display:grid;grid-template-columns:8mm 1fr;align-items:start;border-bottom:.8pt solid #9aa0aa;position:relative}
.tb-bn-rows > div > .tb-rl i{border-bottom-color:#dfe2e6}
.tb-bn-rows > div > b{font-size:8.5pt;color:var(--tb-accent,#15171c);padding-top:1.4mm;text-align:center}
.tb-bn-four{display:flex;flex-direction:column;gap:0;margin-bottom:3mm}
.tb-bn-step{display:grid;grid-template-columns:24mm 1fr;border:.8pt solid #9aa0aa;border-radius:1.4mm;overflow:hidden;min-height:19mm}
.tb-bn-step > div:first-child{background:var(--tb-accent,#15171c);color:#fff;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:.6mm;padding:1.4mm}
.tb-bn-step > div:first-child b{font-size:10pt;font-weight:800}
.tb-bn-step > div:first-child small{font-size:7pt;opacity:.85;text-align:center;line-height:1.3}
.tb-bn-step > div:last-child{position:relative}
.tb-bn-step .tb-rl i{border-bottom-color:#d6d9de}
.tb-bn-step em{position:absolute;right:1.6mm;top:1.2mm;font-style:normal;font-size:7.5pt;color:#6a707c}
.tb-bn-arrow{text-align:center;color:#9aa0aa;font-size:9pt;line-height:1;padding:.8mm 0}
.tb-synhead{display:grid;grid-template-columns:42mm 40mm 50mm 1fr;font-size:8pt;color:#6a707c;border-top:1pt solid #15171c;padding:.8mm 0}
.tb-synhead span{padding-left:1.4mm}
.tb-ticks{display:flex;flex-wrap:wrap;gap:1mm 3.4mm;font-size:8pt;color:#4b515c;margin-bottom:1.4mm}
.tb-ticks span::before{content:"";display:inline-block;width:2.6mm;height:2.6mm;border:.6pt solid #4b515c;margin-right:.8mm;vertical-align:-.4mm}
/* 정답 */
.tb-ans{border-top:1.2pt solid #15171c;padding-top:1.6mm}
.tb-ans h3{margin:0 0 1.2mm;font-size:10.5pt;font-weight:900}
.tb-ans h3 span{color:#6a707c;font-weight:500;margin-right:2mm}
.tb-arow{display:grid;grid-template-columns:24mm minmax(0,1fr);column-gap:2mm;font-size:9pt;line-height:1.5;margin-bottom:.8mm}
.tb-arow dt{font-weight:700;color:#4b515c}
.tb-arow dd{margin:0;min-width:0}
.tb-arow dd b{color:#6a707c;font-weight:500;margin-right:1mm}
.tb-arow dd > span{display:inline-block;margin-right:4mm}
/* 단어 쓰기 정답은 번호를 세로로 한 줄에 하나씩(1 / 2 / 3 / 4) — 채점할 때 번호 찾기 쉽게(선생님 2026-11-09) */
.tb-arow-v dd > span{display:block;margin-right:0}
/* 인쇄: 전역 규칙(globals.css)이 body 안을 모두 숨기고 등록된 인쇄 루트만 보인다. 여기서 직접 보이게 하고
   A4 용지(app-print-a4)를 지정한다 — 빠뜨리면 빈 종이나 레터 용지로 나온다. */
@media print{
#tb-print-root,#tb-print-root *{visibility:visible}
#tb-print-root{page:app-print-a4;position:absolute;left:0;top:0;width:210mm !important;max-width:210mm !important;margin:0 !important;padding:0 !important;transform:none !important;gap:0 !important}
.tb-sheet{box-shadow:none !important}
.tb-measure{display:none !important}
}
/* ───────── 내지 디자인 B · 파스텔 블룸(화사) ───────── */
.tb-theme-b .tb-sheet.tb-part{background:linear-gradient(180deg,color-mix(in srgb,var(--tb-accent,#6a4bd8) 10%,#fff) 0,#fff 42mm)}
.tb-theme-b .tb-sheet.tb-part::before{left:auto;right:-26mm;top:-26mm;bottom:auto;width:78mm;height:78mm;border-radius:50%;background:radial-gradient(circle at 40% 60%,color-mix(in srgb,var(--tb-accent,#6a4bd8) 30%,#fff) 0,color-mix(in srgb,var(--tb-accent,#6a4bd8) 8%,#fff) 55%,transparent 72%)}
.tb-theme-b .tb-part .tb-dh{border-bottom:0;padding-bottom:1mm;position:relative}
.tb-theme-b .tb-part .tb-dh h2{color:color-mix(in srgb,var(--tb-accent,#15171c) 82%,#000)}
.tb-theme-b .tb-part .tb-dh h2::before{display:table;padding:.6mm 2.6mm;border-radius:99px;background:color-mix(in srgb,var(--tb-accent,#15171c) 16%,#fff);color:var(--tb-accent,#15171c);margin-bottom:1.6mm}
.tb-theme-b .tb-part .tb-dh::after{content:"";position:absolute;left:0;right:0;bottom:-1mm;height:1.2mm;border-radius:99px;background:linear-gradient(90deg,var(--tb-accent,#15171c),color-mix(in srgb,var(--tb-accent,#15171c) 25%,#fff) 60%,transparent)}
.tb-theme-b .tb-q{border-top:0;background:color-mix(in srgb,var(--tb-accent,#15171c) 9%,#fff);border-radius:2.6mm;padding:1.4mm 2.4mm;margin-top:1.2mm}
.tb-theme-b .tb-part .tb-q{border-top:0}
.tb-theme-b .tb-q .tb-qn,.tb-theme-b .tb-part .tb-q .tb-qn{border-radius:99px;background:linear-gradient(135deg,var(--tb-accent,#15171c),color-mix(in srgb,var(--tb-accent,#15171c) 55%,#ff8a5c))}
.tb-theme-b .tb-row.tb-th{border:0;background:color-mix(in srgb,var(--tb-accent,#15171c) 10%,#fff);border-radius:2mm}
.tb-theme-b .tb-row{border-bottom-color:color-mix(in srgb,var(--tb-accent,#15171c) 14%,#fff)}
.tb-theme-b .tb-blank{border-bottom:1pt dashed var(--tb-accent,#15171c)}
.tb-theme-b .tb-pick{background:color-mix(in srgb,var(--tb-accent,#15171c) 8%,#fff);border-radius:1.2mm;padding:0 .8mm}
.tb-theme-b .tb-chunks span{border-radius:99px;border-color:color-mix(in srgb,var(--tb-accent,#15171c) 40%,#fff);background:#fff}
.tb-theme-b .tb-tag{border-radius:99px}
.tb-theme-b .tb-foot{border-top:0}
.tb-theme-b .tb-foot .tb-pgno{background:color-mix(in srgb,var(--tb-accent,#15171c) 14%,#fff);color:var(--tb-accent,#15171c);border-radius:99px;padding:.3mm 2.4mm}
.tb-theme-b .tb-divider{background:linear-gradient(160deg,color-mix(in srgb,var(--tb-accent,#15171c) 22%,#fff) 0,#fff 55%,color-mix(in srgb,var(--tb-accent,#15171c) 10%,#fff) 100%)}
.tb-theme-b .tb-divider .tb-dstrip{width:auto;right:auto;left:auto;top:-30mm;right:-30mm;bottom:auto;width:120mm;height:120mm;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--tb-accent,#15171c) 45%,#fff) 0,transparent 70%)}
.tb-theme-b .tb-divider .tb-dbar{border-radius:99px;height:2mm;background:linear-gradient(90deg,var(--tb-accent,#15171c),transparent)}
.tb-theme-b .tb-pdiv .tb-ptop{border-radius:0 0 18mm 18mm;background:linear-gradient(135deg,var(--tb-accent,#15171c),color-mix(in srgb,var(--tb-accent,#15171c) 50%,#ff9a6c))}
.tb-theme-b .tb-contents .tb-cno{display:inline-grid;place-items:center;width:13mm;height:13mm;border-radius:50%;background:color-mix(in srgb,currentColor 14%,#fff);font-size:15pt}
.tb-theme-b .tb-contents .tb-cbody{border-bottom:0;background:#f7f7fb;border-radius:3mm;padding:2.6mm 3.4mm}
.tb-theme-b .tb-contents .tb-cbar{border-radius:99px;background:linear-gradient(90deg,#6a4bd8,#ff8a5c)}
.tb-theme-b .tb-annotes{border-left:0;border-radius:2mm;background:color-mix(in srgb,var(--tb-accent,#15171c) 7%,#fff)}

/* ───────── 내지 디자인 C · 볼드 블록(빵하게) ───────── */
.tb-theme-c .tb-sheet.tb-part::before{top:auto;bottom:0;left:0;right:0;width:auto;height:3.2mm}
.tb-theme-c .tb-part .tb-dh{margin:-13mm -14mm 4mm;padding:8mm 14mm 4mm;background:var(--tb-accent,#15171c);border-bottom:0;color:#fff}
.tb-theme-c .tb-part .tb-dh h2,.tb-theme-c .tb-part .tb-dh .tb-k b{color:#fff}
.tb-theme-c .tb-part .tb-dh h2{font-size:19pt;letter-spacing:-.03em}
.tb-theme-c .tb-part .tb-dh h2::before{color:#fff;opacity:.8}
.tb-theme-c .tb-part .tb-dh h2 small,.tb-theme-c .tb-part .tb-dh .tb-k{color:rgba(255,255,255,.82)}
.tb-theme-c .tb-q,.tb-theme-c .tb-part .tb-q{border-top:0;border-left:2.4mm solid #15171c;padding:.6mm 0 .6mm 2.4mm;font-size:11pt;font-weight:900;letter-spacing:-.01em}
.tb-theme-c .tb-q .tb-qn,.tb-theme-c .tb-part .tb-q .tb-qn{min-width:8mm;height:8mm;font-size:11pt;font-weight:900;background:var(--tb-accent,#15171c)}
.tb-theme-c .tb-row.tb-th{background:#15171c;color:#fff;border-color:#15171c}
.tb-theme-c .tb-row.tb-th > div{color:#fff}
.tb-theme-c .tb-blank{border-bottom-width:1.4pt}
.tb-theme-c .tb-pick{font-weight:800}
.tb-theme-c .tb-chunks span{border-width:1.2pt;border-color:#15171c;font-weight:600}
.tb-theme-c .tb-foot{border-top:1.2pt solid #15171c;color:#15171c}
.tb-theme-c .tb-foot .tb-pgno{font-size:9pt;font-weight:900}
.tb-theme-c .tb-divider{background:var(--tb-accent,#15171c)}
.tb-theme-c .tb-divider .tb-dstrip{background:#15171c;width:24mm}
.tb-theme-c .tb-divider .tb-dpart,.tb-theme-c .tb-divider h2,.tb-theme-c .tb-divider .tb-dko,.tb-theme-c .tb-divider .tb-dsub,.tb-theme-c .tb-divider .tb-dfoot,.tb-theme-c .tb-divider .tb-dfoot b,.tb-theme-c .tb-divider .tb-dlist div,.tb-theme-c .tb-divider .tb-dlist i,.tb-theme-c .tb-divider .tb-dlist small{color:#fff}
.tb-theme-c .tb-divider h2{font-size:44pt;line-height:.95}
.tb-theme-c .tb-divider .tb-dbar{background:#fff;height:2.4mm}
.tb-theme-c .tb-divider .tb-dlist div{border-bottom-color:rgba(255,255,255,.35)}
.tb-theme-c .tb-pdiv .tb-ptop{height:150mm}
.tb-theme-c .tb-pdiv .tb-pin{top:166mm}
.tb-theme-c .tb-pdiv .tb-pno{font-size:170pt}
.tb-theme-c .tb-contents h2{font-size:56pt;letter-spacing:-.04em}
.tb-theme-c .tb-contents .tb-cno{font-size:28pt}
.tb-theme-c .tb-contents .tb-cbody{border-bottom:2pt solid #15171c}
.tb-theme-c .tb-annotes{border-left-width:3.4pt;background:#fff7e6}

/* ───────── 내지 디자인 D · 매거진(세련) ───────── */
.tb-theme-d .tb-sheet.tb-part::before{display:none}
.tb-theme-d .tb-part .tb-dh{border-bottom:.5pt solid #15171c;padding-bottom:2.4mm}
.tb-theme-d .tb-dh h2{font-family:"Source Serif 4",Georgia,serif;font-weight:600;font-size:20pt;letter-spacing:-.01em}
.tb-theme-d .tb-part .tb-dh h2::before{font-family:"Noto Sans KR",sans-serif;font-size:6.4pt;letter-spacing:.32em;color:#8a909b;font-weight:600}
.tb-theme-d .tb-part .tb-dh h2::after{content:"";display:inline-block;width:1.8mm;height:1.8mm;border-radius:50%;background:var(--tb-accent,#15171c);margin-left:2mm;vertical-align:.6mm}
.tb-theme-d .tb-q,.tb-theme-d .tb-part .tb-q{border-top:.5pt solid #c9cdd4;padding-top:2.2mm;font-weight:600}
.tb-theme-d .tb-q .tb-qn,.tb-theme-d .tb-part .tb-q .tb-qn{background:none;color:var(--tb-accent,#15171c);font-family:"Source Serif 4",Georgia,serif;font-style:italic;font-size:15pt;font-weight:600;min-width:7mm;padding:0}
.tb-theme-d .tb-row.tb-th{border-top:.5pt solid #15171c;border-bottom:.5pt solid #15171c;letter-spacing:.12em}
.tb-theme-d .tb-row{border-bottom-color:#e8eaee}
.tb-theme-d .tb-blank{border-bottom:.5pt solid #15171c}
.tb-theme-d .tb-chunks span{border-width:.5pt;border-radius:0}
.tb-theme-d .tb-foot{border-top:0;font-family:"Source Serif 4",Georgia,serif;font-style:italic}
.tb-theme-d .tb-divider .tb-dstrip{width:.8mm;left:24mm;top:40mm;bottom:40mm}
.tb-theme-d .tb-divider h2{font-family:"Source Serif 4",Georgia,serif;font-weight:600;font-style:italic;text-transform:none;font-size:38pt}
.tb-theme-d .tb-divider .tb-dbar{height:.5pt;width:60mm}
.tb-theme-d .tb-pdiv .tb-ptop{background:#fff;color:#15171c;border-bottom:.5pt solid #15171c}
.tb-theme-d .tb-pdiv .tb-ptop::after{background:color-mix(in srgb,var(--tb-accent,#15171c) 10%,#fff)}
.tb-theme-d .tb-pdiv .tb-pno{color:var(--tb-accent,#15171c);font-style:italic;font-weight:600}
.tb-theme-d .tb-contents h2{font-family:"Source Serif 4",Georgia,serif;font-style:italic;font-weight:600}
.tb-theme-d .tb-contents .tb-cno{font-style:italic;font-weight:600}
.tb-theme-d .tb-annotes{background:none;border-left:.5pt solid var(--tb-accent,#15171c)}
/* ───────── 내지 디자인 E · 글래스(B 계열) ───────── */
.tb-theme-e .tb-sheet.tb-part{background:radial-gradient(70% 40% at 100% 0,color-mix(in srgb,var(--tb-accent,#6a4bd8) 16%,#fff) 0,transparent 70%),radial-gradient(60% 35% at 0 100%,color-mix(in srgb,#ff8a5c 12%,#fff) 0,transparent 70%),#fbfbfe}
.tb-theme-e .tb-sheet.tb-part::before{display:none}
.tb-theme-e .tb-part .tb-dh{border-bottom:0;background:rgba(255,255,255,.72);border:.6pt solid color-mix(in srgb,var(--tb-accent,#15171c) 18%,#fff);border-radius:3.4mm;padding:2.4mm 3.4mm;box-shadow:0 1.2mm 3mm color-mix(in srgb,var(--tb-accent,#15171c) 10%,transparent)}
.tb-theme-e .tb-part .tb-dh h2{color:color-mix(in srgb,var(--tb-accent,#15171c) 85%,#000)}
.tb-theme-e .tb-part .tb-dh h2::before{color:var(--tb-accent,#15171c)}
.tb-theme-e .tb-q,.tb-theme-e .tb-part .tb-q{border-top:0;background:rgba(255,255,255,.8);border:.6pt solid color-mix(in srgb,var(--tb-accent,#15171c) 16%,#fff);border-radius:2.6mm;padding:1.3mm 2.4mm;box-shadow:0 .8mm 2mm color-mix(in srgb,var(--tb-accent,#15171c) 8%,transparent);margin-top:1.4mm}
.tb-theme-e .tb-q .tb-qn,.tb-theme-e .tb-part .tb-q .tb-qn{background:#fff;color:var(--tb-accent,#15171c);border:1.2pt solid var(--tb-accent,#15171c);border-radius:99px}
.tb-theme-e .tb-row.tb-th{border:0;background:rgba(255,255,255,.85);border-radius:2mm;box-shadow:inset 0 0 0 .6pt color-mix(in srgb,var(--tb-accent,#15171c) 18%,#fff)}
.tb-theme-e .tb-row{border-bottom-color:color-mix(in srgb,var(--tb-accent,#15171c) 10%,#fff)}
.tb-theme-e .tb-blank{border-bottom:1pt solid color-mix(in srgb,var(--tb-accent,#15171c) 60%,#fff)}
.tb-theme-e .tb-pick{background:rgba(255,255,255,.9);border:.5pt solid color-mix(in srgb,var(--tb-accent,#15171c) 25%,#fff);border-radius:1.4mm;padding:0 .8mm}
.tb-theme-e .tb-chunks span{border-radius:1.6mm;border-color:color-mix(in srgb,var(--tb-accent,#15171c) 30%,#fff);background:rgba(255,255,255,.9)}
.tb-theme-e .tb-foot{border-top:0}
.tb-theme-e .tb-foot .tb-pgno{border:.6pt solid color-mix(in srgb,var(--tb-accent,#15171c) 40%,#fff);border-radius:99px;padding:.2mm 2.4mm;color:var(--tb-accent,#15171c)}
.tb-theme-e .tb-divider{background:radial-gradient(80% 50% at 90% 10%,color-mix(in srgb,var(--tb-accent,#15171c) 28%,#fff) 0,transparent 70%),radial-gradient(70% 40% at 10% 95%,color-mix(in srgb,#ff8a5c 18%,#fff) 0,transparent 70%),#fbfbfe}
.tb-theme-e .tb-divider .tb-dstrip{display:none}
.tb-theme-e .tb-divider .tb-din{background:rgba(255,255,255,.75);border:.6pt solid color-mix(in srgb,var(--tb-accent,#15171c) 20%,#fff);border-radius:5mm;padding:8mm;box-shadow:0 2mm 6mm color-mix(in srgb,var(--tb-accent,#15171c) 12%,transparent)}
.tb-theme-e .tb-pdiv .tb-ptop{left:10mm;right:10mm;top:10mm;border-radius:6mm;background:linear-gradient(135deg,color-mix(in srgb,var(--tb-accent,#15171c) 85%,#fff),color-mix(in srgb,var(--tb-accent,#15171c) 40%,#ffb08a))}
.tb-theme-e .tb-contents .tb-cbody{border-bottom:0;background:rgba(255,255,255,.8);border:.6pt solid #e6e3f5;border-radius:3mm;padding:2.4mm 3.4mm;box-shadow:0 .8mm 2mm rgba(106,75,216,.08)}
.tb-theme-e .tb-contents{background:radial-gradient(60% 30% at 100% 0,#efe9ff 0,transparent 70%),#fbfbfe}
.tb-theme-e .tb-annotes{border-left:0;border:.6pt solid color-mix(in srgb,var(--tb-accent,#15171c) 18%,#fff);border-radius:2mm;background:rgba(255,255,255,.85)}

/* ───────── 내지 디자인 F · 선셋(B 계열) ───────── */
.tb-theme-f .tb-sheet.tb-part::before{display:none}
.tb-theme-f .tb-part .tb-dh{margin:-13mm -14mm 4mm;padding:7mm 14mm 4mm;border-bottom:0;border-radius:0 0 7mm 7mm;background:linear-gradient(120deg,var(--tb-accent,#15171c),color-mix(in srgb,var(--tb-accent,#15171c) 45%,#ffb08a) 70%,#ffd3a8);color:#fff}
.tb-theme-f .tb-part .tb-dh h2,.tb-theme-f .tb-part .tb-dh .tb-k b{color:#fff}
.tb-theme-f .tb-part .tb-dh h2::before{color:#fff;opacity:.85}
.tb-theme-f .tb-part .tb-dh h2 small,.tb-theme-f .tb-part .tb-dh .tb-k{color:rgba(255,255,255,.88)}
.tb-theme-f .tb-q,.tb-theme-f .tb-part .tb-q{border-top:0;padding-top:1mm;margin-top:1.4mm}
.tb-theme-f .tb-q .tb-qn,.tb-theme-f .tb-part .tb-q .tb-qn{border-radius:99px;min-width:9mm;background:linear-gradient(120deg,var(--tb-accent,#15171c),#ff9f7a)}
.tb-theme-f .tb-q::after{content:"";flex:1;height:.8mm;border-radius:99px;margin-left:2mm;background:linear-gradient(90deg,color-mix(in srgb,var(--tb-accent,#15171c) 30%,#fff),transparent)}
.tb-theme-f .tb-row.tb-th{border:0;border-radius:99px;background:linear-gradient(90deg,color-mix(in srgb,var(--tb-accent,#15171c) 14%,#fff),#fff1e6)}
.tb-theme-f .tb-row{border-bottom-color:#f3e7e1}
.tb-theme-f .tb-blank{border-bottom:1.1pt solid #ff9f7a}
.tb-theme-f .tb-pick{background:#fff3ea;border-radius:99px;padding:0 1.4mm}
.tb-theme-f .tb-chunks span{border-radius:99px;border-color:#ffc1a1;background:#fff8f3}
.tb-theme-f .tb-foot{border-top:0}
.tb-theme-f .tb-foot .tb-pgno{background:linear-gradient(120deg,var(--tb-accent,#15171c),#ff9f7a);color:#fff;border-radius:99px;padding:.3mm 2.6mm}
.tb-theme-f .tb-divider{background:linear-gradient(165deg,var(--tb-accent,#15171c) 0,color-mix(in srgb,var(--tb-accent,#15171c) 45%,#ffb08a) 55%,#ffe2c6 100%)}
.tb-theme-f .tb-divider .tb-dstrip{display:none}
.tb-theme-f .tb-divider .tb-dpart,.tb-theme-f .tb-divider h2,.tb-theme-f .tb-divider .tb-dko,.tb-theme-f .tb-divider .tb-dsub{color:#fff}
.tb-theme-f .tb-divider .tb-dbar{background:#fff;border-radius:99px}
.tb-theme-f .tb-divider .tb-dlist{background:rgba(255,255,255,.88);border-radius:4mm;padding:3mm 4mm}
.tb-theme-f .tb-pdiv .tb-ptop{background:linear-gradient(135deg,var(--tb-accent,#15171c),color-mix(in srgb,var(--tb-accent,#15171c) 45%,#ffb08a) 70%,#ffd3a8);border-radius:0 0 22mm 0}
.tb-theme-f .tb-contents .tb-cno{background:linear-gradient(120deg,currentColor,#ff9f7a);-webkit-background-clip:text;background-clip:text}
.tb-theme-f .tb-contents .tb-cbar{border-radius:99px;background:linear-gradient(90deg,#6a4bd8,#ff9f7a);height:2mm;width:36mm}
.tb-theme-f .tb-annotes{border-left:0;border-radius:2mm;background:#fff5ee}
`;

// ---------------------------------------------------------------- 쪽 나누기

export type Block = {
  key: string;
  node: ReactNode;
  /** 쪽 끝에 다 안 들어가면 줄 사이에서 잘라 다음 쪽으로 이어 싣는다(뽑은 테스트지 — 선생님 2026-11-06 「워크북처럼 쭉 이어서」) */
  split?: boolean;
};

/** 쪽에 싣는 조각: 덩어리 i 전체, 또는 from~to(px) 부분 */
type Piece = { i: number; from?: number; to?: number };

/** 덩어리 안에서 글줄을 가르지 않고 자를 수 있는 높이들(덩어리 위 끝 기준, 레이아웃 px) */
function safeCuts(el: HTMLElement): number[] {
  const box = el.getBoundingClientRect();
  const ratio = box.height > 0 ? el.offsetHeight / box.height : 1;
  // 글자 줄만 본다(문단·칸 상자는 여러 줄에 걸쳐 있어 넣으면 자를 곳이 없어진다). 빈칸·밑줄 칸 같은 인라인 상자는 글줄로 본다.
  const rects: Array<{ t: number; b: number }> = [];
  const add = (list: DOMRectList | DOMRect[]) => {
    for (const r of Array.from(list)) if (r.height > 0 && r.width > 0) rects.push({ t: (r.top - box.top) * ratio, b: (r.bottom - box.top) * ratio });
  };
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent?.trim()) continue;
    range.selectNodeContents(n);
    add(range.getClientRects());
  }
  el.querySelectorAll<HTMLElement>("img, svg, .tb-blank, .tb-pick, input, hr").forEach((x) => add(x.getClientRects()));
  // 줄과 줄 사이 빈 틈의 한가운데에서 자른다(글자 아랫부분·윗부분이 넘어가 보이지 않게)
  rects.sort((a, b) => a.t - b.t);
  const cuts: number[] = [];
  let bottom = -Infinity;
  for (const r of rects) {
    if (bottom > -Infinity && r.t > bottom + 1) cuts.push(Math.round((bottom + r.t) / 2));
    bottom = Math.max(bottom, r.b);
  }
  return cuts;
}

/**
 * 덩어리를 재서 A4 쪽으로 나눈다. head는 쪽마다 위에 붙는다(첫 쪽과 나머지 쪽을 다르게 줄 수 있다).
 * 쪽 수가 바뀌면 다시 그린다. measureKey가 바뀌면(글꼴·내용) 다시 잰다.
 */
export function PagedSheet({
  blocks,
  head,
  foot,
  measureKey,
}: {
  blocks: Block[];
  head: (page: number) => ReactNode;
  foot?: (page: number, total: number) => ReactNode;
  measureKey: string;
}) {
  const measureRef = useRef<HTMLDivElement>(null);
  // 재기 전에는 쪽을 그리지 않는다(긴 한 쪽을 먼저 그렸다 버리지 않게)
  const [pages, setPages] = useState<Piece[][] | null>(null);
  const blockKeys = blocks.map((b) => b.key).join("|");
  /*
   * 서버에서는 그리지 않는다(2026-10-29 속도): 서버가 재기용 사본과 나누기 전 긴 한 쪽을 둘 다 그려 보내
   * 테스트 교재 5지문이 HTML 1.85MB였고, 브라우저는 그걸 받아 맞춘 뒤 어차피 다시 나눴다.
   * 브라우저에서 처음 그릴 때 재고 나눈다.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // 글꼴이 늦게 받아지면(처음 열 때) 받은 뒤 다시 잰다 — 먼저 잰 높이로 나누면 쪽 끝이 넘친다
  const [fontTick, setFontTick] = useState(0);
  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts) return;
    let alive = true;
    const bump = () => alive && !isPrinting() && setFontTick((t) => t + 1);
    void document.fonts.ready.then(bump);
    document.fonts.addEventListener("loadingdone", bump);
    return () => {
      alive = false;
      document.fonts.removeEventListener("loadingdone", bump);
    };
  }, []);
  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root) return;
    const firstHead = (root.querySelector("[data-tb-head='0']") as HTMLElement | null)?.offsetHeight ?? 0;
    const restHead = (root.querySelector("[data-tb-head='1']") as HTMLElement | null)?.offsetHeight ?? firstHead;
    const els = Array.from(root.querySelectorAll<HTMLElement>("[data-tb-block]"));
    const heights = els.map((el) => el.offsetHeight);
    // 최종통합자료처럼 미리보기 배율(zoom)이 걸린 곳에서도 맞게, 잰 쪽 높이에 대한 비율로 센다
    const ruler = (root.querySelector("[data-tb-ruler]") as HTMLElement | null)?.offsetHeight ?? 0;
    // 재는 층이 안 보일 때(인쇄 화면 등)는 다시 나누지 않는다 — 높이가 0으로 재져 한 쪽에 몰린다
    if (ruler === 0 || (heights.length > 0 && heights.every((h) => h === 0))) return;
    const scale = ruler / (100 * MM);
    // 잘라 싣는 쪽은 꽉 채우므로 2mm 여유를 둔다
    const anySplit = blocks.some((b) => b.split);
    const inner = (PAGE_H_MM - PAD_Y_MM * 2 - FOOT_MM - (anySplit ? 2 : 0)) * MM * scale;
    const out: Piece[][] = [];
    let cur: Piece[] = [];
    let used = firstHead;
    const newPage = () => {
      out.push(cur);
      cur = [];
      used = restHead;
    };
    heights.forEach((h, i) => {
      const splittable = !!blocks[i]?.split;
      const cuts = splittable ? safeCuts(els[i]!) : [];
      let start = 0;
      for (let guard = 0; guard < 50; guard++) {
        const rest = h - start;
        const room = inner - used;
        if (rest <= room) {
          cur.push(start ? { i, from: start } : { i });
          used += rest;
          return;
        }
        // 줄 사이에서 잘라 이 쪽에 앞부분을 싣는다(두 줄 이상 들어갈 때만)
        const cut = cuts.filter((c) => c > start && c - start <= room && c < h - 4).pop();
        if (cut !== undefined && cut - start >= 12 * MM * scale) {
          cur.push({ i, from: start, to: cut });
          newPage();
          start = cut;
          continue;
        }
        if (cur.length > 0) {
          newPage();
          continue;
        }
        // 빈 쪽에도 안 들어가고 자를 곳도 없으면 그대로 싣는다
        cur.push(start ? { i, from: start } : { i });
        used += rest;
        return;
      }
    });
    if (cur.length || out.length === 0) out.push(cur);
    setPages((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
    // blocks 는 열쇠(blockKeys)로 본다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockKeys, measureKey, mounted, fontTick]);
  if (!mounted) return null;
  return (
    <>
      <div ref={measureRef} className="tb-measure" aria-hidden>
        <div data-tb-ruler="" style={{ height: "100mm", width: 0, position: "absolute" }} />
        <div className="tb-sheet tb-part">
          <div data-tb-head="0">{head(0)}</div>
          <div data-tb-head="1">{head(1)}</div>
          {blocks.map((b) => (
            <div key={b.key} data-tb-block="" style={{ display: "flow-root" }}>
              {b.node}
            </div>
          ))}
        </div>
      </div>
      {(pages ?? []).map((idx, p, all) => (
        <div key={p} className="tb-sheet tb-part">
          {head(p)}
          {idx.map(({ i, from, to }) => {
            const b = blocks[i];
            if (!b) return null;
            if (!b.split) return <Fragment key={b.key}>{b.node}</Fragment>;
            // 잴 때와 같은 감싸기(flow-root)로 그려야 높이가 잰 값과 같다
            // 잘린 덩어리: 같은 덩어리를 그리고 보이는 칸만 남긴다
            return (
              <div key={`${b.key}@${from ?? 0}`} style={{ overflow: "hidden", height: to !== undefined ? `${to - (from ?? 0)}px` : undefined }}>
                <div style={{ display: "flow-root", marginTop: from ? `${-from}px` : undefined }}>{b.node}</div>
              </div>
            );
          })}
          <BookFoot>{foot ? foot(p, all.length) : null}</BookFoot>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- 공용 조각

/** 학원 로고·이름(바닥줄). 교재 화면이 넣어 준다. */
export const TestBookBrand = createContext<{ logoSrc: string | null; academy: string }>({ logoSrc: null, academy: "" });
/**
 * 양면 인쇄에서 유형마다 새 종이로(선생님 2026-11-04 「한 번에 주면 해석 테스트지 지문 보고 빈칸 할 수도 있다」 — 중학교 테스트지·고등 테스트지 뽑기 공통):
 * 앞에 쌓인 쪽 수가 홀수면 빈 쪽을 하나 끼워, 다음 테스트가 늘 홀수 쪽(종이 앞면)에서 시작하게 한다.
 * 앞쪽 표지가 바뀌면 다시 센다(쪽 수는 그려진 뒤에야 안다).
 */
export function OddPageStart({ on }: { on: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [blank, setBlank] = useState(false);
  useEffect(() => {
    const root = document.getElementById("tb-print-root");
    if (!on || !root) {
      setBlank(false);
      return;
    }
    const check = () => {
      const me = ref.current;
      if (!me) return;
      const before = Array.from(root.querySelectorAll<HTMLElement>(".tb-sheet, .qg-print-page")).filter(
        (el) => !el.closest(".tb-measure, .qg-print-measure") && (el.compareDocumentPosition(me) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      ).length;
      const need = before % 2 === 1;
      setBlank((cur) => (cur === need ? cur : need));
    };
    check();
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(check);
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [on]);
  return (
    <>
      <span ref={ref} hidden />
      {blank ? (
        <div className="tb-sheet ms-blank-page">
          <p className="pt-[120mm] text-center text-xs text-slate-300 print:hidden">양면 인쇄용 빈 쪽</p>
        </div>
      ) : null}
    </>
  );
}

/** 시험지 「이름」 칸에 미리 찍을 학생 이름(작업대 왼쪽 칸에서 넣는다 — 선생님 2026-11-04) */
export const TestBookStudent = createContext<string>("");

/** 쪽 바닥줄 — 변형문제 인쇄물처럼 왼쪽에 로고·학원명, 오른쪽에 교재 전체 쪽 번호 */
function BookFoot({ children }: { children?: ReactNode }) {
  const brand = useContext(TestBookBrand);
  return (
    <div className="tb-foot">
      <span className="tb-brand">
        {brand.logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logoSrc} alt="" />
        ) : null}
        {/* 로고가 있으면 로고만(선생님 2026-10-27), 없으면 학원 이름 */}
        {!brand.logoSrc && brand.academy ? <span>{brand.academy}</span> : null}
      </span>
      <span className="tb-fmid">{children}</span>
      {/* 교재 전체 쪽 번호는 화면이 그린 뒤 적어 넣는다(PDF를 쪽마다 따로 찍어도 맞게) */}
      <span className="tb-pgno" />
    </div>
  );
}

function Seg({ seg }: { seg: TestSeg }) {
  if (typeof seg === "string") return <>{seg}</>;
  if ("u" in seg) {
    return (
      <span className="tb-u">
        {seg.n ? <b className="tb-pn">{seg.n}</b> : null}
        <u>{seg.u}</u>
      </span>
    );
  }
  if ("blank" in seg) {
    return (
      // 번호는 빈칸 안 왼쪽에 둔다 — 밖에 두면 번호만 줄 끝에 남았다(nowrap으로 감싸면 쪽 나누기 측정이 흐트러졌다)
      <span className="tb-blank" style={seg.n ? { textAlign: "left" } : undefined}>
        {seg.n ? <sup className="tb-sup">{seg.n}</sup> : null}
        {seg.blank}
      </span>
    );
  }
  return (
    <span className="tb-pick">
      {seg.n ? <b className="tb-pn">{seg.n}</b> : null}[ {seg.pick[0]} <i>/</i> {seg.pick[1]} ]
    </span>
  );
}

function Segs({ segs }: { segs: TestSeg[] }) {
  return (
    <>
      {segs.map((s, i) => (
        <Seg key={i} seg={s} />
      ))}
    </>
  );
}

/** name: 정답지 머리에 크게 찍는 학생 이름(누구 시험지인지 한눈에 — 선생님 2026-11-09) */
export function DocHead({ title, sub, label, right, name }: { title: string; sub?: string; label: string; right?: string; name?: string }) {
  return (
    <div className="tb-b">
      <div className="tb-dh">
        <h2>
          {title}
          {sub ? <small>{sub}</small> : null}
        </h2>
        {name ? (
          <div className="tb-dh-name">
            <small>{label}</small>
            <b>{name}</b>
          </div>
        ) : (
          <div className="tb-k">
            <b>{label}</b>
            {right}
          </div>
        )}
      </div>
    </div>
  );
}

function Who({ total }: { total?: number }) {
  const student = useContext(TestBookStudent);
  return (
    <div className="tb-b">
      <div className="tb-who">
        <span>
          이름{student ? <b className="tb-who-name">{student}</b> : null}
        </span>
        <span>날짜 &nbsp;&nbsp;&nbsp;월 &nbsp;&nbsp;&nbsp;일</span>
        <span>점수 {total ? <>&nbsp;&nbsp;&nbsp;&nbsp;/ {total}</> : null}</span>
      </div>
    </div>
  );
}

/** 파생어: 낱말 품사 뜻(뜻은 작게 — 선생님 2026-10-20) */
function FormList({ forms }: { forms: Array<{ word: string; pos: string; ko?: string }> }) {
  return (
    <>
      {forms.map((f, i) => (
        <span key={f.word} className="tb-form">
          {i > 0 ? ", " : ""}
          {f.word} <i>{f.pos}</i>
          {f.ko ? <small>{f.ko}</small> : null}
        </span>
      ))}
    </>
  );
}

function passageLabel(index: number, p: { title: string; source: string | null }): string {
  return `${String(index + 1).padStart(2, "0")} · ${p.title}`;
}

// ---------------------------------------------------------------- 학습 계획표·이수표

/** 이수표 칸 이름을 줄바꿈할 자리: 한글·영문 경계, 아니면 네 글자 이상은 가운데(「동반/의어」) */
function colLabel(c: string): string {
  const mixed = c.match(/^([가-힣]+)([A-Za-z/]+)$/);
  if (mixed) return `${mixed[1]}\u200b${mixed[2]}`;
  if (c.length >= 4 && /^[가-힣]+$/.test(c)) return `${c.slice(0, Math.ceil(c.length / 2))}\u200b${c.slice(Math.ceil(c.length / 2))}`;
  return c;
}

export const TYPE_SHORT: Record<TestBookTypeKey, string> = {
  line: "해석",
  gist: "제목요지",
  vocabFix: "어휘수정",
  sentenceOrder: "문장순서",
  wordOrder: "어순영작",
  blank: "빈칸",
  grammar: "어법",
  vocab: "어휘",
  order: "어순",
  tf: "T/F",
  writing: "영작",
  link: "연결어",
  sequence: "순서",
  insert: "삽입",
  summary: "요약",
  grammarFix: "어법수정",
  words: "단어",
  reference: "지칭",
  implication: "함축",
  paraphrase: "바꿔말",
  flow: "도식",
};

/**
 * 계획표의 「해 올 것」과 이수표 칸은 교재에 넣기로 고른 묶음·테스트 유형을 그대로 따른다
 * (선생님 2026-10-20: 고른 테스트 종류대로 자동으로).
 */
export const PlanSheets = memo(function PlanSheets({
  projects,
  options,
  measureKey,
  columns,
  extraTodo = [],
}: {
  projects: TestBookProjectInput[];
  options: TestBookOptions;
  measureKey: string;
  /** 이수표 칸(주면 이것을 쓴다 — 최종통합자료는 고른 워크북 유형으로 만든다) */
  columns?: string[];
  /** 「해 올 것」에 더할 것(워크북 등) */
  extraTodo?: string[];
}) {
  const tests = options.tests;
  const cols = columns ?? [
    ...(tests && options.wordTest ? ["단어TEST"] : []),
    ...(tests ? options.types.map((t) => TYPE_SHORT[t]) : []),
  ];
  const todo = [
    ...(options.lesson ? ["단어", "해석"] : []),
    ...(tests && options.types.length ? ["견본 풀기"] : []),
    ...(options.blankNote ? ["백지노트"] : []),
    ...(options.analysis ? ["분석 자료"] : []),
    ...extraTodo,
  ];
  const checkGrid = `24mm repeat(${cols.length}, minmax(0,1fr)) 12mm 15mm`;
  const allWordTestOn = tests && options.allWordTest;
  const checkOn = cols.length > 0 || allWordTestOn;
  const blocks: Block[] = [
    {
      key: "fields",
      node: (
        <div className="tb-b">
          <div className="tb-fields">
            <span>이름</span>
            <span>반</span>
            <span>기간 &nbsp;&nbsp;&nbsp;월 &nbsp;&nbsp;&nbsp;일 ~ &nbsp;&nbsp;&nbsp;월 &nbsp;&nbsp;&nbsp;일</span>
            <span>담당</span>
          </div>
        </div>
      ),
    },
    {
      key: "plan-h",
      node: (
        <div>
          <div className="tb-sub">
            수업 계획 <small>날짜를 적고, 해 온 것에 ✓ · 테스트 날짜에 통과하면 확인 칸에 서명</small>
          </div>
          <div className="tb-row tb-th tb-prow">
            <div>차시</div>
            <div>수업 날짜</div>
            <div>공부해 올 지문</div>
            <div>해 올 것</div>
            <div>테스트 날짜</div>
            <div>확인</div>
          </div>
        </div>
      ),
    },
    ...projects.map((p, i) => ({
      key: `plan-${p.id}`,
      node: (
        <div className="tb-row tb-prow">
          <div>{i + 1}</div>
          <div className="tb-date">&nbsp;&nbsp;월 &nbsp;&nbsp;&nbsp;일 (&nbsp;&nbsp;&nbsp;)</div>
          <div className="tb-psrc">
            {p.source?.trim() ? <b>{p.source}</b> : null}
            <span>{p.title}</span>
          </div>
          <div>
            <span className="tb-todo">
              {todo.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </span>
          </div>
          <div className="tb-date">&nbsp;&nbsp;월 &nbsp;&nbsp;&nbsp;일</div>
          <div />
        </div>
      ),
    })),
    ...(checkOn
      ? [
          {
            key: "check-h",
            node: (
              <div style={{ paddingTop: "3mm" }}>
                <div className="tb-sub">
                  테스트 이수 <small>칸에 점수를 쓰고, 다 통과하면 결과에 ○ · 다시 보면 「재」</small>
                </div>
                {allWordTestOn ? (
                  <div className="tb-fields" style={{ marginBottom: "2mm" }}>
                    <span>전체 단어 TEST &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;/</span>
                    <span>결과</span>
                    <span>날짜 &nbsp;&nbsp;&nbsp;월 &nbsp;&nbsp;&nbsp;일</span>
                    <span>선생님</span>
                  </div>
                ) : null}
                {cols.length ? (
                  <div className="tb-row tb-th tb-crow" style={{ gridTemplateColumns: checkGrid }}>
                    <div>지문</div>
                    {cols.map((c) => (
                      <div key={c}>{colLabel(c)}</div>
                    ))}
                    <div>결과</div>
                    <div>선생님</div>
                  </div>
                ) : null}
              </div>
            ),
          },
          ...(cols.length
            ? projects.map((p, i) => ({
                key: `check-${p.id}`,
                node: (
                  <div className="tb-row tb-crow" style={{ gridTemplateColumns: checkGrid }}>
                    <div>{String(i + 1).padStart(2, "0")}</div>
                    {cols.map((c) => (
                      <div key={c}>/</div>
                    ))}
                    <div />
                    <div />
                  </div>
                ),
              }))
            : []),
        ]
      : []),
    ...(checkOn
      ? [
          {
            key: "re-h",
            node: (
              <div style={{ paddingTop: "3mm" }}>
                <div className="tb-sub">
                  재시험 <small>통과하지 못한 것만 · 날짜를 적고 다시 본다</small>
                </div>
                <div className="tb-row tb-th tb-rrow">
                  <div>지문</div>
                  <div>유형</div>
                  <div>날짜</div>
                  <div>점수</div>
                  <div>선생님 서명</div>
                  <div>학생 서명</div>
                </div>
              </div>
            ),
          },
          ...[0, 1, 2, 3, 4].map((n) => ({
            key: `re-${n}`,
            node: (
              <div className="tb-row tb-rrow">
                <div />
                <div />
                <div className="tb-date">&nbsp;&nbsp;월 &nbsp;&nbsp;&nbsp;일</div>
                <div />
                <div />
                <div />
              </div>
            ),
          })),
        ]
      : []),
    {
      key: "sign",
      node: (
        <div className="tb-sign">
          <span>마지막 확인 &nbsp;&nbsp;&nbsp;월 &nbsp;&nbsp;&nbsp;일</span>
          <span>선생님</span>
          <span>학생</span>
          <span>학부모</span>
        </div>
      ),
    },
  ];
  return (
    <PagedSheet
      blocks={blocks}
      measureKey={measureKey}
      head={(page) => <DocHead title="학습 계획표 · 이수표" sub={page > 0 ? "(이어서)" : undefined} label="PLAN & CHECK" />}
    />
  );
});

// ---------------------------------------------------------------- 단어 정리

export const VocabSheets = memo(function VocabSheets({
  index,
  project,
  measureKey,
}: {
  index: number;
  project: TestBookProjectInput;
  measureKey: string;
}) {
  const rows = project.material?.vocab ?? [];
  const head = (
    <div className="tb-row tb-th tb-vrow">
      <div />
      <div>단어</div>
      <div />
      <div>지문 속 뜻</div>
      <div>= 동의어</div>
      <div>↔ 반의어</div>
      <div>파생어 · 어구</div>
    </div>
  );
  const blocks: Block[] = [
    {
      key: "tip",
      node: (
        <div className="tb-b">
          <div className="tb-tip">
            <span className="tb-star">★</span> 핵심어 · 동의어·반의어는 바꿔 쓰기로 나올 만한 단어에만 붙였습니다.
          </div>
        </div>
      ),
    },
    ...rows.map((r, i) => ({
      key: `v${i}`,
      node: (
        <div className="tb-row tb-vrow">
          <div className="tb-n">{i + 1}</div>
          <div className="tb-w tb-en">
            {r.key ? <span className="tb-star">★ </span> : null}
            {r.word}
          </div>
          <div className="tb-pos">{r.pos}</div>
          <div>{r.meaning}</div>
          <div className={r.synonyms.length ? "tb-en" : "tb-nil"}>{r.synonyms.join(", ") || "—"}</div>
          <div className={r.antonyms.length ? "tb-en" : "tb-nil"}>{r.antonyms.join(", ") || "—"}</div>
          <div className="tb-en">
            <FormList forms={r.forms} />
            {r.forms.length && r.phrase ? <br /> : null}
            {r.phrase}
          </div>
        </div>
      ),
    })),
  ];
  return (
    <PagedSheet
      blocks={blocks}
      measureKey={measureKey}
      head={(page) => (
        <>
          <DocHead title="단어 정리" sub={page > 0 ? "(이어서)" : undefined} label={passageLabel(index, project)} right={project.source?.trim() || "VOCABULARY"} />
          {head}
        </>
      )}
    />
  );
});

// ---------------------------------------------------------------- 전체 단어장

/*
 * 선생님 요청(2026-10-19): 지문별 단어 정리와 별도로, 계획표 다음에 모든 지문 단어를 한데 모아
 * 전체 시험을 보기 편하게. 같은 낱말이 여러 지문에 나오면 처음 지문에만 싣는다.
 */
type AllRow = { no: number; passage: number; row: NonNullable<TestBookProjectInput["material"]>["vocab"][number] };

export function allVocabRows(projects: TestBookProjectInput[], indexOf: (id: string) => number): AllRow[] {
  const seen = new Set<string>();
  const out: AllRow[] = [];
  for (const p of projects) {
    for (const row of p.material?.vocab ?? []) {
      const k = row.word.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      // 단어 탭 단어장은 단어장 인쇄 번호 그대로(빠진 단어가 있어도 번호를 당기지 않는다)
      out.push({ no: row.listNo ?? out.length + 1, passage: indexOf(p.id) + 1, row });
    }
  }
  return out;
}

const ALL_GRID = "9mm 8mm 29mm 8mm 33mm 1fr 1fr 1fr";

export const AllVocabSheets = memo(function AllVocabSheets({
  projects,
  indexOf,
  measureKey,
  range = null,
  noPassage = false,
  title = "전체 단어장",
}: {
  projects: TestBookProjectInput[];
  indexOf: (id: string) => number;
  measureKey: string;
  /** 쪽 제목(선생님이 넣은 이름) */
  title?: string;
  /** 번호 범위만 싣는다(단어 시험지 화면의 출제 범위) — 번호는 전체 차례 그대로 */
  range?: { from: number; to: number } | null;
  /** 지문 번호 칸을 뺀다(자료함 「단어」 탭 단어장은 지문 정보가 없다) */
  noPassage?: boolean;
}) {
  const allRows = allVocabRows(projects, indexOf);
  // 단어 탭 단어장은 지문이 없고, 옛 단어장은 파생어도 없다 — 없는 칸을 빼고 뜻 칸을 넓힌다
  const showForms = !noPassage || allRows.some((r) => r.row.forms.length);
  const grid = !noPassage ? ALL_GRID : showForms ? "9mm 0 31mm 8mm 37mm 1fr 1fr 1fr" : "9mm 0 32mm 8mm 46mm 1fr 1fr 0";
  const rows = range ? allRows.filter((r) => r.no >= range.from && r.no <= range.to) : allRows;
  const head = (
    <div className="tb-row tb-th tb-vrow" style={{ gridTemplateColumns: grid }}>
      <div />
      <div>{noPassage ? null : "지문"}</div>
      <div>단어</div>
      <div />
      <div>{noPassage ? "뜻" : "지문 속 뜻"}</div>
      <div>= 동의어</div>
      <div>↔ 반의어</div>
      <div>{showForms ? "파생어" : null}</div>
    </div>
  );
  // 지문이 둘 이상이면 지문이 바뀔 때마다 「01 · 출처 · 제목」 줄(선생님 2026-11-11 「전체 단어장도 지문마다 구분」)
  const byPassage = new Map(projects.map((p) => [indexOf(p.id) + 1, p] as const));
  const split = byPassage.size > 1;
  const blocks: Block[] = rows.flatMap((r, i) => {
    const out: Block[] = [];
    if (split && (i === 0 || rows[i - 1]!.passage !== r.passage)) {
      const p = byPassage.get(r.passage);
      out.push({
        key: `allp${r.passage}-${r.no}`,
        node: (
          <div style={{ display: "flex", gap: "2mm", alignItems: "baseline", margin: i === 0 ? "1mm 0 0.8mm" : "3mm 0 0.8mm", padding: "0.8mm 2mm", background: "#eef0f6", borderLeft: "1.2mm solid var(--tb-accent,#15171c)", fontSize: "9pt", fontWeight: 700 }}>
            <span>{String(r.passage).padStart(2, "0")}</span>
            {p?.source?.trim() ? <span style={{ color: "#4b515c" }}>{p.source.trim()}</span> : null}
            <span>{p?.title?.trim() || "지문"}</span>
          </div>
        ),
      });
    }
    out.push(row(r));
    return out;
  });
  function row(r: AllRow): Block {
    return {
    key: `all${r.no}`,
    node: (
      <div className="tb-row tb-vrow" style={{ gridTemplateColumns: grid }}>
        <div className="tb-n">{r.no}</div>
        <div className="tb-n">{noPassage ? null : String(r.passage).padStart(2, "0")}</div>
        <div className="tb-w tb-en">
          {r.row.key ? <span className="tb-star">★ </span> : null}
          {r.row.word}
        </div>
        <div className="tb-pos">{r.row.pos}</div>
        <div>{r.row.meaning}</div>
        <div className={r.row.synonyms.length ? "tb-en" : "tb-nil"}>{r.row.synonyms.join(", ") || "—"}</div>
        <div className={r.row.antonyms.length ? "tb-en" : "tb-nil"}>{r.row.antonyms.join(", ") || "—"}</div>
        {showForms ? <div className={r.row.forms.length ? "tb-en" : "tb-nil"}>{r.row.forms.length ? <FormList forms={r.row.forms} /> : "—"}</div> : <div />}
      </div>
    ),
    };
  }
  return (
    <PagedSheet
      blocks={blocks}
      measureKey={measureKey}
      head={(page) => (
        <>
          <DocHead
            title={title}
            sub={page > 0 ? "(이어서)" : range && rows.length < allRows.length ? `${range.from}~${range.to}번 · ${rows.length}단어` : noPassage ? `${rows.length}단어` : `지문 ${projects.length}개 · ${rows.length}단어`}
            label="ALL WORDS"
            right={noPassage ? "VOCABULARY" : "지문 번호는 계획표 차례"}
          />
          {head}
        </>
      )}
    />
  );
});

/** 전체 단어 TEST: 뜻 쓰기(모든 단어, 두 단) */
export const AllWordTestSheets = memo(function AllWordTestSheets({
  projects,
  indexOf,
  measureKey,
}: {
  projects: TestBookProjectInput[];
  indexOf: (id: string) => number;
  measureKey: string;
}) {
  const rows = allVocabRows(projects, indexOf);
  const pairs: AllRow[][] = [];
  for (let i = 0; i < rows.length; i += 2) pairs.push(rows.slice(i, i + 2));
  const blocks: Block[] = [
    { key: "who", node: <Who total={rows.length} /> },
    ...pairs.map((pair, i) => ({
      key: `p${i}`,
      node: (
        <div className="tb-words">
          {pair.map((r) => (
            <div key={r.no} className="tb-wq">
              <span className="tb-i">{r.no}</span>
              <span className="tb-en">{r.row.word}</span>
            </div>
          ))}
        </div>
      ),
    })),
  ];
  return (
    <PagedSheet
      blocks={blocks}
      measureKey={measureKey}
      head={(page) => <DocHead title="전체 단어 TEST" sub={page > 0 ? "(이어서)" : "지문 속 뜻 쓰기"} label="ALL WORDS TEST" />}
    />
  );
});

export const AllWordAnswerSheets = memo(function AllWordAnswerSheets({
  projects,
  indexOf,
  measureKey,
}: {
  projects: TestBookProjectInput[];
  indexOf: (id: string) => number;
  measureKey: string;
}) {
  const student = useContext(TestBookStudent);
  const rows = allVocabRows(projects, indexOf);
  const chunks: AllRow[][] = [];
  for (let i = 0; i < rows.length; i += 6) chunks.push(rows.slice(i, i + 6));
  const blocks: Block[] = chunks.map((c, i) => ({
    key: `wa${i}`,
    node: (
      <dl className="tb-arow tb-arow-v">
        <dt>{i === 0 ? "전체 단어" : ""}</dt>
        <dd>
          {c.map((r) => (
            <span key={r.no}>
              <b>{r.no}</b>
              {r.row.meaning}
            </span>
          ))}
        </dd>
      </dl>
    ),
  }));
  return (
    <PagedSheet
      blocks={blocks}
      measureKey={measureKey}
      head={(page) => <DocHead title="정답 · 전체 단어 TEST" sub={page > 0 ? "(이어서)" : undefined} label="ANSWERS" right="정답만 싣습니다" name={student || undefined} />}
    />
  );
});

// ---------------------------------------------------------------- 동반의어·품사 테스트

export function wordTestTotal(t: WordTest): number {
  return t.meaning.length + t.synonym.length + t.forms.length;
}

export const WordTestSheets = memo(function WordTestSheets({
  index,
  project,
  test,
  measureKey,
}: {
  index: number;
  project: TestBookProjectInput;
  test: WordTest;
  measureKey: string;
}) {
  const blocks: Block[] = [{ key: "who", node: <Who total={wordTestTotal(test)} /> }];
  if (test.meaning.length) {
    blocks.push({
      key: "A",
      node: (
        <div className="tb-b">
          <div className="tb-q">
            <span className="tb-qn">A</span>지문 속 뜻 쓰기 <small>{test.meaning.length}문항</small>
          </div>
          <div className="tb-words">
            {test.meaning.map((m) => (
              <div key={m.no} className="tb-wq">
                <span className="tb-i">{m.no}</span>
                <span className="tb-en">{m.word}</span>
              </div>
            ))}
          </div>
        </div>
      ),
    });
  }
  if (test.synonym.length) {
    blocks.push({
      key: "B",
      node: (
        <div className="tb-q">
          <span className="tb-qn">B</span>동의어 · 반의어 고르기 <small>= 같은 뜻 · ↔ 반대 뜻</small>
        </div>
      ),
    });
    test.synonym.forEach((s) =>
      blocks.push({
        key: `B${s.no}`,
        node: (
          <div className="tb-mc">
            <span className="tb-tip">{s.no}</span>
            <div>
              <b className="tb-en">{s.word}</b>
              <span className="tb-rel">{s.rel}</span>
              <div className="tb-ch tb-en">
                {s.choices.map((c, j) => (
                  <span key={j}>
                    {circled(j)} {c}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ),
      })
    );
  }
  if (test.forms.length) {
    blocks.push({
      key: "C",
      node: (
        <div className="tb-b">
          <div className="tb-q">
            <span className="tb-qn">C</span>품사 바꾸기 <small>주어진 품사로 바꿔 쓰기</small>
          </div>
          <div className="tb-words">
            {test.forms.map((f) => (
              <div key={f.no} className="tb-wq">
                <span className="tb-i">{f.no}</span>
                <span>
                  <span className="tb-en">{f.word}</span> ({f.pos}) → {POS_NAME[f.toPos] ?? f.toPos}
                </span>
              </div>
            ))}
          </div>
        </div>
      ),
    });
  }
  return (
    <PagedSheet
      blocks={blocks}
      measureKey={measureKey}
      head={(page) => (
        <DocHead title="동반의어 TEST" sub={page > 0 ? "(이어서)" : undefined} label={passageLabel(index, project)} right={project.source?.trim() || "WORD TEST"} />
      )}
    />
  );
});

// ---------------------------------------------------------------- 수업용 자료

export const LessonSheets = memo(function LessonSheets({
  index,
  project,
  translation,
  measureKey,
  lead,
}: {
  index: number;
  project: TestBookProjectInput;
  translation: TestBookOptions["translation"];
  measureKey: string;
  /** 첫 쪽 머리글 오른쪽에 놓는 것(중학교 강의 QR) — 그 자리의 글은 제목 옆으로 옮긴다 */
  lead?: ReactNode;
}) {
  const sentenceBlocks: Block[] = project.sentences.map((s, i) => ({
    key: `s${i}`,
    node: (
      <div className="tb-ss">
        <span className="tb-i">{String(i + 1).padStart(2, "0")}</span>
        <div>
          <div className="tb-en">{s.english}</div>
          {translation === "show" ? (
            <div className="tb-ko">{s.korean}</div>
          ) : translation === "hide" ? (
            <>
              <div className="tb-line" />
              {s.english.split(/\s+/).length > 22 ? <div className="tb-line" /> : null}
            </>
          ) : null}
        </div>
      </div>
    ),
  }));
  const blocks: Block[] = sentenceBlocks;
  /*
   * 지문 삽화(4컷)는 본문 뒤에 싣는다. 10-21에 수업용 자료를 이 모양으로 바꾸면서 빠졌다(선생님 2026-10-26).
   * 정사각 그림이라 높이를 정해 두어 쪽 나누기가 그림이 늦게 떠도 어긋나지 않게 한다.
   */
  if (project.illustrationUrl) {
    blocks.push({
      key: "illust",
      node: (
        <div style={{ marginTop: "4mm", textAlign: "center" }}>
          <div className="tb-tip" style={{ textAlign: "left", marginBottom: "1.5mm" }}>
            삽화로 보는 지문 흐름
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={project.illustrationUrl}
            alt="지문 4컷 삽화"
            style={{ width: "100mm", height: "100mm", objectFit: "contain", display: "inline-block" }}
          />
        </div>
      ),
    });
  }
  const sub = translation === "show" ? "해석 있음" : translation === "hide" ? "해석 쓰기" : "해석은 뒤쪽에";
  return (
    <PagedSheet
      blocks={blocks}
      measureKey={measureKey}
      head={(page) =>
        page === 0 && lead ? (
          <>
            <DocHead title="수업용 자료 · 문장별 해석" sub={`${passageLabel(index, project)} · ${sub}`} label="" />
            {lead}
          </>
        ) : (
          <DocHead title="수업용 자료 · 문장별 해석" sub={page > 0 ? "(이어서)" : sub} label={passageLabel(index, project)} right={project.source?.trim() || "수업용 자료"} />
        )
      }
    />
  );
});

/** 해석을 뒤쪽에 모을 때: 지문마다 해석만 */
export const TranslationBackSheets = memo(function TranslationBackSheets({ projects, measureKey }: { projects: TestBookProjectInput[]; measureKey: string }) {
  const blocks: Block[] = projects.flatMap((p, pi) => [
    {
      key: `h${p.id}`,
      node: (
        <div className="tb-q" style={{ marginTop: "1mm" }}>
          <span className="tb-qn">{String(pi + 1).padStart(2, "0")}</span>
          {p.title}
        </div>
      ),
    },
    ...p.sentences.map((s, i) => ({
      key: `${p.id}-${i}`,
      node: (
        <div className="tb-ss">
          <span className="tb-i">{String(i + 1).padStart(2, "0")}</span>
          <div className="tb-ko" style={{ fontSize: "9.5pt", marginTop: 0 }}>
            {s.korean}
          </div>
        </div>
      ),
    })),
  ]);
  return <PagedSheet blocks={blocks} measureKey={measureKey} head={() => <DocHead title="해석" label="TRANSLATION" />} />;
});

// ---------------------------------------------------------------- 테스트지

function ItemNode({ item }: { item: TestItem }) {
  if (item.tf) {
    return (
      <>
        <div className="tb-tf">
          <span className="tb-tip">{item.no}</span>
          <span className="tb-en">
            <Segs segs={item.text} />
          </span>
          <span className="tb-tfbox">T · F</span>
        </div>
        {/* 난이도 UP: F면 바르게 고쳐 쓰는 줄 */}
        {Array.from({ length: item.lines ?? 0 }).map((_, i) => (
          <div key={i} className="tb-line" style={{ marginLeft: "7mm" }} />
        ))}
      </>
    );
  }
  return (
    <div className="tb-it">
      <span className="tb-i">{item.no}</span>
      <div>
        {item.tag ? <div className="tb-tag">{item.tag}</div> : null}
        {item.ko && (item.chunks || !item.text.length) ? <div className="tb-ko" style={{ marginTop: 0 }}>{item.ko}</div> : null}
        {item.hint ? <div className="tb-tip">조건: {item.hint}</div> : null}
        {item.gloss ? (
          <div className="tb-gloss">
            {item.gloss.map((c, i) => (
              <span key={i}>
                <b className="tb-en">{c}</b>
                <i />
              </span>
            ))}
          </div>
        ) : null}
        {item.chunks ? (
          <div className="tb-chunks tb-en">
            {item.chunks.map((c, i) => (
              <span key={i}>{c}</span>
            ))}
          </div>
        ) : null}
        {item.text.length ? (
          <div className="tb-txt tb-en">
            <Segs segs={item.text} />
          </div>
        ) : null}
        {item.ko && !item.chunks && item.text.length ? <div className="tb-ko">{item.ko}</div> : null}
        {item.lead ? (
          <div className="tb-txt tb-en">
            <span className="tb-lead">{item.lead}</span> <span className="tb-blank" style={{ minWidth: "120mm" }} />
          </div>
        ) : null}
        {Array.from({ length: item.lines ?? 0 }).map((_, i) => (
          <div key={i} className="tb-line" />
        ))}
      </div>
    </div>
  );
}

/** 문항 하나하나를 덩어리로(발문은 첫 문항과 함께 둔다) */
function sectionBlocks(sec: TestSection, n: number, prefix: string): Block[] {
  // 제목이 비면(워크북 쪽 안 — 쪽 제목은 워크북이 단다) 안내만 한 줄로
  const title = sec.title ? (
    <div className="tb-q">
      <span className="tb-qn">{n}</span>
      {sec.title}
      {sec.hint ? <small>{sec.hint}</small> : null}
    </div>
  ) : sec.hint ? (
    <p className="tb-tip" style={{ margin: "0 0 1.4mm" }}>
      {sec.hint}
    </p>
  ) : null;
  const top = (
    <>
      {title}
      {sec.box ? (
        <div className="tb-box tb-en">
          {sec.box.map((b, i) => (
            <span key={`${i}-${b}`}>{b}</span>
          ))}
        </div>
      ) : null}
      {sec.given ? <div className="tb-given tb-en">{sec.given}</div> : null}
      {sec.passage ? (
        <p className="tb-psg tb-en">
          <Segs segs={sec.passage} />
        </p>
      ) : null}
      {sec.diagram ? (
        <>
          <div className="tb-flow">
            {sec.diagram.steps.map((st, i) => (
              <Fragment key={i}>
                {i > 0 ? <i>▼</i> : null}
                <div>
                  <b>{st}</b>
                  <span />
                </div>
              </Fragment>
            ))}
          </div>
          <div className="tb-flowbox">
            {sec.diagram.choices.map((c) => (
              <div key={c}>{c}</div>
            ))}
          </div>
        </>
      ) : null}
      {sec.passageKo ? (
        <>
          <div className="tb-kol">[해석]</div>
          <p className="tb-psg tb-ko">{sec.passageKo}</p>
        </>
      ) : null}
    </>
  );
  if (sec.inline) return [{ key: `${prefix}-${n}-${sec.type}`, node: <div className="tb-b">{top}</div> }];
  if (sec.type === "words") {
    return [
      {
        key: `${prefix}-${n}-${sec.type}`,
        node: (
          <div className="tb-b">
            {top}
            <div className="tb-words">
              {sec.items.map((it) => (
                <div key={it.no} className="tb-wq">
                  <span className="tb-i">{it.no}</span>
                  <span>
                    <Segs segs={it.text} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        ),
      },
    ];
  }
  if (!sec.items.length || sec.type === "sequence" || sec.type === "sentenceOrder") {
    return [
      {
        key: `${prefix}-${n}-${sec.type}`,
        node: (
          <div className="tb-b">
            {top}
            {sec.items.map((it) => (
              <div key={it.no} className="tb-it">
                <span className="tb-i" style={{ fontWeight: 700, color: "#15171c" }}>
                  {it.no}
                </span>
                <div className="tb-txt tb-en">
                  <Segs segs={it.text} />
                </div>
              </div>
            ))}
            {sec.type === "sequence" || sec.type === "insert" || sec.type === "sentenceOrder" ? (
              <div className="tb-txt">
                정답 <span className="tb-blank" style={{ minWidth: "50mm" }} />
              </div>
            ) : null}
          </div>
        ),
      },
    ];
  }
  return sec.items.map((it, i) => ({
    key: `${prefix}-${n}-${sec.type}-${i}`,
    node: (
      <div className={i === sec.items.length - 1 ? "tb-b" : undefined}>
        {i === 0 ? top : null}
        <ItemNode item={it} />
      </div>
    ),
  }));
}

export function sheetTotal(sheet: TestSheet): number {
  return sheet.sections.reduce((n, s) => n + (s.items.length && s.type !== "sequence" && s.type !== "sentenceOrder" ? s.items.length : 1), 0);
}

export const TestSheets = memo(function TestSheets({
  index,
  project,
  sheet,
  title,
  measureKey,
}: {
  index: number;
  project: TestBookProjectInput;
  sheet: TestSheet;
  /** 「테스트 견본」·「테스트」 */
  title: string;
  measureKey: string;
}) {
  const blocks: Block[] = [
    { key: "who", node: <Who total={sheetTotal(sheet)} /> },
    ...sheet.sections.flatMap((sec, i) => sectionBlocks(sec, i + 1, project.id)),
  ];
  return (
    <PagedSheet
      blocks={blocks}
      measureKey={measureKey}
      head={(page) => (
        // 뽑기에서도 지문 제목·출처가 늘 보이게(선생님 2026-10-20): 큰 제목이 지문, 오른쪽 위가 출처
        <DocHead
          title={passageLabel(index, project)}
          sub={page > 0 ? `${title} (이어서)` : title}
          label={project.source?.trim() || title}
          right={project.titleEn?.trim() || undefined}
        />
      )}
      foot={(page, total) => (
        <>
          <span>{project.title}</span>
          <span>
            {page + 1} / {total}
          </span>
        </>
      )}
    />
  );
});

/**
 * 뽑은 테스트지를 지문마다 새 쪽으로 나누지 않고 쭉 이어 싣는다(선생님 2026-11-06 「페이지 분할이 심해 종이 낭비 —
 * 정답지만 홀수 쪽, 나머지는 쫙 이어지게」). 지문이 바뀌는 곳에 지문 제목 줄을 넣고, 문항 번호는 지문마다 1부터(정답지와 같다).
 */
export const FlowTestSheets = memo(function FlowTestSheets({
  entries,
  title,
  measureKey,
}: {
  entries: Array<{ index: number; project: TestBookProjectInput; sheet: TestSheet }>;
  title: string;
  measureKey: string;
}) {
  const total = entries.reduce((n, e) => n + sheetTotal(e.sheet), 0);
  const sources = [...new Set(entries.map((e) => e.project.source?.trim()).filter(Boolean))];
  const blocks: Block[] = [
    { key: "who", node: <Who total={total} /> },
    ...entries.flatMap((e, k) => {
      const rows = e.sheet.sections.flatMap((sec, i) => sectionBlocks(sec, i + 1, `f${k}-${e.project.id}`));
      if (!rows.length) return [];
      const head = (
        <div className="tb-flow-psg">
          <b>{passageLabel(e.index, e.project)}</b>
          {e.project.source?.trim() ? <span>{e.project.source.trim()}</span> : null}
        </div>
      );
      // 지문 제목 줄이 쪽 끝에 홀로 남지 않게 첫 덩어리와 붙인다
      return rows.map((r, j) => ({ ...(j === 0 ? { key: r.key, node: <>{head}{r.node}</> } : r), split: true }));
    }),
  ];
  return (
    <PagedSheet
      blocks={blocks}
      measureKey={measureKey}
      head={(page) => <DocHead title={title} sub={page > 0 ? "(이어서)" : undefined} label={sources.length === 1 ? sources[0]! : title} />}
      foot={(page, n) => (
        <>
          <span>{title}</span>
          <span>
            {page + 1} / {n}
          </span>
        </>
      )}
    />
  );
});

// ---------------------------------------------------------------- 백지노트

/** 4단 정리 칸(도식화 느낌 — 선생님 2026-10-27). 칸마다 이 단계에 해당하는 문장 번호를 적는다. */
const FOUR_STEPS: Array<{ no: string; title: string; hint: string }> = [
  { no: "1", title: "도입", hint: "소재 · 배경" },
  { no: "2", title: "전개", hint: "문제 · 주장" },
  { no: "3", title: "근거", hint: "예시 · 이유" },
  { no: "4", title: "결론", hint: "요지 · 교훈" },
];

/** 쓰기 줄: 칸을 넘치는 만큼 그려 두고 칸 밖은 잘린다(overflow hidden). cols=세로선 자리(mm). */
function RuleLines({ step, count, cols }: { step: number; count: number; cols?: number[] }) {
  return (
    <div className="tb-rl" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <i key={i} style={{ height: `${step}mm` }} />
      ))}
      {cols?.map((x) => <b key={x} style={{ left: `${x}mm` }} />)}
    </div>
  );
}

function FourStep({ s }: { s: (typeof FOUR_STEPS)[number] }) {
  return (
    <div className="tb-bn-step">
      <div>
        <b>
          {s.no}. {s.title}
        </b>
        <small>{s.hint}</small>
      </div>
      <div>
        <RuleLines step={6.4} count={12} />
        <em>문장 ____ ~ ____</em>
      </div>
    </div>
  );
}

/**
 * 백지노트(지문마다 2쪽). 원문 문장마다 번호를 달고 아래 「문장별 정리」에 같은 번호 칸을 둔다(선생님 2026-10-27).
 * 둘째 쪽은 4단 정리(도입 → 전개 → 근거 → 결론, 세로 흐름 — 시안 A안) → 동반의어 → 틀린 것 다시 쓰기.
 */
export const BlankNoteSheets = memo(function BlankNoteSheets({ index, project }: { index: number; project: TestBookProjectInput }) {
  const label = passageLabel(index, project);
  const sentences = project.sentences.map((s) => s.english.trim()).filter(Boolean);
  return (
    <>
      <div className="tb-sheet tb-part">
        <div className="tb-note">
          <DocHead title="백지노트" sub="1/2" label={label} right={project.source?.trim() || "BLANK NOTE"} />
          <div className="tb-psgbox tb-bn-psg">
            <div className="tb-lb">
              <span>원문</span>
              <span>표시·메모하며 읽기</span>
            </div>
            <p className="tb-en">
              {sentences.map((en, i) => (
                <Fragment key={i}>
                  <sup>{circled(i)}</sup>
                  {en}{" "}
                </Fragment>
              ))}
            </p>
          </div>
          <div className="tb-fill">
            <div className="tb-lb">
              <b>문장별 정리</b>
              <span>해석 · 구문 · 핵심어를 문장 번호에 맞춰</span>
            </div>
            <div className="tb-bn-rows">
              {sentences.map((_, i) => (
                <div key={i}>
                  <RuleLines step={7} count={8} />
                  <b>{circled(i)}</b>
                  <span />
                </div>
              ))}
            </div>
          </div>
        </div>
        <BookFoot />
      </div>
      <div className="tb-sheet tb-part">
        <div className="tb-note">
          <DocHead title="백지노트" sub="2/2" label={label} right={project.source?.trim() || "BLANK NOTE"} />
          <div className="tb-lb">
            <b>4단 정리</b>
            <span>글의 흐름을 네 단계로 · 단계마다 문장 번호</span>
          </div>
          <div className="tb-bn-four" style={{ borderTop: "1pt solid #15171c", paddingTop: "1.6mm" }}>
              {FOUR_STEPS.map((s, i) => (
                <Fragment key={s.no}>
                  {i ? <div className="tb-bn-arrow">▼</div> : null}
                  <FourStep s={s} />
                </Fragment>
              ))}
          </div>
          <div className="tb-fill">
            <div className="tb-lb">
              <b>동반의어 정리</b>
              <span>단어 · 뜻 · 동의어 = · 반의어 ↔</span>
            </div>
            <div className="tb-synhead">
              <span>단어</span>
              <span>뜻</span>
              <span>= 동의어</span>
              <span>↔ 반의어</span>
            </div>
            <div className="tb-gridlines tb-syn">
              <RuleLines step={7} count={40} cols={[42, 82, 132]} />
            </div>
          </div>
          <div className="tb-fill">
            <div className="tb-lb">
              <b>테스트에서 틀린 것 다시 쓰기</b>
              <span>날짜 &nbsp;&nbsp;/ &nbsp;&nbsp;· &nbsp;&nbsp;/ &nbsp;&nbsp;· &nbsp;&nbsp;/</span>
            </div>
            <div className="tb-ticks">
              {["단어", "해석", "빈칸", "어법", "어휘", "어순", "T/F", "영작", "연결어"].map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
            <div className="tb-gridlines tb-num">
              <RuleLines step={7} count={40} cols={[9]} />
            </div>
          </div>
        </div>
        <BookFoot />
      </div>
    </>
  );
});

// ---------------------------------------------------------------- 정답지

function sectionAnswer(sec: TestSection): ReactNode {
  if (sec.answer) return sec.answer;
  return sec.items.map((it) => (
    <span key={it.no}>
      <b>{it.no}</b>
      {it.answer}
    </span>
  ));
}

export const AnswerSheets = memo(function AnswerSheets({
  entries,
  measureKey,
  title = "정답",
}: {
  entries: Array<{ index: number; project: TestBookProjectInput; word?: WordTest; sheet?: TestSheet; heading?: string }>;
  measureKey: string;
  title?: string;
}) {
  // 테스트지에 학생 이름을 넣었으면 정답지 머리에도 찍는다(선생님 2026-11-06)
  const student = useContext(TestBookStudent);
  // 지문 머리 + 단어 정답은 한 덩어리, 유형 정답은 문항마다 덩어리 — 길어지면 쪽을 넘긴다
  const blocks: Block[] = entries.flatMap((e, k) => {
    const head: Block = {
      key: `a${k}-${e.project.id}`,
      node: (
        <div className="tb-ans" style={{ marginTop: k ? "2.6mm" : 0 }}>
          <h3>
            <span>{String(e.index + 1).padStart(2, "0")}</span>
            {e.project.title}
            {e.heading ? <span style={{ marginLeft: "2mm" }}>{e.heading}</span> : null}
          </h3>
          {e.word ? (
            <>
              {e.word.meaning.length ? (
                <dl className="tb-arow tb-arow-v">
                  <dt>단어 A</dt>
                  <dd>
                    {e.word.meaning.map((m) => (
                      <span key={m.no}>
                        <b>{m.no}</b>
                        {m.answer}
                      </span>
                    ))}
                  </dd>
                </dl>
              ) : null}
              {e.word.synonym.length ? (
                <dl className="tb-arow">
                  <dt>단어 B</dt>
                  <dd>
                    {e.word.synonym.map((x) => (
                      <span key={x.no}>
                        <b>{x.no}</b>
                        {circled(x.answer)}
                      </span>
                    ))}
                  </dd>
                </dl>
              ) : null}
              {e.word.forms.length ? (
                <dl className="tb-arow tb-arow-v">
                  <dt>단어 C</dt>
                  <dd>
                    {e.word.forms.map((f) => (
                      <span key={f.no}>
                        <b>{f.no}</b>
                        {f.answer}
                      </span>
                    ))}
                  </dd>
                </dl>
              ) : null}
            </>
          ) : null}
        </div>
      ),
    };
    const rows: Block[] = (e.sheet?.sections ?? []).flatMap((sec, i) => {
      // 중학교 워크북은 유형 이름을 제목으로 직접 준다(고등 유형 이름과 다를 수 있다)
      const label = `${i + 1} ${sec.title || testBookTypeLabel(sec.type)}`;
      // 긴 답(해석·영작 문장)은 문항마다 한 줄, 짧은 답은 한 줄에 모은다
      const long = !sec.answer && sec.items.some((it) => it.answer.length > 24);
      if (!long) {
        return [
          {
            key: `a${k}-${i}-${sec.type}`,
            node: (
              <dl className={sec.type === "words" && !sec.answer ? "tb-arow tb-arow-v" : "tb-arow"}>
                <dt>{label}</dt>
                <dd>{sectionAnswer(sec)}</dd>
              </dl>
            ),
          },
        ];
      }
      return sec.items.map((it, j) => ({
        key: `a${k}-${i}-${sec.type}-${j}`,
        node: (
          <dl className="tb-arow">
            <dt>{j === 0 ? label : ""}</dt>
            <dd>
              <b>{it.no}</b>
              {it.answer}
            </dd>
          </dl>
        ),
      }));
    });
    return [head, ...rows];
  });
  return (
    <PagedSheet
      blocks={blocks}
      measureKey={measureKey}
      head={(page) => <DocHead title={title} sub={page > 0 ? "(이어서)" : undefined} label="ANSWERS" right="정답만 싣습니다" name={student || undefined} />}
    />
  );
});

// ---------------------------------------------------------------- 표지·목차·분석 자료

/**
 * 표지 = 내신 표지(FrontCover). 칸이 비면 교재 이름 · 지문 출처(교과서 · 출판사 · 과)에서 읽는다.
 * 선생님 2026-10-22: 색 번짐 표지는 지움.
 */
export const CoverSheet = memo(function CoverSheet({
  cover,
  range,
  logoSrc,
}: {
  cover: IntegratedCover;
  range: string;
  logoSrc?: string | null;
}) {
  return (
    <div className="tb-sheet" style={{ padding: 0 }}>
      <FrontCover preset={coverPreset(cover.presetId)} cover={cover} logoSrc={logoSrc} examDefaults={{ range }} />
    </div>
  );
});

/** 교재 묶음(목차·간지·쪽 색). no는 목차 번호, color는 그 묶음 색. */
export type BookPart = { id: string; no: string; en: string; ko: string; sub?: string; color: string };

/** 묶음 안 쪽에 색·꼬리표를 넘긴다(감싸개는 display:contents라 CSS 변수만 내려간다) */
export function partStyle(part: BookPart | undefined): CSSProperties | undefined {
  if (!part) return undefined;
  return { ["--tb-accent" as string]: part.color, ["--tb-part" as string]: `"PART ${part.no} · ${part.en}"` } as CSSProperties;
}

/**
 * 목차(통합자료 목차와 같은 꼴). 쪽 번호는 화면이 그린 쪽을 세어 넣는다
 * (pages: 묶음 id → 첫 쪽, total: 전체 쪽 수, 표지가 1쪽).
 */
export const ContentsSheet = memo(function ContentsSheet({
  parts,
  pages,
  total,
  title,
  range,
}: {
  parts: BookPart[];
  pages: Record<string, number>;
  total: number;
  title: string;
  range: string;
}) {
  return (
    <div className="tb-sheet tb-contents">
      <h2>CONTENTS</h2>
      <div className="tb-cbar" />
      <ol>
        {parts.map((p, i) => {
          const from = pages[p.id];
          const next = parts.slice(i + 1).map((x) => pages[x.id]).find((n) => !!n);
          const to = from ? (next ? next - 1 : total) : undefined;
          return (
            <li key={p.id}>
              <span className="tb-cno" style={{ color: p.color }}>
                {p.no}
              </span>
              <div className="tb-cbody">
                <div className="tb-crow">
                  <span className="tb-cen">{p.en}</span>
                  <span className="tb-cpg">{from ? (to && to > from ? `p. ${from} ~ ${to}` : `p. ${from}`) : ""}</span>
                </div>
                <div className="tb-cko">
                  <b>{p.ko}</b>
                  {p.sub}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="tb-cfoot">
        <b>{title}</b>
        <span>{range}</span>
      </div>
    </div>
  );
});

/** 간지: 묶음 첫 쪽. 지문마다 이 묶음에서 시작하는 쪽을 싣는다. */
export const DividerSheet = memo(function DividerSheet({
  part,
  items,
  title,
}: {
  part: BookPart;
  items: Array<{ id: string; index: number; title: string; source: string | null; page?: number }>;
  title: string;
}) {
  return (
    <div className="tb-sheet tb-divider">
      <div className="tb-dstrip" />
      <div className="tb-din">
        <div className="tb-dpart">PART {part.no}</div>
        <h2>{part.en}</h2>
        <div className="tb-dbar" />
        <div className="tb-dko">{part.ko}</div>
        {part.sub ? <div className="tb-dsub">{part.sub}</div> : null}
        {items.length ? (
          <div className="tb-dlist">
            {items.map((it) => (
              <div key={it.id}>
                <i>{String(it.index + 1).padStart(2, "0")}</i>
                <span>
                  {it.title}
                  {it.source?.trim() ? <small>{it.source.trim()}</small> : null}
                </span>
                <em>{it.page ?? ""}</em>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="tb-dfoot">
        <b>{title}</b>
        PART {part.no} · {part.ko}
      </div>
    </div>
  );
});

/** 분석 자료: 분석서의 주제·문장 분석을 테스트 교재 쪽에 싣는다(분석서가 있는 지문만). */
export const AnalysisSheets = memo(function AnalysisSheets({
  index,
  project,
  translation = "full",
  measureKey,
}: {
  index: number;
  project: TestBookProjectInput;
  /** 전체 해석 · 직독직해(분석서 화면과 같은 선택) */
  translation?: "full" | "chunk";
  measureKey: string;
}) {
  const report = project.analysis;
  if (!report?.sentences?.length) return null;
  const blocks: Block[] = [];
  if (report.topicEn?.trim() || report.topicKo?.trim()) {
    blocks.push({
      key: "topic",
      node: (
        <div className="tb-an-topic">
          <b>TOPIC</b>
          <span className="tb-en">{report.topicEn?.trim()}</span>
          {report.topicKo?.trim() ? <div className="tb-ko">{report.topicKo.trim()}</div> : null}
        </div>
      ),
    });
  }
  // 지칭·함축의미·바꿔 말하기는 그 문장 바로 아래 주석으로(지문 분석서와 같은 부품)
  const plains = report.sentences.map((s) => s.enChunks.map((c) => c.text).join(" ").trim());
  const notesAt = sentenceNotesFor(plains, project.content);

  report.sentences.forEach((s, i) => {
    const plain = plains[i]!;
    const markup = readAnalysisMarkup(s.markup, plain);
    const extra = (s.contextNote ?? "").trim() || (s.easyUnderstanding ?? "").trim();
    const notes = notesAt.get(i);
    blocks.push({
      key: `s${i}`,
      node: (
        <>
          {markup ? (
            <AnalysisMarkupSentence markup={markup} index={i} extraNote={extra || undefined} translationMode={translation} />
          ) : (
            <div className="tb-an-s">
              <div className="tb-ss">
                <span className="tb-i">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <div className="tb-en">{plain}</div>
                  <div className="tb-ko">{s.koChunks.join(" ")}</div>
                  {extra ? <div className="tb-tip">{extra}</div> : null}
                </div>
              </div>
            </div>
          )}
          {notes?.length ? <SentenceNotes notes={notes} accent="var(--tb-accent,#15171c)" /> : null}
        </>
      ),
    });
  });
  return (
    <PagedSheet
      blocks={blocks}
      measureKey={measureKey}
      head={(page) => (
        <DocHead title="분석 자료" sub={page > 0 ? "(이어서)" : undefined} label={passageLabel(index, project)} right={project.source?.trim() || "ANALYSIS"} />
      )}
    />
  );
});

/** 지문 간지: 묶음 안에서 지문이 시작하는 쪽. 지문 번호를 크게, 이 묶음에서 이어질 쪽을 차례로 싣는다. */
export const PassageDividerSheet = memo(function PassageDividerSheet({
  part,
  index,
  project,
  next,
  title,
}: {
  part: BookPart;
  index: number;
  project: { title: string; titleEn: string | null; source: string | null };
  /** 이 지문에서 이어지는 쪽 이름(단어 정리 · 문장별 해석 …) */
  next: string[];
  title: string;
}) {
  const no = String(index + 1).padStart(2, "0");
  return (
    <div className="tb-sheet tb-pdiv">
      <div className="tb-ptop">
        <div className="tb-ppart">
          PART {part.no} · {part.en.toUpperCase()}
        </div>
        <div className="tb-pno">
          <small>PASSAGE</small>
          {no}
        </div>
      </div>
      <div className="tb-pin">
        {project.source?.trim() ? <div className="tb-psrc">{project.source.trim()}</div> : null}
        <h2>{project.title}</h2>
        {project.titleEn?.trim() ? <div className="tb-pen">{project.titleEn.trim()}</div> : null}
        <div className="tb-pbar" />
        {next.length ? (
          <div className="tb-pnext">
            {next.map((n, i) => (
              <div key={n}>
                <i>{i + 1}</i>
                {n}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="tb-pfoot">
        <span>{title}</span>
        <span>
          PART {part.no} · {part.ko} · 지문 {no}
        </span>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------- 단어 시험지

/** 단어 시험지(지문을 합친 한 장 묶음). 쓰기는 두 단, 객관식은 보기 넷을 한 줄에. */
export const VocabExamSheets = memo(function VocabExamSheets({
  exam,
  title = "단어 시험",
  measureKey,
  label = "VOCABULARY TEST",
  right,
}: {
  exam: VocabExam;
  title?: string;
  measureKey: string;
  /** 오른쪽 위 굵은 줄(출처) */
  label?: string;
  right?: string;
}) {
  if (!exam.total) return null;
  const blocks: Block[] = [{ key: "who", node: <Who total={exam.total} /> }];
  exam.sections.forEach((sec, si) => {
    const head = (
      <div className="tb-q">
        <span className="tb-qn">{si + 1}</span>
        {sec.title}
        <small>{sec.hint}</small>
      </div>
    );
    if (sec.items[0]?.choices) {
      sec.items.forEach((it, i) =>
        blocks.push({
          key: `${sec.kind}-${it.no}`,
          node: (
            <div className={i === sec.items.length - 1 ? "tb-b" : undefined}>
              {i === 0 ? head : null}
              <div className="tb-mc">
                <span className="tb-i">{it.no}</span>
                <div>
                  <b className="tb-en">{it.prompt}</b>
                  <div className="tb-ch tb-en">
                    {it.choices!.map((c, ci) => (
                      <span key={ci}>
                        {"①②③④"[ci]} {c}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ),
        })
      );
      return;
    }
    const pairs: VocabExamItem[][] = [];
    for (let i = 0; i < sec.items.length; i += 2) pairs.push(sec.items.slice(i, i + 2));
    pairs.forEach((pair, i) =>
      blocks.push({
        key: `${sec.kind}-p${i}`,
        node: (
          <div className={i === pairs.length - 1 ? "tb-b" : undefined}>
            {i === 0 ? head : null}
            <div className="tb-words">
              {pair.map((it) => (
                <div key={it.no} className="tb-wq">
                  <span className="tb-i">{it.no}</span>
                  <span className={sec.kind === "spelling" ? undefined : "tb-en"}>
                    {it.prompt}
                    {it.hint ? <span className="tb-tip"> ({it.hint}…)</span> : null}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ),
      })
    );
  });
  return (
    <PagedSheet
      blocks={blocks}
      measureKey={measureKey}
      head={(page) => <DocHead title={title} sub={page > 0 ? "(이어서)" : `${exam.total}문항`} label={label} right={right} />}
    />
  );
});

export const VocabExamAnswerSheets = memo(function VocabExamAnswerSheets({
  exam,
  title = "정답 · 단어 시험",
  measureKey,
  source,
}: {
  exam: VocabExam;
  title?: string;
  measureKey: string;
  /** 출처(있으면 「정답만 싣습니다」 대신) */
  source?: string;
}) {
  const student = useContext(TestBookStudent);
  if (!exam.total) return null;
  // 한 유형을 통째로 한 덩어리로 넣으면 60·80문항에서 한 쪽보다 길어져 아래가 잘렸다(선생님 2026-11-11)
  // → 정답을 몇 개씩 잘라 덩어리마다 쪽을 넘길 수 있게 한다. 유형 이름은 첫 덩어리에만.
  const blocks: Block[] = exam.sections.flatMap((sec) => {
    const mc = !!sec.items[0]?.choices;
    // 쓰기 정답은 종이를 아끼게 여러 단으로(선생님 2026-11-11 「4단이나 3단으로」) — 답이 길면 3단, 짧으면 4단.
    // 한 덩어리는 두 줄씩이라 쪽 끝에서도 넘겨진다.
    const cols = mc ? 1 : sec.items.some((it) => it.answer.length > 12) ? 3 : 4;
    const size = mc ? 24 : cols * 2;
    const chunks: VocabExamItem[][] = [];
    for (let i = 0; i < sec.items.length; i += size) chunks.push(sec.items.slice(i, i + size));
    return chunks.map((chunk, ci) => ({
      key: `va-${sec.kind}-${ci}`,
      node: (
        <dl className={mc ? "tb-arow" : "tb-arow tb-arow-v"} style={ci < chunks.length - 1 ? { marginBottom: 0 } : undefined}>
          <dt>{ci === 0 ? sec.title : ""}</dt>
          <dd>
            {chunk.map((it) => (
              <span key={it.no}>
                <b>{it.no}</b>
                {it.answer}
              </span>
            ))}
          </dd>
        </dl>
      ),
    }));
  });
  return (
    <PagedSheet
      blocks={blocks}
      measureKey={measureKey}
      head={(page) => <DocHead title={title} sub={page > 0 ? "(이어서)" : undefined} label="ANSWERS" right={source || "정답만 싣습니다"} name={student || undefined} />}
    />
  );
});

// ---------------------------------------------------------------- 워크북에 끼우는 조각

/**
 * 워크북 쪽 안에 테스트 교재 문항 하나를 그린다(쪽 제목은 워크북이 단다). 테스트 교재 유형을
 * 워크북으로 옮기며(2026-10-21) 같은 그림을 쓰게 했다. 글꼴·모양은 TEST_BOOK_CSS를 함께 넣어야 한다.
 */
export function TestSectionContent({ section }: { section: TestSection }) {
  const blocks = sectionBlocks({ ...section, title: "" }, 0, "wb");
  return (
    <div className="tb-wb">
      {blocks.map((b) => (
        <Fragment key={b.key}>{b.node}</Fragment>
      ))}
    </div>
  );
}

/** 워크북 정답 칸: 문항 번호와 정답만 */
export function TestSectionAnswer({ section }: { section: TestSection }) {
  return <div className="tb-wb tb-arow-plain">{sectionAnswer(section)}</div>;
}

/** 워크북에 끼우는 단어 시험지 문항(쪽 제목·이름 칸은 워크북이 단다) */
export function VocabExamContent({ exam }: { exam: VocabExam }) {
  return (
    <div className="tb-wb">
      {exam.sections.map((sec, si) => (
        <div key={sec.kind} className="tb-b">
          <div className="tb-q">
            <span className="tb-qn">{si + 1}</span>
            {sec.title}
            <small>{sec.hint}</small>
          </div>
          {sec.items[0]?.choices ? (
            sec.items.map((it) => (
              <div key={it.no} className="tb-mc">
                <span className="tb-i">{it.no}</span>
                <div>
                  <b className="tb-en">{it.prompt}</b>
                  <div className="tb-ch tb-en">
                    {it.choices!.map((c, ci) => (
                      <span key={ci}>
                        {"①②③④"[ci]} {c}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="tb-words">
              {sec.items.map((it) => (
                <div key={it.no} className="tb-wq">
                  <span className="tb-i">{it.no}</span>
                  <span className={sec.kind === "spelling" ? undefined : "tb-en"}>
                    {it.prompt}
                    {it.hint ? <span className="tb-tip"> ({it.hint}…)</span> : null}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function VocabExamAnswer({ exam }: { exam: VocabExam }) {
  return (
    <div className="tb-wb">
      {exam.sections.map((sec) => (
        <dl key={sec.kind} className="tb-arow">
          <dt>{sec.title}</dt>
          <dd>
            {sec.items.map((it) => (
              <span key={it.no}>
                <b>{it.no}</b>
                {it.answer}
              </span>
            ))}
          </dd>
        </dl>
      ))}
    </div>
  );
}

/** 표지 고르기 썸네일 — A4 표지를 썸네일 폭에 맞춰 줄인다 */
export function CoverThumbAny({
  presetId,
  cover,
  range,
  logoSrc,
  widthPx,
}: {
  presetId: string;
  cover: IntegratedCover;
  range: string;
  logoSrc?: string | null;
  widthPx: number;
}) {
  const scale = widthPx / 793.7;
  return (
    // 글꼴·TEST_BOOK_CSS는 쓰는 화면(테스트 교재)이 한 번 넣는다 — 썸네일마다 33KB씩 23번 실려 페이지가 800KB 늘었다(2026-10-29)
    <div className="pointer-events-none relative overflow-hidden" style={{ width: widthPx, height: widthPx * (297 / 210) }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: "210mm" }}>
        <CoverSheet cover={{ ...cover, presetId }} range={range} logoSrc={logoSrc} />
      </div>
    </div>
  );
}
