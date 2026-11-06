"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { usePdfPrefetch, usePdfSave } from "@/components/pdf/usePdfSave";
import { collectPrintPages } from "@/lib/pdf/download-sheets-pdf";
import { ListeningPrintQrCode } from "@/components/listening/ListeningPrintQrCode";
import {
  paginatePrintPieces,
  splitPrintUnits,
  type PrintPiece,
  type PrintPiecePage,
  type PrintPiecePart,
  type PrintUnit,
} from "@/lib/question-generator/print-split";
import { ACADEMY_NAME, LOGO_SRC } from "@/lib/branding";
import {
  questionNeedsVocabGloss,
  parseHardWordsColumn,
} from "@/lib/question-generator/exam-vocab";
import {
  buildExamVocabUrl,
  buildExamVocabUrlForJob,
} from "@/lib/question-generator/exam-vocab-url";
import { groupQuestionsByPrintType } from "@/lib/question-generator/print-type-groups";
import {
  cleanQuestionText,
  normalizePassage,
  parseGrammarCorrectionBlocks,
  parseReferenceAnswerBlock,
  parseSummaryTableBlocks,
  parseSummaryWritingBlocks,
  parseWordOrderBlocks,
  reflowPassageForPrint,
  withBlankRules,
} from "@/lib/question-generator/text-utils";
import { isSetMarkKey } from "@/lib/question-generator/passage-set";
import { mergeMarkedPassages } from "@/lib/question-generator/passage-set-merge";
import "./question-print-styles.css";
import "@/components/lesson-materials/material-design.css";
import { MaterialDesignPicker } from "@/components/lesson-materials/MaterialDesignPicker";
import {
  QUESTION_BASE_STYLE,
  materialDesignClass,
  useMaterialDesign,
  type MaterialDesign,
} from "@/lib/lesson-materials/material-design";

type QuestionRow = {
  id: string;
  /** 동형모의고사: 시험지 번호("1", "서술 1")와 배점 */
  item_no?: string | null;
  points?: number | null;
  instruction: string;
  question_text: string;
  passage_original: string;
  passage_modified: string | null;
  choices: Array<{ number: number; text: string }> | null;
  correct_answer: unknown;
  explanation: string;
  question_type?: string;
  category?: string;
  option_key?: string | null;
  passage_id?: string | null;
  hard_words?: Array<{ word: string; meaning: string }> | null;
  choice_language?: string | null;
};

/**
 * 서버에서 불러오지 않고 미리 넣어 주는 문항(중학교 수업자료 문제 은행 — 선생님 2026-10-29 「변형문제 디자인과 같이」).
 * 주면 작업·시험지를 불러오지 않고 보기 단어장 QR도 만들지 않는다.
 */
export type QuestionPrintPreloaded = {
  title: string;
  grade?: string;
  sourceDetail?: string;
  questions: QuestionRow[];
  passages?: Array<{ id: string; source_detail: string | null }>;
};
export type QuestionPrintRow = QuestionRow;

type PrintLayoutMode = "mixed" | "byType" | "byPassage" | "bySet";

type DisplayItem =
  | {
      kind: "q";
      id: string;
      q: QuestionRow;
      num: number;
      /** 지문별 묶음: 지문은 묶음 머리에 한 번 찍었으니 문항에서는 뺀다 */
      hidePassage?: boolean;
    }
  | {
      /** 지문별 묶음 머리: 「[1~3] 다음 글을 읽고, 물음에 답하시오.」와 함께 쓰는 지문 */
      kind: "set";
      id: string;
      head: string;
      passage: string;
      source?: string;
    };

type SheetPage = PrintPiecePage & {
  /** 유형별 출력: 이 페이지가 새 유형의 첫 장일 때 소제목 */
  sectionLabel?: string;
};

const CIRCLED = ["①", "②", "③", "④", "⑤"];

/** A4 본문 열 폭(mm) — 여백·중간 구분선 반영 */
const COL_WIDTH_MM = 88;
const QUESTION_GAP_PX = 14;
const COLUMN_SAFETY_PX = 12;
const BRANDING_STORAGE_KEY = "qg-print-branding";

/*
 * 시험지 모양. 분석지와 같은 시안 셋(A 교재 세리프 · B 깔끔한 산세리프 · C 클래식 인쇄)을
 * 고를 수 있게 했다. 예전 모양(주황 머리선)은 선생님 요청으로 목록에서 뺐고, 처음 여는 사람과
 * 예전에 기본을 골라 둔 사람은 A로 본다. 문항 구성은 같고 글꼴·색·테두리만
 * 바꾼다 — question-print-styles.css의 .qg-style-*.
 */
type QuestionDesignStyle = "base" | "a" | "b" | "c";
const TYPE_ORDER_KEY = "question-print-type-order";
const SPREAD_KEY = "question-print-spread-passages";

/**
 * 같은 지문 문항이 가까이(한 쪽 안에) 붙지 않게 순서를 벌린다. 앞 window−1문항에 나온 지문은 뒤로 미룬다.
 * 선생님 말씀(2026-10-20): 같은 지문이 다른 유형으로 한 쪽에 겹쳐 나오면 서로 힌트가 된다(어휘 두 문항의
 * 밑줄 낱말을 맞대 보면 답이 보인다). 미룰 문항이 없으면(한 지문뿐) 그대로 둔다.
 */
function spreadByPassage<T extends { passage_id?: string | null }>(list: T[], window = 5): T[] {
  const rest = [...list];
  const out: T[] = [];
  while (rest.length) {
    const recent = new Set(out.slice(-(window - 1)).map((q) => q.passage_id ?? ""));
    let i = rest.findIndex((q) => !q.passage_id || !recent.has(q.passage_id));
    if (i < 0) i = 0;
    out.push(rest.splice(i, 1)[0]!);
  }
  return out;
}
/** A·B·C가 쓰는 글꼴. 기본 모양에서는 불러오지 않는다. */
const DESIGN_FONTS_HREF =
  "/fonts/print/fonts.css";

function designClass(style: QuestionDesignStyle): string {
  return style === "base" ? "" : `qg-style qg-style-${style}`;
}

type PrintBranding = {
  headerKicker: string;
  headerTitle: string;
  headerSub: string;
  footerLeft: string;
  footerRight: string;
  showLogo: boolean;
  /**
   * 머리말의 출처, 문항 번호 띠, 그리고 문항 번호 위의 출처를 감춘다.
   * 선생님 요청(2026-09-28): 출처는 답을 알려 주지는 않지만, 어디서 가져온 지문인지
   * 밝히고 싶지 않을 때가 있다.
   * 선생님 요청(2026-09-30): 문항 위에는 지문 제목 대신 출처를 단다. 제목이 곧 답이 되는
   * 문항(요지·주제·제목)이 많아 제목은 빼고, 출처만 이 하나로 켜고 끈다.
   */
  hideOrigin: boolean;
};

function formatAnswer(a: unknown): string {
  if (Array.isArray(a)) return a.join(" / ");
  if (typeof a === "number" && a >= 1 && a <= 5) {
    return CIRCLED[a - 1] ?? String(a);
  }
  return String(a ?? "");
}

function extractBannerNo(sourceDetail: string): string | null {
  const m = sourceDetail.match(/(\d{1,2})\s*번/);
  return m ? m[1] : null;
}

function padNo(n: number): string {
  return String(n).padStart(2, "0");
}

/** 동형모의고사면 학교 시험지 번호, 아니면 01·02 … */
function qNo(q: QuestionRow, index: number): string {
  return q.item_no?.trim() || padNo(index);
}

function pointsTag(q: QuestionRow): string {
  return typeof q.points === "number" ? ` [${q.points}점]` : "";
}

function questionPassage(q: QuestionRow): string {
  const mod = (q.passage_modified || "").trim();
  const orig = (q.passage_original || "").trim();
  if (mod && normalizePassage(mod) !== normalizePassage(orig)) return mod;
  return orig || mod;
}

function parseBogiLines(text: string): string[] {
  const cleaned = cleanQuestionText(text).trim();
  if (!cleaned) return [];
  const parts = cleaned
    .split(/(?=\(\d+\))/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 2) return parts;
  return cleaned.split(/\n+/).map((s) => s.trim()).filter(Boolean);
}

