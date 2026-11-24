// 한 번만: 오프라인 사례(scripts/tmp-rv/offline-qg/all.json)에 지문 원문을 넣어 저장소용 사례 파일을 만든다(DB 없이 돌게)
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const cases = JSON.parse(fs.readFileSync("scripts/tmp-rv/offline-qg/all.json", "utf8")) as any[];
const cache = new Map<string, string>();
const get = async (id: string) => {
  if (!cache.has(id)) cache.set(id, String((await db.from("english_source_passages").select("passage").eq("id", id).single()).data!.passage));
  return cache.get(id)!;
};
const out = [];
for (const c of cases) out.push({ key: c.key, passage: await get(c.passageId ?? "5959d0fd-f763-44bf-a7f6-b4b2dd3ad7ef"), raw: c.raw });
fs.writeFileSync("scripts/qg-regress/cases.json", JSON.stringify(out, null, 1));
console.log("cases", out.length);
