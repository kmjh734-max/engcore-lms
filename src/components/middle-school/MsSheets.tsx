"use client";

import { useEffect, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import { msLectureUrl, msVocabUrl, type MsLectureSlug } from "@/lib/middle-school/qr-url";
import type { TestBookProjectInput } from "@/lib/lesson-materials/test-book";
import type { MaterialDesign } from "@/lib/lesson-materials/material-design";
import type { MsGrammar, MsText, MsUnit, MsWord } from "@/lib/middle-school/queries";
import type { MsWbSheet } from "@/lib/middle-school/workbook";
import type { AnalysisReportData } from "@/lib/lesson-materials/generate-analysis-report";
import { DESIGN_FONTS_HREF, designClass, type AnalysisDesignStyle } from "@/lib/lesson-materials/analysis-design";
import {
  AnalysisSheets,
  AnswerSheets,
  DocHead,
  LessonSheets,
  PagedSheet,
  TEST_BOOK_CSS,
  TEST_BOOK_FONTS_HREF,
  TestBookBrand,
  TestSheets,
  type Block,
} from "@/components/lesson-materials/test-book/TestBookSheets";

/*
 * 중학교 수업자료를 고등 수업자료(테스트 교재·테스트지)와 같은 부품·같은 디자인으로 그린다
 * (선생님 2026-10-29 「디자인은 원래 수업자료에서 만든 걸 그대로」).
 */

/** 인쇄 틀: 글꼴·디자인 바탕·쪽 번호·A4 용지 */
export function MsPrintFrame({ design, academyName, children }: { design: MaterialDesign; academyName: string; children: ReactNode }) {
  useEffect(() => {
    const root = document.getElementById("tb-print-root");
    if (!root) return;
    const count = () => {
      // 최종통합자료에 끼운 문제(변형문제 쪽 .qg-print-page)도 같은 번호 줄기로 센다
      const all = Array.from(root.querySelectorAll<HTMLElement>(".tb-sheet, .qg-print-page")).filter((el) => !el.closest(".tb-measure"));
      all.forEach((el, i) => {
        const no = el.querySelector<HTMLElement>(":scope > .tb-foot .tb-pgno") ?? el.querySelector<HTMLElement>(".qg-print-footer-page");
        if (no && no.textContent !== `- ${i + 1} -`) no.textContent = `- ${i + 1} -`;
      });
    };
    count();
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(count);
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <>
      <link rel="stylesheet" href={TEST_BOOK_FONTS_HREF} />
      <style>{TEST_BOOK_CSS}</style>
      <style>{"@media print{@page{size:210mm 297mm;margin:0}#tb-print-root{transform:none !important;gap:0 !important}}"}</style>
      {/* 끼워 넣은 문제(변형문제 인쇄 부품): 전역 규칙이 맨 위에 절대 위치로 고정하고 이름 붙은 쪽을 쓰는데, 여기서는 차례로 흐르게 한다 */}
      <style>{"#tb-print-root #qg-print-root{padding:0}@media print{#tb-print-root #qg-print-root{position:static !important;width:210mm !important;max-width:210mm !important;margin:0 !important;padding:0 !important;page:auto !important}#tb-print-root .qg-print-page-last{break-after:page !important;page-break-after:always !important}}"}</style>
      <TestBookBrand.Provider value={{ logoSrc: null, academy: academyName }}>
        <div id="tb-print-root" className={`tb-theme-${design} relative flex flex-col items-center gap-6 print:gap-0 [&_.tb-sheet]:shadow`}>
          {children}
        </div>
      </TestBookBrand.Provider>
    </>
  );
}

function asProject(
  id: string,
  title: string,
  titleEn: string | null,
  source: string,
  sentences: TestBookProjectInput["sentences"],
  analysis: AnalysisReportData | null = null,
): TestBookProjectInput {
  return { id, title, titleEn, source, sentences, content: null, material: null, analysis };
}

export function msSource(unit: Pick<MsUnit, "grade" | "publisher" | "lessonNo">): string {
  return `${unit.grade} ${unit.publisher} ${unit.lessonNo}과`;
}

/** 분석이 들어 있는 본문만 */
export function msAnalyzed(unit: MsUnit): MsText[] {
  return unit.passages.filter((t) => (t.analysis?.sentences?.length ?? 0) > 0);
}

const WORD_GRID = "8mm 34mm 10mm 52mm 1fr";
const POS = /^((?:n|v|a|adj|adv|prep|conj|pron|int)\.)\s*/;

/** 쪽 머리글 오른쪽의 QR(WORDS·GRAMMAR 글자 자리). 머리글 위 여백까지 올려 놓아 본문 자리를 차지하지 않는다 */
function MsQrBar({ url, title, sub }: { url: string; title: string; sub: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, { width: 240, margin: 1, errorCorrectionLevel: "M" })
      .then((d) => alive && setSrc(d))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [url]);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "2mm", height: "15mm", margin: "-17mm 0 2mm", position: "relative" }}>
      <div style={{ textAlign: "right", lineHeight: 1.3 }}>
        <div style={{ fontWeight: 700, fontSize: "9.5pt", color: "#1f2937" }}>{title}</div>
        <div style={{ fontSize: "7pt", color: "#6a707c" }}>{sub}</div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt={`${title} QR`} style={{ width: "15mm", height: "15mm", display: "block", background: "#fff" }} /> : <div style={{ width: "15mm", height: "15mm" }} />}
    </div>
  );
}

