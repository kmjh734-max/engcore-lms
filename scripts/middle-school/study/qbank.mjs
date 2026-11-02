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
} else {
  console.log("dump | study | patch");
}
