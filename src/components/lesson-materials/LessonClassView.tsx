"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { postJson } from "@/lib/lesson-materials/post-json";
import { askCreditConfirm } from "@/lib/credits/confirm-store";
import { usePdfSave } from "@/components/pdf/usePdfSave";
import { collectPrintPages } from "@/lib/pdf/download-sheets-pdf";
import type { TestBookProjectInput } from "@/lib/lesson-materials/test-book";
import type { TeacherNotes, TeacherSpotKind } from "@/lib/lesson-materials/teacher-notes";
import { isUsableAntonym } from "@/lib/lesson-materials/teacher-notes-shared";
import type { ClassGrammarMark } from "@/lib/lesson-materials/test-book-actions";
import { BlankNoteSheets, TEST_BOOK_CSS, TEST_BOOK_FONTS_HREF, TestBookBrand, partStyle } from "@/components/lesson-materials/test-book/TestBookSheets";

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
/** 교사용 해설에서 보여 줄 항목(선생님 2026-11-10 「시안처럼 보여 줄 수 있는 걸 선택」) */
type TSec = "bg" | "tip" | "tts" | "flow" | "voc" | "fig" | "check" | "qt";
const TSECS: Array<{ id: TSec; label: string }> = [
  { id: "bg", label: "배경지식" },
  { id: "tip", label: "강의 Tip" },
  { id: "tts", label: "주제·제목·요약문" },
  { id: "flow", label: "지문 FLOW" },
  { id: "voc", label: "핵심 어휘" },
  { id: "fig", label: "비유·함축" },
  { id: "check", label: "시험 직전 체크" },
  { id: "qt", label: "출제 가능성" },
];
const ALL_TSEC = Object.fromEntries(TSECS.map((t) => [t.id, true])) as Record<TSec, boolean>;
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
  /** 지문마다 뒤에 백지노트(2쪽) */
  blankNote: boolean;
  /** 교사용 해설 항목 */
  tsec: Record<TSec, boolean>;
  /** 학생용에 붙일 항목(선생님 2026-11-10 「학생용도 마찬가지로」) — 처음엔 모두 끔 */
  tsecS: Record<TSec, boolean>;
};
const DEFAULT_SETTINGS: Settings = {
  mode: "teacher",
  theme: "white",
  koFont: "noto",
  enFont: "same",
  size: 15,
  layers: { grammar: true, vocab: true, spots: true, easy: true, ko: true, side: true },
  blankNote: false,
  tsec: ALL_TSEC,
  tsecS: Object.fromEntries(TSECS.map((t) => [t.id, false])) as Record<TSec, boolean>,
};

// ---------------------------------------------------------------- 지문 위 표시 모으기

type GrammarMark = ClassGrammarMark;
type VocabMark = { si: number; start: number; end: number; syn: string[]; ant: string[]; level: number };
type SpotMark = { si: number; start: number; end: number; kind: TeacherSpotKind; q: string; note: string };

const RELATIVE_PRONOUN = /^(who|whom|whose|which|that|what|where|when)$/i;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function findIn(sentence: string, q: string): number {
  if (!q) return -1;
  const i = sentence.indexOf(q);
  if (i >= 0) return i;
  return sentence.toLowerCase().indexOf(q.toLowerCase());
}

/**
 * 지문 위 동반의어 — 내용상 중요한 낱말·표현에만(선생님 2026-11-10 「marine에 동반의어는 필요 없잖아」).
 * 교사용 해설의 핵심 어휘(글의 논리에 중요한 B2~C1, 문맥상 동의어)를 쓰고, 반의어는 단어 정리에 있으면 가져온다.
 * 해설이 아직 없으면 단어 정리의 ★핵심어만.
 */
function vocabMarks(p: TestBookProjectInput, notes: TeacherNotes | null): VocabMark[] {
  const out: VocabMark[] = [];
  const taken = new Set<string>();
  const rows = p.material?.vocab ?? [];
  const antOf = (w: string) => rows.find((r) => r.word.trim().toLowerCase() === w.trim().toLowerCase())?.antonyms ?? [];
  const source = notes?.keyVocab?.length
    ? notes.keyVocab.filter((v) => v.synonyms.length).map((v) => ({ word: v.word, syn: v.synonyms, ant: v.antonym && isUsableAntonym(v.antonym) ? [v.antonym] : [] }))
    : notes?.vocab.length
    ? notes.vocab.map((v) => ({ word: v.word, syn: v.synonyms, ant: antOf(v.word) }))
    : rows.filter((r) => r.key).map((r) => ({ word: r.word, syn: r.synonyms, ant: r.antonyms }));
  for (const v of source) {
    const syn = v.syn.filter(Boolean).slice(0, 3);
    const ant = v.ant.filter(Boolean).slice(0, 3);
    if (!syn.length && !ant.length) continue;
    const word = v.word.trim();
    if (!word || taken.has(word.toLowerCase())) continue;
    // 낱말이면 굴절형까지(promote → promoted), 어구면 그대로
    const re = word.includes(" ")
      ? new RegExp(`\\b${escapeRe(word)}\\b`, "i")
      : new RegExp(`\\b${escapeRe(word.replace(/(e|s|ed|ing)$/i, ""))}[a-z]{0,4}\\b`, "i");
    for (let si = 0; si < p.sentences.length; si++) {
      const m = re.exec(p.sentences[si]!.english);
      if (m) {
        out.push({ si, start: m.index, end: m.index + m[0].length, syn, ant, level: 0 });
        taken.add(word.toLowerCase());
        break;
      }
    }
  }
  out.sort((a, b) => a.si - b.si || a.start - b.start);
  // 겹침은 그린 뒤 실제 위치로 고친다(LessonClassView 의 useLayoutEffect)
  return out;
}

