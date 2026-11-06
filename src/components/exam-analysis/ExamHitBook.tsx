import { itemOrder, type BookCard, type BookItem, type HitBook } from "@/lib/exam-analysis/hit-book";
import { HitBookTools } from "@/components/exam-analysis/HitBookTools";
import { HitBookRecheck } from "@/components/exam-analysis/HitBookRecheck";

/**
 * 적중 자료집 — A4 한 장씩. 표지 · 일람 · 문항마다 한 장.
 * 선생님이 손으로 만든 발곡고 적중 자료집(2026-10-14)과 같은 꼴이다. 인쇄하면 그대로 PDF가 된다.
 */
const CIRCLED = "①②③④⑤";

const CSS = `
.hb{--ink:#1b2232;--muted:#5b6476;--rule:#dde1e8;--soft:#eef1f5;--red:#c8322b;--red-soft:#fbeae8;--blue:#2c5aa0;--blue-soft:#e7eef9;--navy:#141a2a;
--display:"Gowun Batang",Georgia,serif;--body:"Noto Sans KR",sans-serif;--mono:"IBM Plex Mono",monospace;
color:var(--ink);font-family:var(--body);display:grid;justify-content:center;gap:8mm;padding:6mm 0 12mm;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.hb *{box-sizing:border-box}
.hb h1,.hb h2,.hb h3{font-family:var(--display);margin:0;line-height:1.25}
.hb p{margin:0}
.hb .pg{width:210mm;height:296mm;padding:13mm 13mm 11mm;position:relative;overflow:hidden;display:flex;flex-direction:column;gap:4.2mm;background:#fff;box-shadow:0 2px 14px rgba(20,26,42,.14)}
.hb .brand{font-weight:900;letter-spacing:.06em}
.hb .ph{display:flex;justify-content:space-between;font-size:8.5pt;color:var(--muted);border-bottom:1.2pt solid var(--ink);padding-bottom:2mm}
.hb .ph .brand{color:var(--red)}
.hb .pf{position:absolute;left:13mm;right:13mm;bottom:6mm;font-size:7pt;color:var(--muted);text-align:right}
.hb .cover{background:var(--navy);color:#fff;padding:20mm 18mm 16mm;gap:0;justify-content:space-between}
.hb .cover::before{content:"";position:absolute;right:-40mm;top:-40mm;width:150mm;height:150mm;border:2.4mm solid var(--red);border-radius:50%;opacity:.9}
.hb .cover::after{content:"";position:absolute;right:-12mm;top:-12mm;width:94mm;height:94mm;border:1.4mm solid var(--red);border-radius:50%;opacity:.55}
.hb .cv-top{display:flex;justify-content:space-between;font-size:9.5pt;color:#c7cedb;position:relative;z-index:1}
.hb .cv-top .brand{color:#fff;font-size:12pt}
.hb .cv-mid{position:relative;z-index:1;margin-top:16mm}
.hb .cv-school{font-family:var(--display);font-size:36pt;font-weight:700;color:#fff;line-height:1.2}
.hb .cv-sub2{font-size:12pt;color:#c7cedb;margin-top:2mm;letter-spacing:.04em}
.hb .cover h1{font-size:58pt;letter-spacing:.04em;margin:3mm 0 6mm;color:#fff}
.hb .cv-sub{font-size:11.5pt;line-height:1.7;color:#dfe4ec}
.hb .formula{position:relative;z-index:1;display:grid;grid-template-columns:1fr auto 1fr auto 1.15fr;align-items:center;gap:3mm;margin-top:10mm}
.hb .term{background:#fff;color:var(--ink);border-radius:4mm;padding:6mm 4mm 5mm;display:grid;justify-items:center;text-align:center;gap:1mm}
.hb .term .tn{font-weight:900;font-size:11pt;color:var(--red)}
.hb .term.t2 .tn,.hb .term.t2 .tv{color:var(--blue)}
.hb .term .tv{font-family:var(--mono);font-weight:600;font-size:30pt;line-height:1;color:var(--red)}
.hb .term .tv small{font-size:14pt}
.hb .term .tl{font-weight:700;font-size:10pt}
.hb .term .ts{font-size:7.8pt;color:var(--muted)}
.hb .term.total{background:var(--red);color:#fff;box-shadow:0 0 0 1.2mm #fff inset}
.hb .term.total .tn{color:#fff;font-size:13pt;letter-spacing:.2em}
.hb .term.total .tv{color:#fff;font-size:38pt}
.hb .term.total .ts{color:#ffe1dd}
.hb .op{font-family:var(--mono);font-size:26pt;color:#fff;font-weight:600}
.hb .cv-count{position:relative;z-index:1;margin-top:10mm;display:grid;grid-template-columns:auto auto 1fr;align-items:end;column-gap:3mm}
.hb .cv-count>b{font-family:var(--mono);font-size:54pt;line-height:.9;color:#fff}
.hb .cv-count>span{font-size:20pt;font-weight:900;color:#fff;padding-bottom:1.5mm}
.hb .cv-count p{font-size:11pt;line-height:1.5;color:#dfe4ec;padding-bottom:1.5mm;padding-left:3mm;border-left:1mm solid var(--red)}
.hb .cv-count p b{color:#fff}
.hb .cv-foot{position:relative;z-index:1;display:grid;grid-template-columns:repeat(3,1fr);gap:4mm;margin-top:12mm;border-top:.6pt solid #46506a;padding-top:6mm}
.hb .cv-foot div{display:grid;gap:1mm}
.hb .cv-foot b{font-family:var(--mono);font-size:20pt;color:#fff}
.hb .cv-foot span{font-size:8.5pt;color:#c7cedb;line-height:1.5}
.hb .cv-note{position:relative;z-index:1;font-size:8pt;color:#8f99ad;margin-top:8mm}
.hb h2{font-size:22pt}
.hb .lead{font-size:9.5pt;line-height:1.6;color:var(--muted)}
.hb .red{color:var(--red)}.hb .blue{color:var(--blue)}
.hb .list{width:100%;border-collapse:collapse;font-size:8pt}
.hb .list th{background:var(--ink);color:#fff;font-weight:500;padding:1.8mm 2mm;text-align:left;white-space:nowrap}
.hb .list td{padding:1mm 1.6mm;border-bottom:.5pt solid var(--rule);vertical-align:top}
.hb .list .r{text-align:right;font-family:var(--mono)}
.hb .list .no{font-family:var(--display);font-weight:700;font-size:10pt}
.hb .list td:nth-child(2){white-space:nowrap}
.hb .list .nt{color:var(--muted);font-size:7pt;line-height:1.35}
.hb .list.dense td{padding:.55mm 1.4mm}.hb .list.dense .no{font-size:9pt}.hb .list.dense .bd{font-size:7pt;padding:.1mm 1.8mm}.hb .list.dense .nt{font-size:6.6pt;line-height:1.3}
.hb .cntc{font-weight:700;color:var(--red)}
.hb .bd{display:inline-block;border-radius:99px;padding:.3mm 2.2mm;font-weight:700;font-size:7.6pt;white-space:nowrap}
.hb .bd.same{background:var(--red-soft);color:var(--red)}
.hb .bd.similar{background:var(--blue-soft);color:var(--blue)}
.hb .bd.none{background:var(--soft);color:var(--muted)}
.hb .ihead{display:flex;align-items:center;gap:4mm}
.hb .ino{font-family:var(--display);font-weight:700;font-size:34pt;line-height:1;color:var(--red);min-width:14mm}
.hb .v-similar .ino{color:var(--blue)}
.hb .ihead h3{font-size:15pt}
.hb .ihead .meta{font-size:8.5pt;color:var(--muted)}
.hb .ihead>div:first-of-type{flex:1}
.hb .hright{display:flex;align-items:center;gap:3mm}
.hb .verdict{font-weight:700;font-size:9.5pt;padding:1.5mm 4mm;border-radius:99px;background:var(--red);color:#fff}
.hb .v-similar .verdict{background:var(--blue)}
.hb .bigcnt{display:grid;grid-template-columns:auto auto;align-items:end;column-gap:.6mm;background:var(--red);color:#fff;border-radius:3mm;padding:1.6mm 3.4mm 1.8mm}
.hb .v-similar .bigcnt{background:var(--blue)}
.hb .bigcnt b{font-family:var(--mono);font-size:26pt;line-height:1}
.hb .bigcnt span{font-size:11pt;font-weight:700;padding-bottom:1mm}
.hb .bigcnt em{grid-column:1/-1;font-style:normal;font-size:6.8pt;line-height:1.3;font-weight:700;opacity:.92}
.hb .exam{background:#fff;border:.8pt solid #9aa3b2;border-radius:2mm;padding:3.2mm 4mm;position:relative;font-size:9pt}
.hb .etag{font-size:8pt;font-weight:700;color:var(--muted);letter-spacing:.04em;margin-bottom:1mm}
.hb .stem{font-weight:700;font-size:9.4pt;line-height:1.45;padding-right:44mm;min-height:11mm;margin-bottom:1.6mm}
.hb .ebody{font-family:Georgia,"Times New Roman",serif;font-size:9pt;line-height:1.55;text-align:justify;overflow-wrap:anywhere}
.hb .blur{filter:blur(2.2px);user-select:none}
.hb .key{background:#fff3f1;box-shadow:0 0 0 1.2px var(--red) inset;border-radius:2px;padding:0 2px;font-weight:700}
.hb .stamp{position:absolute;top:2mm;right:3mm;display:grid;justify-items:center;padding:1.4mm 2.6mm;border:.9mm solid var(--red);border-radius:3mm;color:var(--red);background:rgba(255,255,255,.85);transform:rotate(-8deg);font-family:var(--display);line-height:1.15}
.hb .stamp b{font-size:13pt;letter-spacing:.08em}
.hb .stamp span{font-family:var(--body);font-size:6.6pt;font-weight:700}
.hb .v-similar .stamp{border-color:var(--blue);color:var(--blue)}
.hb .echo{list-style:none;margin:1.6mm 0 0;padding:0;display:grid;gap:.5mm;font-size:8.4pt}
.hb .echo li{display:grid;grid-template-columns:5mm 1fr;gap:1mm;padding:.3mm 1mm;border-radius:1.4mm}
.hb .echo li.ans{background:var(--red-soft);font-weight:700;color:var(--red)}
.hb .arow{display:grid;grid-template-columns:1fr 1.25fr;gap:3mm}
.hb .abox,.hb .lbox{border-radius:2.5mm;padding:2.6mm 3.2mm;font-size:8.4pt;line-height:1.55}
.hb .abox{background:var(--ink);color:#fff;display:grid;grid-template-columns:auto 1fr;column-gap:3mm;align-items:start}
.hb .abox .atag{grid-column:1/-1;color:#ffb3ab}
.hb .abox .ano{font-size:22pt;font-weight:900;line-height:1;color:#fff}
.hb .lbox{background:var(--red-soft)}
.hb .v-similar .lbox{background:var(--blue-soft)}
.hb .atag{font-size:7.6pt;font-weight:700;letter-spacing:.04em;color:var(--red);margin-bottom:.8mm}
.hb .v-similar .lbox .atag{color:var(--blue)}
.hb .cmp{border:1.4pt solid var(--red);border-radius:2.5mm;padding:2mm 3mm;background:#fff}
.hb .v-similar .cmp{border-color:var(--blue)}
.hb .ctag{font-size:8pt;font-weight:700;color:var(--red);margin-bottom:1mm}
.hb .v-similar .ctag{color:var(--blue)}
.hb .cmp table{width:100%;border-collapse:collapse;font-size:7.8pt}
.hb .cmp th{font-size:7pt;color:var(--muted);text-align:left;font-weight:500;padding:.5mm 1mm}
.hb .cmp td{padding:1mm;border-top:.4pt solid var(--rule);vertical-align:top}
.hb .cx,.hb .co{font-family:Georgia,serif;width:36%;background:#fff3f1;overflow-wrap:anywhere}
.hb .v-similar .cx,.hb .v-similar .co{background:#eef3fb}
.hb .ca{width:3mm;color:var(--red);font-weight:900;text-align:center;font-size:11pt}
.hb .cs{font-weight:700}
.hb .leadbox{flex:1 1 0;min-height:26mm;display:flex;flex-direction:column;gap:2mm;background:var(--red-soft);border-radius:3mm;padding:3mm;overflow:hidden;margin-bottom:4mm}
.hb .v-similar .leadbox{background:var(--blue-soft)}
.hb .ltag{font-size:8pt;font-weight:700;letter-spacing:.04em;color:var(--red)}
.hb .v-similar .ltag{color:var(--blue)}
.hb .cards{display:grid;grid-template-columns:1fr 1fr;gap:3mm;align-items:stretch;min-height:0;flex:1 1 0;overflow:hidden}
.hb .cards.one{grid-template-columns:1fr}
.hb .qcard{background:#fff;border:.8mm solid var(--red);border-radius:2mm;padding:2.6mm 3mm;display:grid;gap:1.4mm;font-size:7.6pt;line-height:1.5;min-width:0;max-height:100%;overflow:hidden;align-self:start}
.hb .v-similar .qcard{border-color:var(--blue)}
.hb .qcard header{display:flex;flex-wrap:wrap;justify-content:space-between;gap:1mm 3mm;font-size:7pt;border-bottom:.4pt solid #e6e9ee;padding-bottom:1mm}
.hb .qcard .src{font-weight:700;color:var(--red)}
.hb .qcard .dt{color:var(--muted)}
.hb .qcard .ins{font-weight:700}
.hb .qcard .qt{border:.4pt solid #cfd5df;border-radius:1.4mm;padding:1.2mm 2mm;background:#f7f8fa;font-family:Georgia,serif}
.hb .qcard .pm{background:#f3f5f8;border-radius:1.4mm;padding:1.6mm 2mm;font-family:Georgia,"Times New Roman",serif;font-size:7.4pt;overflow-wrap:anywhere;white-space:pre-line}
.hb .qcard u{text-decoration:underline 1px;text-underline-offset:2px;font-weight:700}
.hb mark{background:#ffe9e6;color:#b4231b;border-radius:1px;padding:0 1px;box-shadow:0 0 0 1.4px var(--red);font-weight:700}
.hb mark.ln{background:transparent;color:inherit;box-shadow:none;font-weight:400}
.hb .qcard .ch{list-style:none;margin:0;padding:0;display:grid;gap:.4mm}
.hb .qcard .ch li{display:grid;grid-template-columns:4mm 1fr;gap:1mm}
.hb .qcard .ch li.ans{background:#ffe3df;font-weight:700}
.hb .qcard .ans{color:var(--muted)}
.hb .qcard .br{font-weight:700}.hb .qcard .br.hit{color:#b4231b;background:#ffe9e6;padding:0 1px;border-radius:1px;box-shadow:0 0 0 1.4px var(--red)}
.hb .qcard.wb ul{margin:0;padding-left:4mm;display:grid;gap:1mm;font-family:Georgia,serif;font-size:8pt}
.hb .f1 .ebody{font-size:8.2pt;line-height:1.5}.hb .f1 .echo{font-size:7.8pt}
.hb .f2 .ebody{font-size:7.5pt;line-height:1.45}.hb .f2 .echo{font-size:7.3pt}.hb .f2 .stem{min-height:0}
.hb .f3{gap:3mm}.hb .f3 .ebody{font-size:6.9pt;line-height:1.4}.hb .f3 .cmp table{font-size:7.2pt}.hb .f3 .abox,.hb .f3 .lbox{font-size:7.6pt;padding:2mm 2.6mm}
.hb .f4{gap:2.4mm}.hb .f4 .ebody{font-size:6.4pt;line-height:1.36}.hb .f4 .echo{font-size:6.8pt;gap:0}.hb .f4 .ihead .ino{font-size:28pt}.hb .f4 .leadbox{min-height:18mm}
.hb .f5 .leadbox{display:none}.hb .f5 .cmp tr:nth-child(n+3){display:none}
.hb .f6 .ebody{font-size:5.9pt;line-height:1.3}.hb .f6 .echo{font-size:6.3pt}.hb .f6 .arow{grid-template-columns:1fr 1.6fr}
/* 2026-10-15 선생님 지시: 학교 문제는 작게, 우리 문제는 실제 시험지처럼 크게, 둘을 도식으로 잇는다 */
.hb .top2{display:grid;grid-template-columns:0.92fr 1.08fr;gap:3mm;align-items:start}
.hb .exam.mini{padding:2.4mm 3mm;font-size:7.4pt}
.hb .exam.mini .ebody{max-height:70mm;overflow:hidden;-webkit-mask-image:linear-gradient(#000 85%,transparent);mask-image:linear-gradient(#000 85%,transparent)}
.hb .exam.mini .etag{display:flex;justify-content:space-between;align-items:center;margin-bottom:.8mm}
.hb .exam.mini .ans-chip{background:var(--ink);color:#fff;border-radius:99px;padding:.2mm 2.2mm;font-size:7pt;letter-spacing:0}
.hb .exam.mini .stem{font-size:7.6pt;min-height:0;padding-right:0;margin-bottom:1mm}
.hb .exam.mini .ebody{font-size:6.9pt;line-height:1.42}
.hb .exam.mini .echo{font-size:6.8pt;gap:.2mm;margin-top:1mm}
.hb .exam.mini .echo li{grid-template-columns:4mm 1fr}
.hb .flow{display:flex;flex-direction:column;gap:1.8mm}
.hb .ftag{font-size:8pt;font-weight:700;color:var(--red)}
.hb .v-similar .ftag{color:var(--blue)}
.hb .fpair{display:grid;grid-template-columns:1fr 13mm 1fr;align-items:stretch;gap:0}
.hb .fbox{border-radius:2mm;padding:1.4mm 2mm;font-size:7.3pt;line-height:1.4;overflow-wrap:anywhere}
.hb .fbox p{font-family:Georgia,"Times New Roman",serif}
.hb .fl{display:block;font-size:6.4pt;font-weight:700;letter-spacing:.02em;margin-bottom:.4mm}
.hb .fx{background:#f1f3f6;border:.5pt solid #c5ccd6}
.hb .fx .fl{color:var(--muted)}
.hb .fo{background:#fff3f1;border:1pt solid var(--red)}
.hb .fo .fl{color:var(--red)}
.hb .v-similar .fo{background:#eef3fb;border-color:var(--blue)}
.hb .v-similar .fo .fl{color:var(--blue)}
.hb .farrow{position:relative;display:flex;align-items:center;justify-content:center}
.hb .farrow::before{content:"";position:absolute;left:1mm;right:2.4mm;top:50%;border-top:1.2pt solid var(--red)}
.hb .farrow::after{content:"";position:absolute;right:.6mm;top:calc(50% - 1.6mm);border:1.6mm solid transparent;border-left:2.2mm solid var(--red)}
.hb .v-similar .farrow::before{border-top-color:var(--blue)}.hb .v-similar .farrow::after{border-left-color:var(--blue)}
.hb .farrow span{position:relative;z-index:1;background:#fff;font-size:5.8pt;line-height:1.2;font-weight:700;color:var(--ink);text-align:center;padding:.4mm .4mm;max-width:12mm}
.hb .fnone{font-size:7.6pt;color:var(--muted)}
.hb .fwhy{background:var(--red-soft);border-radius:2mm;padding:1.8mm 2.4mm;font-size:7.6pt;line-height:1.5}
.hb .v-similar .fwhy{background:var(--blue-soft)}
.hb .fans{display:block;font-size:8pt;margin-bottom:.4mm}
/* 우리 시험지 — 크게 */
.hb .leadbox{min-height:110mm}
.hb .ltag{font-size:8.6pt}
.hb .sheet{position:relative;background:#fff;border:.8mm solid var(--red);border-radius:1.6mm;padding:3mm 3.4mm 3.4mm;display:grid;gap:1.6mm;font-size:8.4pt;line-height:1.55;min-width:0;max-height:100%;overflow:hidden;align-self:start;box-shadow:0 1.2mm 0 rgba(20,26,42,.06)}
.hb .v-similar .sheet{border-color:var(--blue)}
.hb .sheet header{display:flex;align-items:baseline;gap:2mm;font-size:7.2pt;border-bottom:1pt solid var(--ink);padding-bottom:1.2mm}
.hb .sheet .sbrand{font-weight:900;letter-spacing:.06em}
.hb .sheet .src{font-weight:700;color:var(--red);flex:1}
.hb .v-similar .sheet .src{color:var(--blue)}
.hb .sheet .dt{color:var(--muted)}
.hb .sheet .ins{font-weight:700;font-size:8.6pt}
.hb .sheet .qno{font-family:var(--display);font-size:10pt;margin-right:.6mm}
.hb .sheet .qt{border:.6pt solid #9aa3b2;padding:1.6mm 2.4mm;font-family:Georgia,serif}
.hb .sheet .pm{border:.6pt solid #9aa3b2;padding:2mm 2.6mm;font-family:Georgia,"Times New Roman",serif;font-size:8.3pt;line-height:1.6;overflow-wrap:anywhere;white-space:pre-line;text-align:justify}
.hb .sheet u{text-decoration:underline 1px;text-underline-offset:2px;font-weight:700}
.hb .sheet .ch{list-style:none;margin:0;padding:0;display:grid;gap:.5mm;font-size:8.2pt}
.hb .sheet .ch li{display:grid;grid-template-columns:5mm 1fr;gap:1mm}
.hb .sheet .ch li.ans{background:#ffe3df;font-weight:700}
.hb .sheet .sans{position:absolute;right:3mm;bottom:2.4mm;border:.7mm solid var(--red);color:var(--red);border-radius:2mm;padding:.4mm 2.4mm;font-weight:900;font-size:8pt;transform:rotate(-6deg);background:rgba(255,255,255,.9)}
.hb .v-similar .sheet .sans{border-color:var(--blue);color:var(--blue)}
.hb .sheet .br{font-weight:700}.hb .sheet .br.hit{color:#b4231b;background:#ffe9e6;padding:0 1px;border-radius:1px;box-shadow:0 0 0 1.4px var(--red)}
.hb .sheet.wb ul{margin:0;padding-left:4.4mm;display:grid;gap:1.4mm;font-family:Georgia,serif;font-size:8.6pt;line-height:1.6}
.hb .cards.one .sheet{font-size:8.8pt}.hb .cards.one .sheet .pm{font-size:8.7pt}
/* 넘치면: 학교 문제 · 도식부터 줄이고, 우리 시험지는 끝까지 남긴다 */
.hb .f1 .exam.mini .ebody{font-size:6.4pt;max-height:60mm}
.hb .f2 .fbox{font-size:6.8pt}.hb .f2 .fwhy{font-size:7pt}.hb .f2 .exam.mini .ebody{max-height:50mm}
.hb .f3 .fpair:nth-of-type(n+4){display:none}.hb .f3 .leadbox{min-height:96mm}
.hb .f4 .ihead .ino{font-size:28pt}.hb .f4 .leadbox{min-height:84mm}.hb .f4 .exam.mini .ebody{max-height:40mm}
.hb .f5 .fpair:nth-of-type(n+3){display:none}.hb .f5 .leadbox{min-height:70mm;display:flex}
.hb .f6 .sheet{font-size:7.6pt}.hb .f6 .sheet .pm{font-size:7.5pt}.hb .f6 .leadbox{min-height:56mm}
.hb .fpair{grid-template-columns:1fr 11mm 1fr;row-gap:.6mm}
.hb .farrow span{font-size:6.2pt;max-width:10mm}
.hb .fsame{grid-column:1/-1;margin:0;font-size:7pt;font-weight:700;color:var(--ink);line-height:1.35;padding-left:1mm}
.hb .sheet .sans{position:static;transform:none;margin-left:1mm;padding:.1mm 2mm;font-size:7.4pt;border-width:.5mm;white-space:nowrap;max-width:40mm;overflow:hidden;text-overflow:ellipsis}
.hb .sheet .pm{max-height:64mm;overflow:hidden;-webkit-mask-image:linear-gradient(#000 82%,transparent);mask-image:linear-gradient(#000 82%,transparent)}
.hb .cards.one .sheet .pm{max-height:84mm}
.hb .f4 .sheet .pm{max-height:52mm}.hb .f6 .sheet .pm{max-height:40mm}
.hb .sheet header{flex-wrap:wrap;row-gap:.8mm}.hb .sheet .src{min-width:28mm}
.hb .sheet .stag{background:var(--ink);color:#fff;border-radius:99px;padding:.1mm 2.2mm;font-size:6.8pt;font-weight:700;white-space:nowrap}
.hb .sheet.other{border-style:dashed}
.hb .leadbox.nocard{min-height:0;flex:0 0 auto}.hb .nocard-note{font-size:8.4pt;line-height:1.6;color:var(--ink)}
.hb-tools{display:flex;justify-content:center;gap:8px;padding:10px 0 0}
.hb .hb-recheck{position:absolute;top:4mm;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:2mm;z-index:2}
.hb .hb-recheck button{font:inherit;font-size:8pt;font-weight:700;color:#1b2232;background:#fff;border:1px solid #cfd5df;border-radius:99px;padding:1mm 3.4mm;cursor:pointer}
.hb .hb-recheck button:disabled{opacity:.6;cursor:default}
.hb .hb-recheck em{font-style:normal;font-size:7.5pt;color:#c8322b;background:#fff;padding:0 2mm}
html,body{margin:0;background:#e8ebf0}
/*
 * 인쇄 — 앱 틀 없는 쪽(/hit-book/[id])이라 자료집만 찍힌다. 선생님 지적(2026-10-15): 인쇄하면 A4가 조금 잘린다.
 * 틀을 숨겨도 자리는 남아 브라우저가 쪽을 밀었고, 297mm를 꽉 채우면 반올림으로 다음 장으로 넘쳤다.
 * 그래서 앱 틀 밖에서 열고, 한 장은 296mm로 둔다.
 */
@media print{
  @page{size:A4;margin:0}
  html,body{background:#fff}
  .hb{padding:0;gap:0;display:block}
  .hb .pg{box-shadow:none;page-break-after:always;break-after:page}
  .hb .pg:last-child{page-break-after:auto;break-after:auto}
  .hb-tools,.hb .hb-recheck{display:none}
}
`;