/** <u>…</u> 및 일반 텍스트를 인쇄용 노드로 변환 */
function renderMarkedText(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /<u>([\s\S]*?)<\/u>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(
        <span key={`t${key++}`}>{text.slice(last, m.index)}</span>
      );
    }
    nodes.push(
      <u key={`u${key++}`} className="qg-print-u">
        {m[1]}
      </u>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    nodes.push(<span key={`t${key++}`}>{text.slice(last)}</span>);
  }
  return nodes.length > 0 ? nodes : [text];
}

/**
 * 지문 조각을 문단별 <p>로 그린다. range가 있으면 그 조각만(단을 넘겨 이어지는 긴 지문).
 * 조각마다 data-qg-u를 달아 쪽 나눔 측정에서 조각 단위로 잘라 볼 수 있게 한다.
 * 같은 문단의 조각은 한 칸 띄워 이어 붙이므로 쪼개지 않은 문단은 예전과 똑같이 보인다.
 */
function PassageUnits({
  units,
  range,
  marked = true,
  pClass = "qg-print-passage-p",
}: {
  units: PrintUnit[];
  range?: { from: number; to: number };
  /** <u>…</u>를 밑줄로 그린다(개수형 지문·해설은 글자 그대로). */
  marked?: boolean;
  pClass?: string;
}) {
  const from = range?.from ?? 0;
  const to = range?.to ?? units.length;
  const paras: { para: number; items: { index: number; text: string; lead: boolean }[] }[] = [];
  for (let i = from; i < to; i++) {
    const u = units[i];
    if (!u) continue;
    const lead = i > 0 && units[i - 1]?.para === u.para;
    const last = paras[paras.length - 1];
    if (last && last.para === u.para) last.items.push({ index: i, text: u.text, lead });
    else paras.push({ para: u.para, items: [{ index: i, text: u.text, lead }] });
  }
  return (
    <>
      {paras.map((p) => (
        <p key={p.para} className={pClass} data-qg-para="">
          {p.items.map((it) => (
            <span key={it.index} data-qg-u={it.index}>
              {it.lead ? " " : null}
              {marked ? renderMarkedText(it.text) : it.text}
            </span>
          ))}
        </p>
      ))}
    </>
  );
}

function PassageParas({
  units,
  range,
}: {
  units: PrintUnit[];
  range?: { from: number; to: number };
}) {
  if (units.length === 0) return null;
  return (
    <div className="qg-print-passage qg-print-passage-block">
      <PassageUnits units={units} range={range} />
    </div>
  );
}

