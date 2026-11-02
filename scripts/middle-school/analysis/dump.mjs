/**
 * 중학교 분석서 원고 입력 만들기: 과의 본문 문장을 in/<학년>-<과>.json 으로 뽑는다(정수학원·동아(윤정미)).
 *   node --env-file=.env.local scripts/middle-school/analysis/dump.mjs 중1 1
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const here = path.dirname(fileURLToPath(import.meta.url));
// 동아(이병민)은 학년에 「이」: dump.mjs 중1이 2 → in/중1이-2.json
const [gradeRaw = "중1", lesson = "1"] = process.argv.slice(2);
const grade = gradeRaw.replace(/이$/, "");
const publisher = gradeRaw.endsWith("이") ? "동아(이병민)" : "동아(윤정미)";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: academy } = await sb.from("academies").select("id").eq("slug", "jeongsu").single();
const { data: unit } = await sb
  .from("ms_units")
  .select("id, grade, publisher, lesson_no, title, grammar")
  .eq("academy_id", academy.id)
  .eq("grade", grade)
  .eq("publisher", publisher)
  .eq("lesson_no", Number(lesson))
  .single();
if (!unit) throw new Error("과 없음");
const { data: texts } = await sb.from("ms_texts").select("id, part, title, lines").eq("unit_id", unit.id).eq("kind", "본문").order("order_index");
const out = {
  unitId: unit.id,
  grade: unit.grade,
  publisher: unit.publisher,
  lessonNo: unit.lesson_no,
  title: unit.title,
  grammarTitles: (unit.grammar ?? []).map((g) => g.title),
  passages: texts.map((t) => ({ id: t.id, part: t.part, title: t.title, lines: t.lines.map((l) => ({ en: l.en, ko: l.ko })) })),
};
fs.mkdirSync(path.join(here, "in"), { recursive: true });
const file = path.join(here, "in", `${gradeRaw}-${lesson}.json`);
fs.writeFileSync(file, JSON.stringify(out, null, 1));
console.log(file, "본문", out.passages.length, "문장", out.passages.reduce((s, p) => s + p.lines.length, 0));