const pct = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/**
 * 빨간 표시(같은 자리)가 지문 뒤쪽이면 접힌 아래로 숨는다 — 표시 앞 몇 문장부터 보여 준다(2026-10-15 발곡고1 14번).
 * 태그(<u>·<mark>) 한가운데서 자르지 않도록 열린 <u> 가 있으면 그 앞에서 자른다.
 */
function aroundMark(html: string): string {
  const at = html.indexOf("<mark");
  if (at < 420) return html;
  let from = html.lastIndexOf(". ", at - 260);
  if (from < 0) return html;
  from += 2;
  const head = html.slice(0, from);
  const openU = head.lastIndexOf("<u>");
  if (openU > head.lastIndexOf("</u>")) from = openU;
  return `… ${html.slice(from)}`;
}

/** 문단 통째로 칠한 빨간 표시는 풀어 둔다 — 짧은 자리만 빨간 상자(상우고1 2번) */
function shortMarks(html: string): string {
  return html.replace(/<mark>([\s\S]*?)<\/mark>/g, (m, inner: string) => (inner.replace(/<[^>]+>/g, "").length > 160 ? inner : m));
}

/** 한 줄이 너무 길면(올린 자료 한 문항이 통째로 한 줄) 표시 둘레만 짧게 */
function clipLine(h: string): string {
  const plain = h.replace(/<[^>]+>/g, "");
  if (plain.length <= 360) return h;
  const at = h.indexOf("<mark");
  if (at < 0) return `${h.slice(0, h.lastIndexOf(" ", 340) > 0 ? h.lastIndexOf(" ", 340) : 340)} …`;
  const end = h.indexOf("</mark>", at);
  let from = Math.max(0, at - 180);
  let to = Math.min(h.length, (end < 0 ? at : end + 7) + 180);
  // 태그 한가운데서 자르지 않는다
  const lt = h.lastIndexOf("<", from);
  if (lt > h.lastIndexOf(">", from)) from = lt;
  const gt = h.indexOf(">", to);
  if (h.lastIndexOf("<", to) > h.lastIndexOf(">", to - 1) && gt > 0) to = gt + 1;
  return `${from > 0 ? "… " : ""}${h.slice(from, to)}${to < h.length ? " …" : ""}`;
}

