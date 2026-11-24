/**
 * 동형모의고사 문제지를 한글 파일(.hwpx)로 만든다 — 브라우저에서 바로(서버·한글 프로그램 없이).
 * 선생님 2026-11-24: 「워드는 이상하게 나오니 hwp만」「호원고 양식」「제목은 학교 이름 + 동형모의고사」
 * 「원본은 A3·B4라 A4에선 글씨를 줄여서」.
 * 모양: A4 · 머리 전체 상자(연도·학기·학년·과목·회차 / 큰 제목 / 교시·반·번·성명) · 본문 2단 가운데 줄 ·
 * 안내 상자는 왼쪽 단 맨 위 · 문항은 한 칸 표로 통째로(쪽·단에서 쪼개지지 않게) · 지문은 테두리 상자 ·
 * 아래 왼쪽 「학년 과목」, 가운데 네모 「쪽/전체」.
 * 글꼴: 한글 HY신명조, 영어 Times New Roman(학교 시험지와 같게). 단위 HWPUNIT(1mm = 283.465).
 */

export type MockHwpxItem = {
  label: string; // "1." · "[서답형 1]"
  stem: string;
  points?: number | null;
  /** 문장 삽입의 주어진 문장(지문 위 상자) */
  given?: string;
  passage?: string;
  /** 지문 아래 점선 상자(요약문·조건 등) */
  extra?: string;
  choices?: string[];
  subjective?: boolean;
};

export type MockHwpxInput = {
  t1: string; // 첫 줄
  title: string; // 큰 제목
  left: string; // 셋째 줄 왼쪽
  nameLine: string; // 셋째 줄 오른쪽
  notice: string[]; // 안내 상자 줄
  footLeft: string; // 아래 왼쪽
  items: MockHwpxItem[];
  closing?: string; // 마지막 확인 문구
};

const MM = 283.465;
const mm = (v: number) => Math.round(v * MM);
const PAGE_W = mm(210);
const PAGE_H = mm(297);
const MARGIN_LR = mm(13);
const TEXT_W = PAGE_W - 2 * MARGIN_LR;
const COL_GAP = mm(7);
const COL_W = Math.floor((TEXT_W - COL_GAP) / 2);

/** 글자 크기(pt) — A4에 맞춘 값(학교 원본 A3·B4의 약 0.8배) */
const SZ = { t1: 12.5, title: 20, line3: 9.5, notice: 8.5, stem: 9.5, passage: 9, extra: 8.8, choice: 9, foot: 8.5 };

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

// ── 글자 모양·문단 모양을 그때그때 등록(같은 모양은 한 번만) ──
type CharSpec = { pt: number; bold?: boolean; underline?: boolean; box?: boolean };
type ParaSpec = {
  align?: "LEFT" | "CENTER" | "JUSTIFY" | "RIGHT";
  left?: number;
  right?: number;
  indent?: number;
  prev?: number;
  next?: number;
  line?: number; // %
  border?: number; // borderFill id
  borderOffset?: number;
  tab?: number; // tabPr id
  keepNext?: boolean;
};

class Reg<T> {
  list: T[] = [];
  private map = new Map<string, number>();
  constructor(first: T) {
    this.get(first);
  }
  get(spec: T): number {
    const k = JSON.stringify(spec);
    let id = this.map.get(k);
    if (id === undefined) {
      id = this.list.length;
      this.list.push(spec);
      this.map.set(k, id);
    }
    return id;
  }
}

// borderFill: 1 없음, 2 없음(표), 3 얇은 실선(지문·안내), 4 얇은 점선, 5 머리 상자(굵게), 6 쪽 번호 네모
const BORDER_FILLS: Array<{ type: string; width: string } | null> = [
  null,
  { type: "NONE", width: "0.1 mm" },
  { type: "NONE", width: "0.1 mm" },
  { type: "SOLID", width: "0.12 mm" },
  { type: "DASH", width: "0.12 mm" },
  { type: "SOLID", width: "0.4 mm" },
  { type: "SOLID", width: "0.12 mm" },
];