const unitLabel = (unit: Pick<MsUnit, "grade" | "publisher" | "lessonNo">) => `${unit.grade} ${unit.publisher} ${unit.lessonNo}과`;

function MsLectureQr({ unit, slug }: { unit: MsUnit; slug: MsLectureSlug }) {
  if (!unit.lectureSections.includes(slug)) return null;
  const ko = slug === "dialogue" ? "대화문" : slug === "grammar" ? "문법" : "본문";
  return <MsQrBar url={msLectureUrl(unit.id, slug)} title={`${ko} 강의`} sub={unitLabel(unit)} />;
}

export function MsWordSheets({ unit, examples, measureKey }: { unit: MsUnit; examples: boolean; measureKey: string }) {
  const head = (
    <div className="tb-row tb-th tb-vrow" style={{ gridTemplateColumns: WORD_GRID }}>
      <div />
      <div>단어</div>
      <div />
      <div>뜻</div>
      <div>{examples ? "예문" : ""}</div>
    </div>
  );
  const blocks: Block[] = [];
  let n = 0;
  for (const sec of ["대화문", "본문"] as const) {
    const ws = unit.words.filter((w) => w.section === sec);
    if (!ws.length) continue;
    ws.forEach((w: MsWord, wi) => {
      n++;
      const pos = w.meaning.match(POS)?.[1] ?? "";
      blocks.push({
        key: `w${n}`,
        node: (
          <>
            {/* 소제목이 쪽 끝에 혼자 남지 않게 첫 낱말과 한 덩어리로 */}
            {wi === 0 ? <div className="tb-q" style={{ margin: "2mm 0 1mm" }}>{sec} 단어</div> : null}
          <div className="tb-row tb-vrow" style={{ gridTemplateColumns: WORD_GRID }}>
            <div className="tb-n">{n}</div>
            <div className="tb-w tb-en">{w.word}</div>
            <div className="tb-pos">{pos}</div>
            <div>{w.meaning.replace(POS, "")}</div>
            <div className="tb-en" style={{ color: "#6a707c" }}>
              {examples ? (w.examples?.[0]?.en ?? "") : ""}
            </div>
          </div>
          </>
        ),
      });
    });
  }
  return (
    <PagedSheet
      blocks={blocks}
      measureKey={measureKey}
      head={(page) => (
        <>
          <DocHead title="단어" sub={page > 0 ? "(이어서)" : `${unit.words.length}단어`} label={page === 0 ? "" : "WORDS"} right={page === 0 ? undefined : unitLabel(unit)} />
          {page === 0 ? <MsQrBar url={msVocabUrl(unit.id)} title="단어학습" sub={unitLabel(unit)} /> : null}
          {head}
        </>
      )}
    />
  );
}