/** 줄 묶음 자료는 표시된 줄과 그 앞뒤만 — 없으면 앞 여덟 줄. 올린 자료는 발문 한 줄을 맨 앞에 */
function markedLines(linesHtml: string[]): string[] {
  const all = linesHtml.flatMap((h) => shortMarks(h).split(/<br\s*\/?>|\n/)).filter((l) => l.replace(/<[^>]+>/g, "").trim());
  const hits = all.map((l, i) => (/<mark|class="br hit"/.test(l) ? i : -1)).filter((i) => i >= 0);
  if (hits.length === 0) return all.slice(0, 8).map(clipLine);
  const keep = new Set<number>();
  const stem = all.findIndex((l) => /[가-힣].*(것은|곳은|순서|고르|쓰시오|\?)/.test(l.replace(/<[^>]+>/g, "")));
  if (stem >= 0 && stem < hits[0]!) keep.add(stem);
  for (const i of hits) for (const k of [i - 1, i, i + 1]) if (k >= 0 && k < all.length) keep.add(k);
  return [...keep].sort((a, b) => a - b).slice(0, 7).map((i) => clipLine(all[i]!));
}

/** 우리 자료 — 실제 시험지처럼(문항 번호 · 발문 · 지문 상자 · 보기 · 정답 도장) */
function Card({ card, n, academyName }: { card: BookCard; n: number; academyName: string }) {
  if (card.kind === "line") {
    return (
      <article className={`sheet wb${card.tag ? " other" : ""}`}>
        <header>
          <span className="sbrand">{academyName}</span>
          <span className="src">{card.source}</span>
          {card.tag ? <span className="stag">{card.tag}</span> : null}
          <span className="dt">{card.date ? `${card.date} 수업` : ""}</span>
        </header>
        <ul>
          {markedLines(card.linesHtml).map((h, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: h }} />
          ))}
        </ul>
      </article>
    );
  }
  const no = card.source.match(/(\d+)번$/)?.[1] ?? String(n);
  return (
    <article className={`sheet${card.tag ? " other" : ""}`}>
      <header>
        <span className="sbrand">{academyName}</span>
        <span className="src">{card.source.replace(/\s*\d+번$/, "")}</span>
        {card.tag ? <span className="stag">{card.tag}</span> : null}
        <span className="dt">{card.date ? `${card.date} 수업` : ""}</span>
        <span className="sans">정답 {card.answerNo ? CIRCLED[card.answerNo - 1] : card.answerText}</span>
      </header>
      <p className="ins">
        <b className="qno">{no}.</b> {card.instruction}
      </p>
      {card.questionText ? <div className="qt">{card.questionText}</div> : null}
      {card.passageHtml ? <div className="pm" dangerouslySetInnerHTML={{ __html: aroundMark(shortMarks(card.passageHtml)) }} /> : null}
      {card.choices.length ? (
        <ol className="ch">
          {card.choices.map((c, i) => (
            <li key={i} className={card.answerNo === i + 1 ? "ans" : undefined}>
              <span>{CIRCLED[i]}</span>
              {card.choicesHtml ? <span dangerouslySetInnerHTML={{ __html: c }} /> : <span>{c}</span>}
            </li>
          ))}
        </ol>
      ) : null}
    </article>
  );
}