function borderFillXml(id: number, b: { type: string; width: string }) {
  const side = (n: string) => `<hh:${n} type="${b.type}" width="${b.width}" color="#000000"/>`;
  return (
    `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">` +
    `<hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>` +
    side("leftBorder") + side("rightBorder") + side("topBorder") + side("bottomBorder") +
    `<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/></hh:borderFill>`
  );
}

const LANGS = ["HANGUL", "LATIN", "HANJA", "JAPANESE", "OTHER", "SYMBOL", "USER"] as const;
const fontRefAll = (v: (lang: string) => number) =>
  `hangul="${v("HANGUL")}" latin="${v("LATIN")}" hanja="${v("HANJA")}" japanese="${v("JAPANESE")}" other="${v("OTHER")}" symbol="${v("SYMBOL")}" user="${v("USER")}"`;
const allSame = (n: number) => `hangul="${n}" latin="${n}" hanja="${n}" japanese="${n}" other="${n}" symbol="${n}" user="${n}"`;

function charPrXml(id: number, c: CharSpec) {
  // 글꼴 0 = HY신명조, 1 = Times New Roman — 영문·숫자·기호는 Times
  const ref = fontRefAll((l) => (l === "LATIN" || l === "OTHER" ? 1 : 0));
  return (
    `<hh:charPr id="${id}" height="${Math.round(c.pt * 100)}" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="${c.box ? 6 : 2}">` +
    `<hh:fontRef ${ref}/><hh:ratio ${allSame(100)}/><hh:spacing ${allSame(0)}/><hh:relSz ${allSame(100)}/><hh:offset ${allSame(0)}/>` +
    (c.bold ? "<hh:bold/>" : "") +
    `<hh:underline type="${c.underline ? "BOTTOM" : "NONE"}" shape="SOLID" color="#000000"/>` +
    `<hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#C0C0C0" offsetX="10" offsetY="10"/></hh:charPr>`
  );
}

function paraPrXml(id: number, p: ParaSpec) {
  const margin =
    `<hh:margin><hc:intent value="${p.indent ?? 0}" unit="HWPUNIT"/><hc:left value="${p.left ?? 0}" unit="HWPUNIT"/>` +
    `<hc:right value="${p.right ?? 0}" unit="HWPUNIT"/><hc:prev value="${p.prev ?? 0}" unit="HWPUNIT"/><hc:next value="${p.next ?? 0}" unit="HWPUNIT"/></hh:margin>` +
    `<hh:lineSpacing type="PERCENT" value="${p.line ?? 150}" unit="HWPUNIT"/>`;
  const off = p.borderOffset ?? 0;
  return (
    `<hh:paraPr id="${id}" tabPrIDRef="${p.tab ?? 0}" condense="0" fontLineHeight="0" snapToGrid="0" suppressLineNumbers="0" checked="0">` +
    `<hh:align horizontal="${p.align ?? "JUSTIFY"}" vertical="BASELINE"/>` +
    `<hh:heading type="NONE" idRef="0" level="0"/>` +
    `<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="${p.keepNext ? 1 : 0}" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>` +
    `<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>` +
    `<hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar">${margin}</hp:case><hp:default>${margin}</hp:default></hp:switch>` +
    `<hh:border borderFillIDRef="${p.border ?? 2}" offsetLeft="${off}" offsetRight="${off}" offsetTop="${off}" offsetBottom="${off}" connect="1" ignoreMargin="0"/>` +
    `</hh:paraPr>`
  );
}

const NS =
  'xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>';