function spotMarks(p: TestBookProjectInput, notes: TeacherNotes | null | undefined): SpotMark[] {
  const out: SpotMark[] = [];
  for (const s of notes?.spots ?? []) {
    // 관계대명사(who·which 등)는 지칭 추론으로 내지 않는다(선생님 2026-11-10)
    if (s.kind === "reference" && RELATIVE_PRONOUN.test(s.q.trim())) continue;
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
  // 다섯 낱말 넘는 문법 자리는 앞 두 낱말에만 밑줄·번호(선생님 2026-11-11 점검: 절 전체 밑줄이 문장을 덮었다) — 전체는 아래 문법 줄에
  const g = (layers.grammar ? grammar : []).map((m) => {
    const span = text.slice(m.start, m.end);
    const words = span.trim().split(/\s+/);
    if (words.length <= 5) return m;
    const re = /\S+\s+\S+/.exec(span);
    return re ? { ...m, end: m.start + re.index + re[0].length } : m;
  });
  const v = layers.vocab ? vocab : [];
  const s0 = layers.spots ? spots : [];
  // 다른 출제 자리 안에 든 자리의 꼬리표는 바깥 자리 끝으로(함축 「work those pathways to your advantage」 안의 지칭 「those pathways」)
  const tagAt = (m: SpotMark) => {
    let at = m.end;
    for (const o of s0) if (o !== m && o.start <= m.start && o.end > m.end && o.end > at) at = o.end;
    return at;
  };
  const s = s0;
  const tagGroups = new Map<number, SpotMark[]>();
  for (const m of s) tagGroups.set(tagAt(m), [...(tagGroups.get(tagAt(m)) ?? []), m]);

  const cuts = new Set<number>([0, text.length]);
  for (const m of [...g, ...v, ...s]) {
    cuts.add(Math.max(0, Math.min(text.length, m.start)));
    cuts.add(Math.max(0, Math.min(text.length, m.end)));
  }
  const pts = [...cuts].sort((a, b) => a - b);
  const parts: ReactNode[] = [];
  let skip = 0; // 앞 꼬리표에 붙여 쓴 문장부호 글자 수
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k]! + skip;
    skip = 0;
    const b = pts[k + 1]!;
    if (a >= b) continue;
    const inside = <T extends { start: number; end: number }>(list: T[]) => list.filter((m) => m.start <= a && m.end >= b);
    const gs = inside(g);
    const ss = inside(s);
    const vs = v.filter((m) => m.start === pts[k]);
    const cls = [gs.length ? "lc-g" : "", ...ss.map((x) => `lc-s-${x.kind}`), inside(v).length ? "lc-v" : ""].filter(Boolean).join(" ") || undefined;
    const labels = vs.map((m, i) => (
      <span key={`v${i}`} className="lc-vl">
        <span className="lc-full">
          {m.syn.length ? <span className="lc-syn">= {m.syn.join(", ")}</span> : null}
          {m.syn.length && m.ant.length ? " " : null}
          {m.ant.length ? <span className="lc-ant">↔ {m.ant.join(", ")}</span> : null}
        </span>
        <span className="lc-short">
          {m.syn.length ? <span className="lc-syn">= {m.syn[0]}</span> : <span className="lc-ant">↔ {m.ant[0]}</span>}
        </span>
      </span>
    ));
    const sups = g
      .filter((x) => x.end === b)
      .map((m) => (
        <sup key={`g${m.no}`} className="lc-gn">
          {CIRCLED[m.no - 1] ?? `(${m.no})`}
        </sup>
      ));
    const tagged = tagGroups.get(b) ?? [];
    const chips = groupSpots(tagged).length
      ? [
          <span key={`s${b}`} className={`lc-tag lc-tag-${tagged[0]!.kind}`}>
            {[...new Set(tagged.map((m) => SPOT_LABEL[m.kind]))].join("·")}
          </span>,
        ]
      : [];
    const seg = text.slice(a, b);
    if (!sups.length && !chips.length) {
      parts.push(
        <span key={`t${a}`} className={cls}>
          {labels}
          {seg}
        </span>
      );
      continue;
    }
    // 꼬리표·번호는 앞 낱말과 바로 뒤 문장부호에 붙여 혼자 다음 줄로 떨어지지 않게(선생님 2026-11-11 점검: 「, who were …」로 시작하는 줄)
    const cut = seg.search(/\S+\s*$/);
    const head = cut > 0 ? seg.slice(0, cut) : "";
    const last = cut > 0 ? seg.slice(cut) : seg;
    const punct = /^[,.;:!?)”’"]+/.exec(text.slice(b))?.[0] ?? "";
    skip = punct.length;
    if (head)
      parts.push(
        <span key={`t${a}`} className={cls}>
          {labels}
          {head}
        </span>
      );
    parts.push(
      <span key={`n${b}`} className="lc-nowrap">
        <span className={cls}>
          {head ? null : labels}
          {last}
        </span>
        {sups}
        {chips}
        {punct}
      </span>
    );
  }
  return <>{parts}</>;
}

/** 같은 자리(시작·끝)의 출제 표시를 한 묶음으로 */
function groupSpots(list: SpotMark[]): SpotMark[][] {
  const m = new Map<string, SpotMark[]>();
  for (const x of list) m.set(`${x.start}-${x.end}`, [...(m.get(`${x.start}-${x.end}`) ?? []), x]);
  return [...m.values()];
}

// ---------------------------------------------------------------- 쪽에 채울 덩어리

/** 쪽에 하나씩 채우는 덩어리. keepNext는 제목처럼 다음 덩어리와 같은 쪽에 있어야 하는 것, newPage는 새 쪽에서 시작 */
type Block = {
  key: string;
  node: ReactNode;
  keepNext?: boolean;
  newPage?: boolean;
  /** 지문 시작 덩어리에만 */
  passage?: number;
  /** 몇 번째 지문인지(모든 덩어리) */
  pi?: number;
  /** 지문 쪽(문장·제목) — 한 쪽 맞추기에서 글자를 줄이는 대상 */
  body?: boolean;
};

