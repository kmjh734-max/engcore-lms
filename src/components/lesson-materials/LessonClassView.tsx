"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { postJson } from "@/lib/lesson-materials/post-json";
import { askCreditConfirm } from "@/lib/credits/confirm-store";
import { usePdfSave } from "@/components/pdf/usePdfSave";
import { collectPrintPages } from "@/lib/pdf/download-sheets-pdf";
import type { TestBookProjectInput } from "@/lib/lesson-materials/test-book";
import type { TeacherNotes, TeacherSpotKind } from "@/lib/lesson-materials/teacher-notes";
import type { ClassGrammarMark } from "@/lib/lesson-materials/test-book-actions";

/**
 * 교사용·학생용 수업 화면(선생님 2026-11-10, 정수학원 먼저 — lesson_class_view).
 *
 * 칠판·남색·크림·흰색 배경, 한글·영어 글씨체, 글자 크기를 고른다. 지문 위에 문법 번호(분석서) · 동반의어(단어 정리) ·
 * 출제 자리(빈칸·삽입·지칭·함축) · 쉽게 말하면을 겹치고, 지문 아래에 출제 예상 자리 · 글의 흐름 · 문법 포인트,
 * 그 아래 교사용 해설 8칸(teacher-notes.ts). 학생용은 해석·교사용 해설을 빼고 지칭 대상·함축 뜻·문법 설명·흐름 가운데를 빈 줄로.
 *
 * 선생님 2026-11-10 「PDF도 지금 화면과 똑같이, 애초부터 A4 안에」: 화면을 처음부터 A4 쪽으로 나눠 그리고(덩어리마다 높이를 재서
 * 쪽에 채움), PDF는 그 쪽을 그대로 찍는다 — 배경색·글씨체·글자 크기까지 화면 그대로.
 */

type Mode = "teacher" | "student";
type Theme = "chalk" | "navy" | "cream" | "white";
type Layer = "grammar" | "vocab" | "spots" | "easy" | "ko" | "side";

const THEMES: Array<{ id: Theme; label: string; swatch: string }> = [
  { id: "chalk", label: "칠판", swatch: "#2f4a3a" },
  { id: "navy", label: "남색", swatch: "#1d2a44" },
  { id: "cream", label: "크림", swatch: "#f8f1df" },
  { id: "white", label: "흰색", swatch: "#ffffff" },
];
const KO_FONTS: Array<{ id: string; label: string; css: string }> = [
  { id: "noto", label: "본고딕", css: '"Noto Sans KR", sans-serif' },
  { id: "nanum", label: "나눔고딕", css: '"Nanum Gothic", sans-serif' },
  { id: "gowun", label: "고운돋움", css: '"Gowun Dodum", sans-serif' },
  { id: "serif", label: "본명조", css: '"Noto Serif KR", serif' },
  { id: "gaegu", label: "개구(손글씨)", css: '"Gaegu", cursive' },
  { id: "pen", label: "나눔펜(손글씨)", css: '"Nanum Pen Script", cursive' },
];
const EN_FONTS: Array<{ id: string; label: string; css: string | null }> = [
  { id: "same", label: "한글과 같게", css: null },
  { id: "merri", label: "Merriweather", css: '"Merriweather", serif' },
  { id: "lora", label: "Lora", css: '"Lora", serif' },
  { id: "georgia", label: "Georgia", css: "Georgia, serif" },
  { id: "arial", label: "Arial", css: "Arial, sans-serif" },
];
const LAYERS: Array<{ id: Layer; label: string }> = [
  { id: "grammar", label: "문법" },
  { id: "vocab", label: "동반의어" },
  { id: "spots", label: "출제 자리" },
  { id: "easy", label: "쉽게 말하면" },
  { id: "ko", label: "해석" },
  { id: "side", label: "흐름" },
];
const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;600;800&family=Noto+Serif+KR:wght@400;700&family=Nanum+Gothic:wght@400;700;800&family=Gowun+Dodum&family=Nanum+Pen+Script&family=Gaegu:wght@400;700&family=Merriweather:wght@400;700&family=Lora:wght@400;700&display=swap";
const SETTINGS_KEY = "lesson-class-view";
const SPOT_LABEL: Record<TeacherSpotKind, string> = { blank: "빈칸", insert: "삽입", reference: "지칭", implication: "함축" };
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

type Settings = {
  mode: Mode;
  theme: Theme;
  koFont: string;
  enFont: string;
  size: number;
  layers: Record<Layer, boolean>;
};
const DEFAULT_SETTINGS: Settings = {
  mode: "teacher",
  theme: "chalk",
  koFont: "noto",
  enFont: "same",
  size: 14,
  layers: { grammar: true, vocab: true, spots: true, easy: true, ko: true, side: true },
};

// ---------------------------------------------------------------- 지문 위 표시 모으기

type GrammarMark = ClassGrammarMark;
type VocabMark = { si: number; start: number; end: number; syn: string[]; ant: string[]; level: number };
type SpotMark = { si: number; start: number; end: number; kind: TeacherSpotKind; q: string; note: string };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function findIn(sentence: string, q: string): number {
  if (!q) return -1;
  const i = sentence.indexOf(q);
  if (i >= 0) return i;
  return sentence.toLowerCase().indexOf(q.toLowerCase());
}

