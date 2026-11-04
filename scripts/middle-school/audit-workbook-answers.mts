/**
 * 중학교 워크북 정답 전수 대조(값 없음, DB 읽기만).
 *   npx tsx scripts/middle-school/audit-workbook-answers.mts <출력.txt>
 * 화면이 실제로 만드는 문항(buildMsWorkbook, 모든 유형)을 받아, 유형마다 「정답을 문제에 넣으면 본문 문장과 같아지는지」를 본다.
 *  - 빈칸(영문)·동사 형태·어법 선택: 정답을 채운 영어 = 본문 문장(줄 1~3개 묶음 안에 그대로 들어 있어야)
 *  - 빈칸(우리말): 위 영어가 본문 문장이고, 채운 우리말이 그 문장의 본문 해석과 거의 같아야(글자 겹침)
 *  - 순서 배열: 정답이 본문 문장이고, 섞인 낱말이 모두 정답에 들어 있어야
 *  - 영작: 정답이 본문 문장이고, 조건 낱말(원형 앞 3글자)이 정답에 들어 있어야, 우리말이 그 문장의 해석이어야
 *  - 어법 선택: 정답이 [A / B] 둘 중 하나여야
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import { buildMsWorkbook, fitsVerb, MS_WB_TYPES, type MsWorkbook } from "../../src/lib/middle-school/workbook";
import type { MsUnit, MsText } from "../../src/lib/middle-school/queries";
import type { TestSeg } from "../../src/lib/lesson-materials/test-book";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: rows } = await admin.from("ms_units").select("id,grade,publisher,lesson_no,title,words,grammar,workbook").eq("academy_id", "79ea0a71-d148-46ac-8c8f-a3a3e4961838").order("publisher").order("grade").order("lesson_no");

// 줄임말은 풀어서 비교(I'm = I am) — 양쪽에 똑같이 적용
const unc = (s: string) =>
  s.replace(/[’‘]/g, "'").replace(/\b(can)'t\b/gi, "$1 not").replace(/\bwon't\b/gi, "will not").replace(/n't\b/gi, " not").replace(/'m\b/gi, " am").replace(/'re\b/gi, " are").replace(/'ll\b/gi, " will").replace(/'ve\b/gi, " have").replace(/'d\b/gi, " would").replace(/\b(it|he|she|that|there|what|where|who|here|let)'s\b/gi, (m, w) => (w.toLowerCase() === "let" ? "let us" : `${w} is`));
const en = (s: string) => ` ${unc(s).toLowerCase().replace(/[“”]/g, '"').replace(/[^a-z0-9']+/g, " ").trim()} `;
const ko = (s: string) => s.replace(/[^가-힣a-zA-Z0-9]/g, "");
const bi = (s: string) => { const m = new Map<string, number>(); for (let i = 0; i + 1 < s.length; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1); return m; };
const recall = (a: string, b: string) => { const A = bi(a), B = bi(b); let n = 0, hit = 0; for (const [k, v] of A) { n += v; hit += Math.min(v, B.get(k) ?? 0); } return n ? hit / n : 1; };

const ALL = MS_WB_TYPES.map((t) => t.key);
const stat: Record<string, { all: number; bad: number }> = {};
const bad: string[] = [];
for (const r of rows ?? []) {
  const { data: texts } = await admin.from("ms_texts").select("id,kind,part,title,lines").eq("unit_id", r.id).order("order_index");
  const all = (texts ?? []) as MsText[];
  const unit = {
    id: r.id, grade: r.grade, publisher: r.publisher, lessonNo: r.lesson_no, title: r.title,
    grammarTitles: [], wordCount: (r.words ?? []).length,
    words: r.words ?? [], grammar: r.grammar ?? [],
    dialogues: all.filter((t) => t.kind === "대화문"), passages: all.filter((t) => t.kind === "본문"),
    workbook: (r.workbook ?? {}) as MsWorkbook, lectureSections: [],
  } as unknown as MsUnit;
  const lines = unit.passages.flatMap((p) => p.lines);
  // 본문 문장 묶음(1~3줄)
  const windows: { en: string; ko: string }[] = [];
  for (const p of unit.passages) for (let a = 0; a < p.lines.length; a++) for (let s = 1; s <= 4 && a + s <= p.lines.length; s++) {
    const w = p.lines.slice(a, a + s);
    windows.push({ en: w.map((l) => l.en).join(" "), ko: w.map((l) => l.ko).join(" ") });
  }
  const bodyEn = en(lines.map((l) => l.en).join(" "));
  // 본문 줄에 없는 번호(「1.」)·글머리(「•」「-」)·머리말 한 덩어리(「Dear Nick,」「Break a Leg」)는 봐준다: 나머지가 다 본문에 있으면 맞음
  const strip = (s: string) => s.replace(/^\s*(\d+\.|[•\-])\s*/, "");
  const inBody = (s: string) => {
    if (bodyEn.includes(en(s)) || bodyEn.includes(en(strip(s)))) return true;
    const pieces = strip(s).split(/(?<=[.!?,])\s+/).filter((x) => en(x).trim());
    const out = pieces.filter((x) => !bodyEn.includes(en(x)));
    return out.length <= 1 && out.every((x) => en(x).trim().split(" ").length <= 3) && pieces.length > out.length;
  };
  const winOf = (s: string) => windows.find((w) => en(w.en).includes(en(strip(s))));
  /** 문제 아래 해석이 정답 문장의 본문 해석과 맞는지 */
  const koOk = (shown: string | undefined, filled: string) => {
    const w = winOf(filled);
    if (!w || !shown) return true;
    return recall(ko(shown), ko(w.ko)) >= 0.5;
  };
  const sheets = buildMsWorkbook(unit, unit.workbook, ALL);
  const key = `${String(r.publisher).slice(3, 4)} ${r.grade} ${r.lesson_no}과`;
  for (const sh of sheets) {
    if (sh.title === "단어" || sh.title.startsWith("대화문")) continue;
    for (const sec of sh.sheet.sections) {
      const type = MS_WB_TYPES.find((t) => sec.title === t.label || sec.title.startsWith(`${t.label} `))?.key ?? sec.title;
      for (const it of sec.items) {
        stat[type] ??= { all: 0, bad: 0 };
        stat[type].all++;
        const ans = String(it.answer ?? "");
        const parts = ans.split(/\s*\/\s*/).filter(Boolean);
        const segs = (it.text ?? []) as TestSeg[];
        const flat = segs.map((g) => (typeof g === "string" ? g : "")).join("");
        let why = "";
        if (type === "r_line") {
          // 해석 쓰기: 정답은 본문 해석 — 생성 방식상 맞음
        } else if (type === "r_en_blank") {
          const words = parts.join(" ").split(/\s+/);
          let k = 0;
          const filled = segs.map((g) => (typeof g === "string" ? g : "blank" in g ? words[k++] ?? "□" : "")).join("");
          // 빈칸 하나 = 한 낱말; 정답 낱말 수가 다르면 문장 단위로 비교
          if (!inBody(filled)) {
            const loose = segs.map((g) => (typeof g === "string" ? g : "\u0000")).join("").split("\u0000");
            let k2 = 0;
            const alt = loose.reduce((acc, s, i) => acc + s + (i < loose.length - 1 ? "" : ""), "");
            void alt; void k2;
            why = `채운 문장이 본문에 없음: ${filled}`;
          } else if (!koOk(it.ko, filled)) why = `문제 아래 해석이 정답 문장과 다름: ${it.ko} / 정답 문장 ${filled}`;
        } else if (type === "r_ko_blank") {
          const english = typeof segs[0] === "string" ? segs[0] : flat;
          if (!inBody(english)) why = `위 영어가 본문 문장이 아님: ${english}`;
          else {
            let k = 0;
            const filled = String(it.ko ?? "").replace(/_{3,}/g, () => parts[k++] ?? "");
            const w = windows.find((x) => en(x.en) === en(english));
            if (w && recall(ko(filled), ko(w.ko)) < 0.6) why = `채운 우리말이 본문 해석과 다름: ${filled} ≠ ${w.ko}`;
          }
        } else if (type === "r_verb_form") {
          let k = 0;
          const filled = flat.replace(/(?<![A-Z]{2}\s?)\(([^)]+)\)/g, (m) => parts[k] !== undefined ? parts[k++] : m);
          if (!inBody(filled)) why = `채운 문장이 본문에 없음: ${filled}`;
          else if (!koOk(it.ko, filled)) why = `문제 아래 해석이 정답 문장과 다름: ${it.ko} / 정답 문장 ${filled}`;
        } else if (type === "r_grammar") {
          const picks = segs.filter((g): g is { pick: [string, string] } => typeof g !== "string" && "pick" in g);
          if (picks.length !== parts.length) why = `[A/B] ${picks.length}개인데 정답 ${parts.length}개`;
          else if (picks.some((p, i) => !p.pick.map((x) => x.trim().toLowerCase()).includes(parts[i].trim().toLowerCase()))) why = `정답이 보기에 없음: ${ans}`;
          else {
            let k = 0;
            const filled = segs.map((g) => (typeof g === "string" ? g : "pick" in g ? parts[k++] : "")).join("");
            if (!inBody(filled)) why = `채운 문장이 본문에 없음: ${filled}`;
            else if (!koOk(it.ko, filled)) why = `문제 아래 해석이 정답 문장과 다름: ${it.ko} / 정답 문장 ${filled}`;
          }
        } else if (type === "r_word_order") {
          if (!inBody(ans)) why = `정답이 본문 문장이 아님: ${ans}`;
          else {
            const toks = en(flat).trim().split(" ").filter((t) => t.length > 1);
            const aw = new Set(en(ans).trim().split(" "));
            const miss = toks.filter((t) => !aw.has(t));
            if (miss.length) why = `섞인 낱말이 정답에 없음: ${miss.join(", ")} | ${ans}`;
          }
        } else if (type === "r_writing") {
          if (!inBody(ans)) why = `정답이 본문 문장이 아님: ${ans}`;
          else {
            const hint = String(it.hint ?? "").replace(/\(순서대로\)/, "");
            const need = hint.split(/[,，]/).map((h) => h.trim().toLowerCase()).filter(Boolean);
            const al = ans.toLowerCase();
            // 조건 낱말은 문장에서 꼴이 바뀐다(make → making, cry → cried, good → best, oneself → herself)
            const SPECIAL: Record<string, string[]> = { good: ["better", "best"], old: ["older", "oldest", "elder", "eldest"], this: ["these"], that: ["those"], oneself: ["myself", "yourself", "himself", "herself", "itself", "ourselves", "themselves"], leaf: ["leaves"], "can't": ["couldn't", "cannot", "can not"], bad: ["worse", "worst"], many: ["more", "most"], much: ["more", "most"] };
            const plain = en(ans);
            const stem = (w: string) => w.replace(/e$/, "").replace(/y$/, "i");
            const miss = need.filter((h) => !h.split(/\s+/).every((w) => plain.includes(` ${w}`) || fitsVerb(plain, w) || plain.includes(` ${stem(w)}`) || (SPECIAL[w] ?? []).some((x) => plain.includes(` ${x} `)) || (h === "be going to" && plain.includes("going to"))));
            if (miss.length) why = `조건 낱말이 정답에 없음: ${miss.join(", ")} | ${ans}`;
            const w = windows.find((x) => en(x.en) === en(ans));
            if (!why && w && it.ko && recall(ko(w.ko), ko(it.ko)) < 0.5) why = `우리말이 정답 문장 해석과 다름: ${it.ko} ≠ ${w.ko}`;
          }
        } else if (type === "r_context") {
          // 어색한 곳 고치기: 따로 본다
        }
        if (why) {
          stat[type].bad++;
          bad.push(`${key} ${sh.title} ${MS_WB_TYPES.find((t) => t.key === type)?.label ?? type} ${it.no} | ${why}`);
        }
      }
    }
  }
}
console.log(JSON.stringify(stat));
fs.writeFileSync(process.argv[2], bad.join("\n"));
console.log("걸린 문항", bad.length);
