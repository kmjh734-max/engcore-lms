/**
 * 중학교 문제 은행 작업 도구(정수학원·동아(윤정미), 모델 호출 없음). 내용 파일은 족보닷컴 글이라 커밋하지 않는다(study/data).
 *   node --env-file=.env.local scripts/middle-school/study/qbank.mjs dump  중1 2          → data/중1-2.yesang.json (예상문제 전 문항)
 *   node --env-file=.env.local scripts/middle-school/study/qbank.mjs study 중1 2 [--적용]  ← data/중1-2.study.json (STEP2·3·대표유형 입력)
 *   node --env-file=.env.local scripts/middle-school/study/qbank.mjs patch 중1 2 [--적용]  ← data/중1-2.patch.json (예상문제 고치기)
 *
 * 동아(이병민)은 학년에 「이」를 붙인다: qbank.mjs dump 중1이 2 → data/중1이-2.yesang.json
 *
 * study.json: [{ source, area, stem, body: string[], choices?: string[](5개, 있으면 객관식), answer, explanation? }]
 *   source: 「본문학습 STEP2 커뮤니케이션」 「본문학습 STEP3 교과서 속 문법」 「대표유형 풀어보기」. answer: 객관식은 "4" 또는 "3, 5".
 * patch.json: [{ id, stem?, body?, group_lines?, choices?: [{no,text}], answer?, explanation?, review?, why }] — 준 칸만 바꾼다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(here, "data");
fs.mkdirSync(DATA, { recursive: true });
const args = process.argv.slice(2);
const apply = args.includes("--적용");
const [cmd, gradeRaw, lessonRaw] = args.filter((a) => !a.startsWith("--"));
const grade = gradeRaw.replace(/이$/, "");
const publisher = gradeRaw.endsWith("이") ? "동아(이병민)" : "동아(윤정미)";
const lesson = Number(lessonRaw);
const key = `${gradeRaw}-${lesson}`;
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: academy } = await sb.from("academies").select("id").eq("slug", "jeongsu").single();
const { data: unit, error: ue } = await sb.from("ms_units").select("id").eq("academy_id", academy.id).eq("grade", grade).eq("publisher", publisher).eq("lesson_no", lesson).single();
if (ue) throw ue;
const SOURCES = ["본문학습 STEP2 커뮤니케이션", "본문학습 STEP3 교과서 속 문법", "대표유형 풀어보기"];
const AREAS = ["단어", "의사소통", "어법", "본문"];
const norm = (s) => String(s ?? "").replace(/<\/?u>/g, "").replace(/[‘’']/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
const die = (e) => { if (e) throw e; };

/** 문항 하나의 형식 검사 — 문제가 있으면 사유 목록 */
function check(q) {
  const out = [];
  if (!String(q.stem ?? "").trim()) out.push("발문 없음");
  const body = q.body ?? [];
  const texts = [...body, ...(q.choices ?? []).map((c) => (typeof c === "string" ? c : c.text))];
  if (texts.some((l) => /\t|zb\d+\)|^\s*(정답|해설|PRE-STEP|본문변형)\s*$|\(불일치\)|\(일치\)|\(→/.test(l))) out.push("꼬리 글자·탭·교사용 표시");
  if (texts.some((l) => /[-㐀-䶿ἀ-῿Ⰰ-ⷿ]/.test(l))) out.push("깨진 글자");
  if (q.kind === "mc") {
    if ((q.choices ?? []).length !== 5) out.push(`보기 ${(q.choices ?? []).length}개`);
    const ans = String(q.answer).split(/\s*,\s*/);
    if (!ans.every((a) => /^[1-5]$/.test(a))) out.push(`객관식 정답 꼴 「${q.answer}」`);
  } else {
    if (!String(q.answer ?? "").trim()) out.push("정답 없음");
    const parts = String(q.answer ?? "").split(/\n|\s+\/\s+|(?=\([A-Z]\))|(?=[①-⑮])/).map((x) => norm(x).replace(/^\([a-z0-9]\)\s*|^[①-⑮]\s*/, "")).filter((x) => x.split(" ").length >= 3);
    if (parts.some((p) => body.some((b) => norm(b).includes(p)))) out.push("정답이 문제 글에 보임");
  }
  return out;
}