function vocabMarks(p: TestBookProjectInput): VocabMark[] {
  const out: VocabMark[] = [];
  const taken = new Set<string>();
  for (const v of p.material?.vocab ?? []) {
    const syn = v.synonyms.filter(Boolean).slice(0, 3);
    const ant = v.antonyms.filter(Boolean).slice(0, 3);
    if (!syn.length && !ant.length) continue;
    const word = v.word.trim();
    if (!word || word.includes(" ") || taken.has(word.toLowerCase())) continue;
    const re = new RegExp(`\\b${escapeRe(word)}(s|es|d|ed|ing|ly)?\\b`, "i");
    for (let si = 0; si < p.sentences.length; si++) {
      const m = re.exec(p.sentences[si]!.english);
      if (m) {
        out.push({ si, start: m.index, end: m.index + m[0].length, syn, ant, level: 0 });
        taken.add(word.toLowerCase());
        break;
      }
    }
  }
  // 이름표 글씨(본문의 0.46배)가 다음 낱말 이름표와 겹치면 한 줄 위로 올린다
  out.sort((a, b) => a.si - b.si || a.start - b.start);
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1]!;
    const cur = out[i]!;
    if (prev.si !== cur.si) continue;
    const prevLen = (prev.syn.length ? 2 + prev.syn.join(", ").length : 0) + (prev.ant.length ? 3 + prev.ant.join(", ").length : 0);
    if (prevLen * 0.5 + 1 > cur.start - prev.start) cur.level = prev.level === 0 ? 1 : 0;
  }
  return out;
}

function spotMarks(p: TestBookProjectInput, notes: TeacherNotes | null | undefined): SpotMark[] {
  const out: SpotMark[] = [];
  for (const s of notes?.spots ?? []) {
    const sentence = p.sentences[s.sentence]?.english;
    if (!sentence) continue;
    const at = findIn(sentence, s.q);
    if (at < 0) continue;
    out.push({ si: s.sentence, start: at, end: at + s.q.length, kind: s.kind, q: s.q, note: s.note });
  }
  return out;
}

// ---------------------------------------------------------------- 한 문장 그리기

function SentenceLine({
  text,
  grammar,
  vocab,
  spots,
  layers,
}: {
  text: string;
  grammar: GrammarMark[];
  vocab: VocabMark[];
  spots: SpotMark[];
  layers: Record<Layer, boolean>;
}) {
  const g = layers.grammar ? grammar : [];
  const v = layers.vocab ? vocab : [];
  const s = layers.spots ? spots : [];
  const cuts = new Set<number>([0, text.length]);
  for (const m of [...g, ...v, ...s]) {
    cuts.add(Math.max(0, Math.min(text.length, m.start)));
    cuts.add(Math.max(0, Math.min(text.length, m.end)));
  }
  const pts = [...cuts].sort((a, b) => a - b);
  const parts: ReactNode[] = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k]!;
    const b = pts[k + 1]!;
    const inside = <T extends { start: number; end: number }>(list: T[]) => list.filter((m) => m.start <= a && m.end >= b);
    const gs = inside(g);
    const ss = inside(s);
    const vs = v.filter((m) => m.start === a);
    const cls = [
      gs.length ? "lc-g" : "",
      ...ss.map((x) => `lc-s-${x.kind}`),
      inside(v).length ? "lc-v" : "",
    ]
      .filter(Boolean)
      .join(" ");
    parts.push(
      <span key={`t${a}`} className={cls || undefined}>
        {vs.map((m, i) => (
          <span key={i} className={m.level ? "lc-vl lc-vl2" : "lc-vl"}>
            {m.syn.length ? <span className="lc-syn">= {m.syn.join(", ")}</span> : null}
            {m.syn.length && m.ant.length ? " " : null}
            {m.ant.length ? <span className="lc-ant">↔ {m.ant.join(", ")}</span> : null}
          </span>
        ))}
        {text.slice(a, b)}
      </span>
    );
    for (const m of g.filter((x) => x.end === b)) {
      parts.push(
        <sup key={`g${m.no}`} className="lc-gn">
          {CIRCLED[m.no - 1] ?? `(${m.no})`}
        </sup>
      );
    }
    for (const m of s.filter((x) => x.end === b)) {
      parts.push(
        <span key={`s${m.kind}${a}`} className={`lc-tag lc-tag-${m.kind}`}>
          {SPOT_LABEL[m.kind]}
        </span>
      );
    }
  }
  return <>{parts}</>;
}

// ---------------------------------------------------------------- 쪽에 채울 덩어리

/** 쪽에 하나씩 채우는 덩어리. keepNext는 제목처럼 다음 덩어리와 같은 쪽에 있어야 하는 것, newPage는 새 쪽에서 시작 */
type Block = { key: string; node: ReactNode; keepNext?: boolean; newPage?: boolean; passage?: number };