function passageBlocks(
  p: TestBookProjectInput,
  index: number,
  mode: Mode,
  layers: Record<Layer, boolean>,
  notes: TeacherNotes | null,
  grammar: GrammarMark[],
  tsec: Record<TSec, boolean> = ALL_TSEC
): Block[] {
  const teacher = mode === "teacher";
  const vocab = vocabMarks(p, notes);
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
                    <span className="lc-gn2">{CIRCLED[m.no - 1] ?? `(${m.no})`}</span> <b className="lc-gterm">{m.term || m.label}</b>{" "}
                    <span className="lc-gq">{m.q.length > 48 ? `${m.q.slice(0, 46)}…` : m.q}</span>
                    {teacher ? (m.short ? <span className="lc-gx"> — {m.short}</span> : null) : <> — {blank}</>}
                  </p>
                ))}
              </div>
            ) : null}
            {layers.spots && ownSpots.length ? (
              <div className="lc-spots">
                {groupSpots(ownSpots).map((ms, i) => (
                  <p key={i}>
                    <span className={`lc-tag lc-tag-${ms[0]!.kind}`}>{ms.map((m) => SPOT_LABEL[m.kind]).join("·")}</span> <b>{ms[0]!.q}</b>
                    {ms.map((m, j) =>
                      m.note ? (
                        <span key={j}>
                          {j ? " / " : " — "}
                          {ms.length > 1 ? <b className="lc-dim">{SPOT_LABEL[m.kind]} </b> : null}
                          {teacher || m.kind === "blank" || m.kind === "insert" ? m.note : blank}
                        </span>
                      ) : null
                    )}
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

  if (!notes) return tagBlocks(out, index);

  // 교사용 해설 — A안(강의 노트형, 선생님 2026-11-10 「A안이 그나마 나음」), 새 쪽에서
  if (!TSECS.some((t) => tsec[t.id])) return tagBlocks(out, index);
  const bodyCount = out.length;
  let secNo = 0;
  const num = (_n: number, title: string) => (
    <h4 className="la-h">
      <i>{++secNo}</i>
      {title}
    </h4>
  );
  out.push({
    key: k("t-h"),
    newPage: true,
    keepNext: true,
    node: (
      <header className="la-band">
        <span>{teacher ? "교사용 해설" : "핵심 정리"}</span>
        <b>
          {String(index + 1).padStart(2, "0")} · {notes.title.en || p.title}
        </b>
        <em>{notes.topic.ko}</em>
      </header>
    ),
  });
  const bgCol = tsec.bg ? (
        <div key="bg">
          {num(1, "배경지식")}
          {notes.background.map((b, i) => (
            <div key={i} className="la-term">
              <b>{b.term}</b>
              {b.termEn ? <small>{b.termEn}</small> : null}
              <p>{b.definition}</p>
              {b.example ? <p className="lc-dim">예) {b.example}</p> : null}
            </div>
          ))}
        </div>
      ) : null;
  const tipCol = tsec.tip ? (
        <div key="tip">
          {num(2, "강의 Tip")}
          {notes.tip.hookTitle ? <p className="la-hook">🎬 {notes.tip.hookTitle}</p> : null}
          {notes.tip.script ? <div className="la-bubble">{notes.tip.script.replace(/^“|”$/g, "")}</div> : null}
          {notes.tip.analogy ? (
            <p className="la-ana">
              <b>비유</b> {notes.tip.analogy}
            </p>
          ) : null}
          {notes.tip.points.length ? (
            <ul className="la-pts">
              {notes.tip.points.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null;
  // 두 칸 중 하나만 고르면 한 칸 전체 폭으로
  const pair = (key: string, cols: Array<ReactNode | null>) => {
    const shown = cols.filter(Boolean);
    if (shown.length) out.push({ key: k(key), node: <div className={shown.length === 2 ? "la-grid" : "la-grid la-one"}>{shown}</div> });
  };
  pair("t-12", [bgCol, tipCol]);
  if (tsec.tts) out.push({
    key: k("t-3"),
    node: (
      <div>
        {num(3, "주제 · 제목 · 요약문")}
        <div className="la-tts">
          {(
            [
              ["Topic", notes.topic],
              ["Title", notes.title],
              ["Summary", notes.summary],
            ] as const
          ).map(([h, v]) => (
            <div key={h} className="la-ttsrow">
              <b>{h}</b>
              <div>
                {v.en}
                <span>{v.ko}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
  });
  if (tsec.flow && notes.flow.length)
    out.push({
      key: k("t-4"),
      node: (
        <div>
          {num(4, "지문 FLOW")}
          {/* 칸 크기를 똑같이(선생님 2026-11-10) — 한 줄에 단계 수만큼 같은 폭 */}
          <div className="la-flow" style={{ gridTemplateColumns: notes.flow.map(() => "minmax(0,1fr)").join(" auto ") }}>
            {notes.flow.flatMap((f, i) => [
              ...(i
                ? [
                    <span key={`a${i}`} className="la-arr">
                      ➜
                    </span>,
                  ]
                : []),
              <div key={i} className="la-st">
                <b>{f.label}</b>
                {f.sentences ? <small>{f.sentences}번</small> : null}
                {f.lines.map((l, j) => (
                  <p key={j}>{l}</p>
                ))}
              </div>,
            ])}
          </div>
        </div>
      ),
    });
  if (tsec.voc && notes.vocab.length)
    out.push({
      key: k("t-5"),
      node: (
        <div>
          {num(5, "핵심 어휘")}
          <div className="la-voc">
            <div className="la-vr la-vh">
              <span>단어</span>
              <span>뜻</span>
              <span>어원</span>
              <span>문맥상 동의어</span>
            </div>
            {notes.vocab.map((v, i) => (
              <div key={i} className="la-vr">
                <b>{v.word}</b>
                <span>{v.meaning}</span>
                <span>{v.etymology || "—"}</span>
                <span>{v.synonyms.join(", ")}</span>
              </div>
            ))}
          </div>
        </div>
      ),
    });
  const figCol = tsec.fig ? (
        <div key="fig">
          {num(6, "비유 · 함축")}
          {notes.figurative.length ? (
            notes.figurative.map((f, i) => (
              <div key={i} className="la-fig">
                <b>“{f.expression}”</b>
                <p className="la-figen">= {f.meaningEn}</p>
                <p>{f.explainKo}</p>
              </div>
            ))
          ) : (
            <p className="lc-dim">이 지문에는 따로 짚을 비유적 표현이 없습니다.</p>
          )}
        </div>
      ) : null;
  const checkCol = tsec.check ? (
        <div key="check">
          {num(7, "시험 직전 체크")}
          <ul className="la-check">
            <li>
              ☐ <b>주제</b> {notes.review.mainIdea}
            </li>
            {notes.review.studentLine ? (
              <li>
                ☐ <b>한 줄</b> “{notes.review.studentLine.replace(/^“|”$/g, "")}”
              </li>
            ) : null}
            <li>
              ☐ <b>어휘</b> {notes.review.vocabNote}
            </li>
            <li>
              ☐ <b>유형</b> {notes.review.typesNote}
            </li>
            <li>
              ☐ <b>비유</b> {notes.review.figurativeNote}
            </li>
          </ul>
        </div>
      ) : null;
  pair("t-67", [figCol, checkCol]);
  if (tsec.qt && notes.questionTypes.length) {
    out.push({ key: k("t-8h"), keepNext: true, node: num(8, "출제 가능성") });
    out.push({
      key: k("t-8n"),
      keepNext: true,
      node: <p className="la-note">별점은 평가원 출제 확률이 아니라 지문 구조를 보고 내린 교육적 판단입니다.</p>,
    });
    // 카드 두 장씩 한 줄 — 쪽은 줄 사이에서만 나뉜다
    // 별점 높은 4개만 — 마지막 카드 하나 때문에 빈 쪽이 생기지 않게(선생님 2026-11-10 점검)
    const qts = notes.questionTypes.slice(0, 4);
    for (let i = 0; i < qts.length; i += 2) {
      out.push({
        key: k(`t-8-${i}`),
        node: (
          <div className="la-qt">
            {qts.slice(i, i + 2).map((q, j) => (
              <div key={j} className="la-q">
                <div className="la-qh">
                  <b>{q.type}</b>
                  <span>{"★".repeat(q.stars) + "☆".repeat(5 - q.stars)}</span>
                </div>
                <p>
                  <em>왜</em> {q.reason}
                </p>
                {q.spot ? (
                  <p>
                    <em>어디</em> {q.spot}
                  </p>
                ) : null}
                <p>
                  <em>함정</em> {q.trap}
                </p>
                <p>
                  <em>풀이</em> {q.strategy}
                </p>
              </div>
            ))}
          </div>
        ),
      });
    }
  }
  return tagBlocks(out, index, bodyCount);
}

/** 덩어리에 지문 번호와 「지문 쪽」 표시를 단다(앞의 bodyCount개가 지문 쪽) */
function tagBlocks(out: Block[], pi: number, bodyCount = out.length): Block[] {
  return out.map((b, i) => ({ ...b, pi, body: i < bodyCount }));
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
.lc-root[data-theme="cream"],.lc-root[data-theme="white"]{--ink:#1d1d1f;--sub:#48443b;--gram:#a66b00;--syn:#1f6fb2;--ant:#c0392b;--head:#8a5a00;
  --t-blank:#d9780a;--t-insert:#1e8a4c;--t-reference:#7240c9;--t-implication:#c2307a;--easy:#1e8a4c;--shadow:none}
.lc-root[data-theme="cream"]{--bg:#f8f1df;--panel:#fffaf0;--line:#e2d6b8}
.lc-root[data-theme="white"]{--bg:#fff;--panel:#f7f7f5;--line:#dedede}
.lc-root{font-family:var(--ff)}
.lc-page{width:210mm;height:297mm;box-sizing:border-box;padding:${PAGE_PAD_MM}mm ${PAGE_PAD_MM + 1}mm;background:var(--bg);color:var(--ink);
  position:relative;overflow:hidden;font-size:var(--fs);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.lc-cont{position:absolute;top:5mm;left:${PAGE_PAD_MM + 1}mm;right:${PAGE_PAD_MM + 1}mm;font-size:9px;color:var(--sub);border-bottom:1px solid var(--line);padding-bottom:1mm}
.lc-pno{position:absolute;bottom:6mm;left:0;right:0;text-align:center;font-size:9px;color:var(--sub)}
.lc-measure{position:absolute;left:-100000px;top:0;width:${210 - (PAGE_PAD_MM + 1) * 2}mm;visibility:hidden;font-size:var(--fs)}
.lc-headblock{padding-bottom:3mm}
.lc-h1{font-size:1.35em;font-weight:800;margin:0;line-height:1.3}
.lc-meta{color:var(--sub);font-size:.72em;margin:2px 0 0}
.lc-row2{display:grid;grid-template-columns:3fr 1fr;gap:0 4mm;padding-top:.85em}
.lc-main{min-width:0}
.lc-aside{font-size:calc(var(--fs) * .74);line-height:1.5;border-left:1px dashed var(--line);padding:.6em 0 0 2.5mm;color:var(--ink)}
.lc-aside p{margin:0 0 .5em}
.lc-astep{border:1.5px solid var(--line);border-left:4px solid var(--head);border-radius:6px;padding:.45em .65em;margin-bottom:.5em;background:var(--panel)}
.lc-astep b{color:var(--head)}
.lc-aeasy{border-left:3px solid var(--easy);padding:.2em 0 .2em .55em;background:color-mix(in srgb,var(--bg) 86%,var(--easy) 14%);border-radius:0 6px 6px 0}
.lc-aeasy b{color:var(--easy)}
.lc-glines{font-size:.72em;line-height:1.5;margin:.25em 0 0 1.6em}
.lc-glines p{margin:.15em 0}
.lc-gterm{color:var(--head)}
.lc-gq{font-style:italic;color:var(--sub)}
.lc-spots{font-size:.72em;line-height:1.5;margin:.3em 0 0 1.6em}
.lc-spots p{margin:.15em 0}
.lc-blank-s{min-width:100%;display:block;margin-top:.9em}
.lc-thead{display:flex;align-items:baseline;gap:.8em;padding:.6em .9em;border-radius:8px;background:color-mix(in srgb,var(--bg) 80%,var(--head) 20%);margin-bottom:.2em}
.lc-thead span{font-size:1.05em;font-weight:800;color:var(--head)}
.lc-thead b{font-size:.8em}
.lc-sec-t{border-bottom:none;border-left:4px solid var(--head);padding:1em 0 .3em .6em;margin-top:.4em}
.lc-en{font-family:var(--fe,var(--ff));font-size:1em;line-height:2.85;margin:0;text-shadow:var(--shadow)}
.lc-sn{display:inline-block;min-width:1.4em;color:var(--sub);font-size:.62em;font-weight:800}
.lc-ko{font-size:.76em;color:var(--sub);margin:0 0 .2em 1.6em;line-height:1.55}
.lc-easy{font-size:.76em;line-height:1.55;margin:.3em 0 .2em 1.6em;padding:.35em .8em;border-left:4px solid var(--easy);
  background:color-mix(in srgb,var(--bg) 84%,var(--easy) 16%);border-radius:0 6px 6px 0}
.lc-easy b{color:var(--easy)}
.lc-g{border-bottom:2px solid var(--gram)}
.lc-gn{color:var(--gram);font-weight:800;font-size:.6em;margin-left:1px}
.lc-v{position:relative}
.lc-nowrap{white-space:nowrap}
.lc-vl{position:absolute;left:0;top:-1.3em;white-space:nowrap;font-size:.6em;font-weight:700;line-height:1;pointer-events:none}
.lc-vl.up{top:-2.38em}
.lc-vl::after{content:"";position:absolute;left:var(--tick,3px);top:100%;height:var(--tickh,.5em);border-left:1px dotted var(--syn);opacity:.8}.lc-short{display:none}.lc-vl.cmp .lc-full{display:none}.lc-vl.cmp .lc-short{display:inline}
.lc-syn{color:var(--syn)}.lc-ant{color:var(--ant)}
.lc-s-blank{box-shadow:inset 0 -.42em 0 color-mix(in srgb,var(--t-blank) 42%,transparent)}
.lc-s-implication{background:color-mix(in srgb,transparent 72%,var(--t-implication) 28%);border-radius:3px}
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
/* 교사용 해설 A안 */
.la-band{display:flex;align-items:baseline;gap:.8em;background:var(--ink);color:var(--bg);padding:.6em 1em;border-radius:8px}
.la-band span{font-weight:800;color:var(--t-blank)}.la-band b{font-size:.92em}.la-band em{margin-left:auto;font-style:normal;opacity:.8;font-size:.68em}
.la-h{display:flex;align-items:center;gap:.5em;font-size:.86em;margin:1em 0 .45em;color:var(--ink);border-bottom:2px solid var(--line);padding-bottom:.2em}
.la-h i{font-style:normal;background:var(--ink);color:var(--bg);border-radius:50%;width:1.45em;height:1.45em;display:inline-flex;align-items:center;justify-content:center;font-size:.8em}
.la-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 7mm;font-size:.8em;line-height:1.55}
.la-grid .la-h{font-size:1.2em}
.la-one{grid-template-columns:1fr}
.la-term{margin-bottom:.5em}.la-term small{color:var(--sub);margin-left:.4em}.la-term p{margin:0}
.la-hook{font-weight:800;margin:0 0 .4em}
.la-bubble{background:color-mix(in srgb,var(--bg) 88%,var(--t-implication) 12%);border:1.5px solid var(--t-implication);border-radius:12px 12px 12px 2px;padding:.5em .8em;margin-bottom:.5em}
.la-ana{margin:0 0 .3em}.la-pts{margin:0;padding-left:1.2em}
.la-tts{font-size:.8em;line-height:1.5}
.la-ttsrow{display:grid;grid-template-columns:20mm 1fr;padding:.3em 0;border-bottom:1px solid var(--line)}
.la-ttsrow b{color:var(--head)}.la-ttsrow span{display:block;color:var(--sub)}
.la-flow{display:grid;align-items:stretch;gap:0 .3em;font-size:.74em;line-height:1.45}
.la-st{border:1.5px solid var(--line);border-top:4px solid var(--ink);border-radius:6px;padding:.4em .55em;background:var(--panel)}
.la-st small{color:var(--sub);margin-left:.3em}.la-st p{margin:0}
.la-arr{align-self:center;color:var(--sub)}
.la-voc{font-size:.76em;line-height:1.45}
.la-vr{display:grid;grid-template-columns:24mm 34mm 1fr 34mm;gap:0 .6em;padding:.3em .45em;border-bottom:1px solid var(--line)}
.la-vr:nth-child(even){background:var(--panel)}
.la-vh{background:var(--ink) !important;color:var(--bg);font-weight:800;border-radius:4px 4px 0 0}
.la-fig{border-left:4px solid var(--t-reference);background:color-mix(in srgb,var(--bg) 88%,var(--t-reference) 12%);padding:.45em .7em;border-radius:0 8px 8px 0;margin-bottom:.45em}
.la-fig p{margin:0}.la-figen{color:var(--t-reference);font-style:italic}
.la-check{list-style:none;padding:0;margin:0}.la-check li{padding:.3em 0;border-bottom:1px dashed var(--line)}
.la-note{font-size:.62em;color:var(--sub);margin:0 0 .3em}
.la-qt{display:grid;grid-template-columns:1fr 1fr;gap:.45em;font-size:.74em;line-height:1.5;padding-bottom:.45em}
.la-q{border:1.5px solid var(--line);border-radius:8px;padding:.45em .7em}
.la-q p{margin:0}.la-qh{display:flex;justify-content:space-between;margin-bottom:.2em}.la-qh span{color:#f59e0b;letter-spacing:1px}
.la-q em{font-style:normal;font-weight:800;color:var(--head);margin-right:.25em}
`;

// ---------------------------------------------------------------- 화면

export function LessonClassView({
  role,
  projects,
  title,
  onClose,
  closeSlot,
  embedded = false,
  design = "a",
  brand = { logoSrc: null, academy: "" },
  onPrepared,
}: {
  role: "admin" | "teacher";
  projects: TestBookProjectInput[];
  title: string;
  onClose?: () => void;
  /** 닫기 자리에 둘 것(수업용 자료 화면의 「닫기(저장)」) */
  closeSlot?: ReactNode;
  /** 최종통합자료 안 — 쪽만(교사용 · 흰 바탕 · 기본 글꼴) */
  embedded?: boolean;
  /** 백지노트(테스트 교재 쪽)의 디자인 */
  design?: string;
  brand?: { logoSrc: string | null; academy: string };
  /** 재료(단어 정리·해석)를 새로 만든 뒤 지문 데이터를 다시 읽는다 */
  onPrepared?: () => Promise<void>;
}) {
  // 최종통합자료 안(embedded)은 학생 교재라 학생용으로(선생님 2026-11-11 「교사용이 들어가면 안 된다」)
  const [settings, setSettings] = useState<Settings>(embedded ? { ...DEFAULT_SETTINGS, mode: "student" } : DEFAULT_SETTINGS);
  useEffect(() => {
    if (embedded) return;
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Settings>;
        const size = typeof saved.size === "number" && saved.size >= 11 && saved.size <= 24 ? saved.size : DEFAULT_SETTINGS.size;
        setSettings({
          ...DEFAULT_SETTINGS,
          ...saved,
          size,
          layers: { ...DEFAULT_SETTINGS.layers, ...(saved.layers ?? {}) },
          tsec: { ...ALL_TSEC, ...(saved.tsec ?? {}) },
          tsecS: { ...DEFAULT_SETTINGS.tsecS, ...(saved.tsecS ?? {}) },
        });
      }
    } catch {
      /* 기본 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const loadData = () =>
    postJson<{ ok: true; data: Record<string, { notes: TeacherNotes | null; grammar: GrammarMark[] }> } | { ok: false; message: string }>(
      "/api/lesson-materials/test-book",
      { role, op: "classData", projectIds: projects.map((x) => x.id) }
    )
      .then((res) => {
        if (res.ok) setExtra(res.data);
        else setError(res.message);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "불러오지 못했습니다."))
      .finally(() => setLoaded(true));
  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const notesOf = (id: string) => extra[id]?.notes ?? null;
  // 재료(단어 정리·해석)나 교사용 해설이 없는 지문
  const missing = loaded ? projects.filter((x) => !notesOf(x.id) || !x.material || !x.content) : [];

  // 교사용 해설 만들기
  const [busy, setBusy] = useState<string | null>(null);
  async function makeNotes(targets: TestBookProjectInput[], regenerate = false) {
    if (busy || !targets.length) return;
    const charged = targets.filter((t) => regenerate || !notesOf(t.id));
    const go = charged.length
      ? await askCreditConfirm({
          title: "수업용 자료",
          description:
            "지문마다 해석 · 동반의어 · 문법 한 줄 · 출제 자리 · 쉽게 말하면 · 흐름과 교사용 해설(배경지식 · 강의 Tip · 주제/제목/요약문 · FLOW · 어휘 어원 · 비유와 함축 · 출제 유형 · 마무리)을 만듭니다. 학생용은 같은 재료로 나옵니다. 단어장 · 단어 시험지는 자료함 「단어」 탭에서 만듭니다.",
          subject: charged.length === 1 ? `「${charged[0]!.title}」` : `지문 ${charged.length}개`,
          contents: ["지문 쪽(교사용 · 학생용)", "교사용 해설", "PDF"],
          items: [{ feature: "lesson_teacher_notes", quantity: charged.length }],
        })
      : true;
    if (!go) return;
    setError(null);
    let done = 0;
    const failed: string[] = [];
    setBusy(`수업용 자료 만드는 중… 0/${targets.length}`);
    let next = 0;
    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= targets.length) return;
        const t = targets[i]!;
        try {
          // 재료(단어 정리·해석)가 없으면 먼저 — 새 수업용 자료에서는 재료 값을 따로 받지 않는다
          if (!t.material || !t.content) {
            const prep = await postJson<{ ok: boolean; message?: string }>("/api/lesson-materials/test-book", {
              role,
              op: "prepareWorkbook",
              projectId: t.id,
              classView: true,
            });
            if (!prep.ok) {
              failed.push(`「${t.title}」 ${prep.message ?? "재료를 만들지 못했습니다."}`);
              continue;
            }
          }
          if (!regenerate && notesOf(t.id)) continue;
          const res = await postJson<{ ok: true; notes: TeacherNotes } | { ok: false; message: string }>(
            "/api/lesson-materials/test-book",
            { role, op: "teacherNotes", projectId: t.id, forceRegenerate: regenerate }
          );
          if (res.ok) setExtra((x) => ({ ...x, [t.id]: { grammar: x[t.id]?.grammar ?? [], notes: res.notes } }));
          else failed.push(`「${t.title}」 ${res.message}`);
        } catch (e) {
          failed.push(`「${t.title}」 ${e instanceof Error ? e.message : "실패"}`);
        }
        finally {
          done += 1;
          setBusy(`수업용 자료 만드는 중… ${done}/${targets.length}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker));
    if (targets.some((t) => !t.material || !t.content)) await onPrepared?.().catch(() => {});
    // 문법 한 줄 요약은 해설과 같이 만들어지므로 다시 읽는다
    await loadData();
    setBusy(null);
    if (failed.length) setError(failed.join(" · "));
  }

  // 처음 열 때 재료·해설이 없는 지문이 있으면 한 번 묻는다
  const askedRef = useRef(false);
  useEffect(() => {
    if (embedded || !loaded || askedRef.current || !missing.length) return;
    askedRef.current = true;
    void makeNotes(missing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, missing.length, embedded]);

  // ------------------------------------------------ 덩어리 → A4 쪽
  const blocks = useMemo(
    () =>
      projects.flatMap((p, i) =>
        passageBlocks(
          p,
          i,
          settings.mode,
          settings.layers,
          extra[p.id]?.notes ?? null,
          extra[p.id]?.grammar ?? [],
          settings.mode === "teacher" ? settings.tsec : settings.tsecS
        )
      ),
    [projects, settings.mode, settings.layers, settings.tsec, settings.tsecS, extra]
  );
  const measureRef = useRef<HTMLDivElement>(null);
  /** 지문마다 글자 비율 — 한 쪽을 조금 넘는 지문은 줄여서 한 쪽에(선생님 2026-11-10 점검: 마지막 문장 하나만 다음 쪽) */
  const [fit, setFit] = useState<Record<number, number>>({});
  const blockStyle = (b: Block): CSSProperties | undefined =>
    b.body && b.pi !== undefined && fit[b.pi] ? { fontSize: `${fit[b.pi]}em` } : undefined;
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
  const layoutKey = `${settings.mode}|${settings.size}|${settings.koFont}|${settings.enFont}|${JSON.stringify(settings.layers)}|${JSON.stringify(settings.mode === "teacher" ? settings.tsec : settings.tsecS)}|${blocks.length}|${fontsTick}|${loaded}|${JSON.stringify(fit)}`;
  const [pages, setPages] = useState<{ key: string; list: number[][] }>({ key: "", list: [] });
  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root) return;
    const els = Array.from(root.children) as HTMLElement[];
    // 화면 전체가 확대·축소돼 있으면(최종통합자료 60% 등) 잰 높이도 그만큼 줄어 있다 — 틀 폭(쪽 안쪽 폭)으로 비율을 되돌린다
    const scale = root.getBoundingClientRect().width / ((210 - (PAGE_PAD_MM + 1) * 2) * MM) || 1;
    const heights = els.map((el) => el.getBoundingClientRect().height / scale);
    // 지문 쪽(제목·문장)이 한 쪽을 40% 안쪽으로 넘으면 그 지문만 글자를 줄인다(82%까지). 크게 넘는 긴 지문은 그대로 2쪽.
    const sums = new Map<number, number>();
    blocks.forEach((b, i) => {
      if (b.body && b.pi !== undefined) sums.set(b.pi, (sums.get(b.pi) ?? 0) + (heights[i] ?? 0));
    });
    const nextFit: Record<number, number> = { ...fit };
    let changed = false;
    for (const [pi, h] of sums) {
      const cur = fit[pi] ?? 1;
      if (h > BODY_PX && h / cur <= BODY_PX * 1.4) {
        const want = Math.max(0.82, Math.round(cur * (BODY_PX / h) * 0.97 * 100) / 100);
        if (want < cur - 0.005) {
          nextFit[pi] = want;
          changed = true;
        }
      }
    }
    if (changed) setFit(nextFit);
    setPages({ key: layoutKey, list: paginate(heights, blocks) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, extra]);
  // 동반의어 이름표 자리 잡기 — 늘 자기 낱말 위에(선생님 2026-11-10 「동반의어가 그 자리에 안 맞는다」: 옆으로 비키면 어느 낱말 것인지 모른다).
  // 왼쪽 맞춤 → 오른쪽 맞춤(둘 다 낱말 위) → 동의어 하나만 → 위층. 앞 이름표·윗줄 글자에 닿지 않는 첫 자리.
  useLayoutEffect(() => {
    const root = pagesRef.current;
    if (!root) return;
    const hit = (a: DOMRect, b: DOMRect) => a.left < b.right + 3 && b.left < a.right + 3 && a.top < b.bottom && b.top < a.bottom;
    root.querySelectorAll<HTMLElement>(".lc-main").forEach((main) => {
      const box = main.getBoundingClientRect();
      const labels = Array.from(main.querySelectorAll<HTMLElement>(".lc-vl"));
      let placed: DOMRect[] = [];
      let lineTop = Number.NaN;
      // 글자·밑줄도 장애물로(윗줄 글자에 닿지 않게) — 이름표 안 글자는 빼고
      const textRects: DOMRect[] = [];
      const walk = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (n.parentElement?.closest(".lc-vl, .lc-ko, .lc-glines, .lc-spots, .lc-easy")) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const b of Array.from(range.getClientRects())) textRects.push(new DOMRect(b.left, b.top, b.width, b.height + 3));
      }
      // 꼬리표 칩·문법 번호는 글자보다 위로 솟는다
      main.querySelectorAll<HTMLElement>(".lc-en .lc-tag, .lc-en .lc-gn, .lc-en .lc-g, .lc-en [class*='lc-s-']").forEach((e) => {
        for (const b of Array.from(e.getClientRects())) textRects.push(new DOMRect(b.left, b.top, b.width, b.height + 2));
      });
      for (const el of labels) {
        const set = (level: 0 | 1, compact: boolean, right: boolean) => {
          el.classList.toggle("cmp", compact);
          el.classList.toggle("up", level === 1);
          el.style.left = "";
          el.style.right = "";
          if (right || el.getBoundingClientRect().right > box.right) {
            el.style.left = "auto";
            el.style.right = "0";
          }
          return el.getBoundingClientRect();
        };
        let r = set(0, false, false);
        const hostTop = el.parentElement?.getBoundingClientRect().top ?? r.top;
        if (Math.abs(hostTop - lineTop) > 4) {
          lineTop = hostTop;
          placed = [];
        }
        const blocked = (q: DOMRect) => placed.some((p) => hit(p, q)) || textRects.some((t) => hit(t, q));
        // 늘 자기 낱말 위: 왼쪽 맞춤 → 오른쪽 맞춤 → 짧게(동의어 하나) → 위층(줄 간격이 좁아 마지막)
        const tries: Array<[0 | 1, boolean, boolean]> = [
          [0, false, false],
          [0, false, true],
          [0, true, false],
          [0, true, true],
          [1, false, false],
          [1, true, false],
          [1, true, true],
        ];
        el.style.display = "";
        let free = false;
        for (const [lv, cp, rt] of tries) {
          r = set(lv, cp, rt);
          if (!blocked(r)) {
            free = true;
            break;
          }
        }
        // 어느 자리도 비지 않으면(옆 이름표·윗줄 글자) 겹쳐 두지 않고 뺀다
        if (!free) {
          el.style.display = "none";
          continue;
        }
        // 이름표 → 낱말 잇는 선(선생님 2026-11-10 「동반의어가 그 단어랑 선이라도」): 아래층 이름표를 지나가지 않는 자리로
        const host = el.parentElement?.getBoundingClientRect();
        if (host) {
          const scale = main.offsetWidth ? box.width / main.offsetWidth : 1;
          let x = host.left + Math.min(4, host.width / 2);
          for (const q of placed) if (q.bottom <= host.top && q.top > r.bottom - 1 && x >= q.left - 2 && x <= q.right + 2) x = q.right + 3;
          // 낱말 안이면서 이름표 아래인 자리(오른쪽 맞춤 이름표도)
          x = Math.min(Math.max(x, host.left + 1, r.left + 2), host.right - 1, r.right - 2);
          el.style.setProperty("--tick", `${(x - r.left) / scale}px`);
          el.style.setProperty("--tickh", `${Math.max(0, host.top - r.bottom + 2) / scale}px`);
        }
        placed.push(r);
      }
    });
  }, [pages, zoom, settings.theme]);
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
      void pdf.save(label, collectPrintPages(pagesRef.current, PAGE_SELECTOR), [title], undefined, false);
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

  // 쪽마다 어느 지문인지(통합자료 목차·백지노트 자리)
  const passageOfPage = useMemo(() => {
    const ofBlock: number[] = [];
    let curP = 0;
    blocks.forEach((b, i) => {
      if (b.passage !== undefined) curP = b.passage;
      ofBlock[i] = curP;
    });
    return pages.list.map((pg) => ofBlock[pg[0] ?? 0] ?? 0);
  }, [pages, blocks]);

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
  const tocOf = (pi: number) => {
    const p = projects[pi];
    return p ? { "data-toc-sub": `${String(pi + 1).padStart(2, "0")} ${p.title}`, "data-toc-note": p.source?.trim() || undefined } : {};
  };

  const pagesNode = (
    <div ref={pagesRef} className={`flex flex-col items-center ${embedded ? "gap-6 print:gap-0" : "gap-6"}`} style={embedded ? undefined : { zoom: zoom / 100 }}>
      {pages.list.map((pg, pi) => {
        const passage = passageOfPage[pi] ?? 0;
        const lastOfPassage = passageOfPage[pi + 1] !== passage;
        const p = projects[passage];
        return (
          <div key={pi} className="contents">
            <div className={`lc-page ${embedded ? "" : "shadow-2xl"}`} {...tocOf(passage)}>
              {/* 이어지는 쪽에는 위 여백에 지문 번호·제목 */}
              {pg[0] !== undefined && !blocks[pg[0]]?.newPage && p ? (
                <div className="lc-cont">
                  {String(passage + 1).padStart(2, "0")} · {p.title} (이어서)
                </div>
              ) : null}
              {pg.map((bi) => {
                const b = blocks[bi];
                return b ? (
                  <div key={b.key} style={blockStyle(b)}>
                    {b.node}
                  </div>
                ) : null;
              })}
              {embedded ? null : <div className="lc-pno">{pi + 1}</div>}
            </div>
            {settings.blankNote && lastOfPassage && p ? (
              <div className={`contents tb-theme-${design}`} {...tocOf(passage)}>
                <BlankNoteSheets index={passage} project={p} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
  const shared = (
    <>
      <link rel="stylesheet" href={FONTS_HREF} />
      <style>{CSS}</style>
      {settings.blankNote ? (
        <>
          <link rel="stylesheet" href={TEST_BOOK_FONTS_HREF} />
          <style>{TEST_BOOK_CSS}</style>
        </>
      ) : null}
      {/* 높이 재는 틀(쪽 폭과 같음) */}
      <div ref={measureRef} className="lc-measure" aria-hidden>
        {blocks.map((b) => (
          <div key={b.key} style={blockStyle(b)}>
            {b.node}
          </div>
        ))}
      </div>
    </>
  );
  const withBrand = (node: ReactNode) => (
    <TestBookBrand.Provider value={brand}>
      <div className="contents" style={partStyle({ id: "lesson", no: "", en: "LESSON MATERIALS", ko: "수업용 자료", color: "#1d2a8f" })}>
        {node}
      </div>
    </TestBookBrand.Provider>
  );

  // 최종통합자료 안: 쪽만(교사용 · 흰 바탕)
  if (embedded)
    return withBrand(
      <div id="lesson-pack-print-root" className="lc-root relative" data-theme="white" style={rootStyle}>
        {shared}
        {pagesNode}
      </div>
    );

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-700 print:hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-slate-900 px-4 py-2 text-xs text-white">
        {closeSlot ?? (
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 font-bold text-white/80 hover:bg-white/10">
            ← 닫기
          </button>
        )}
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
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={settings.blankNote} onChange={(e) => update({ blankNote: e.target.checked })} />
            백지노트
          </label>
          {settings.mode ? (
            <details className="relative">
              <summary className="cursor-pointer select-none rounded-md border border-white/30 px-2 py-0.5 font-bold">
                {settings.mode === "teacher" ? "교사용 해설 항목 ▾" : "학생용에 붙일 정리 ▾"}
              </summary>
              <div className="absolute left-0 top-full z-10 mt-1 w-48 space-y-1 rounded-lg bg-white p-2 text-slate-800 shadow-xl">
                {TSECS.map((t) => (
                  <label key={t.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={(settings.mode === "teacher" ? settings.tsec : settings.tsecS)[t.id]}
                      onChange={(e) =>
                        settings.mode === "teacher"
                          ? update({ tsec: { ...settings.tsec, [t.id]: e.target.checked } })
                          : update({ tsecS: { ...settings.tsecS, [t.id]: e.target.checked } })
                      }
                    />
                    {t.label}
                  </label>
                ))}
              </div>
            </details>
          ) : null}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {missing.length ? (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void makeNotes(missing)}
              className="rounded-md bg-amber-400 px-3 py-1 font-bold text-slate-900 hover:bg-amber-300 disabled:opacity-60"
            >
              만들기 (지문 {missing.length}개)
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
      {/* 진행 표시(선생님 2026-11-10 「반응이 없어」 — 해설은 지문당 30~40초, 4개씩) */}
      {busy ? (
        <div className="flex items-center gap-3 bg-amber-400 px-4 py-2 text-sm font-bold text-slate-900">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
          {busy}
          <span className="text-xs font-semibold text-slate-800">지문 하나에 30~40초 걸립니다 · 4개씩 함께 만듭니다 · 다 되면 쪽이 저절로 바뀝니다</span>
        </div>
      ) : !loaded ? (
        <div className="flex items-center gap-3 bg-slate-600 px-4 py-2 text-sm font-semibold text-white">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          해설 불러오는 중…
        </div>
      ) : null}
      {error || pdf.status ? (
        <div className="bg-slate-800 px-4 py-1 text-xs font-semibold">
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
          {pages.list.length}쪽 · PDF는 보이는 그대로 저장됩니다 · 단어장·단어 시험지는 자료함 「단어」 탭
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
      {withBrand(
        <div ref={scrollRef} className="lc-root relative min-h-0 flex-1 overflow-auto" data-theme={settings.theme} style={rootStyle}>
          {shared}
          <div className="flex justify-center py-6">{pagesNode}</div>
        </div>
      )}
    </div>
  );
}

/** PDF·통합자료가 세는 쪽: 수업 화면 쪽과 백지노트 쪽 */
const PAGE_SELECTOR = ".lc-page, .tb-sheet:not(.tb-measure .tb-sheet)";