export function MsGrammarSheets({ unit, measureKey }: { unit: MsUnit; measureKey: string }) {
  const blocks: Block[] = unit.grammar.flatMap((g: MsGrammar, gi) => [
    {
      key: `g${gi}`,
      node: (
        <div className="tb-b" style={{ marginTop: gi ? "4mm" : 0 }}>
          <div className="tb-q">
            <span className="tb-qn">{gi + 1}</span>
            {g.title}
          </div>
          <ul style={{ margin: "1.5mm 0 0", paddingLeft: "5mm", listStyle: "disc", fontSize: "9.5pt", lineHeight: 1.6 }}>
            {g.points.map((p, i) => {
              const [text, eg] = p.split(" | ");
              return (
                <li key={i} style={{ margin: "1mm 0" }}>
                  {text}
                  {eg ? <div className="tb-en tb-tip" style={{ fontSize: "8.8pt" }}>e.g. {eg}</div> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ),
    },
    ...g.examples.map((x, i) => ({
      key: `g${gi}-x${i}`,
      node: (
        <div className="tb-ss">
          <span className="tb-i">{String(i + 1).padStart(2, "0")}</span>
          <div>
            <div className="tb-en">
              {x.en}
              {x.fromText ? <span className="tb-tip" style={{ marginLeft: "2mm" }}>교과서 본문</span> : null}
            </div>
            <div className="tb-ko">{x.ko}</div>
          </div>
        </div>
      ),
    })),
  ]);
  return (
    <PagedSheet
      blocks={blocks}
      measureKey={measureKey}
      head={(page) => (
        <>
          <DocHead title="문법" sub={page > 0 ? "(이어서)" : unit.grammar.map((g) => g.title).join(" · ")} label={page === 0 && unit.lectureSections.includes("grammar") ? "" : "GRAMMAR"} right={page === 0 && unit.lectureSections.includes("grammar") ? undefined : unitLabel(unit)} />
          {page === 0 ? <MsLectureQr unit={unit} slug="grammar" /> : null}
        </>
      )}
    />
  );
}

/** 대화문: 대화마다 소제목 + 말차례별 해석(짧은 대화가 한 쪽씩 차지하지 않게 이어 싣는다) */
export function MsDialogueSheets({ unit, translation, measureKey }: { unit: MsUnit; translation: "show" | "hide"; measureKey: string }) {
  const blocks: Block[] = unit.dialogues.flatMap((t, ti) => [
    {
      key: `dh${ti}`,
      node: (
        <div className="tb-q" style={{ marginTop: ti ? "4mm" : 0 }}>
          <span className="tb-qn">{ti + 1}</span>
          {t.title ?? t.part}
        </div>
      ),
    },
    ...t.lines.map((l, i) => ({
      key: `d${ti}-${i}`,
      node: (
        <div className="tb-ss">
          <span className="tb-i">{l.speaker}</span>
          <div>
            <div className="tb-en">{l.en}</div>
            {translation === "show" ? <div className="tb-ko">{l.ko}</div> : <div className="tb-line" />}
          </div>
        </div>
      ),
    })),
  ]);
  return (
    <PagedSheet
      blocks={blocks}
      measureKey={measureKey}
      head={(page) => (
        <>
          <DocHead
            title="대화문"
            sub={page > 0 ? "(이어서)" : translation === "show" ? "해석 있음" : "해석 쓰기"}
            label={page === 0 && unit.lectureSections.includes("dialogue") ? "" : "DIALOGUE"}
            right={page === 0 && unit.lectureSections.includes("dialogue") ? undefined : unitLabel(unit)}
          />
          {page === 0 ? <MsLectureQr unit={unit} slug="dialogue" /> : null}
        </>
      )}
    />
  );
}

export type MsLessonOptions = {
  sections: { words: boolean; grammar: boolean; dialogue: boolean; reading: boolean };
  translation: "show" | "hide";
  wordExamples: boolean;
};

/** 본문: 본문마다 문장별 해석(고등 수업용 자료 부품) */
export function MsReadingSheets({ unit, translation, measureKey }: { unit: MsUnit; translation: "show" | "hide"; measureKey: string }) {
  const source = msSource(unit);
  return (
    <>
      {unit.passages.map((t: MsText, i) => (
        <LessonSheets
          key={t.id}
          index={i}
          project={asProject(
            t.id,
            `${t.part} ${t.title ?? ""}`.trim(),
            i === 0 ? unit.title : null,
            source,
            t.lines.map((l) => ({ english: l.speaker ? `${l.speaker}: ${l.en}` : l.en, korean: l.ko })),
          )}
          translation={translation}
          measureKey={measureKey}
          lead={i === 0 ? <MsLectureQr unit={unit} slug="reading" /> : undefined}
        />
      ))}
    </>
  );
}

/** 수업용 자료: 단어 → 대화문 → 문법 → 본문(선생님 2026-10-30 차례·제목) */
export function MsLessonSheets({ unit, options }: { unit: MsUnit; options: MsLessonOptions }) {
  const mk = `${unit.id}-${options.translation}-${options.wordExamples}`;
  return (
    <>
      {options.sections.words ? <MsWordSheets unit={unit} examples={options.wordExamples} measureKey={mk} /> : null}
      {options.sections.dialogue && unit.dialogues.length ? <MsDialogueSheets unit={unit} translation={options.translation} measureKey={mk} /> : null}
      {options.sections.grammar && unit.grammar.length ? <MsGrammarSheets unit={unit} measureKey={mk} /> : null}
      {options.sections.reading ? <MsReadingSheets unit={unit} translation={options.translation} measureKey={mk} /> : null}
    </>
  );
}

/** 워크북·뽑은 테스트지: 지문마다 테스트지 + 정답 */
export function MsWorkbookSheets({ sheets, answers, title, measureKey }: { sheets: MsWbSheet[]; answers: boolean; title: string; measureKey: string }) {
  const proj = (s: MsWbSheet) => asProject(s.key, s.title, s.titleEn, s.source, []);
  return (
    <>
      {sheets.map((s) => (
        <TestSheets key={s.key} index={s.index} project={proj(s)} sheet={s.sheet} title={title} measureKey={measureKey} />
      ))}
      {answers && sheets.length ? (
        <AnswerSheets title={`${title} 정답`} entries={sheets.map((s) => ({ index: s.index, project: proj(s), sheet: s.sheet }))} measureKey={measureKey} />
      ) : null}
    </>
  );
}

export type MsAnalysisOptions = { style: AnalysisDesignStyle; translation: "full" | "chunk" };

/**
 * 분석서: 본문마다 문장 분석(고등 「분석 자료」 부품 그대로 — 성분·괄호·이름표·번호 설명·해석).
 * 분석은 직접 써서 ms_texts.analysis 에 넣어 둔 것만 싣는다(모델 호출 없음).
 */
export function MsAnalysisSheets({ unit, options, measureKey }: { unit: MsUnit; options: MsAnalysisOptions; measureKey: string }) {
  const source = msSource(unit);
  const list = msAnalyzed(unit);
  if (!list.length) return null;
  return (
    <div className={`contents ${designClass(options.style)}`}>
      <link rel="stylesheet" href={DESIGN_FONTS_HREF} />
      {list.map((t) => {
        const i = unit.passages.indexOf(t);
        return (
          <AnalysisSheets
            key={t.id}
            index={i}
            project={asProject(t.id, `${t.part} ${t.title ?? ""}`.trim(), i === 0 ? unit.title : null, source, [], t.analysis ?? null)}
            translation={options.translation}
            measureKey={`${measureKey}|${options.style}|${options.translation}`}
          />
        );
      })}
    </div>
  );
}

/** 워크북·테스트지 정답만(최종통합자료의 정답지 묶음) */
export function MsWorkbookAnswerSheets({ sheets, title, measureKey }: { sheets: MsWbSheet[]; title: string; measureKey: string }) {
  if (!sheets.length) return null;
  return (
    <AnswerSheets
      title={title}
      entries={sheets.map((s) => ({ index: s.index, project: asProject(s.key, s.title, s.titleEn, s.source, []), sheet: s.sheet }))}
      measureKey={measureKey}
    />
  );
}