function passageBlocks(
  p: TestBookProjectInput,
  index: number,
  mode: Mode,
  layers: Record<Layer, boolean>,
  notes: TeacherNotes | null,
  grammar: GrammarMark[]
): Block[] {
  const teacher = mode === "teacher";
  const vocab = vocabMarks(p);
  const spots = spotMarks(p, notes);
  const blank = <span className="lc-blank" />;
  const k = (s: string) => `${p.id}:${s}`;
  const out: Block[] = [];
  out.push({
    key: k("head"),
    newPage: true,
    keepNext: true,
    passage: index,
    node: (
      <div className="lc-headblock">
        <h2 className="lc-h1">
          {String(index + 1).padStart(2, "0")} · {notes?.title.en || p.titleEn || p.title}
        </h2>
        <p className="lc-meta">
          {p.source ? `${p.source} · ` : ""}
          {notes ? `주제: ${notes.topic.ko}` : p.title}
        </p>
      </div>
    ),
  });
  // 흐름 단계는 그 단계가 시작하는 문장 옆에 둔다(「3·4」 → 3번 문장)
  const flowAt = new Map<number, Array<{ f: NonNullable<typeof notes>["flow"][number]; i: number }>>();
  (notes?.flow ?? []).forEach((f, i) => {
    const n = Number((f.sentences.match(/\d+/) ?? [])[0]);
    const si = Number.isFinite(n) && n >= 1 ? Math.min(n - 1, p.sentences.length - 1) : 0;
    flowAt.set(si, [...(flowAt.get(si) ?? []), { f, i }]);
  });
  const flowCount = notes?.flow.length ?? 0;

  // 문장마다 한 줄: 왼쪽(3) 영어 · 해석 · 문법 한 줄 · 출제 예상 자리, 오른쪽(1) 흐름 · 쉽게 말하면
  p.sentences.forEach((s, si) => {
    const easy = layers.easy ? notes?.easy.find((e) => e.sentence === si) : undefined;
    const own = grammar.filter((m) => m.si === si);
    const ownSpots = spots.filter((m) => m.si === si);
    const steps = layers.side ? (flowAt.get(si) ?? []) : [];
    out.push({
      key: k(`s${si}`),
      node: (
        <div className="lc-row2">
          <div className="lc-main">
            <p className="lc-en">
              <span className="lc-sn">{si + 1}</span>
              <SentenceLine text={s.english} grammar={own} vocab={vocab.filter((m) => m.si === si)} spots={ownSpots} layers={layers} />
            </p>
            {layers.ko && teacher && s.korean ? <p className="lc-ko">{s.korean}</p> : null}
            {layers.grammar && own.length ? (
              <div className="lc-glines">
                {own.map((m) => (
                  <p key={m.no}>
                    <span className="lc-gn2">{CIRCLED[m.no - 1] ?? `(${m.no})`}</span>{" "}
                    {teacher ? (
                      m.short || (
                        <>
                          <b>{m.label}</b> {m.q}
                        </>
                      )
                    ) : (
                      <>
                        <b>{m.label}</b> {blank}
                      </>
                    )}
                  </p>
                ))}
              </div>
            ) : null}
            {layers.spots && ownSpots.length ? (
              <div className="lc-spots">
                {ownSpots.map((m, i) => (
                  <p key={i}>
                    <span className={`lc-tag lc-tag-${m.kind}`}>{SPOT_LABEL[m.kind]}</span> <b>{m.q}</b>
                    {m.note ? <> — {teacher || m.kind === "blank" || m.kind === "insert" ? m.note : blank}</> : null}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
          <div className="lc-aside">
            {steps.map(({ f, i }) => {
              const hide = !teacher && i > 0 && i < flowCount - 1;
              return (
                <div key={i} className="lc-astep">
                  <b>
                    {i + 1}. {f.label}
                  </b>
                  {f.lines.map((l, j) => (
                    <div key={j}>{hide ? <span className="lc-blank lc-blank-s" /> : l}</div>
                  ))}
                </div>
              );
            })}
            {easy ? (
              <p className="lc-aeasy">
                <b>쉽게 말하면</b>
                <br />
                {easy.text}
              </p>
            ) : null}
          </div>
        </div>
      ),
    });
  });
  const section = (key: string, title: string, items: Array<{ key: string; node: ReactNode }>, cls = "") => {
    if (!items.length) return;
    out.push({ key: k(`${key}-h`), keepNext: true, node: <h3 className={`lc-sec ${cls}`}>{title}</h3> });
    for (const it of items) out.push({ key: k(`${key}-${it.key}`), node: <div className="lc-item">{it.node}</div> });
  };

  if (!teacher || !notes) return out;

  // 교사용 해설 8칸 — 새 쪽에서(선생님 2026-11-10 「별도 페이지에 깔끔하게」)
  out.push({
    key: k("t-h"),
    newPage: true,
    keepNext: true,
    node: (
      <div className="lc-thead">
        <span>교사용 해설</span>
        <b>
          {String(index + 1).padStart(2, "0")} · {notes.title.en || p.title}
        </b>
      </div>
    ),
  });
  const t = (key: string, title: string, items: ReactNode[]) =>
    section(
      key,
      title,
      items.map((node, i) => ({ key: String(i), node })),
      "lc-sec-t"
    );
  t(
    "bg",
    "1. 배경지식",
    notes.background.map((b, i) => (
      <p key={i}>
        {i + 1}.{" "}
        <b>
          {b.term}
          {b.termEn ? `(${b.termEn})` : ""}
        </b>{" "}
        — {b.definition} <span className="lc-dim">예) {b.example}</span>
      </p>
    ))
  );
  t(
    "tip",
    "2. 이 지문을 효과적으로 강의할 수 있는 Tip",
    [
      notes.tip.hookTitle ? (
        <p>
          <b>도입부 썰</b> — {notes.tip.hookTitle}
        </p>
      ) : null,
      notes.tip.script ? <p className="lc-script">“{notes.tip.script.replace(/^“|”$/g, "")}”</p> : null,
      notes.tip.analogy ? (
        <p>
          <b>어려운 개념 비유</b> — {notes.tip.analogy}
        </p>
      ) : null,
      ...notes.tip.points.map((x, i) => (
        <p key={i}>
          {i === 0 ? <b>강조 포인트 </b> : null}
          {i + 1}. {x}
        </p>
      )),
    ].filter(Boolean)
  );
  t("tts", "3. 주제 / 제목 / 요약문", [
    <p key="a">
      <b>Topic</b> {notes.topic.en}
      <br />
      <span className="lc-dim">{notes.topic.ko}</span>
    </p>,
    <p key="b">
      <b>Title</b> {notes.title.en}
      <br />
      <span className="lc-dim">{notes.title.ko}</span>
    </p>,
    <p key="c">
      <b>Summary</b> {notes.summary.en}
      <br />
      <span className="lc-dim">{notes.summary.ko}</span>
    </p>,
  ]);
  t(
    "fl",
    "4. 지문 FLOW",
    notes.flow.map((f, i) => (
      <p key={i}>
        <b>
          {i + 1}. {f.label}
        </b>
        {f.sentences ? ` (${f.sentences}번)` : ""}
        {f.lines.map((l, j) => (
          <span key={j}>
            <br />
            {l}
          </span>
        ))}
      </p>
    ))
  );
  if (notes.vocab.length)
    t("voc", "5. 핵심 어휘 분석", [
      <div key="h" className="lc-row lc-row-v lc-row-head">
        <span>단어</span>
        <span>뜻</span>
        <span>어원 분석</span>
        <span>문맥상 동의어</span>
      </div>,
      ...notes.vocab.map((v, i) => (
        <div key={i} className="lc-row lc-row-v">
          <b>{v.word}</b>
          <span>{v.meaning}</span>
          <span>{v.etymology || "—"}</span>
          <span>{v.synonyms.join(", ")}</span>
        </div>
      )),
    ]);
  t(
    "fig",
    "6. 비유와 함축 의미",
    notes.figurative.length
      ? notes.figurative.map((f, i) => (
          <p key={i}>
            <b>표현</b> {f.expression}
            <br />
            <b>함축 의미</b> {f.meaningEn}
            <br />
            <b>설명</b> {f.explainKo}
          </p>
        ))
      : [<p key="0" className="lc-dim">이 지문에는 따로 짚을 비유적 표현이 없습니다.</p>]
  );
  if (notes.questionTypes.length)
    t("qt", "7. 출제 가능성이 높은 문제 유형", [
      <p key="n" className="lc-dim">
        별점은 평가원 출제 확률이 아니라 지문 구조를 보고 내린 교육적 판단입니다.
      </p>,
      <div key="h" className="lc-row lc-row-q lc-row-head">
        <span>유형</span>
        <span>적합도</span>
        <span>이유 · 출제 지점</span>
        <span>함정</span>
        <span>풀이 전략</span>
      </div>,
      ...notes.questionTypes.map((q, i) => (
        <div key={i} className="lc-row lc-row-q">
          <b>{q.type}</b>
          <span className="lc-stars">{"★".repeat(q.stars) + "☆".repeat(5 - q.stars)}</span>
          <span>
            {q.reason}
            {q.spot ? <span className="lc-dim"> · {q.spot}</span> : null}
          </span>
          <span>{q.trap}</span>
          <span>{q.strategy}</span>
        </div>
      )),
    ]);
  t("rv", "8. 강의 마무리 – 시험 대비 핵심 정리", [
    <p key="1">
      1️⃣ <b>Main Idea &amp; Claim</b> — {notes.review.mainIdea}
      {notes.review.studentLine ? (
        <>
          <br />
          학생 한 줄: “{notes.review.studentLine.replace(/^“|”$/g, "")}”
        </>
      ) : null}
    </p>,
    <p key="2">
      2️⃣ <b>Key Vocabulary &amp; Synonyms</b> — {notes.review.vocabNote}
    </p>,
    <p key="3">
      3️⃣ <b>Expected Question Types</b> — {notes.review.typesNote}
    </p>,
    <p key="4">
      4️⃣ <b>Figurative Expressions</b> — {notes.review.figurativeNote}
    </p>,
  ]);
  return out;
}

// ---------------------------------------------------------------- A4 쪽 나누기

const PAGE_PAD_MM = 12;
const MM = 96 / 25.4;
/** 쪽 안쪽 높이(px) — 297mm에서 위아래 여백과 쪽 번호 자리를 뺀다 */
const BODY_PX = (297 - PAGE_PAD_MM * 2 - 6) * MM;

function paginate(heights: number[], blocks: Block[]): number[][] {
  const pages: number[][] = [];
  let cur: number[] = [];
  let used = 0;
  const flush = () => {
    if (cur.length) pages.push(cur);
    cur = [];
    used = 0;
  };
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    const h = heights[i] ?? 0;
    if (b.newPage) flush();
    // 제목은 다음 덩어리와 같이 들어갈 자리가 없으면 다음 쪽으로
    const need = b.keepNext && i + 1 < blocks.length ? h + (heights[i + 1] ?? 0) : h;
    if (cur.length && used + need > BODY_PX) flush();
    cur.push(i);
    used += h;
  }
  flush();
  return pages;
}

// ---------------------------------------------------------------- 모양

const CSS = `
.lc-root{--bg:#2f4a3a;--panel:#35523f;--ink:#f3f1e7;--sub:#c9d3c4;--line:#5d7a66;--gram:#ffe27a;--syn:#9fd8ff;--ant:#ffadad;--head:#ffe27a;
  --t-blank:#ffb84d;--t-insert:#7ee0a8;--t-reference:#c7a6ff;--t-implication:#ff8fc8;--easy:#7ee0a8;--shadow:0 0 1px rgba(255,255,255,.35)}
.lc-root[data-theme="navy"]{--bg:#1d2a44;--panel:#24345a;--ink:#f1f4fb;--sub:#b8c3dc;--line:#3d5180;--shadow:none}
.lc-root[data-theme="cream"],.lc-root[data-theme="white"]{--ink:#1d1d1f;--sub:#5f5a50;--gram:#a66b00;--syn:#1f6fb2;--ant:#c0392b;--head:#8a5a00;
  --t-blank:#d9780a;--t-insert:#1e8a4c;--t-reference:#7240c9;--t-implication:#c2307a;--easy:#1e8a4c;--shadow:none}
.lc-root[data-theme="cream"]{--bg:#f8f1df;--panel:#fffaf0;--line:#e2d6b8}
.lc-root[data-theme="white"]{--bg:#fff;--panel:#f7f7f5;--line:#dedede}
.lc-root{font-family:var(--ff)}
.lc-page{width:210mm;height:297mm;box-sizing:border-box;padding:${PAGE_PAD_MM}mm ${PAGE_PAD_MM + 1}mm;background:var(--bg);color:var(--ink);
  position:relative;overflow:hidden;font-size:var(--fs);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.lc-pno{position:absolute;bottom:6mm;left:0;right:0;text-align:center;font-size:9px;color:var(--sub)}
.lc-measure{position:absolute;left:-100000px;top:0;width:${210 - (PAGE_PAD_MM + 1) * 2}mm;visibility:hidden;font-size:var(--fs)}
.lc-headblock{padding-bottom:3mm}
.lc-h1{font-size:1.35em;font-weight:800;margin:0;line-height:1.3}
.lc-meta{color:var(--sub);font-size:.72em;margin:2px 0 0}
.lc-row2{display:grid;grid-template-columns:3fr 1fr;gap:0 4mm;padding-top:.85em}
.lc-main{min-width:0}
.lc-aside{font-size:.6em;line-height:1.5;border-left:1px dashed var(--line);padding:.6em 0 0 2.5mm;color:var(--ink)}
.lc-aside p{margin:0 0 .5em}
.lc-astep{border:1.5px solid var(--line);border-left:4px solid var(--head);border-radius:6px;padding:.35em .55em;margin-bottom:.45em;background:var(--panel)}
.lc-astep b{color:var(--head)}
.lc-aeasy{border-left:3px solid var(--easy);padding:.2em 0 .2em .55em;background:color-mix(in srgb,var(--bg) 86%,var(--easy) 14%);border-radius:0 6px 6px 0}
.lc-aeasy b{color:var(--easy)}
.lc-glines{font-size:.64em;line-height:1.5;margin:.25em 0 0 1.6em}
.lc-glines p{margin:.1em 0}
.lc-spots{font-size:.64em;line-height:1.5;margin:.3em 0 0 1.6em}
.lc-spots p{margin:.15em 0}
.lc-blank-s{min-width:100%;display:block;margin-top:.9em}
.lc-thead{display:flex;align-items:baseline;gap:.8em;padding:.6em .9em;border-radius:8px;background:color-mix(in srgb,var(--bg) 80%,var(--head) 20%);margin-bottom:.2em}
.lc-thead span{font-size:1.05em;font-weight:800;color:var(--head)}
.lc-thead b{font-size:.8em}
.lc-sec-t{border-bottom:none;border-left:4px solid var(--head);padding:1em 0 .3em .6em;margin-top:.4em}
.lc-en{font-family:var(--fe,var(--ff));font-size:1em;line-height:2.25;margin:0;text-shadow:var(--shadow)}
.lc-sn{display:inline-block;min-width:1.4em;color:var(--sub);font-size:.62em;font-weight:800}
.lc-ko{font-size:.68em;color:var(--sub);margin:0 0 .2em 1.6em;line-height:1.55}
.lc-easy{font-size:.68em;line-height:1.55;margin:.3em 0 .2em 1.6em;padding:.35em .8em;border-left:4px solid var(--easy);
  background:color-mix(in srgb,var(--bg) 84%,var(--easy) 16%);border-radius:0 6px 6px 0}
.lc-easy b{color:var(--easy)}
.lc-g{border-bottom:2px solid var(--gram)}
.lc-gn{color:var(--gram);font-weight:800;font-size:.6em;margin-left:1px}
.lc-v{position:relative}
.lc-vl{position:absolute;left:0;top:-1.05em;white-space:nowrap;font-size:.46em;font-weight:600;line-height:1;pointer-events:none}
.lc-vl2{top:-2.1em}
.lc-syn{color:var(--syn)}.lc-ant{color:var(--ant)}
.lc-s-blank{box-shadow:inset 0 -.42em 0 color-mix(in srgb,var(--t-blank) 42%,transparent)}
.lc-s-implication{border-top:2px dashed var(--t-implication);border-bottom:2px dashed var(--t-implication)}
.lc-s-reference{border-bottom:3px dotted var(--t-reference)}
.lc-s-insert{color:var(--t-insert);font-weight:700}
.lc-tag{display:inline-block;font-family:var(--ff);font-size:.55em;font-weight:800;padding:0 .55em;border-radius:999px;margin:0 2px;vertical-align:middle;line-height:1.7;color:#111;text-shadow:none}
.lc-tag-blank{background:var(--t-blank)}.lc-tag-insert{background:var(--t-insert)}.lc-tag-reference{background:var(--t-reference)}.lc-tag-implication{background:var(--t-implication)}
.lc-root[data-theme="cream"] .lc-tag:not(.lc-tag-blank),.lc-root[data-theme="white"] .lc-tag:not(.lc-tag-blank){color:#fff}
.lc-sec{margin:0;padding:1.1em 0 .35em;font-size:.82em;font-weight:800;color:var(--head);border-bottom:1.5px solid var(--line)}
.lc-item{font-size:.7em;line-height:1.6;padding:.35em 0 0}
.lc-item p{margin:0}
.lc-gn2{color:var(--gram);font-weight:800}
.lc-blank{display:inline-block;min-width:12em;border-bottom:1.5px solid var(--sub);height:1em;vertical-align:baseline}
.lc-flow{display:flex;flex-wrap:wrap;align-items:stretch;gap:.4em 0;padding-top:.5em;font-size:.66em;line-height:1.5}
.lc-fstep{display:flex;align-items:center}
.lc-farr{color:var(--sub);padding:0 .35em;font-weight:800}
.lc-fbox{border:1.5px solid var(--line);border-radius:8px;padding:.35em .6em;background:var(--panel);text-align:center;max-width:15em}
.lc-sec-t{color:var(--head)}
.lc-script{border-left:4px solid var(--t-implication);padding:.3em .8em !important;background:color-mix(in srgb,var(--bg) 88%,var(--t-implication) 12%);border-radius:0 6px 6px 0}
.lc-dim{color:var(--sub)}
.lc-row{display:grid;gap:0 .7em;padding:.25em 0;border-bottom:1px solid var(--line)}
.lc-row-v{grid-template-columns:7.5em 9em 1fr 9em}
.lc-row-q{grid-template-columns:6.5em 5.2em 1.3fr 1fr 1fr}
.lc-row-head{font-weight:800;color:var(--sub)}
.lc-stars{color:#e0a100;white-space:nowrap}
`;

// ---------------------------------------------------------------- 화면

export function LessonClassView({
  role,
  projects,
  title,
  onClose,
}: {
  role: "admin" | "teacher";
  projects: TestBookProjectInput[];
  title: string;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Settings>;
        const size = typeof saved.size === "number" && saved.size >= 11 && saved.size <= 24 ? saved.size : DEFAULT_SETTINGS.size;
        setSettings({ ...DEFAULT_SETTINGS, ...saved, size, layers: { ...DEFAULT_SETTINGS.layers, ...(saved.layers ?? {}) } });
      }
    } catch {
      /* 기본 */
    }
  }, []);
  const update = (patch: Partial<Settings>) =>
    setSettings((s) => {
      const next = { ...s, ...patch };
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        /* 무시 */
      }
      return next;
    });

  // 해설·문법 번호는 이 화면을 열 때 따로 읽는다
  const [error, setError] = useState<string | null>(null);
  const [extra, setExtra] = useState<Record<string, { notes: TeacherNotes | null; grammar: GrammarMark[] }>>({});
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    void postJson<{ ok: true; data: Record<string, { notes: TeacherNotes | null; grammar: GrammarMark[] }> } | { ok: false; message: string }>(
      "/api/lesson-materials/test-book",
      { role, op: "classData", projectIds: projects.map((x) => x.id) }
    )
      .then((res) => {
        if (!alive) return;
        if (res.ok) setExtra(res.data);
        else setError(res.message);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "불러오지 못했습니다."))
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const notesOf = (id: string) => extra[id]?.notes ?? null;
  const missing = loaded ? projects.filter((x) => !notesOf(x.id)) : [];

  // 교사용 해설 만들기
  const [busy, setBusy] = useState<string | null>(null);
  async function makeNotes(targets: TestBookProjectInput[], regenerate = false) {
    if (busy || !targets.length) return;
    const go = await askCreditConfirm({
      title: "교사용 수업 해설",
      description:
        "지문마다 배경지식 · 강의 Tip · 주제/제목/요약문 · FLOW · 어휘(어원) · 비유와 함축 · 출제 유형 · 마무리 정리와, 지문 위 출제 자리 · 쉽게 말하면을 만듭니다. 학생용은 같은 재료로 나옵니다.",
      subject: targets.length === 1 ? `「${targets[0]!.title}」` : `지문 ${targets.length}개`,
      contents: ["교사용 해설 8칸", "출제 자리", "쉽게 말하면", "학생용"],
      items: [{ feature: "lesson_teacher_notes", quantity: targets.length }],
    });
    if (!go) return;
    setError(null);
    let done = 0;
    const failed: string[] = [];
    setBusy(`교사용 해설 만드는 중… 0/${targets.length}`);
    let next = 0;
    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= targets.length) return;
        const t = targets[i]!;
        try {
          const res = await postJson<{ ok: true; notes: TeacherNotes } | { ok: false; message: string }>(
            "/api/lesson-materials/test-book",
            { role, op: "teacherNotes", projectId: t.id, forceRegenerate: regenerate }
          );
          if (res.ok) setExtra((x) => ({ ...x, [t.id]: { grammar: x[t.id]?.grammar ?? [], notes: res.notes } }));
          else failed.push(`「${t.title}」 ${res.message}`);
        } catch (e) {
          failed.push(`「${t.title}」 ${e instanceof Error ? e.message : "실패"}`);
        }
        done += 1;
        setBusy(`교사용 해설 만드는 중… ${done}/${targets.length}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker));
    setBusy(null);
    if (failed.length) setError(failed.join(" · "));
  }

  // ------------------------------------------------ 덩어리 → A4 쪽
  const blocks = useMemo(
    () =>
      projects.flatMap((p, i) => passageBlocks(p, i, settings.mode, settings.layers, extra[p.id]?.notes ?? null, extra[p.id]?.grammar ?? [])),
    [projects, settings.mode, settings.layers, extra]
  );
  const measureRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(100);
  const [fontsTick, setFontsTick] = useState(0);
  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts) return;
    let alive = true;
    const bump = () => alive && setFontsTick((t) => t + 1);
    void document.fonts.ready.then(bump);
    document.fonts.addEventListener?.("loadingdone", bump);
    return () => {
      alive = false;
      document.fonts.removeEventListener?.("loadingdone", bump);
    };
  }, []);
  const layoutKey = `${settings.mode}|${settings.size}|${settings.koFont}|${settings.enFont}|${JSON.stringify(settings.layers)}|${blocks.length}|${fontsTick}|${loaded}`;
  const [pages, setPages] = useState<{ key: string; list: number[][] }>({ key: "", list: [] });
  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root) return;
    const els = Array.from(root.children) as HTMLElement[];
    const heights = els.map((el) => el.getBoundingClientRect().height);
    setPages({ key: layoutKey, list: paginate(heights, blocks) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, extra]);
  // 동반의어 이름표가 지문 칸 오른쪽을 넘으면 낱말 오른쪽 끝에 맞춘다(옆 설명 칸·쪽 밖으로 나가지 않게)
  useLayoutEffect(() => {
    const root = pagesRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>(".lc-vl").forEach((el) => {
      el.style.left = "";
      el.style.right = "";
      const box = el.closest(".lc-main")?.getBoundingClientRect();
      if (box && el.getBoundingClientRect().right > box.right + 1) {
        el.style.left = "auto";
        el.style.right = "0";
      }
    });
  }, [pages, zoom]);
  const firstPageOf = useMemo(() => {
    const m = new Map<number, number>();
    pages.list.forEach((pg, pi) => {
      const b = blocks[pg[0]!];
      if (b?.passage !== undefined && !m.has(b.passage)) m.set(b.passage, pi);
    });
    return m;
  }, [pages, blocks]);

  // ------------------------------------------------ PDF — 화면의 쪽을 그대로
  const pdf = usePdfSave();
  const [pendingPdf, setPendingPdf] = useState<Mode | null>(null);
  useEffect(() => {
    if (!pendingPdf || settings.mode !== pendingPdf || pages.key !== layoutKey) return;
    const label = pendingPdf === "teacher" ? "교사용" : "학생용";
    setPendingPdf(null);
    requestAnimationFrame(() => {
      void pdf.save(label, collectPrintPages(pagesRef.current, ".lc-page"), [title], undefined, false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPdf, settings.mode, pages.key, layoutKey]);
  const savePdf = (mode: Mode) => {
    if (settings.mode !== mode) update({ mode });
    setPendingPdf(mode);
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const [cur, setCur] = useState(0);
  const goPassage = (i: number) => {
    setCur(i);
    const pi = firstPageOf.get(i);
    const el = pi !== undefined ? pagesRef.current?.querySelectorAll<HTMLElement>(".lc-page")[pi] : null;
    el?.scrollIntoView({ block: "start" });
  };

  const ko = KO_FONTS.find((f) => f.id === settings.koFont) ?? KO_FONTS[0]!;
  const en = EN_FONTS.find((f) => f.id === settings.enFont) ?? EN_FONTS[0]!;
  const rootStyle = {
    ["--ff" as string]: ko.css,
    ...(en.css ? { ["--fe" as string]: en.css } : {}),
    ["--fs" as string]: `${settings.size}px`,
  } as CSSProperties;
  const barBtn = (on: boolean) =>
    `rounded-md px-2.5 py-1 text-xs font-bold ${on ? "bg-white text-slate-900" : "text-white/80 hover:bg-white/10"}`;
  const curProject = projects[cur];

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-700 print:hidden">
      <link rel="stylesheet" href={FONTS_HREF} />
      <style>{CSS}</style>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-slate-900 px-4 py-2 text-xs text-white">
        <button type="button" onClick={onClose} className="rounded-md px-2 py-1 font-bold text-white/80 hover:bg-white/10">
          ← 닫기
        </button>
        <span className="inline-flex overflow-hidden rounded-md border border-white/30">
          <button type="button" className={barBtn(settings.mode === "teacher")} onClick={() => update({ mode: "teacher" })}>
            교사용
          </button>
          <button type="button" className={barBtn(settings.mode === "student")} onClick={() => update({ mode: "student" })}>
            학생용
          </button>
        </span>
        <span className="flex items-center gap-1.5">
          <b className="text-white/60">배경</b>
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              title={t.label}
              onClick={() => update({ theme: t.id })}
              className={`h-6 w-6 rounded-full border-2 border-white/40 ${settings.theme === t.id ? "outline outline-2 outline-white" : ""}`}
              style={{ background: t.swatch }}
            />
          ))}
        </span>
        <label className="flex items-center gap-1">
          <b className="text-white/60">글씨체</b>
          <select value={settings.koFont} onChange={(e) => update({ koFont: e.target.value })} className="rounded px-1 py-0.5 text-slate-900">
            {KO_FONTS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <b className="text-white/60">영어</b>
          <select value={settings.enFont} onChange={(e) => update({ enFont: e.target.value })} className="rounded px-1 py-0.5 text-slate-900">
            {EN_FONTS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <b className="text-white/60">글자</b>
          <input type="range" min={11} max={24} value={settings.size} onChange={(e) => update({ size: Number(e.target.value) })} />
        </label>
        <label className="flex items-center gap-1">
          <b className="text-white/60">확대</b>
          <input type="range" min={50} max={200} step={10} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          <span className="w-9 tabular-nums">{zoom}%</span>
        </label>
        <span className="flex flex-wrap items-center gap-2">
          {LAYERS.map((l) => (
            <label key={l.id} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={settings.layers[l.id]}
                onChange={(e) => update({ layers: { ...settings.layers, [l.id]: e.target.checked } })}
              />
              {l.label}
            </label>
          ))}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {missing.length ? (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void makeNotes(missing)}
              className="rounded-md bg-amber-400 px-3 py-1 font-bold text-slate-900 hover:bg-amber-300 disabled:opacity-60"
            >
              교사용 해설 만들기 ({missing.length})
            </button>
          ) : null}
          <button
            type="button"
            disabled={!!pdf.busy || !!pendingPdf}
            onClick={() => savePdf("teacher")}
            className="rounded-md bg-white px-3 py-1 font-bold text-slate-900 hover:bg-slate-100 disabled:opacity-60"
          >
            ⤓ 교사용 PDF
          </button>
          <button
            type="button"
            disabled={!!pdf.busy || !!pendingPdf}
            onClick={() => savePdf("student")}
            className="rounded-md bg-white px-3 py-1 font-bold text-slate-900 hover:bg-slate-100 disabled:opacity-60"
          >
            ⤓ 학생용 PDF
          </button>
        </span>
      </div>
      {busy || error || pdf.status ? (
        <div className="bg-slate-800 px-4 py-1 text-xs font-semibold">
          {busy ? <span className="text-amber-300">{busy}</span> : null}
          {error ? <span className="ml-3 text-rose-300">{error}</span> : null}
          {pdf.status ? <span className="ml-3 text-sky-200">{pdf.status}</span> : null}
        </div>
      ) : null}
      <div className="flex gap-1 overflow-x-auto bg-slate-800 px-4 py-1.5">
        {projects.map((x, i) => (
          <button
            key={x.id}
            type="button"
            onClick={() => goPassage(i)}
            title={x.title}
            className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-bold ${i === cur ? "bg-white text-slate-900" : "text-white/70 hover:bg-white/10"}`}
          >
            {String(i + 1).padStart(2, "0")}
            {!loaded || notesOf(x.id) ? "" : " ·"}
          </button>
        ))}
        <span className="ml-auto shrink-0 self-center px-2 text-[11px] text-white/50">
          {pages.list.length}쪽 · PDF는 보이는 그대로 저장됩니다
        </span>
        {curProject && notesOf(curProject.id) ? (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void makeNotes([curProject], true)}
            className="shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold text-white/60 hover:bg-white/10"
          >
            {String(cur + 1).padStart(2, "0")}번 해설 다시 만들기
          </button>
        ) : null}
      </div>
      <div ref={scrollRef} className="lc-root min-h-0 flex-1 overflow-auto" data-theme={settings.theme} style={rootStyle}>
        {/* 높이 재는 틀(쪽 폭과 같음) */}
        <div ref={measureRef} className="lc-measure" aria-hidden>
          {blocks.map((b) => (
            <div key={b.key}>{b.node}</div>
          ))}
        </div>
        <div className="flex justify-center py-6">
          <div ref={pagesRef} className="flex flex-col gap-6" style={{ zoom: zoom / 100 }}>
            {pages.list.map((pg, pi) => (
              <div key={pi} className="lc-page shadow-2xl">
                {pg.map((bi) => {
                  const b = blocks[bi];
                  return b ? <div key={b.key}>{b.node}</div> : null;
                })}
                <div className="lc-pno">{pi + 1}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
