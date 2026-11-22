/**
 * 표 문항 고침(2026-11-22 「표로 된 문제가 깨졌다」)을 운영 ms_questions 에 넣는다. 모델 호출 없음.
 *   node --env-file=.env.local scripts/middle-school/study/apply-table-patch.mjs data/table-patch-1122.json [--적용]
 * 패치: [{ id, body?, group_lines?, choices?, review?, kind?, answer?, old }] — old 는 고치기 전 값(지금 DB 와 다르면 건너뜀).
 * 문장 넣기 고침: data/insert-patch-1122.json(「[주어진 문장] …」 줄), 숨겼던 표 문항 살리기: data/revive-patch-1122.json.
 * 표 꼴 「[표] 칸 | 칸 // 칸 | 칸」은 새 인쇄 코드(print-split parseTableParagraph)가 있어야 표로 보인다 → 코드 배포와 같이 넣을 것.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const apply = args.includes("--적용");
const file = path.resolve(here, args.find((a) => !a.startsWith("--")));
const patch = JSON.parse(fs.readFileSync(file, "utf8"));
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const FIELDS = ["body", "group_lines", "choices", "review", "kind", "answer", "stem"];
let done = 0, skipped = 0;
for (const p of patch) {
  const field = ["body", "group_lines", "review", "choices"].find((f) => f in p);
  const { data: row, error } = await sb.from("ms_questions").select(`id,${FIELDS.join(",")}`).eq("id", p.id).single();
  if (error) throw error;
  if (JSON.stringify(row[field] ?? null) !== JSON.stringify(p.old ?? null)) { console.log("건너뜀(이미 바뀜)", p.id, field); skipped++; continue; }
  const upd = Object.fromEntries(FIELDS.filter((f) => f in p).map((f) => [f, p[f]]));
  if (apply) { const { error: e } = await sb.from("ms_questions").update(upd).eq("id", p.id); if (e) throw e; }
  done++;
}
console.log(`${apply ? "넣음" : "미리보기"} ${done}, 건너뜀 ${skipped}`);
