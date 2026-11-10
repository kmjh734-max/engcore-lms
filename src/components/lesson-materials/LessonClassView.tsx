"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
 * 화면: 칠판·남색·크림·흰색 배경, 한글·영어 글씨체, 글자 크기를 골라 지문 하나씩 띄운다.
 * 지문 위에 문법 번호(분석서) · 동반의어(단어 정리) · 출제 자리(빈칸·삽입·지칭·함축) · 쉽게 말하면을 겹치고,
 * 옆에 출제 자리 · 글의 흐름 · 문법 포인트, 아래에 교사용 해설 8칸(teacher-notes.ts).
 * 학생용은 해석·교사용 해설을 빼고 지칭 대상·함축 뜻·문법 설명·흐름 가운데 칸을 빈 줄로 둔다.
 * PDF는 늘 흰 바탕 A4로, 교사용·학생용을 따로 받는다.
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
  { id: "side", label: "옆 칸" },
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
  size: 24,
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

// ---------------------------------------------------------------- 지문 하나

function PassageView({
  p,
  index,
  mode,
  layers,
  paper,
  notes,
  grammar,
}: {
  p: TestBookProjectInput;
  index: number;
  mode: Mode;
  layers: Record<Layer, boolean>;
  paper: boolean;
  notes: TeacherNotes | null;
  grammar: GrammarMark[];
}) {
  const vocab = useMemo(() => vocabMarks(p), [p]);
  const spots = useMemo(() => spotMarks(p, notes), [p, notes]);
  const teacher = mode === "teacher";
  const showKo = layers.ko && teacher;
  const blank = <span className="lc-blank" />;
  const sideOn = layers.side;
  return (
    <div className={paper ? "lc-paper" : "lc-screen"}>
      <h2 className="lc-h1">
        {String(index + 1).padStart(2, "0")} · {notes?.title.en || p.titleEn || p.title}
      </h2>
      <p className="lc-meta">
        {p.source ? `${p.source} · ` : ""}
        {notes ? `주제: ${notes.topic.ko}` : p.title}
      </p>
      <div className={sideOn ? "lc-grid" : ""}>
        <div className="lc-passage">
          {p.sentences.map((s, si) => {
            const easy = layers.easy ? notes?.easy.find((e) => e.sentence === si) : undefined;
            return (
              <div key={si} className="lc-sent">
                <p className="lc-en">
                  <span className="lc-sn">{si + 1}</span>
                  <SentenceLine
                    text={s.english}
                    grammar={grammar.filter((m) => m.si === si)}
                    vocab={vocab.filter((m) => m.si === si)}
                    spots={spots.filter((m) => m.si === si)}
                    layers={layers}
                  />
                </p>
                {showKo && s.korean ? <p className="lc-ko">{s.korean}</p> : null}
                {easy ? (
                  <p className="lc-easy">
                    <b>쉽게 말하면</b> {easy.text}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
        {sideOn ? (
          <div className="lc-side">
            {layers.spots && spots.length ? (
              <div className="lc-card">
                <h3>출제 예상 자리</h3>
                <ul>
                  {spots.map((m, i) => (
                    <li key={i}>
                      <span className={`lc-tag lc-tag-${m.kind}`}>{SPOT_LABEL[m.kind]}</span> <b>{m.q}</b>
                      {m.note ? (
                        <>
                          {" "}
                          — {teacher || m.kind === "blank" || m.kind === "insert" ? m.note : blank}
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {notes?.flow.length ? (
              <div className="lc-card">
                <h3>글의 흐름</h3>
                <div className="lc-flow">
                  {notes.flow.map((f, i) => {
                    const hide = !teacher && i > 0 && i < notes.flow.length - 1;
                    return (
                      <div key={i}>
                        {i > 0 ? <div className="lc-farr">↓</div> : null}
                        <div className="lc-fbox">
                          <b>
                            {f.label}
                            {f.sentences ? ` (${f.sentences})` : ""}
                          </b>
                          {f.lines.map((l, k) => (
                            <div key={k}>{hide ? blank : l}</div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {layers.grammar && grammar.length ? (
              <div className="lc-card">
                <h3>문법 포인트</h3>
                <ol className="lc-gl">
                  {grammar.map((m) => (
                    <li key={m.no}>
                      <span className="lc-gn2">{CIRCLED[m.no - 1] ?? `(${m.no})`}</span> <b>{m.label}</b>
                      {teacher ? <span className="lc-gx"> — {m.explanation}</span> : <> — {blank}</>}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {teacher && notes ? <TeacherSection notes={notes} /> : null}
    </div>
  );
}

function TeacherSection({ notes }: { notes: TeacherNotes }) {
  return (
    <section className="lc-teacher">
      <h2 className="lc-h2">교사용 해설</h2>
      {notes.background.length ? (
        <div className="lc-tcard">
          <h3>1. 배경지식</h3>
          <ol>
            {notes.background.map((b, i) => (
              <li key={i}>
                <b>
                  {b.term}
                  {b.termEn ? `(${b.termEn})` : ""}
                </b>{" "}
                — {b.definition} <span className="lc-dim">예) {b.example}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <div className="lc-tcard">
        <h3>2. 이 지문을 효과적으로 강의할 수 있는 Tip</h3>
        {notes.tip.hookTitle ? (
          <p>
            <b>도입부 썰</b> — {notes.tip.hookTitle}
          </p>
        ) : null}
        {notes.tip.script ? <p className="lc-script">“{notes.tip.script.replace(/^“|”$/g, "")}”</p> : null}
        {notes.tip.analogy ? (
          <p>
            <b>어려운 개념 비유</b> — {notes.tip.analogy}
          </p>
        ) : null}
        {notes.tip.points.length ? (
          <>
            <p>
              <b>강조 포인트</b>
            </p>
            <ol>
              {notes.tip.points.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ol>
          </>
        ) : null}
      </div>
      <div className="lc-tcard">
        <h3>3. 주제 / 제목 / 요약문</h3>
        <p>
          <b>Topic</b> {notes.topic.en}
          <br />
          <span className="lc-dim">{notes.topic.ko}</span>
        </p>
        <p>
          <b>Title</b> {notes.title.en}
          <br />
          <span className="lc-dim">{notes.title.ko}</span>
        </p>
        <p>
          <b>Summary</b> {notes.summary.en}
          <br />
          <span className="lc-dim">{notes.summary.ko}</span>
        </p>
      </div>
      {notes.flow.length ? (
        <div className="lc-tcard">
          <h3>4. 지문 FLOW</h3>
          {notes.flow.map((f, i) => (
            <p key={i}>
              <b>
                {i + 1}. {f.label}
              </b>
              {f.sentences ? ` (${f.sentences}번)` : ""}
              {f.lines.map((l, k) => (
                <span key={k}>
                  <br />
                  {l}
                </span>
              ))}
            </p>
          ))}
        </div>
      ) : null}
      {notes.vocab.length ? (
        <div className="lc-tcard">
          <h3>5. 핵심 어휘 분석</h3>
          <table>
            <thead>
              <tr>
                <th>단어</th>
                <th>뜻</th>
                <th>어원 분석</th>
                <th>문맥상 동의어</th>
              </tr>
            </thead>
            <tbody>
              {notes.vocab.map((v, i) => (
                <tr key={i}>
                  <td>
                    <b>{v.word}</b>
                  </td>
                  <td>{v.meaning}</td>
                  <td>{v.etymology || "—"}</td>
                  <td>{v.synonyms.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="lc-tcard">
        <h3>6. 비유와 함축 의미</h3>
        {notes.figurative.length ? (
          notes.figurative.map((f, i) => (
            <p key={i}>
              <b>표현</b> {f.expression}
              <br />
              <b>함축 의미</b> {f.meaningEn}
              <br />
              <b>설명</b> {f.explainKo}
            </p>
          ))
        ) : (
          <p className="lc-dim">이 지문에는 따로 짚을 비유적 표현이 없습니다.</p>
        )}
      </div>
      {notes.questionTypes.length ? (
        <div className="lc-tcard">
          <h3>7. 출제 가능성이 높은 문제 유형</h3>
          <p className="lc-dim">별점은 평가원 출제 확률이 아니라 지문 구조를 보고 내린 교육적 판단입니다.</p>
          <table>
            <thead>
              <tr>
                <th>유형</th>
                <th>적합도</th>
                <th>이유 · 출제 지점</th>
                <th>함정</th>
                <th>풀이 전략</th>
              </tr>
            </thead>
            <tbody>
              {notes.questionTypes.map((q, i) => (
                <tr key={i}>
                  <td>
                    <b>{q.type}</b>
                  </td>
                  <td className="lc-stars">{"★".repeat(q.stars) + "☆".repeat(5 - q.stars)}</td>
                  <td>
                    {q.reason}
                    {q.spot ? <span className="lc-dim"> · {q.spot}</span> : null}
                  </td>
                  <td>{q.trap}</td>
                  <td>{q.strategy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="lc-tcard">
        <h3>8. 강의 마무리 – 시험 대비 핵심 정리</h3>
        <p>
          1️⃣ <b>Main Idea &amp; Claim</b> — {notes.review.mainIdea}
          {notes.review.studentLine ? (
            <>
              <br />
              학생 한 줄: “{notes.review.studentLine.replace(/^“|”$/g, "")}”
            </>
          ) : null}
        </p>
        <p>
          2️⃣ <b>Key Vocabulary &amp; Synonyms</b> — {notes.review.vocabNote}
        </p>
        <p>
          3️⃣ <b>Expected Question Types</b> — {notes.review.typesNote}
        </p>
        <p>
          4️⃣ <b>Figurative Expressions</b> — {notes.review.figurativeNote}
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- 모양

const CSS = `
.lc-root{--bg:#2f4a3a;--panel:#35523f;--ink:#f3f1e7;--sub:#c9d3c4;--line:#5d7a66;--gram:#ffe27a;--syn:#9fd8ff;--ant:#ffadad;
  --t-blank:#ffb84d;--t-insert:#7ee0a8;--t-reference:#c7a6ff;--t-implication:#ff8fc8;--easy:#7ee0a8;--shadow:0 0 1px rgba(255,255,255,.35)}
.lc-root[data-theme="navy"]{--bg:#1d2a44;--panel:#24345a;--ink:#f1f4fb;--sub:#b8c3dc;--line:#3d5180;--shadow:none}
.lc-root[data-theme="cream"],.lc-root[data-theme="white"],.lc-paper{--ink:#1d1d1f;--sub:#5f5a50;--gram:#a66b00;--syn:#1f6fb2;--ant:#c0392b;
  --t-blank:#d9780a;--t-insert:#1e8a4c;--t-reference:#7240c9;--t-implication:#c2307a;--easy:#1e8a4c;--shadow:none}
.lc-root[data-theme="cream"]{--bg:#f8f1df;--panel:#fffaf0;--line:#e2d6b8}
.lc-root[data-theme="white"]{--bg:#fff;--panel:#fff;--line:#e3e3e3}
.lc-paper{--bg:#fff;--panel:#fff;--line:#cfcfcf}
.lc-root{background:var(--bg);color:var(--ink);font-family:var(--ff)}
.lc-screen{max-width:1240px;margin:0 auto;padding:20px 24px 80px}
.lc-paper{width:210mm;box-sizing:border-box;padding:11mm 12mm 0;background:#fff;color:var(--ink);font-family:var(--ff);--fs:14.5px}
.lc-h1{font-size:1.5em;font-weight:800;margin:0 0 2px}
.lc-paper .lc-h1{font-size:17px}
.lc-meta{color:var(--sub);font-size:14px;margin:0 0 14px}
.lc-paper .lc-meta{font-size:10.5px;margin-bottom:8px}
.lc-grid{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:22px;align-items:start}
.lc-paper .lc-grid{display:block}
.lc-paper .lc-side{display:grid !important;grid-template-columns:repeat(3,minmax(0,1fr));gap:3mm;margin-top:3mm;align-items:start}
.lc-paper .lc-sent{break-inside:avoid}
.lc-paper .lc-tcard:last-child{margin-bottom:0}
.lc-passage{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px 24px}
.lc-paper .lc-passage{padding:3mm 4mm;border-radius:6px}
.lc-en{font-family:var(--fe,var(--ff));font-size:var(--fs);line-height:2.4;margin:0;text-shadow:var(--shadow)}
.lc-paper .lc-en{line-height:2.25}
.lc-sn{display:inline-block;min-width:1.4em;color:var(--sub);font-size:.62em;font-weight:800}
.lc-ko{font-size:max(13px,calc(var(--fs) * .62));color:var(--sub);margin:-4px 0 12px 1.6em;line-height:1.6}
.lc-paper .lc-ko{font-size:10px;margin:-3px 0 6px 1.4em}
.lc-easy{font-size:max(13px,calc(var(--fs) * .62));line-height:1.6;margin:-2px 0 14px 1.6em;padding:6px 12px;border-left:4px solid var(--easy);
  background:color-mix(in srgb,var(--panel) 86%,var(--easy) 14%);border-radius:0 8px 8px 0}
.lc-paper .lc-easy{font-size:10px;padding:3px 8px;margin-bottom:6px}
.lc-easy b{color:var(--easy)}
.lc-g{border-bottom:2px solid var(--gram)}
.lc-gn{color:var(--gram);font-weight:800;font-size:.6em;margin-left:1px}
.lc-v{position:relative}
.lc-vl{position:absolute;left:0;top:-1.15em;white-space:nowrap;font-size:.46em;font-weight:600;line-height:1;pointer-events:none}
.lc-vl2{top:-2.25em}
.lc-syn{color:var(--syn)}.lc-ant{color:var(--ant)}
.lc-s-blank{box-shadow:inset 0 -.42em 0 color-mix(in srgb,var(--t-blank) 42%,transparent)}
.lc-s-implication{border-top:2px dashed var(--t-implication);border-bottom:2px dashed var(--t-implication)}
.lc-s-reference{border-bottom:3px dotted var(--t-reference)}
.lc-s-insert{color:var(--t-insert);font-weight:700}
.lc-tag{display:inline-block;font-family:var(--ff);font-size:12px;font-weight:800;padding:0 7px;border-radius:999px;margin:0 2px;vertical-align:middle;line-height:1.7;color:#111;text-shadow:none;
  -webkit-print-color-adjust:exact;print-color-adjust:exact}
.lc-paper .lc-tag{font-size:8.5px;padding:0 5px}
.lc-tag-blank{background:var(--t-blank)}.lc-tag-insert{background:var(--t-insert)}.lc-tag-reference{background:var(--t-reference)}.lc-tag-implication{background:var(--t-implication)}
.lc-paper .lc-tag-insert,.lc-paper .lc-tag-reference,.lc-paper .lc-tag-implication,.lc-root[data-theme="cream"] .lc-tag:not(.lc-tag-blank),.lc-root[data-theme="white"] .lc-tag:not(.lc-tag-blank){color:#fff}
.lc-side{display:flex;flex-direction:column;gap:14px}
.lc-paper .lc-side{gap:3mm}
.lc-card,.lc-tcard{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;font-size:14px;line-height:1.65;break-inside:avoid}
.lc-paper .lc-card{padding:2.5mm 3mm;border-radius:6px;font-size:9.5px}
.lc-card h3,.lc-tcard h3{margin:0 0 8px;font-size:15px;font-weight:800}
.lc-tcard h3{color:var(--gram);font-size:17px}
.lc-paper .lc-card h3{font-size:11px;margin-bottom:4px}
.lc-card ul,.lc-card ol,.lc-tcard ol{margin:0;padding-left:18px}
.lc-card li{margin-bottom:5px}
.lc-gl{list-style:none;padding-left:0 !important}
.lc-gn2{color:var(--gram);font-weight:800}
.lc-blank{display:inline-block;min-width:150px;border-bottom:1.5px solid var(--sub);height:1em;vertical-align:baseline}
.lc-paper .lc-blank{min-width:30mm}
.lc-flow .lc-fbox{border:2px solid var(--line);border-radius:10px;padding:6px 10px;text-align:center;font-size:13.5px}
.lc-paper .lc-flow .lc-fbox{font-size:9px;padding:2px 5px;border-width:1px;border-radius:5px}
.lc-farr{text-align:center;color:var(--sub);line-height:1.2}
.lc-teacher{margin-top:26px}
.lc-paper .lc-teacher{margin-top:0;break-before:page;padding-top:2mm}
.lc-h2{font-size:21px;font-weight:800;margin:0 0 12px}
.lc-paper .lc-h2{font-size:14px;margin-bottom:3mm}
.lc-tcard{margin-bottom:14px;font-size:15px;padding:16px 20px}
.lc-paper .lc-tcard{font-size:10px;padding:3mm 4mm;margin-bottom:3mm;border-radius:6px;line-height:1.55}
.lc-paper .lc-tcard h3{font-size:11.5px;margin-bottom:4px}
.lc-tcard p{margin:0 0 8px}
.lc-script{border-left:4px solid var(--t-implication);padding:6px 12px;background:color-mix(in srgb,var(--panel) 88%,var(--t-implication) 12%);border-radius:0 8px 8px 0}
.lc-dim{color:var(--sub)}
.lc-tcard table{width:100%;border-collapse:collapse;font-size:.93em}
.lc-tcard th,.lc-tcard td{border:1px solid var(--line);padding:5px 7px;text-align:left;vertical-align:top}
.lc-tcard th{background:color-mix(in srgb,var(--panel) 86%,var(--ink) 9%)}
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
  const [error, setError] = useState<string | null>(null);
  // 해설·문법 번호는 이 화면을 열 때 따로 읽는다
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
  const onNotes = (id: string, notes: TeacherNotes) =>
    setExtra((x) => ({ ...x, [id]: { grammar: x[id]?.grammar ?? [], notes } }));
  const notesOf = (id: string) => extra[id]?.notes ?? null;
  const grammarOf = (id: string) => extra[id]?.grammar ?? [];
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Settings>;
        setSettings({ ...DEFAULT_SETTINGS, ...saved, layers: { ...DEFAULT_SETTINGS.layers, ...(saved.layers ?? {}) } });
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
  const [cur, setCur] = useState(0);
  const p = projects[Math.min(cur, projects.length - 1)];
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
          if (res.ok) onNotes(t.id, res.notes);
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

  // PDF — 늘 흰 바탕 A4, 교사용·학생용 따로
  const pdf = usePdfSave();
  const [pdfMode, setPdfMode] = useState<Mode | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pdfMode) return;
    let alive = true;
    const label = pdfMode === "teacher" ? "교사용" : "학생용";
    requestAnimationFrame(() =>
      requestAnimationFrame(async () => {
        if (!alive) return;
        await pdf.save(label, collectPrintPages(printRef.current, ".lc-paper"), [title], undefined, false);
        setPdfMode(null);
      })
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfMode]);

  const ko = KO_FONTS.find((f) => f.id === settings.koFont) ?? KO_FONTS[0]!;
  const en = EN_FONTS.find((f) => f.id === settings.enFont) ?? EN_FONTS[0]!;
  const rootStyle = {
    ["--ff" as string]: ko.css,
    ...(en.css ? { ["--fe" as string]: en.css } : {}),
    ["--fs" as string]: `${settings.size}px`,
  } as CSSProperties;
  const paperStyle = {
    ["--ff" as string]: '"Noto Sans KR", sans-serif',
    ...(en.css ? { ["--fe" as string]: en.css } : {}),
  } as CSSProperties;

  const barBtn = (on: boolean) =>
    `rounded-md px-2.5 py-1 text-xs font-bold ${on ? "bg-white text-slate-900" : "text-white/80 hover:bg-white/10"}`;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-900 print:hidden">
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
          <input type="range" min={16} max={40} value={settings.size} onChange={(e) => update({ size: Number(e.target.value) })} />
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
            disabled={!!pdf.busy || !!pdfMode}
            onClick={() => setPdfMode("teacher")}
            className="rounded-md bg-white px-3 py-1 font-bold text-slate-900 hover:bg-slate-100 disabled:opacity-60"
          >
            ⤓ 교사용 PDF
          </button>
          <button
            type="button"
            disabled={!!pdf.busy || !!pdfMode}
            onClick={() => setPdfMode("student")}
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
            onClick={() => setCur(i)}
            title={x.title}
            className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-bold ${i === cur ? "bg-white text-slate-900" : "text-white/70 hover:bg-white/10"}`}
          >
            {String(i + 1).padStart(2, "0")}
            {notesOf(x.id) ? "" : " ·"}
          </button>
        ))}
        {p && notesOf(p.id) ? (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => p && void makeNotes([p], true)}
            className="ml-auto shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold text-white/60 hover:bg-white/10"
          >
            이 지문 해설 다시 만들기
          </button>
        ) : null}
      </div>
      <div className="lc-root min-h-0 flex-1 overflow-auto" data-theme={settings.theme} style={rootStyle}>
        {p ? (
          <PassageView
            key={p.id}
            p={p}
            index={cur}
            mode={settings.mode}
            layers={settings.layers}
            paper={false}
            notes={notesOf(p.id)}
            grammar={grammarOf(p.id)}
          />
        ) : null}
        {p && loaded && !notesOf(p.id) ? (
          <p className="lc-screen" style={{ paddingTop: 0, color: "var(--sub)", fontSize: 14 }}>
            이 지문은 아직 교사용 해설이 없습니다. 위의 「교사용 해설 만들기」를 누르면 출제 자리 · 쉽게 말하면 · 흐름 · 교사용 해설이 붙습니다.
          </p>
        ) : null}
      </div>
      {/* PDF용 쪽(흰 바탕 A4) — 화면 밖에 그려 두고 저장할 때만 뜬다 */}
      <div aria-hidden style={{ position: "absolute", left: -100000, top: 0 }}>
        {pdfMode ? (
          <div ref={printRef} className="lc-root" data-theme="white" style={paperStyle}>
            {projects.map((x, i) => (
              <PassageView
                key={x.id}
                p={x}
                index={i}
                mode={pdfMode}
                layers={{ ...settings.layers, side: true }}
                paper
                notes={notesOf(x.id)}
                grammar={grammarOf(x.id)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