function headerXml(chars: CharSpec[], paras: ParaSpec[], tabs: string[]) {
  const fonts = (lang: string) =>
    `<hh:fontface lang="${lang}" fontCnt="2">` +
    `<hh:font id="0" face="HY신명조" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_MYUNGJO" weight="6" proportion="0" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>` +
    `<hh:font id="1" face="Times New Roman" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_MYUNGJO" weight="6" proportion="0" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>` +
    `</hh:fontface>`;
  const bfs = BORDER_FILLS.map((b, i) => (b ? borderFillXml(i, b) : "")).join("");
  return (
    XML_HEAD +
    `<hh:head ${NS} version="1.4" secCnt="1"><hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/><hh:refList>` +
    `<hh:fontfaces itemCnt="${LANGS.length}">${LANGS.map(fonts).join("")}</hh:fontfaces>` +
    `<hh:borderFills itemCnt="${BORDER_FILLS.length - 1}">${bfs}</hh:borderFills>` +
    `<hh:charProperties itemCnt="${chars.length}">${chars.map((c, i) => charPrXml(i, c)).join("")}</hh:charProperties>` +
    `<hh:tabProperties itemCnt="${tabs.length}">${tabs.join("")}</hh:tabProperties>` +
    `<hh:paraProperties itemCnt="${paras.length}">${paras.map((p, i) => paraPrXml(i, p)).join("")}</hh:paraProperties>` +
    `<hh:styles itemCnt="1"><hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/></hh:styles>` +
    `</hh:refList><hh:compatibleDocument targetProgram="HWP201X"><hh:layoutCompatibility/></hh:compatibleDocument>` +
    `<hh:docOption><hh:linkinfo path="" pageInherit="0" footnoteInherit="0"/></hh:docOption><hh:trackchageConfig flags="56"/></hh:head>`
  );
}

function tabPrXml(id: number, items: Array<{ pos: number; type: "RIGHT" | "CENTER" }>) {
  if (!items.length) return `<hh:tabPr id="${id}" autoTabLeft="0" autoTabRight="0"/>`;
  return (
    `<hh:tabPr id="${id}" autoTabLeft="0" autoTabRight="0">` +
    items
      .map(
        (t) =>
          `<hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar"><hh:tabItem pos="${t.pos}" type="${t.type}" leader="NONE" unit="HWPUNIT"/></hp:case>` +
          `<hp:default><hh:tabItem pos="${t.pos * 2}" type="${t.type}" leader="NONE"/></hp:default></hp:switch>`,
      )
      .join("") +
    `</hh:tabPr>`
  );
}