function ItemPage({ it, book, academyName }: { it: BookItem; book: HitBook; academyName: string }) {
  const same = it.verdict === "same";
  const ansNo = CIRCLED.indexOf(it.answer.trim().charAt(0));
  return (
    <section className={`pg item v-${it.verdict}`}>
      {book.analysisId ? <HitBookRecheck analysisId={book.analysisId} itemId={it.id} no={it.no} /> : null}
      <div className="ph">
        <span className="brand">{academyName} 적중 자료집</span>
        <span>
          {book.title} {book.examLabel}
        </span>
      </div>
      <div className="ihead">
        <span className="ino">{it.no}</span>
        <div>
          <h3>{it.typeName}</h3>
          <span className="meta">
            {it.points != null ? `${it.points}점 · ` : ""}난이도 {it.level}
          </span>
        </div>
        <div className="hright">
          <span className="verdict">{same ? "① 동일 유형 · 동일 포인트" : "② 유사 유형"}</span>
          <div className="bigcnt">
            <b>{it.count}</b>
            <span>개</span>
            <em>
              {same ? "시험과 같은 자리를" : "이 문제를 대비해"}
              <br />
              {same ? "미리 다룬 우리 자료" : "미리 풀어 본 우리 자료"}
            </em>
          </div>
        </div>
      </div>

      <div className="top2">
        {/* 학교 시험 — 작게 */}
        <div className="exam mini">
          <div className="etag">
            학교 시험 {it.no}번 <span className="ans-chip">정답 {ansNo >= 0 ? CIRCLED[ansNo] : "✎"}</span>
          </div>
          <p className="stem">{it.stem.replace(/<\/?u>/g, "")}</p>
          <div className="ebody" dangerouslySetInnerHTML={{ __html: it.examHtml }} />
          {it.choices.length ? (
            <ol className="echo">
              {it.choices.map((c, i) => (
                <li key={i} className={c.answer ? "ans" : undefined}>
                  <span className="cn">{CIRCLED[i]}</span>
                  <span>{c.text}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>

        {/* 적중 도식 — 학교 시험 그 자리 → 우리 자료 그 자리 */}
        <div className="flow">
          <div className="ftag">적중 도식 — 어디가 같은가</div>
          {it.compare.length ? (
            it.compare.slice(0, 3).map((c, i) => (
              <div className="fpair" key={i}>
                <div className="fbox fx">
                  <span className="fl">학교 시험</span>
                  <p>{c.exam}</p>
                </div>
                <div className="farrow">
                  <span>{same ? "같은 자리" : "같은 내용"}</span>
                </div>
                <div className="fbox fo">
                  <span className="fl">{academyName} 자료 (시험 전)</span>
                  <p>{c.ours}</p>
                </div>
                <p className="fsame">✔ {c.same}</p>
              </div>
            ))
          ) : (
            <p className="fnone">같은 지문 · 같은 유형으로 미리 풀어 본 문항입니다.</p>
          )}
          <div className="fwhy">
            <div className="atag">학교 시험 정답 · 맞출 수 있었던 까닭</div>
            <p>
              <b className="fans">{ansNo >= 0 ? `${CIRCLED[ansNo]} ${it.answer.slice(1).trim()}` : it.answer}</b>
              {it.reason}
            </p>
          </div>
        </div>
      </div>

      {it.cards.length ? (
        <div className="leadbox">
          <div className="ltag">
            {same
              ? `▼ 시험 전에 학생들이 실제로 푼 ${academyName} 문제 — 같은 자리를 빨간 상자로`
              : it.cards.some((c) => c.tag)
                ? `▼ 시험 전에 학생들이 실제로 푼 ${academyName} 자료 — 형식이 다른 자료는 꼬리표로 밝혔습니다`
                : `▼ 시험 전에 학생들이 실제로 푼 ${academyName} 자료`}
          </div>
          <div className={`cards ${it.cards.length === 1 ? "one" : ""}`}>
            {it.cards.map((c, i) => (
              <Card key={i} card={c} n={i + 1} academyName={academyName} />
            ))}
          </div>
        </div>
      ) : (
        <div className="leadbox nocard">
          <div className="ltag">▼ 시험 전에 학생들이 실제로 푼 {academyName} 자료</div>
          <p className="nocard-note">
            이 문항은 시험과 같은 유형의 우리 문제 대신, 위 도식의 자료(워크북 · 1장 자료 · 다른 유형 문항)로 같은 내용을 미리 다뤘습니다.
          </p>
        </div>
      )}
      <div className="pf">
        {it.no}번 · 시험 문제 일부를 흐리게 가렸습니다.
      </div>
    </section>
  );
}

export function ExamHitBook({ book, academyName, backHref }: { book: HitBook; academyName: string; backHref?: string }) {
  const items = [...book.items].sort(itemOrder);
  const shown = items.filter((x) => x.verdict !== "none");
  const hard = book.items.filter((x) => x.level === "상");
  const hardHit = hard.filter((x) => x.verdict !== "none").length;
  const cutoff = book.cutoff ? book.cutoff.slice(0, 10).replace(/-/g, ". ") + "." : "";
  return (
    <>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&display=swap"
      />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <HitBookTools backHref={backHref} />
      <div className="hb">
        <section className="pg cover">
          <div className="cv-top">
            <span className="brand">{academyName}</span>
            <span>{book.examLabel}</span>
          </div>
          <div className="cv-mid">
            <p className="cv-school">{book.title}</p>
            <p className="cv-sub2">
              {book.examLabel} · {book.subtitle}
            </p>
            <h1>적중 자료집</h1>
            <p className="cv-sub">
              시험 전에 학생들이 풀었던 {academyName} 자료가
              <br />
              실제 시험에서 어떻게 나왔는지, 문항마다 그대로 보여 드립니다.
            </p>
          </div>
          <div className="formula">
            <div className="term t1">
              <span className="tn">①</span>
              <span className="tv">
                {pct(book.samePct)}
                <small>%</small>
              </span>
              <span className="tl">동일 유형 + 동일 포인트</span>
              <span className="ts">시험과 거의 똑같이 낸 문제 · {book.sameCount}문항</span>
            </div>
            <div className="op">+</div>
            <div className="term t2">
              <span className="tn">②</span>
              <span className="tv">
                {pct(book.similarPct)}
                <small>%</small>
              </span>
              <span className="tl">유사 유형</span>
              <span className="ts">풀었으면 바로 풀리는 문제 · {book.similarCount}문항</span>
            </div>
            <div className="op">=</div>
            <div className="term total">
              <span className="tn">적중</span>
              <span className="tv">
                {Math.round(book.samePct + book.similarPct)}
                <small>%</small>
              </span>
              <span className="tl">시험 배점 기준</span>
              <span className="ts">
                {book.total}문항 중 {book.sameCount + book.similarCount}문항
              </span>
            </div>
          </div>
          <div className="cv-count">
            <b>{book.materials}</b>
            <span>개</span>
            <p>
              시험 문제를 <b>시험 전에</b> 미리 다룬
              <br />
              {academyName} 변형문제 · 동형모의고사 · 워크북 · 1장 테스트지 · 1장 요약자료
            </p>
          </div>
          <div className="cv-foot">
            <div>
              <b>
                {book.sameCount + book.similarCount} / {book.total}
              </b>
              <span>적중 문항 (동일 + 유사)</span>
            </div>
            <div>
              <b>
                {hardHit} / {hard.length}
              </b>
              <span>난이도 상 문항 적중</span>
            </div>
            <div>
              <b>{book.sameCount}문항</b>
              <span>같은 문장 · 같은 빈칸 · 같은 밑줄까지</span>
            </div>
          </div>
          <p className="cv-note">
            대조 자료: 시험지를 올리기 전{cutoff ? `(${cutoff})` : ""}에 만든 {academyName} 변형문제 · 동형모의고사 · 워크북 · 1장 테스트지 · 1장 요약자료
          </p>
        </section>

        <section className="pg">
          <div className="ph">
            <span className="brand">{academyName} 적중 자료집</span>
            <span>
              {book.title} {book.examLabel}
            </span>
          </div>
          <h2>문항별 적중 일람</h2>
          <p className="lead">
            <b className="red">① 동일 유형 + 동일 포인트</b>는 같은 유형으로 같은 자리(같은 밑줄 · 같은 빈칸 · 같은 주어진 문장 ·
            같은 정답 표현)를 물은 것, <b className="blue">② 유사 유형</b>은 같은 지문 · 같은 유형을 풀어 바로 풀 수 있는
            것입니다. 같은 지문이라도 그 유형을 미리 풀지 않았으면 「다루지 않음」으로 셉니다.
          </p>
          {/* 문항이 많으면(서술형까지 22개 넘게) 표를 촘촘하게 — 26문항에서 마지막 줄이 A4 밖으로 밀렸다(호원고1) */}
          <table className={`list${items.length > 22 ? " dense" : ""}`}>
            <thead>
              <tr>
                <th>번호</th>
                <th>유형</th>
                <th className="r">배점</th>
                <th>난도</th>
                <th>적중</th>
                <th className="r">같은 자료</th>
                <th>{academyName} 자료</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td className="no">{it.no}</td>
                  <td>{it.typeName}</td>
                  <td className="r">{it.points ?? ""}</td>
                  <td>{it.level}</td>
                  <td>
                    <span className={`bd ${it.verdict}`}>
                      {it.verdict === "same" ? "① 동일 유형 · 동일 포인트" : it.verdict === "similar" ? "② 유사 유형" : "다루지 않음"}
                    </span>
                  </td>
                  <td className={`r ${it.verdict !== "none" ? "cntc" : ""}`}>{it.verdict !== "none" ? `${it.count}개` : "-"}</td>
                  <td className="nt">{it.reason.length > (items.length > 22 ? 40 : 52) ? `${it.reason.slice(0, items.length > 22 ? 40 : 52)}…` : it.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {shown.map((it) => (
          <ItemPage key={it.id} it={it} book={book} academyName={academyName} />
        ))}
      </div>
    </>
  );
}