if (cmd === "dump") {
  const { data, error } = await sb.from("ms_questions").select("id,source,no,area,kind,stem,group_lead,group_lines,body,choices,answer,explanation,review").eq("unit_id", unit.id).like("source", "예상문제%").order("source").order("no");
  die(error);
  fs.writeFileSync(path.join(DATA, `${key}.yesang.json`), JSON.stringify(data, null, 1));
  console.log(`${key} 예상문제 ${data.length}문항 (숨김 ${data.filter((q) => q.review).length}) → study/data/${key}.yesang.json`);
  const bad = data.filter((q) => !q.review).map((q) => [q, check(q)]).filter(([, c]) => c.length);
  for (const [q, c] of bad) console.log(`  의심 ${q.id} ${q.source} ${q.no}: ${c.join(", ")}`);
} else if (cmd === "study") {
  const items = JSON.parse(fs.readFileSync(path.join(DATA, `${key}.study.json`), "utf8"));
  const nos = {};
  const counts = {};
  let problems = 0;
  const rows = items.map((q, i) => {
    if (!SOURCES.includes(q.source)) { console.log(`  ${i}: 출처 이름 틀림 「${q.source}」`); problems++; }
    if (!AREAS.includes(q.area)) { console.log(`  ${i}: 영역 틀림 「${q.area}」`); problems++; }
    const kind = q.choices ? "mc" : "sa";
    const c = check({ ...q, kind });
    if (c.length) { console.log(`  ${i} ${q.source}: ${c.join(", ")} | ${String(q.stem).slice(0, 40)}`); problems++; }
    nos[q.source] = (nos[q.source] ?? 0) + 1;
    counts[q.source] = nos[q.source];
    return { unit_id: unit.id, source: q.source, no: nos[q.source], area: q.area, kind, stem: q.stem, group_lead: null, group_lines: null, body: q.body ?? [], choices: (q.choices ?? []).map((text, n) => ({ no: n + 1, text })), answer: q.answer, explanation: q.explanation ?? "", point: "", needs_image: false, review: "" };
  });
  console.log(key, counts, `문제 ${problems}`);
  if (apply) {
    if (problems) { console.log("문제가 있어 넣지 않음"); process.exit(1); }
    die((await sb.from("ms_questions").delete().eq("unit_id", unit.id).in("source", SOURCES)).error);
    die((await sb.from("ms_questions").insert(rows)).error);
    console.log("넣음");
  }
} else if (cmd === "patch") {
  const items = JSON.parse(fs.readFileSync(path.join(DATA, `${key}.patch.json`), "utf8"));
  const { data: cur, error } = await sb.from("ms_questions").select("id,source,no,kind,stem,body,group_lines,choices,answer,explanation,review").eq("unit_id", unit.id).in("id", items.map((x) => x.id));
  die(error);
  const byId = new Map(cur.map((q) => [q.id, q]));
  let problems = 0;
  for (const p of items) {
    const q = byId.get(p.id);
    if (!q) { console.log(`  ${p.id}: 이 과 문항이 아님`); problems++; continue; }
    if (!q.source.startsWith("예상문제")) { console.log(`  ${p.id}: 예상문제가 아님`); problems++; continue; }
    if (!p.why) { console.log(`  ${p.id}: why 없음`); problems++; }
    const next = { ...q, ...p };
    const c = next.review ? [] : check(next);
    if (c.length) { console.log(`  ${p.id} ${q.source} ${q.no}: 고친 뒤에도 ${c.join(", ")}`); problems++; }
  }
  console.log(key, `고침 ${items.length} · 문제 ${problems}`);
  if (apply) {
    if (problems) { console.log("문제가 있어 넣지 않음"); process.exit(1); }
    for (const p of items) {
      const { id, why: _why, ...patch } = p;
      die((await sb.from("ms_questions").update(patch).eq("id", id)).error);
    }
    console.log("고침 적용");
  }
} else if (cmd === "concert") {
  /*
   * 내신콘서트(선생님 2026-11-04 「거기 있는 모든 문제를 다 넣어」, 문제 은행에만): data/<학년>-<과>.concert.json
   * [{ source: "내신콘서트 …", no?: 책 번호, area, stem, body?: string[], choices?: string[](2~5개, 있으면 객관식),
   *    answer, explanation?, group?: { lead: "[20-22] 다음 글을 읽고, 물음에 답하시오.", lines: string[] }, review?: "숨길 사유" }]
   * 과의 내신콘서트 문항을 모두 지우고 다시 넣는다.
   */
  // 나눠 입력한 파일(<키>.concert.json, <키>.concert.a.json, .b.json …)을 이름 차례로 합친다
  const files = fs.readdirSync(DATA).filter((f) => f.startsWith(`${key}.concert`) && f.endsWith(".json")).sort();
  if (!files.length) throw new Error(`data/${key}.concert*.json 없음`);
  // 출처 이름에 갈래를 붙인다(선생님 2026-11-04 「단어 대화문 문법 본문 종합문제 이렇게, 순서가」):
  // 「내신콘서트 Words 연습 문제 1」 → 「내신콘서트 단어 · Words 연습 문제 1」, 실전 모의고사는 「종합문제」, Extra Reading은 「본문」
  // 문항이 몇 개 안 되는 꼭지는 묶는다(선생님 「2문제만 있는 건 하나로 묶어서」): 갈래마다 「연습 문제」·「실전 문제」 둘, 종합문제는 회차별.
  //   Words 연습 1·2 → 단어 · 연습 문제 / Dialogues in Textbook·연습 → 대화문 · 연습 문제 / Grammar Quick Test·연습·요점 노트 → 문법 · 연습 문제
  //   Reading 연습 1~4 → 본문 · 연습 문제 / Reading 실전·Extra Reading 실전 → 본문 · 실전 문제 / 실전 모의고사 X → 종합문제 · 실전 모의고사 X
  const CATS = [[/^Words/, "단어"], [/^Dialogues/, "대화문"], [/^Grammar/, "문법"], [/^(Reading|Extra Reading)/, "본문"]];
  const withCat = (src) => {
    const rest = String(src ?? "").replace(/^내신콘서트\s+/, "");
    if (/^(단어|대화문|문법|본문|종합문제) · /.test(rest)) return `내신콘서트 ${rest}`;
    if (/^실전 모의고사/.test(rest)) return `내신콘서트 종합문제 · ${rest}`;
    const cat = CATS.find(([re]) => re.test(rest))?.[1];
    if (!cat) return `내신콘서트 ${rest}`;
    return `내신콘서트 ${cat} · ${/실전 문제/.test(rest) ? "실전 문제" : "연습 문제"}`;
  };
  const items = files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"))).map((q) => ({ ...q, source: withCat(q.source) }));
  console.log("파일", files.join(", "));
  const nos = {};
  let problems = 0;
  const rows = items.map((q, i) => {
    const tag = `  ${i} ${q.source} ${q.no ?? ""}`;
    if (!/^내신콘서트 \S/.test(q.source ?? "")) { console.log(`${tag}: 출처는 「내신콘서트 …」`); problems++; }
    if (!AREAS.includes(q.area)) { console.log(`${tag}: 영역 틀림 「${q.area}」`); problems++; }
    const kind = q.choices ? "mc" : "sa";
    const out = [];
    if (!String(q.stem ?? "").trim()) out.push("발문 없음");
    const texts = [...(q.body ?? []), ...(q.choices ?? []), ...(q.group?.lines ?? [])];
    if (texts.some((l) => /\t/.test(l))) out.push("탭");
    if (texts.some((l) => /[-㐀-䶿]/.test(l))) out.push("깨진 글자"); // 한글 기호 글꼴(PUA)·한자 확장 — 붙임표(-)는 정상
    if (kind === "mc") {
      const n = q.choices.length;
      if (n < 2 || n > 5) out.push(`보기 ${n}개`);
      const ans = String(q.answer).split(/\s*,\s*/);
      if (!ans.every((a) => /^\d$/.test(a) && Number(a) >= 1 && Number(a) <= n)) out.push(`객관식 정답 꼴 「${q.answer}」`);
    } else if (!String(q.answer ?? "").trim()) out.push("정답 없음");
    // 정답 ↔ 해설: 해설이 ①~⑤를 들어 말하는데 정답 번호가 그 안에 없으면 밀린 것일 수 있다(선생님 2026-11-04 「정답·해설 일치 꼼꼼히」)
    if (kind === "mc" && !q.review) {
      const CIRC = "①②③④⑤";
      const named = [...String(q.explanation ?? "")].filter((c) => CIRC.includes(c)).map((c) => CIRC.indexOf(c) + 1);
      const ans = String(q.answer).split(/\s*,\s*/).map(Number);
      const lead = String(q.explanation ?? "").trim()[0];
      if (CIRC.includes(lead ?? "") && !ans.includes(CIRC.indexOf(lead) + 1) && named.length === 1) out.push(`해설 첫 번호 ${lead} ≠ 정답 ${q.answer}`);
    }
    if (out.length && !q.review) { console.log(`${tag}: ${out.join(", ")} | ${String(q.stem).slice(0, 40)}`); problems++; }
    nos[q.source] = (nos[q.source] ?? 0) + 1;
    return {
      unit_id: unit.id, source: q.source, no: q.no ?? nos[q.source], area: q.area, kind, stem: q.stem,
      group_lead: q.group?.lead ?? null, group_lines: q.group?.lines ?? null,
      body: q.body ?? [], choices: (q.choices ?? []).map((text, n) => ({ no: n + 1, text })), answer: String(q.answer ?? ""),
      explanation: q.explanation ?? "", point: "", needs_image: false, review: q.review ?? "",
    };
  });
  // 한 꼭지 안에서 책 번호가 겹치면(소단원마다 1번부터 — Grammar 연습 문제 2) 그 꼭지는 차례대로 다시 번호를 매긴다(과·출처·번호는 하나뿐이어야)
  for (const src of Object.keys(nos)) {
    const mine = rows.filter((r) => r.source === src);
    if (new Set(mine.map((r) => r.no)).size !== mine.length) mine.forEach((r, i) => (r.no = i + 1));
  }
  console.log(key, Object.fromEntries(Object.entries(nos).sort()), `합 ${rows.length} · 숨김 ${rows.filter((r) => r.review).length} · 문제 ${problems}`);
  if (apply) {
    if (problems) { console.log("문제가 있어 넣지 않음"); process.exit(1); }
    die((await sb.from("ms_questions").delete().eq("unit_id", unit.id).like("source", "내신콘서트%")).error);
    for (let i = 0; i < rows.length; i += 200) die((await sb.from("ms_questions").insert(rows.slice(i, i + 200))).error);
    console.log("넣음");
  }
} else {
  console.log("dump | study | patch | concert");
}