// ── 본문 ──
export function buildMockHwpxSection(input: MockHwpxInput) {
  const chars = new Reg<CharSpec>({ pt: SZ.passage });
  const paras = new Reg<ParaSpec>({});
  const TAB_HEAD = 1; // 셋째 줄 오른쪽 맞춤
  const TAB_FOOT = 2; // 아래 가운데
  const headInner = TEXT_W - 2 * mm(1.8);
  const tabs = [
    tabPrXml(0, []),
    tabPrXml(1, [{ pos: headInner, type: "RIGHT" }]),
    tabPrXml(2, [{ pos: Math.round(TEXT_W / 2), type: "CENTER" }]),
  ];
  let tblId = 1000;

  /** <u>·<b> 만 살린 글자 조각 */
  function runs(text: string, base: CharSpec): string {
    const t = decodeEntities(String(text ?? ""));
    const parts = t.split(/(<\/?u>|<\/?b>|\t)/);
    let u = false;
    let b = false;
    let out = "";
    for (const part of parts) {
      if (part === "<u>" || part === "</u>") {
        u = part === "<u>";
        continue;
      }
      if (part === "<b>" || part === "</b>") {
        b = part === "<b>";
        continue;
      }
      const id = chars.get({ ...base, bold: base.bold || b || undefined, underline: u || undefined });
      if (part === "\t") {
        out += `<hp:run charPrIDRef="${id}"><hp:t><hp:tab width="4000" leader="0" type="2"/></hp:t></hp:run>`;
        continue;
      }
      // HTML 꾸밈 태그만 지운다 — <보기>·<조건> 같은 시험지 표시는 글자 그대로(지우면 「흐름에 맞게 의 단어를」처럼 끊겼다)
      const clean = part.replace(/<\/?(?:u|b|i|em|strong|span|br|p|div|font|sup|sub)(?=[\s>/])[^>]*>/gi, "");
      if (!clean) continue;
      out += `<hp:run charPrIDRef="${id}"><hp:t>${esc(clean)}</hp:t></hp:run>`;
    }
    return out || `<hp:run charPrIDRef="${chars.get(base)}"/>`;
  }
  const P = (spec: ParaSpec, inner: string) =>
    `<hp:p id="0" paraPrIDRef="${paras.get(spec)}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${inner}</hp:p>`;

  /** 한 칸 표(테두리 있음/없음) — 안의 문단들을 담는다 */
  function table(width: number, cellBorder: number, inner: string, opts: { pad?: number; noSplit?: boolean; align?: "LEFT" | "CENTER" } = {}) {
    const pad = opts.pad ?? 0;
    const id = tblId++;
    return (
      `<hp:tbl id="${id}" zOrder="${id - 1000}" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="${opts.noSplit ? "NONE" : "CELL"}" repeatHeader="0" rowCnt="1" colCnt="1" cellSpacing="0" borderFillIDRef="2" noAdjust="0">` +
      `<hp:sz width="${width}" widthRelTo="ABSOLUTE" height="1000" heightRelTo="ABSOLUTE" protect="0"/>` +
      `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="${opts.align ?? "LEFT"}" vertOffset="0" horzOffset="0"/>` +
      `<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="${pad}" right="${pad}" top="${pad}" bottom="${pad}"/>` +
      `<hp:tr><hp:tc name="" header="0" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="${cellBorder}">` +
      `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${inner}</hp:subList>` +
      `<hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${width}" height="1000"/>` +
      `<hp:cellMargin left="${pad}" right="${pad}" top="${pad}" bottom="${pad}"/></hp:tc></hp:tr></hp:tbl>`
    );
  }
  /** 여러 칸 표 — <표> 블록용. rows[r][c] 는 칸 안 문단 XML */
  function gridTable(width: number, rows: string[][], border: number, fractions?: number[]) {
    const cols = Math.max(...rows.map((r) => r.length));
    const cw = Math.floor(width / cols);
    // 칸 너비(비율) — 없으면 고르게
    const colW = (ci: number, span: number) =>
      fractions ? Math.round(width * fractions.slice(ci, ci + span).reduce((a, b) => a + b, 0)) : cw * span;
    const id = tblId++;
    const pad = mm(1);
    const trs = rows
      .map(
        (r, ri) =>
          `<hp:tr>${Array.from({ length: cols }, (_, ci) => {
            const span = ci === r.length - 1 ? cols - ci : 1;
            if (ci >= r.length) return "";
            return (
              `<hp:tc name="" header="0" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="${border}">` +
              `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${r[ci]}</hp:subList>` +
              `<hp:cellAddr colAddr="${ci}" rowAddr="${ri}"/><hp:cellSpan colSpan="${span}" rowSpan="1"/><hp:cellSz width="${colW(ci, span)}" height="1000"/>` +
              `<hp:cellMargin left="${pad}" right="${pad}" top="${pad}" bottom="${pad}"/></hp:tc>`
            );
          }).join("")}</hp:tr>`,
      )
      .join("");
    return (
      `<hp:tbl id="${id}" zOrder="${id - 1000}" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="NONE" repeatHeader="0" rowCnt="${rows.length}" colCnt="${cols}" cellSpacing="0" borderFillIDRef="2" noAdjust="0">` +
      `<hp:sz width="${fractions ? width : cw * cols}" widthRelTo="ABSOLUTE" height="1000" heightRelTo="ABSOLUTE" protect="0"/>` +
      `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
      `<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="${pad}" right="${pad}" top="${pad}" bottom="${pad}"/>${trs}</hp:tbl>`
    );
  }
  const anchor = (spec: ParaSpec, ctrl: string) =>
    P(spec, `<hp:run charPrIDRef="${chars.get({ pt: 1 })}">${ctrl}<hp:t/></hp:run>`);

  // 1) 머리 상자(1단)
  const head =
    P({ align: "CENTER", line: 130, prev: mm(1.2), next: mm(0.6) }, runs(input.t1, { pt: SZ.t1 })) +
    P({ align: "CENTER", line: 130, next: mm(2) }, runs(input.title, { pt: SZ.title, bold: true })) +
    P({ align: "LEFT", line: 130, tab: TAB_HEAD, next: mm(0.8) }, runs(`${input.left}\t${input.nameLine}`, { pt: SZ.line3, bold: true }));

  // 아래: 왼쪽 학년 과목 · 가운데 네모 쪽/전체
  const footCs = chars.get({ pt: SZ.foot, bold: true });
  const boxCs = chars.get({ pt: SZ.foot, box: true });
  const autoNum = (t: string) =>
    `<hp:ctrl><hp:autoNum num="1" numType="${t}"><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar="" supscript="0"/></hp:autoNum></hp:ctrl>`;
  const footer =
    `<hp:ctrl><hp:footer id="1" applyPageType="BOTH"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="BOTTOM" linkListIDRef="0" linkListNextIDRef="0" textWidth="${TEXT_W}" textHeight="${mm(8)}" hasTextRef="0" hasNumRef="0">` +
    P(
      { align: "LEFT", tab: TAB_FOOT, line: 130 },
      `<hp:run charPrIDRef="${footCs}"><hp:t>${esc(input.footLeft)}<hp:tab width="4000" leader="0" type="3"/></hp:t></hp:run>` +
        `<hp:run charPrIDRef="${boxCs}"><hp:t>    </hp:t>${autoNum("PAGE")}<hp:t>/</hp:t>${autoNum("TOTAL_PAGE")}<hp:t>    </hp:t></hp:run>`,
    ) +
    `</hp:subList></hp:footer></hp:ctrl>`;

  const secPr =
    `<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="${COL_GAP}" tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="0" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0">` +
    `<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/><hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>` +
    `<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>` +
    `<hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>` +
    `<hp:pagePr landscape="WIDELY" width="${PAGE_W}" height="${PAGE_H}" gutterType="LEFT_ONLY"><hp:margin header="0" footer="${mm(8)}" gutter="0" left="${MARGIN_LR}" right="${MARGIN_LR}" top="${mm(12)}" bottom="${mm(6)}"/></hp:pagePr>` +
    `<hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr>` +
    `<hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/></hp:endNotePr>` +
    `<hp:pageBorderFill type="BOTH" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>` +
    `<hp:pageBorderFill type="EVEN" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>` +
    `<hp:pageBorderFill type="ODD" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>` +
    `</hp:secPr>`;
  const oneCol = `<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>`;
  const tiny = chars.get({ pt: 1 });
  let body =
    P({ align: "LEFT", line: 100 }, `<hp:run charPrIDRef="${tiny}">${secPr}${oneCol}</hp:run><hp:run charPrIDRef="${tiny}">${footer}${table(TEXT_W, 5, head, { pad: mm(1.8), noSplit: true })}<hp:t/></hp:run>`) +
    P({ line: 100, next: mm(1.5) }, `<hp:run charPrIDRef="${tiny}"/>`);

  // 2) 본문 2단(가운데 줄)
  const twoCol = `<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="2" sameSz="1" sameGap="${COL_GAP}"><hp:colLine type="SOLID" width="0.12 mm" color="#000000"/></hp:colPr></hp:ctrl>`;
  body += P({ line: 100 }, `<hp:run charPrIDRef="${tiny}">${twoCol}</hp:run>`);

  // 안내 상자(왼쪽 단 맨 위)
  const noticeInner = input.notice
    .filter((l) => l.trim())
    .map((l) => P({ align: "LEFT", line: 135, left: mm(2.4), indent: -mm(2.4) }, runs(l, { pt: SZ.notice })))
    .join("");
  if (noticeInner) body += anchor({ line: 100, next: mm(3) }, table(COL_W, 3, noticeInner, { pad: mm(1.4), noSplit: true }));

  const BOX_W = COL_W - mm(0.4);
  const gap = (n: number) => P({ line: 100, next: mm(n) }, `<hp:run charPrIDRef="${tiny}"/>`);
  /** 테두리 상자(네 변 모두) — 안 문단들을 한 칸 표로 감싼다. 문단 테두리는 한글에서 양옆 줄이 빠졌다 */
  const boxed = (inner: string, opts: { dashed?: boolean; pad?: number } = {}) =>
    anchor({ line: 100, next: 0 }, table(BOX_W, opts.dashed ? 4 : 3, inner, { pad: opts.pad ?? mm(1.8), noSplit: true }));
  const psgP = (text: string, size = SZ.passage) => P({ align: "JUSTIFY", line: 140 }, runs(text, { pt: size }));
  const labelP = (t: string) => P({ align: "LEFT", line: 140, next: mm(0.8) }, runs(t, { pt: SZ.extra, bold: true }));

  /** <조건>·<보기>·<요약문>·<표>·<답란> … 블록으로 나눈다(한 줄이 「<이름>」뿐이면 새 블록) */
  function splitBlocks(qt: string) {
    const out: Array<{ tag: string; lines: string[] }> = [{ tag: "", lines: [] }];
    for (const raw of decodeEntities(qt).split("\n")) {
      const line = raw.trim();
      const m = line.match(/^<\s*([^<>/]{1,10}?)\s*>$/);
      if (m) out.push({ tag: m[1]!.trim(), lines: [] });
      else if (line) out[out.length - 1]!.lines.push(line);
    }
    return out.filter((b) => b.tag || b.lines.length);
  }
  const ANSWER_TAGS = /^(답란|지칭답란|답안행|답)$/;
  /** 답란 — 네모 칸(학교 시험지처럼). 밑줄 글자는 한글에서 몇 군데 안 그려졌다 */
  function answerArea(tag: string, lines: string[]) {
    const cellP = (t: string, opts: { bold?: boolean; center?: boolean } = {}) =>
      P({ align: opts.center ? "CENTER" : "LEFT", line: 130 }, runs(t, { pt: SZ.choice, bold: opts.bold }));
    // 손으로 쓸 높이(약 8mm) — 큰 글자 한 줄로 칸을 키운다
    const blank = P({ align: "LEFT", line: 160 }, runs(" ", { pt: 15 }));
    let rows: string[][];
    let fr: number[];
    if (tag === "답안행") {
      const n = Math.max(3, Math.min(5, Number(lines[0]) || 3));
      rows = [
        [cellP("", { center: true }), cellP("기호", { bold: true, center: true }), cellP("바르게 고친 것", { bold: true, center: true })],
        ...Array.from({ length: n }, (_, i) => [cellP(`(${i + 1})`, { center: true }), blank, blank]),
      ];
      fr = [0.12, 0.22, 0.66];
    } else {
      const labels = lines.filter((l) => l.length <= 8).map((l) => l.replace(/[:：]\s*$/, ""));
      rows = (labels.length ? labels : ["답"]).map((l) => [cellP(l, { bold: true, center: true }), blank]);
      fr = [0.14, 0.86];
    }
    return P({ line: 100, next: mm(1.2) }, `<hp:run charPrIDRef="${tiny}"/>`) + anchor({ line: 100 }, gridTable(BOX_W, rows, 3, fr));
  }
  function blockXml(tag: string, lines: string[], dashedPlain: boolean) {
    if (!tag) return boxed(lines.map((l) => psgP(l, SZ.extra)).join(""), { dashed: dashedPlain });
    if (ANSWER_TAGS.test(tag)) return answerArea(tag, lines);
    if (tag === "표") {
      const rows = lines
        .filter((l) => l.includes("|") && !/^\|?\s*[-:| ]+\|?\s*$/.test(l))
        .map((l) => l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim()));
      if (rows.length) {
        const cells = rows.map((r, ri) => r.map((c) => P({ align: ri === 0 ? "CENTER" : "LEFT", line: 135 }, runs(c || " ", { pt: SZ.extra, bold: ri === 0 }))));
        return labelP("<표>") + anchor({ line: 100 }, gridTable(BOX_W, cells, 3));
      }
    }
    // <보기> 낱말 나열은 한 줄에 「 / 」로
    const wordList = tag === "보기" && lines.length >= 3 && lines.every((l) => l.split(/\s+/).length <= 3 && !/^[①-⑩(]/.test(l));
    const body = wordList
      ? P({ align: "CENTER", line: 160 }, runs(lines.join("  /  "), { pt: SZ.passage }))
      : lines.map((l) => (/^[○●·\-※]/.test(l) ? P({ align: "LEFT", line: 145, left: mm(2.6), indent: -mm(2.6) }, runs(l, { pt: SZ.extra })) : psgP(l, SZ.extra))).join("");
    return boxed(P({ align: "LEFT", line: 130, next: mm(1) }, runs(`<${tag}>`, { pt: SZ.extra, bold: true })) + body);
  }

  for (const it of input.items) {
    const pts = typeof it.points === "number" ? ` [${Math.round(it.points * 10) / 10}점]` : "";
    let inner = P(
      { align: "LEFT", line: 150, left: mm(3.2), indent: -mm(3.2), next: mm(2.2) },
      `<hp:run charPrIDRef="${chars.get({ pt: SZ.stem, bold: true })}"><hp:t>${esc(it.label)} </hp:t></hp:run>` +
        runs((it.stem || "다음 물음에 답하시오.") + pts, { pt: SZ.stem }),
    );
    if (it.given?.trim()) {
      inner += boxed(psgP(it.given.trim())) + gap(2.4);
    }
    if (it.passage?.trim()) {
      const ps = it.passage.split(/\n\s*\n|\n(?=\([A-C]\))/).filter((x) => x.trim());
      inner += boxed(ps.map((x) => psgP(x.replace(/\s*\n\s*/g, " ").trim())).join(""));
    }
    if (it.extra?.trim()) {
      for (const bl of splitBlocks(it.extra)) {
        inner += gap(ANSWER_TAGS.test(bl.tag) ? 0.5 : 2.4) + blockXml(bl.tag, bl.lines, !it.subjective);
      }
    }
    const ch = (it.choices ?? []).filter((c) => String(c ?? "").trim());
    if (ch.length) {
      inner += gap(3);
      const marks = "①②③④⑤⑥⑦";
      inner += ch
        .map((c, i) => P({ align: "LEFT", line: 145, left: mm(5), indent: -mm(3.6), next: mm(0.9) }, runs(`${marks[i] ?? `${i + 1}`} ${c}`, { pt: SZ.choice })))
        .join("");
    } else if (it.subjective && !/<\s*(답란|지칭답란|답안행)\s*>/.test(it.extra ?? "")) {
      // 답란 표시가 없으면 발문·문제에 나온 ⓐ ⓑ …로 칸을 만든다
      const src = `${it.stem} ${it.extra ?? ""}`;
      let marks = [...new Set(src.match(/[ⓐ-ⓗ]/g) ?? [])];
      if (!marks.length) marks = [...new Set([...it.stem.matchAll(/\(([A-E])\)/g)].map((m) => `(${m[1]})`))];
      inner += answerArea("답", marks);
    }
    // 끝에 얇은 여백 한 줄 — 없으면 한글에서 마지막 상자의 아랫줄이 잘렸다(보기 없는 문항)
    inner += gap(0.6);
    body += anchor({ line: 100, next: mm(4.5) }, table(COL_W, 2, inner, { noSplit: true }));
  }
  if (input.closing?.trim()) {
    body += anchor({ line: 100, prev: mm(4) }, table(COL_W, 3, P({ align: "LEFT", line: 135 }, runs(input.closing, { pt: SZ.notice })), { pad: mm(1.4), noSplit: true }));
  }

  const section = XML_HEAD + `<hs:sec ${NS}>${body}</hs:sec>`;
  return { section, header: headerXml(chars.list, paras.list, tabs) };
}

// ── 압축(저장만, 압축 없음) — mimetype 이 맨 앞 ──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 이름
    local.setUint16(8, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, f.data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, f.data.length, true);
    cen.setUint32(24, f.data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cenSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

export function buildMockHwpx(input: MockHwpxInput): Uint8Array {
  const { section, header } = buildMockHwpxSection(input);
  const enc = new TextEncoder();
  const hpf =
    XML_HEAD +
    `<opf:package ${NS} version="" unique-identifier="" id=""><opf:metadata><opf:title>${esc(input.title)}</opf:title><opf:language>ko</opf:language></opf:metadata>` +
    `<opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/><opf:item id="settings" href="settings.xml" media-type="application/xml"/></opf:manifest>` +
    `<opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>`;
  const files: Array<[string, string]> = [
    ["mimetype", "application/hwp+zip"],
    [
      "version.xml",
      XML_HEAD +
        `<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="0" buildNumber="1" os="1" xmlVersion="1.4" application="Hancom Office Hangul" appVersion="11, 0, 0, 0"/>`,
    ],
    [
      "META-INF/container.xml",
      XML_HEAD +
        `<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/></ocf:rootfiles></ocf:container>`,
    ],
    ["META-INF/manifest.xml", XML_HEAD + `<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>`],
    ["Contents/content.hpf", hpf],
    ["Contents/header.xml", header],
    ["Contents/section0.xml", section],
    [
      "settings.xml",
      XML_HEAD +
        `<ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>`,
    ],
  ];
  return zipStore(files.map(([name, s]) => ({ name, data: enc.encode(s) })));
}