function WordOrderBoxes({
  blocks,
}: {
  blocks: NonNullable<ReturnType<typeof parseWordOrderBlocks>>;
}) {
  return (
    <div className="qg-print-word-order">
      <div className="qg-print-wo-box">
        <p className="qg-print-wo-label">&lt;조건&gt;</p>
        <div className="qg-print-wo-body">
          {blocks.conditions.split(/\n+/).map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </div>
      <div className="qg-print-wo-box">
        <p className="qg-print-wo-label">
          &lt;보기&gt;
          {blocks.allowExtraWords ? (
            <span className="qg-print-wo-hint"> · 없는 단어 추가 가능</span>
          ) : null}
        </p>
        <div className="qg-print-wo-body qg-print-wo-words">
          {blocks.words}
        </div>
      </div>
      <div className="qg-print-wo-box">
        <p className="qg-print-wo-label">&lt;해석&gt;</p>
        <div className="qg-print-wo-body">{blocks.translation}</div>
      </div>
      <p className="qg-print-wo-answer-line">
        ⓐ : _______________________________________________
      </p>
    </div>
  );
}

function SummaryWritingBoxes({
  blocks,
}: {
  blocks: NonNullable<ReturnType<typeof parseSummaryWritingBlocks>>;
}) {
  const labels =
    blocks.blankLabels.length > 0 ? blocks.blankLabels : ["ⓐ", "ⓑ"];
  return (
    <div className="qg-print-word-order">
      <div className="qg-print-wo-box">
        <p className="qg-print-wo-label">&lt;조건&gt;</p>
        <div className="qg-print-wo-body">
          {blocks.conditions.split(/\n+/).map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </div>
      {blocks.words != null && blocks.words.trim() ? (
        <div className="qg-print-wo-box">
          <p className="qg-print-wo-label">&lt;보기&gt;</p>
          <div className="qg-print-wo-body qg-print-wo-words">
            {blocks.words}
          </div>
        </div>
      ) : null}
      <div className="qg-print-wo-box">
        <p className="qg-print-wo-label">&lt;요약문&gt;</p>
        <div className="qg-print-wo-body qg-print-wo-summary">
          {blocks.summary}
        </div>
      </div>
      {labels.map((lab) => (
        <p key={lab} className="qg-print-wo-answer-line">
          {lab} : _______________________________________________
        </p>
      ))}
    </div>
  );
}

function SummaryTableBoxes({
  blocks,
}: {
  blocks: NonNullable<ReturnType<typeof parseSummaryTableBlocks>>;
}) {
  const [headRow, ...bodyRows] = blocks.rows;
  return (
    <div className="qg-print-word-order">
      <div className="qg-print-wo-box">
        <p className="qg-print-wo-label">&lt;조건&gt;</p>
        <div className="qg-print-wo-body">
          {blocks.conditions.split(/\n+/).map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </div>
      {/* 첫 칸은 그 줄의 이름, 나머지는 내용 (학력평가 모양) */}
      <table className="qg-print-summary-table">
        <thead>
          <tr>
            {(headRow ?? []).map((cell, i) => (
              <th key={i} className={i === 0 ? "qg-print-summary-key" : undefined}>
                {withBlankRules(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) =>
                ci === 0 ? (
                  <th key={ci} scope="row" className="qg-print-summary-key">
                    {cell}
                  </th>
                ) : (
                  <td key={ci}>{withBlankRules(cell)}</td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {blocks.blankLabels.map((lab) => (
        <p key={lab} className="qg-print-wo-answer-line">
          {lab} : _____________________
        </p>
      ))}
    </div>
  );
}

function GrammarCorrectionBoxes({
  blocks,
}: {
  blocks: NonNullable<ReturnType<typeof parseGrammarCorrectionBlocks>>;
}) {
  const rows = Array.from({ length: blocks.rowCount }, (_, i) => i);
  return (
    <div className="qg-print-word-order">
      <div className="qg-print-wo-box">
        <p className="qg-print-wo-label">&lt;조건&gt;</p>
        <div className="qg-print-wo-body">
          {blocks.conditions.split(/\n+/).map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </div>
      {/*
       * 선생님 지적(2026-10-01): 칸을 셋 만들어 두면 학생이 세 개인 줄 안다.
       * 한 칸만 크게 둔다 — 몇 개를 쓸지는 학생이 정한다.
       */}
      <table className="qg-print-fix-table">
        <thead>
          <tr>
            <th>어법상 틀린 곳의 기호</th>
            <th>바르게 고친 것</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i} className={rows.length === 1 ? "qg-print-fix-tall" : undefined}>
              <td>&nbsp;</td>
              <td>&nbsp;</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 쪼갠 문항 부분에 붙이는 카드 class와 지문 범위. 끝 부분이 아니면 아래 구분선을 뺀다. */
function pieceProps(part: PrintPiecePart | undefined) {
  return {
    cardClass: part && !part.last ? " qg-print-card-cont" : "",
    range: part ? { from: part.from, to: part.to } : undefined,
    head: !part || part.first,
    tail: !part || part.last,
  };
}

/**
 * 단을 넘겨 이어 실은 지문 조각 맨 위의 작은 표시. 표시 없이 문장만 옆 단 위에 있으면
 * 새 지문처럼 보여 어색했다(선생님 지적 2026-09-18: "단이 잘리는 건 괜찮은데 이상하게 잘린다").
 */
function ContinuedLabel({ index }: { index: number }) {
  return (
    <p className="qg-print-cont-label" data-qg-cont="">
      {padNo(index)}번 지문 이어서
    </p>
  );
}

/** 지문별 묶음 머리 — 여러 문항이 함께 쓰는 지문을 한 번 찍는다 */
function SetPassageBlock({
  head,
  passage,
  source,
  part,
}: {
  head: string;
  passage: string;
  source?: string;
  part?: PrintPiecePart;
}) {
  const { cardClass, range, head: isHead } = pieceProps(part);
  const units = splitPrintUnits(reflowPassageForPrint(passage));
  return (
    <section className={`qg-print-card qg-print-set-card${cardClass}`}>
      {isHead ? (
        <div data-qg-head="">
          {source ? <p className="qg-print-q-source">{source}</p> : null}
          <p className="qg-print-q-head qg-print-set-head">{head}</p>
        </div>
      ) : (
        <p className="qg-print-cont-label" data-qg-cont="">
          지문 이어서
        </p>
      )}
      <PassageParas units={units} range={range} />
    </section>
  );
}

function QuestionBlock({
  q,
  index,
  part,
  passageSource,
  hidePassage,
}: {
  q: QuestionRow;
  index: number;
  /** 지문별 묶음: 지문은 묶음 머리에 찍었다 */
  hidePassage?: boolean;
  /** 문항 번호 위에 작게 다는 지문 출처(없거나 감추면 안 단다) */
  passageSource?: string;
  /** 한 단보다 긴 문항을 나눠 실을 때 이 부분(없으면 문항 전체). */
  part?: PrintPiecePart;
}) {
  const { cardClass, range, head, tail } = pieceProps(part);
  const isCount = q.question_type === "content_count";
  const isInsertion = q.question_type === "sentence_insertion";
  const isIrrelevant = q.question_type === "irrelevant_sentence";
  const summaryTable = parseSummaryTableBlocks(q.question_text);
  const summaryWriting = summaryTable
    ? null
    : parseSummaryWritingBlocks(q.question_text);
  const wordOrder =
    summaryTable || summaryWriting ? null : parseWordOrderBlocks(q.question_text);
  const grammarFix =
    summaryTable || summaryWriting || wordOrder
      ? null
      : parseGrammarCorrectionBlocks(q.question_text);
  const referenceAnswer =
    summaryTable || summaryWriting || wordOrder || grammarFix
      ? null
      : parseReferenceAnswerBlock(q.question_text);
  const extra =
    summaryTable || summaryWriting || wordOrder || referenceAnswer || grammarFix
      ? ""
      : cleanQuestionText(q.question_text);
  const passage = hidePassage ? "" : questionPassage(q);
  const bogiLines = isCount ? parseBogiLines(q.question_text) : [];
  const showChoices =
    !isCount &&
    !isInsertion &&
    !isIrrelevant &&
    !summaryTable &&
    !wordOrder &&
    !summaryWriting &&
    !referenceAnswer &&
    !grammarFix &&
    q.choices &&
    q.choices.length > 0 &&
    q.choices.some((c) => String(c.text ?? "").trim().length > 0);

  // 지문 조각(쪽 나눔 측정과 쪼갠 문항이 같은 조각을 쓴다)
  const units = splitPrintUnits(reflowPassageForPrint(passage));

  if (isCount) {
    return (
      <section className={`qg-print-card qg-print-count-card${cardClass}`}>
        {!head ? <ContinuedLabel index={index} /> : null}
        {head && passageSource ? <p className="qg-print-q-source" data-qg-head="">{passageSource}</p> : null}
        {head ? (
          <p className="qg-print-q-head" data-qg-head="">
            <span className={`qg-print-q-num qg-print-count-num${qNo(q, index).length > 2 ? " qg-print-q-num--wide" : ""}`}>
              {qNo(q, index)}
            </span>{" "}
            {q.instruction}
            {pointsTag(q)}
          </p>
        ) : null}
        {units.length > 0 && (
          <div className="qg-print-count-box qg-print-passage-block">
            <PassageUnits units={units} range={range} marked={false} />
          </div>
        )}
        {tail ? (
          <div data-qg-tail="">
            <p className="qg-print-bogi-label">&lt;보기&gt;</p>
            <div className="qg-print-count-box qg-print-bogi-box">
              {bogiLines.map((line, i) => (
                <p key={i} className="qg-print-bogi-line">
                  {line}
                </p>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className={`qg-print-card${cardClass}`}>
      {!head ? <ContinuedLabel index={index} /> : null}
      {head ? (
        <div data-qg-head="">
          {passageSource ? <p className="qg-print-q-source">{passageSource}</p> : null}
          <p className="qg-print-q-head">
            <span className={`qg-print-q-num${qNo(q, index).length > 2 ? " qg-print-q-num--wide" : ""}`}>{qNo(q, index)}</span> {q.instruction}
            {pointsTag(q)}
          </p>
          {isInsertion && extra ? (
            <div className="qg-print-given-box">{extra}</div>
          ) : null}
        </div>
      ) : null}
      <PassageParas units={units} range={range} />
      {tail ? (
      <div data-qg-tail="">
      {summaryTable ? <SummaryTableBoxes blocks={summaryTable} /> : null}
      {summaryWriting ? (
        <SummaryWritingBoxes blocks={summaryWriting} />
      ) : null}
      {wordOrder ? <WordOrderBoxes blocks={wordOrder} /> : null}
      {grammarFix ? <GrammarCorrectionBoxes blocks={grammarFix} /> : null}
      {referenceAnswer
        ? referenceAnswer.labels.map((lab) => (
            <p key={lab} className="qg-print-wo-answer-line">
              {lab} : _______________________________________________
            </p>
          ))
        : null}
      {!isInsertion &&
      !summaryTable &&
      !wordOrder &&
      !summaryWriting &&
      !referenceAnswer &&
      !grammarFix &&
      extra ? (
        q.question_type?.startsWith("ms_") ? (
          // 중학교 문제 은행: 줄(보기 ⓐ~ⓔ, (A)~(C))과 밑줄을 살린다
          <p className="qg-print-extra" style={{ whiteSpace: "pre-line" }}>{renderMarkedText(extra)}</p>
        ) : (
          <p className="qg-print-extra">{extra}</p>
        )
      ) : null}
      {showChoices && (
        <ul className="qg-print-choices">
          {q.choices!.map((c) => (
            <li key={c.number}>
              <span className="qg-print-choice-mark">
                {CIRCLED[c.number - 1] ?? `${c.number}.`}
              </span>
              {c.text.trim() ? <span>{renderMarkedText(c.text)}</span> : null}
            </li>
          ))}
        </ul>
      )}
      </div>
      ) : null}
    </section>
  );
}

function AnswerBlock({
  q,
  index,
  part,
}: {
  q: QuestionRow;
  index: number;
  part?: PrintPiecePart;
}) {
  const { cardClass, range, head, tail } = pieceProps(part);
  // 해설이 한 단보다 길면 문장 단위로 나눠 다음 단에 잇는다.
  // (white-space: normal이라 줄바꿈은 원래도 한 칸으로 보였다)
  const explanation = String(q.explanation ?? "").replace(/\s+/g, " ").trim();
  const units = splitPrintUnits(explanation ? [explanation] : []);
  const hardWords = questionNeedsVocabGloss({
    choices: q.choices,
    questionType: q.question_type,
    optionKey: q.option_key,
    questionText: q.question_text,
    choiceLanguage: q.choice_language,
  })
    ? parseHardWordsColumn(q.hard_words)
    : [];
  return (
    <section className={`qg-print-card qg-print-answer-card${cardClass}`}>
      {head ? (
        <p className="qg-print-answer-head" data-qg-head="">
          <span className={`qg-print-q-num${qNo(q, index).length > 2 ? " qg-print-q-num--wide" : ""}`}>{qNo(q, index)}</span>{" "}
          <span className="qg-print-answer-mark">
            {formatAnswer(q.correct_answer)}
          </span>
        </p>
      ) : null}
      {units.length > 0 ? (
        <PassageUnits
          units={units}
          range={range}
          marked={false}
          pClass="qg-print-answer-body"
        />
      ) : (
        <p className="qg-print-answer-body" />
      )}
      {tail && hardWords.length > 0 ? (
        <div className="qg-print-hard-words" data-qg-tail="">
          <p className="qg-print-hard-words-label">보기 단어</p>
          <ul className="qg-print-hard-words-list">
            {hardWords.map((w) => (
              <li key={`${w.word}-${w.meaning}`}>
                <span className="qg-print-hw-en">{w.word}</span>
                <span className="qg-print-hw-ko">{w.meaning}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** 꼬리말 오른쪽 기본값: 자료 이름(정답지는 뒤에 "정답"). */
function defaultFooterRight(title: string, mode: "exam" | "answers"): string {
  const name = title.trim() || "영어 변형문제";
  return mode === "answers" ? `${name} · 정답` : name;
}

/**
 * 머리말·꼬리말 저장 위치. 학원 이름·로고는 학원마다(한 브라우저로 여러 학원에 들어가도 다른
 * 학원 이름이 남지 않게), 제목·출처·꼬리말은 자료마다 저장한다.
 */
function brandingKey(scope: { academy: string } | { jobId: string }): string {
  return "jobId" in scope
    ? `${BRANDING_STORAGE_KEY}:${scope.jobId}`
    : `${BRANDING_STORAGE_KEY}:academy:${scope.academy}`;
}

function loadStoredBranding(
  scope: { academy: string } | { jobId: string }
): Partial<PrintBranding> | null {
  try {
    const raw = localStorage.getItem(brandingKey(scope));
    if (!raw) return null;
    return JSON.parse(raw) as Partial<PrintBranding>;
  } catch {
    return null;
  }
}

export function QuestionPrintView({
  jobId,
  setId,
  backHref,
  printBaseHref,
  mode = "exam",
  layout: layoutProp = "mixed",
  academyName = ACADEMY_NAME,
  logoSrc = LOGO_SRC,
  embedded = false,
  design,
  preloaded,
}: {
  jobId: string;
  /** 미리 넣어 주는 문항(있으면 불러오지 않는다) */
  preloaded?: QuestionPrintPreloaded;
  /**
   * 골라 묶은 시험지를 찍을 때 그 시험지 id.
   *
   * 선생님 요청(2026-09-30): 유형별로 골라 새 시험지를 조립하고 싶다.
   * 있으면 생성 묶음 대신 이 시험지에 담긴 문항을 담은 차례대로 읽는다.
   */
  setId?: string;
  /** ← 뒤로: 내 자료 목록 */
  backHref: string;
  /** 문제지/해설지 전환용 (…/generations/{id}) */
  printBaseHref: string;
  mode?: "exam" | "answers";
  layout?: PrintLayoutMode;
  /** 학원별 인쇄 브랜딩 */
  academyName?: string;
  logoSrc?: string;
  /** 최종통합자료 안에 쪽만 끼워 넣는다(설정 창 없이). */
  embedded?: boolean;
  /** 최종통합자료가 고른 디자인(주면 이것을 쓴다) */
  design?: MaterialDesign;
}) {
  const [title, setTitle] = useState("영어 변형문제");
  /** PDF로 바로 저장(인쇄 창 없이) */
  const pdf = usePdfSave();
  // 미리 PDF를 만들어 두어 「PDF로 저장」을 누르면 바로 받아진다
  usePdfPrefetch("qg-print-root", ".qg-print-sheet", { enabled: !embedded });
  const [grade, setGrade] = useState("");
  const [sourceDetail, setSourceDetail] = useState("");
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  /*
   * 만들어 둔 문제 가운데 원하는 유형만 뽑아 낸다.
   *
   * 선생님 요청(2026-09-30): 변형문제에서 만든 문제 중에 내가 원하는 유형만
   * 출제하도록 해 달라. 지금까지는 한 묶음을 통째로 찍을 수밖에 없어서, 유형
   * 하나만 쓰려면 그 유형만 다시 만들어야 했다.
   *
   * 빈 집합은 「다 쓴다」는 뜻이다 (처음 열었을 때).
   */
  const [offTypes, setOffTypes] = useState<Set<string>>(new Set());
  /** 지문 id → 출처(문항 번호 위에 작게 단다) */
  const [passageSources, setPassageSources] = useState<Record<string, string>>({});
  const [printLayout, setPrintLayout] = useState<PrintLayoutMode>(layoutProp);
  const [vocabSetId, setVocabSetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<SheetPage[]>([]);
  const [branding, setBranding] = useState<PrintBranding>({
    headerKicker: academyName,
    headerTitle: "",
    headerSub: "",
    footerLeft: academyName,
    footerRight: "영어 변형문제",
    showLogo: true,
    hideOrigin: false,
  });
  const [brandingReady, setBrandingReady] = useState(false);
  const measureRef = useRef<HTMLDivElement>(null);
  /** 디자인 — 모든 자료가 하나를 같이 쓴다(material-design.ts, 선생님 2026-10-21). 통합자료는 design으로 준다. */
  const [md, chooseMd] = useMaterialDesign(design);
  const designStyle = QUESTION_BASE_STYLE[md] as QuestionDesignStyle;
  /*
   * 유형 차례(유형 코드 목록). 빈 목록은 기본 차례다.
   * 선생님 요청(2026-10-20): 유형별 출력에서 유형 순서를 바꿀 수 있게. 한 번 정하면
   * 다른 자료에도 같은 차례로 나오게 학원마다 브라우저에 저장한다.
   */
  const [typeOrder, setTypeOrder] = useState<string[]>([]);
  /** 같은 지문이 한 쪽에 겹치지 않게(기본 켬). 끄면 예전처럼 만든 차례대로 싣는다. */
  const [spreadPassages, setSpreadPassages] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(SPREAD_KEY) === "off") setSpreadPassages(false);
    } catch {
      /* 저장소를 못 쓰면 켠 채로 */
    }
  }, []);
  const chooseSpread = (on: boolean) => {
    setSpreadPassages(on);
    try {
      window.localStorage.setItem(SPREAD_KEY, on ? "on" : "off");
    } catch {
      /* 무시 */
    }
  };
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(`${TYPE_ORDER_KEY}:${academyName}`) ?? "[]");
      if (Array.isArray(saved)) setTypeOrder(saved.filter((c): c is string => typeof c === "string"));
    } catch {
      /* 저장소를 못 쓰면 기본 차례 */
    }
  }, [academyName]);
  const chooseTypeOrder = (order: string[]) => {
    setTypeOrder(order);
    try {
      window.localStorage.setItem(`${TYPE_ORDER_KEY}:${academyName}`, JSON.stringify(order));
    } catch {
      /* 무시 */
    }
  };
  /*
   * 모양을 바꾸면 글꼴이 늦게 들어와 글자 폭이 달라진다. 쪽 나눔은 잰 높이로 하므로
   * 글꼴이 다 들어온 뒤 한 번 더 잰다(안 그러면 쪽이 넘쳐 아래가 잘린다).
   */
  const [fontsTick, setFontsTick] = useState(0);
  useEffect(() => {
    if (designStyle === "base" || typeof document === "undefined" || !document.fonts) return;
    let alive = true;
    const bump = () => alive && setFontsTick((t) => t + 1);
    void document.fonts.ready.then(bump);
    document.fonts.addEventListener?.("loadingdone", bump);
    return () => {
      alive = false;
      document.fonts.removeEventListener?.("loadingdone", bump);
    };
  }, [designStyle]);

  const load = useCallback(async () => {
    const data = preloaded
      ? {
          ok: true,
          job: { request_config: { title: preloaded.title, grade: preloaded.grade, sourceDetail: preloaded.sourceDetail } },
          questions: preloaded.questions,
          passages: preloaded.passages ?? [],
        }
      : await (
          await fetch(setId ? `/api/question-generator/sets/${setId}/print-data` : `/api/question-generator/jobs/${jobId}`)
        ).json();
    if (!data.ok) {
      setError(data.message ?? "불러오기 실패");
      return;
    }
    const job = data.job;
    const nextTitle =
      job?.request_config?.title ||
      job?.english_source_passages?.title ||
      "영어 변형문제";
    const nextGrade =
      job?.request_config?.grade || job?.english_source_passages?.grade || "";
    const nextDetail =
      job?.request_config?.sourceDetail ||
      job?.english_source_passages?.source_detail ||
      "";
    setTitle(nextTitle);
    setGrade(nextGrade);
    setSourceDetail(nextDetail);
    setQuestions(data.questions ?? []);
    // 1지문 다문항으로 만든 작업은 지문별 묶음으로 연다(주소에 배치를 따로 적었으면 그것을 따른다)
    if (job?.request_config?.passageSet && layoutProp === "mixed") setPrintLayout("bySet");
    // 문항 위에는 출처만 단다. 제목은 그 자체가 답이 되는 문항이 많아 싣지 않는다.
    setPassageSources(
      Object.fromEntries(
        ((data.passages ?? []) as Array<{ id: string; source_detail: string | null }>).map((p) => [
          p.id,
          (p.source_detail || "").trim(),
        ])
      )
    );
    setVocabSetId(
      typeof job?.vocab_set_id === "string" ? job.vocab_set_id : null
    );

    // 보기 단어장 동기화 (QR용 vocab_set_id 확보) — 생성 묶음에만 있다
    if (!setId && !preloaded && (data.questions ?? []).length > 0) {
      try {
        const vr = await fetch(
          `/api/question-generator/jobs/${jobId}/exam-vocab`,
          { method: "POST" }
        );
        const vd = (await vr.json()) as {
          ok?: boolean;
          vocabSetId?: string | null;
        };
        if (vd.ok && vd.vocabSetId) {
          setVocabSetId(vd.vocabSetId);
        }
      } catch {
        /* ignore */
      }
    }

    setBranding((prev) => {
      const shared =
        typeof window !== "undefined" ? loadStoredBranding({ academy: academyName }) : null;
      const own = typeof window !== "undefined" ? loadStoredBranding({ jobId }) : null;
      return {
        headerKicker:
          shared?.headerKicker ??
          prev.headerKicker ??
          `${academyName}${nextGrade ? ` · ${nextGrade}` : ""}`,
        headerTitle: own?.headerTitle || nextTitle,
        headerSub: own?.headerSub ?? nextDetail,
        footerLeft: shared?.footerLeft ?? academyName,
        footerRight: own?.footerRight ?? defaultFooterRight(nextTitle, mode),
        showLogo: shared?.showLogo ?? true,
        // 예전에 따로 저장해 둔 값(hideSource·hideTitle)도 출처 감추기로 이어 받는다
        hideOrigin:
          own?.hideOrigin ??
          (own as { hideTitle?: boolean; hideSource?: boolean } | null)?.hideTitle ??
          (own as { hideSource?: boolean } | null)?.hideSource ??
          false,
      };
    });
    setBrandingReady(true);
  }, [jobId, setId, mode, academyName, preloaded]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!brandingReady) return;
    try {
      // 학원 이름·로고는 이 학원의 모든 자료에 같게, 제목·출처·꼬리말은 이 자료에만 저장한다.
      // 예전에는 전부 브라우저에 한 벌이라, 고친 제목이 다음 자료에, 한 학원 이름이 다른
      // 학원 계정의 머리말에 그대로 붙었다.
      const { headerKicker, footerLeft, showLogo, headerTitle, headerSub, footerRight, hideOrigin } =
        branding;
      localStorage.setItem(
        brandingKey({ academy: academyName }),
        JSON.stringify({ headerKicker, footerLeft, showLogo })
      );
      localStorage.setItem(
        brandingKey({ jobId }),
        JSON.stringify({ headerTitle, headerSub, footerRight, hideOrigin })
      );
    } catch {
      /* ignore */
    }
  }, [branding, brandingReady, jobId, academyName]);

  const bannerNo = extractBannerNo(sourceDetail);
  const sheetTitle =
    branding.headerTitle ||
    (mode === "answers" ? `${title} · 해설지` : title);

  /** 이 묶음에 든 유형들 (고르개에 쓴다) */
  const typeGroups = useMemo(
    () => groupQuestionsByPrintType(questions, typeOrder).map((g) => ({ code: g.code, label: g.label, n: g.items.length })),
    [questions, typeOrder]
  );
  /** 유형 하나를 위·아래로 옮긴다. 이 묶음에 없는 유형은 뒤에 그대로 둔다. */
  const moveTypeTo = (from: number, to: number) => {
    const codes = typeGroups.map((t) => t.code);
    if (from === to || from < 0 || to < 0 || from >= codes.length || to >= codes.length) return;
    const [code] = codes.splice(from, 1);
    codes.splice(to, 0, code!);
    chooseTypeOrder([...codes, ...typeOrder.filter((c) => !codes.includes(c))]);
  };
  /*
   * 끌어서 원하는 자리에 놓기. 선생님 요청(2026-10-20): 한 칸씩 옮기는 게 아니라 원하는 곳에 넣게.
   * dragFrom = 끌고 있는 줄, dragOver = 놓일 줄(그 줄 자리로 들어간다).
   */
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  /** 끈 유형을 뺀 문항 */
  const shown = useMemo(() => {
    if (offTypes.size === 0) return questions;
    return groupQuestionsByPrintType(questions, typeOrder)
      .filter((g) => !offTypes.has(g.code))
      .flatMap((g) => g.items);
  }, [questions, offTypes, typeOrder]);

  const displayItems: DisplayItem[] = useMemo(() => {
    if (shown.length === 0) return [];
    /*
     * 지문 순서로 한 바퀴: 지문을 넣은 순서대로 한 문항씩 돌고, 다시 첫 지문으로 돌아온다.
     * (선생님 요청 2026-09-20: "전체 세트가 순서대로 한 바퀴 돌고 다시 18번 문제부터 쭉")
     */
    if (printLayout === "byPassage") {
      const order: string[] = [];
      const byPassage = new Map<string, QuestionRow[]>();
      for (const q of shown) {
        const key = q.passage_id ?? "";
        if (!byPassage.has(key)) {
          byPassage.set(key, []);
          order.push(key);
        }
        byPassage.get(key)!.push(q);
      }
      // 한 지문 안에서는 유형 차례대로 돌아 회차마다 같은 순서가 되게 한다.
      for (const key of order) {
        const list = byPassage.get(key)!;
        byPassage.set(key, groupQuestionsByPrintType(list, typeOrder).flatMap((g) => g.items));
      }
      const rounds = Math.max(...order.map((k) => byPassage.get(k)!.length));
      const items: DisplayItem[] = [];
      let num = 1;
      for (let r = 0; r < rounds; r++) {
        for (const key of order) {
          const q = byPassage.get(key)![r];
          if (!q) continue;
          items.push({ kind: "q", id: q.id, q, num });
          num++;
        }
      }
      return items;
    }
    /*
     * 지문별 묶음(1지문 다문항): 같은 지문 문항을 모아 「[1~3] 다음 글을 읽고…」 아래에 지문을 한 번 찍는다.
     * 원문 그대로 푸는 문항은 그 지문을 함께 쓰고, 빈칸·밑줄을 친 문항이 하나뿐이면 그 지문을 함께 쓴다(41~42번 꼴).
     * 지문을 자르거나 문장을 뺀 문항(삽입·순서 등)과, 표시형이 둘 이상일 때의 표시형 문항은 자기 지문을 따로 찍는다.
     * 해설지는 번호만 묶음 차례를 따른다.
     */
    if (printLayout === "bySet") {
      const order: string[] = [];
      const byPassage = new Map<string, QuestionRow[]>();
      for (const q of shown) {
        const key = q.passage_id ?? q.id;
        if (!byPassage.has(key)) {
          byPassage.set(key, []);
          order.push(key);
        }
        byPassage.get(key)!.push(q);
      }
      const marked = (q: QuestionRow) =>
        normalizePassage(questionPassage(q)) !== normalizePassage((q.passage_original || "").trim());
      const items: DisplayItem[] = [];
      let num = 1;
      /*
       * 지문을 바꾼 문항(무관한 문장·삽입·순서 등 자기 지문을 따로 찍는 문항)은 묶음에서 빼 뒤의 「개별 문항」으로
       * 보낸다. 원문과 한 쪽에 있으면 원문과 맞대 보아 답이 보인다(선생님 지적 2026-10-20).
       * 해설지도 같은 차례로 번호를 매기므로 나누기는 문제지·해설지에서 똑같이 한다.
       */
      const later: QuestionRow[] = [];
      for (const key of order) {
        const all = byPassage.get(key)!;
        const original0 = all[0]!.passage_original || questionPassage(all[0]!);
        const shareable0 = all.filter((q) => marked(q) && isSetMarkKey(q.option_key ?? ""));
        const sharedOk = shareable0.length > 0 && mergeMarkedPassages(original0, shareable0.map((q) => questionPassage(q))) != null;
        const ownPassage = (q: QuestionRow) => marked(q) && !(sharedOk && shareable0.includes(q));
        const list = spreadPassages && all.length > 1 ? all.filter((q) => !ownPassage(q)) : all;
        if (spreadPassages && all.length > 1) later.push(...all.filter(ownPassage));
        if (list.length === 0) continue;
        if (mode !== "exam" || list.length < 2) {
          for (const q of list) items.push({ kind: "q", id: q.id, q, num: num++ });
          continue;
        }
        /*
         * 빈칸·밑줄을 친 문항들의 표시를 원문 위에 겹쳐 지문 하나로 찍는다(1지문 다문항은 만들 때 서로 다른 문장에
         * 표시하게 했다). 겹쳐지지 않으면(유형별로 만든 작업 등) 원문을 함께 쓰고 그 문항들만 자기 지문을 찍는다.
         */
        const original = list[0]!.passage_original || questionPassage(list[0]!);
        const shareable = list.filter((q) => marked(q) && isSetMarkKey(q.option_key ?? ""));
        const mergedPassage = shareable.length
          ? mergeMarkedPassages(original, shareable.map((q) => questionPassage(q)))
          : null;
        const shared = new Set(mergedPassage ? shareable : []);
        const sharedPassage = mergedPassage ?? original;
        items.push({
          kind: "set",
          id: `set:${key}`,
          head: `[${num}~${num + list.length - 1}] 다음 글을 읽고, 물음에 답하시오.`,
          passage: sharedPassage,
          source: branding.hideOrigin ? undefined : passageSources[list[0]!.passage_id ?? ""],
        });
        for (const q of list) {
          items.push({ kind: "q", id: q.id, q, num: num++, hidePassage: !marked(q) || shared.has(q) });
        }
      }
      for (const q of spreadByPassage(later)) items.push({ kind: "q", id: q.id, q, num: num++ });
      return items;
    }
    if (printLayout !== "byType") {
      return (spreadPassages ? spreadByPassage(shown) : shown).map((q, i) => ({
        kind: "q" as const,
        id: q.id,
        q,
        num: i + 1,
      }));
    }
    const groups = groupQuestionsByPrintType(shown, typeOrder);
    const items: DisplayItem[] = [];
    let num = 1;
    for (const g of groups) {
      // 유형 안에서만 벌린다(유형 묶음과 유형별 쪽 나눔은 그대로)
      for (const q of spreadPassages ? spreadByPassage(g.items) : g.items) {
        items.push({ kind: "q", id: q.id, q, num });
        num++;
      }
    }
    return items;
  }, [shown, printLayout, mode, passageSources, branding.hideOrigin, typeOrder, spreadPassages]);

  /** 유형별: 각 유형 구간 [start, end) — 새 페이지 강제용 */
  const typeRanges = useMemo(() => {
    if (printLayout !== "byType" || shown.length === 0) return [];
    const groups = groupQuestionsByPrintType(shown, typeOrder);
    const ranges: { start: number; end: number; label: string }[] = [];
    let start = 0;
    for (const g of groups) {
      const end = start + g.items.length;
      ranges.push({ start, end, label: g.label });
      start = end;
    }
    return ranges;
  }, [shown, printLayout, typeOrder]);

  useEffect(() => {
    if (displayItems.length === 0) {
      setPages([]);
      return;
    }

    const run = () => {
      const root = measureRef.current;
      if (!root) return;
      // offsetHeight로 잰다. getBoundingClientRect는 화면 배율(CSS zoom)이 곱해진 값이라,
      // 최종통합자료 미리보기(60%) 안에서는 문항이 실제보다 작게 재어져 한 쪽에 너무 많이
      // 담기고 인쇄에서 아래가 잘렸다.
      const heights = displayItems.map((item) => {
        const el = root.querySelector<HTMLElement>(
          `[data-measure-q="${item.id}"]`
        );
        return el ? el.offsetHeight + 1 : 40;
      });

      const mmToPx = (mm: number) => (mm * 96) / 25.4;
      const firstColMax = mmToPx(232);
      const nextColMax = mmToPx(240);

      /**
       * 한 단보다 긴 문항의 부분 높이: 측정용 문항을 복제해 머리·꼬리·지문 조각을 덜어 낸 뒤 잰다.
       * 실제 쪽의 부분(QuestionBlock part)과 같은 모양이 되게 덜어 낸다.
       */
      const measureEls = displayItems.map((item) =>
        root.querySelector<HTMLElement>(`[data-measure-q="${item.id}"]`)
      );
      const unitCount = (i: number) =>
        measureEls[i]?.querySelectorAll("[data-qg-u]").length ?? 0;
      const measurePart = (i: number, from: number, to: number, first: boolean, last: boolean) => {
        const src = measureEls[i];
        if (!src) return Infinity;
        const clone = src.cloneNode(true) as HTMLElement;
        clone.removeAttribute("data-measure-q");
        if (!first) {
          clone.querySelectorAll("[data-qg-head]").forEach((el) => el.remove());
          const card = clone.querySelector(".qg-print-card");
          if (card) {
            const label = document.createElement("p");
            label.className = "qg-print-cont-label";
            label.textContent = "00번 지문 이어서";
            card.prepend(label);
          }
        }
        if (!last) {
          clone.querySelectorAll("[data-qg-tail]").forEach((el) => el.remove());
          clone.querySelector(".qg-print-card")?.classList.add("qg-print-card-cont");
        }
        clone.querySelectorAll<HTMLElement>("[data-qg-u]").forEach((el) => {
          const u = Number(el.dataset.qgU);
          if (u < from || u >= to) el.remove();
        });
        clone.querySelectorAll("[data-qg-para]").forEach((p) => {
          if (!p.querySelector("[data-qg-u]")) p.remove();
        });
        root.appendChild(clone);
        const h = clone.offsetHeight + 1;
        clone.remove();
        return h;
      };
      const split = {
        unitCount,
        fit: (i: number, from: number, first: boolean, maxPx: number) => {
          const n = unitCount(i);
          const whole = measurePart(i, from, n, first, true);
          if (whole <= maxPx) return { to: n, height: whole };
          // 끝 부분(보기·선택지 포함)이 다 들어가지 않으면 지문만 들어가는 만큼 싣는다.
          let lo = from + 1;
          let hi = n - 1;
          if (lo > hi) return { to: from, height: 0 };
          const firstH = measurePart(i, from, lo, first, false);
          if (firstH > maxPx) return { to: from, height: 0 };
          let best = { to: lo, height: firstH };
          while (lo < hi) {
            const mid = Math.floor((lo + hi + 1) / 2);
            const h = measurePart(i, from, mid, first, false);
            if (h <= maxPx) {
              best = { to: mid, height: h };
              lo = mid;
            } else {
              hi = mid - 1;
            }
          }
          // 옆 단에 지문 한 문장만 달랑 남으면 끊긴 자리가 어색하다. 한 문장을 더 넘긴다.
          if (n - best.to === 1 && best.to - from >= 2) {
            const to = best.to - 1;
            return { to, height: measurePart(i, from, to, first, false) };
          }
          return best;
        },
      };
      const paginate = (slice: number[], offset: number, firstColumnMaxPx: number) =>
        paginatePrintPieces(
          slice,
          {
            firstColumnMaxPx,
            nextColumnMaxPx: nextColMax,
            questionGapPx: QUESTION_GAP_PX,
            columnSafetyPx: COLUMN_SAFETY_PX,
            // 이미 문항이 있는 단에 1/3도 안 남았으면 긴 문항은 다음 단에서 시작한다.
            minStartPx: nextColMax / 3,
          },
          {
            unitCount: (i) => split.unitCount(i + offset),
            fit: (i, from, first, maxPx) => split.fit(i + offset, from, first, maxPx),
          }
        )
          .filter((p) => p.left.length > 0 || p.right.length > 0)
          .map((p) => {
            const shift = (list: PrintPiece[]) =>
              list.map((piece) => ({ ...piece, item: piece.item + offset }));
            return { left: shift(p.left), right: shift(p.right) };
          });

      if (printLayout === "byType" && typeRanges.length > 0) {
        const all: SheetPage[] = [];
        const bannerReservePx = mmToPx(8); // 유형 소제목 배너
        let isDocFirstSection = true;
        for (const range of typeRanges) {
          if (range.end <= range.start) continue;
          const slice = heights.slice(range.start, range.end);
          const layouts = paginate(
            slice,
            range.start,
            (isDocFirstSection ? firstColMax : nextColMax) - bannerReservePx
          );
          layouts.forEach((layout, i) => {
            all.push({
              sectionLabel: i === 0 ? range.label : undefined,
              left: layout.left,
              right: layout.right,
            });
          });
          isDocFirstSection = false;
        }
        setPages(all);
        return;
      }

      setPages(paginate(heights, 0, firstColMax));
    };

    const t = window.setTimeout(run, 50);
    void document.fonts?.ready?.then(() => {
      window.setTimeout(run, 30);
    });
    return () => window.clearTimeout(t);
  }, [
    displayItems,
    mode,
    branding.headerTitle,
    branding.headerSub,
    printLayout,
    typeRanges,
    designStyle,
    fontsTick,
  ]);

  function runPrint() {
    const prev = document.title;
    document.title = sheetTitle;
    // 레이아웃·폰트 반영 후 인쇄 (빈 미리보기 방지)
    requestAnimationFrame(() => {
      window.setTimeout(() => {
        window.print();
        window.setTimeout(() => {
          document.title = prev;
        }, 500);
      }, 50);
    });
  }

  function patchBranding(patch: Partial<PrintBranding>) {
    setBranding((prev) => ({ ...prev, ...patch }));
  }

  function resetBranding() {
    setBranding({
      headerKicker: `${academyName}${grade ? ` · ${grade}` : ""}`,
      headerTitle: title,
      headerSub: sourceDetail,
      footerLeft: academyName,
      footerRight: defaultFooterRight(title, mode),
      showLogo: true,
      hideOrigin: false,
    });
  }

  function renderHeader(compact: boolean, pageIdx: number, totalPages: number) {
    /*
     * 보기 단어 QR 은 생성 묶음에 딸린 것이라, 골라 묶은 시험지에는 걸지 않는다.
     * (jobId 가 빈 채로 주소를 만들면 열리지 않는 고리가 된다)
     */
    const showVocabQr =
      mode === "exam" &&
      !compact &&
      pageIdx === 0 &&
      questions.length > 0 &&
      !preloaded &&
      (!setId || Boolean(vocabSetId));
    return (
      <header
        className={`qg-print-header ${compact ? "qg-print-header-compact" : ""} ${
          mode === "answers" ? "qg-print-header-answer-sheet" : ""
        } ${showVocabQr ? "qg-print-header-with-qr" : ""}`}
      >
        <div className="qg-print-header-main">
          {branding.showLogo && logoSrc && (
            <div className="qg-print-logo-box">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoSrc}
                alt={academyName}
                className="qg-print-logo-img"
              />
            </div>
          )}
          <div className="qg-print-header-text">
            {branding.headerKicker && (
              <p className="qg-print-kicker">{branding.headerKicker}</p>
            )}
            {!compact && branding.headerTitle && (
              <h1 className="qg-print-title">{branding.headerTitle}</h1>
            )}
            {!compact && !branding.hideOrigin && branding.headerSub && (
              <p className="qg-print-sub">{branding.headerSub}</p>
            )}
            {bannerNo && !compact && !branding.hideOrigin && mode === "exam" && (
              <p className="qg-print-banner">┃3월 {bannerNo}번┃</p>
            )}
            {compact && branding.headerTitle && (
              <p className="qg-print-title qg-print-title-sm">
                {branding.headerTitle}
              </p>
            )}
          </div>
        </div>
        <div className="qg-print-header-aside">
          <div className="qg-print-header-aside-row">
            <div className="qg-print-header-aside-meta">
              <p className="qg-print-meta">
                {questions.length}문항{" "}
                <span className="qg-print-page-no">
                  {pageIdx + 1}/{totalPages}
                </span>
              </p>
            </div>
            {showVocabQr ? (
              <div className="qg-print-vocab-qr">
                <ListeningPrintQrCode
                  url={
                    vocabSetId
                      ? buildExamVocabUrl(vocabSetId)
                      : buildExamVocabUrlForJob(jobId)
                  }
                  sizePx={88}
                />
                <p className="qg-print-vocab-qr-label">
                  보기 단어
                  <br />
                  학습 QR
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </header>
    );
  }

  function renderFooter(pageIdx: number) {
    return (
      <footer className="qg-print-footer">
        <div className="qg-print-footer-left">
          {branding.showLogo && logoSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoSrc}
              alt=""
              className="qg-print-footer-logo"
            />
          )}
          <span>{branding.footerLeft || academyName}</span>
        </div>
        {/* 최종통합자료에 끼울 때는 통합자료가 교재 전체 쪽번호를 찍는다 — 두 번호가 겹치지 않게 뺀다 */}
        <span className="qg-print-footer-page">{embedded ? "" : `- ${pageIdx + 1} -`}</span>
        <span className="qg-print-footer-right">
          {branding.footerRight || "영어 변형문제"}
        </span>
      </footer>
    );
  }

  if (error) return <p className="p-6 text-red-600">{error}</p>;

  const sheetPages =
    pages.length > 0
      ? pages
      : displayItems.length > 0
        ? [
            {
              left: displayItems.map((_, i): PrintPiece => ({ item: i })),
              right: [] as PrintPiece[],
            },
          ]
        : [];

  function renderDisplayItem(item: DisplayItem | undefined, part?: PrintPiecePart) {
    if (!item) return null;
    if (item.kind === "set") {
      return <SetPassageBlock head={item.head} passage={item.passage} source={item.source} part={part} />;
    }
    return mode === "exam" ? (
      <QuestionBlock
        q={item.q}
        index={item.num}
        part={part}
        hidePassage={item.hidePassage}
        passageSource={
          branding.hideOrigin || item.hidePassage ? undefined : passageSources[item.q.passage_id ?? ""]
        }
      />
    ) : (
      <AnswerBlock q={item.q} index={item.num} part={part} />
    );
  }

  function renderPiece(piece: PrintPiece) {
    const item = displayItems[piece.item];
    return (
      <div key={`${item?.id ?? piece.item}:${piece.part?.from ?? "all"}`}>
        {renderDisplayItem(item, piece.part)}
      </div>
    );
  }

  /** 측정 영역과 인쇄 쪽들. 최종통합자료에 끼워 넣을 때(embedded)도 같은 모양을 쓴다. */
  const printBody = (
    <>
          {designStyle !== "base" ? <link rel="stylesheet" href={DESIGN_FONTS_HREF} /> : null}
          <div
            ref={measureRef}
            aria-hidden
            className={`qg-print-measure font-print no-print ${designClass(designStyle)} ${materialDesignClass(md)}`}
            style={{ width: `${COL_WIDTH_MM}mm` }}
          >
            {displayItems.map((item) => (
              <div key={item.id} data-measure-q={item.id}>
                {renderDisplayItem(item)}
              </div>
            ))}
          </div>

          <div
            id="qg-print-root"
            className={`max-w-[210mm] px-4 py-6 print:mx-0 print:max-w-none print:px-0 print:py-0 ${designClass(designStyle)} ${materialDesignClass(md)}`}
          >
            {sheetPages.map((page, pageIdx) => (
              <article
                key={pageIdx}
                className={`qg-print-page qg-print-sheet ${
                  pageIdx < sheetPages.length - 1
                    ? "qg-print-page-break"
                    : "qg-print-page-last"
                }`}
              >
                {renderHeader(pageIdx > 0, pageIdx, sheetPages.length)}
                {page.sectionLabel ? (
                  <div className="qg-print-type-banner">
                    <p className="qg-print-type-banner-title">
                      {page.sectionLabel}
                    </p>
                  </div>
                ) : null}
                <div className="qg-print-cols">
                  <div className="qg-print-col">
                    {page.left.map(renderPiece)}
                  </div>
                  <div className="qg-print-col qg-print-col-right">
                    {page.right.map(renderPiece)}
                  </div>
                </div>
                {renderFooter(pageIdx)}
              </article>
            ))}
          </div>
    </>
  );

  if (embedded) return <div className="relative">{printBody}</div>;

  return (
    <div className="qg-print-app min-h-screen bg-slate-200 print:min-h-0 print:bg-white">
      <div className="flex min-h-screen print:block print:min-h-0">
        <aside className="no-print sticky top-0 flex h-screen w-[min(100%,320px)] shrink-0 flex-col gap-3 overflow-y-auto border-r border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              href={backHref}
              className="text-sm text-slate-700 hover:underline"
            >
              ← 뒤로
            </Link>
            <Button type="button" onClick={runPrint}>
              인쇄
            </Button>
          </div>
          <div className="flex flex-col gap-1">
            <Button
              type="button"
              variant="secondary"
              disabled={!!pdf.busy}
              onClick={() =>
                void pdf.save(
                  mode === "answers" ? "해설지" : "문제지",
                  collectPrintPages(document.getElementById("qg-print-root"), ".qg-print-sheet"),
                  [branding.headerTitle || title]
                )
              }
            >
              PDF로 저장 ({mode === "answers" ? "해설지" : "문제지"})
            </Button>
            {pdf.status ? (
              <p className={`text-[11px] font-semibold ${pdf.busy ? "text-brand-700" : "text-rose-600"}`}>{pdf.status}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              보기 전환
            </p>
            <Link
              href={`${printBaseHref}/print?mode=exam${printLayout === "byType" ? "&layout=byType" : ""}`}
              className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                mode === "exam"
                  ? "bg-brand-700 text-white"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              문제지
            </Link>
            <Link
              href={`${printBaseHref}/print?mode=answers`}
              className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                mode === "answers"
                  ? "bg-brand-700 text-white"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              해설지
            </Link>
          </div>

          {mode === "exam" && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                출력 방식
              </p>
              <button
                type="button"
                className={`rounded-lg px-3 py-2 text-left text-xs font-semibold ${
                  printLayout === "mixed"
                    ? "bg-brand-700 text-white"
                    : "border border-slate-200 bg-white text-slate-700"
                }`}
                onClick={() => setPrintLayout("mixed")}
              >
                종합해서 출력
              </button>
              <button
                type="button"
                className={`rounded-lg px-3 py-2 text-left text-xs font-semibold ${
                  printLayout === "byType"
                    ? "bg-brand-700 text-white"
                    : "border border-slate-200 bg-white text-slate-700"
                }`}
                onClick={() => setPrintLayout("byType")}
              >
                유형별 출력
              </button>
              <button
                type="button"
                className={`rounded-lg px-3 py-2 text-left text-xs font-semibold ${
                  printLayout === "byPassage"
                    ? "bg-brand-700 text-white"
                    : "border border-slate-200 bg-white text-slate-700"
                }`}
                onClick={() => setPrintLayout("byPassage")}
              >
                지문 순서로 한 바퀴
              </button>
              <button
                type="button"
                className={`rounded-lg px-3 py-2 text-left text-xs font-semibold ${
                  printLayout === "bySet"
                    ? "bg-brand-700 text-white"
                    : "border border-slate-200 bg-white text-slate-700"
                }`}
                onClick={() => setPrintLayout("bySet")}
              >
                지문별 묶음 (지문 한 번 + 여러 문항)
              </button>
              <label className="mt-1 flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs">
                <input
                  type="checkbox"
                  checked={spreadPassages}
                  onChange={(e) => chooseSpread(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-brand-600"
                />
                <span>
                  <span className="font-semibold text-slate-800">같은 지문 겹치지 않게</span>
                  <span className="block text-[11px] leading-snug text-slate-500">
                    같은 지문 문항을 떨어뜨려 한 쪽에서 서로 힌트가 되지 않게 해요. 지문별 묶음에서는 지문을 바꾼
                    문항(무관한 문장·삽입·순서 등)을 뒤의 개별 문항으로 옮겨요.
                  </span>
                </span>
              </label>
            </div>
          )}

          {typeGroups.length > 1 ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  낼 유형 · 순서
                </p>
                <div className="flex gap-2">
                  {typeOrder.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => chooseTypeOrder([])}
                      className="text-[11px] font-semibold text-brand-700 hover:underline"
                    >
                      기본 순서로
                    </button>
                  ) : null}
                  {offTypes.size > 0 ? (
                    <button
                      type="button"
                      onClick={() => setOffTypes(new Set())}
                      className="text-[11px] font-semibold text-brand-700 hover:underline"
                    >
                      다 켜기
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="space-y-1">
                {typeGroups.map((t, ti) => {
                  const on = !offTypes.has(t.code);
                  return (
                    <label
                      key={t.code}
                      draggable
                      onDragStart={(e) => {
                        setDragFrom(ti);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(e) => {
                        if (dragFrom === null) return;
                        e.preventDefault();
                        if (dragOver !== ti) setDragOver(ti);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragFrom !== null) moveTypeTo(dragFrom, ti);
                        setDragFrom(null);
                        setDragOver(null);
                      }}
                      onDragEnd={() => {
                        setDragFrom(null);
                        setDragOver(null);
                      }}
                      title="끌어서 원하는 자리에 놓을 수 있습니다"
                      className={`flex cursor-grab items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                        dragOver === ti && dragFrom !== ti
                          ? "border-brand-500 ring-2 ring-brand-200"
                          : "border-slate-200"
                      } ${dragFrom === ti ? "opacity-40" : ""} ${on ? "bg-white" : "bg-slate-100 text-slate-400"}`}
                    >
                      <span aria-hidden className="shrink-0 select-none text-slate-300">⋮⋮</span>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setOffTypes((p) => {
                            const next = new Set(p);
                            if (next.has(t.code)) next.delete(t.code);
                            else next.add(t.code);
                            return next;
                          })
                        }
                        className="h-3.5 w-3.5 accent-brand-600"
                      />
                      <span className="min-w-0 flex-1 truncate font-semibold">{t.label}</span>
                      <span className="shrink-0 tabular-nums text-slate-400">{t.n}</span>
                      <span className="flex shrink-0 gap-0.5">
                        <button
                          type="button"
                          aria-label={`${t.label} 위로`}
                          disabled={ti === 0}
                          onClick={(e) => {
                            e.preventDefault();
                            moveTypeTo(ti, ti - 1);
                          }}
                          className="rounded px-1 text-[10px] text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          aria-label={`${t.label} 아래로`}
                          disabled={ti === typeGroups.length - 1}
                          onClick={(e) => {
                            e.preventDefault();
                            moveTypeTo(ti, ti + 1);
                          }}
                          className="rounded px-1 text-[10px] text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                        >
                          ▼
                        </button>
                      </span>
                    </label>
                  );
                })}
              </div>
              {offTypes.size > 0 ? (
                <p className="text-[11px] text-slate-500">
                  {shown.length}문항만 냅니다 (전체 {questions.length}문항).
                </p>
              ) : null}
            </div>
          ) : null}

          <MaterialDesignPicker value={md} onChange={chooseMd} />

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-700">
                머릿말 · 꼬릿말
              </p>
              <button
                type="button"
                className="text-xs text-brand-700 hover:underline"
                onClick={resetBranding}
              >
                기본값으로
              </button>
            </div>
            <div className="grid gap-2">
              <label className="block text-xs text-slate-600">
                머릿말 상단
                <input
                  className="ui-input mt-1 py-1.5 text-sm"
                  value={branding.headerKicker}
                  onChange={(e) =>
                    patchBranding({ headerKicker: e.target.value })
                  }
                  placeholder={academyName}
                />
              </label>
              <label className="block text-xs text-slate-600">
                머릿말 제목
                <input
                  className="ui-input mt-1 py-1.5 text-sm"
                  value={branding.headerTitle}
                  onChange={(e) =>
                    patchBranding({ headerTitle: e.target.value })
                  }
                  placeholder="자료 제목"
                />
              </label>
              <label className="block text-xs text-slate-600">
                머릿말 부제
                <input
                  className="ui-input mt-1 py-1.5 text-sm"
                  value={branding.headerSub}
                  onChange={(e) => patchBranding({ headerSub: e.target.value })}
                  placeholder="출처·설명"
                />
              </label>
              <label className="block text-xs text-slate-600">
                꼬릿말 왼쪽
                <input
                  className="ui-input mt-1 py-1.5 text-sm"
                  value={branding.footerLeft}
                  onChange={(e) =>
                    patchBranding({ footerLeft: e.target.value })
                  }
                  placeholder={academyName}
                />
              </label>
              <label className="block text-xs text-slate-600">
                꼬릿말 오른쪽
                <input
                  className="ui-input mt-1 py-1.5 text-sm"
                  value={branding.footerRight}
                  onChange={(e) =>
                    patchBranding({ footerRight: e.target.value })
                  }
                  placeholder="영어 변형문제"
                />
              </label>
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={branding.showLogo}
                onChange={(e) => patchBranding({ showLogo: e.target.checked })}
              />
              학원 로고 표시
            </label>
            <label className="mt-2 flex items-start gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={branding.hideOrigin}
                onChange={(e) => patchBranding({ hideOrigin: e.target.checked })}
              />
              <span>
                출처 감추기
                <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                  문항 번호 위의 출처와 머리말의 출처(예: 2026년 9월 고1 모의고사),
                  문항 번호 띠를 뺍니다.
                </span>
              </span>
            </label>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {printBody}
        </div>
      </div>
    </div>
  );
}
