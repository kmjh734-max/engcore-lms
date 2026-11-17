// 중학교 대화문 설명 넣기(선생님 2026-11-17 「대화문에 해당 표현 설명이 필요 — 원래 pdf 참고파일에 있다」).
// 족보닷컴 본문학습 STEP2 커뮤니케이션 PDF를 보고 직접 옮겨 적은 data/<키>.json 을 넣는다. 모델 호출 없음.
//  - ms_units.workbook.communication: Communication 1·2 상자(기능·예시 대화·표현 목록)
//  - ms_texts(대화문).lines[i].key: 핵심표현(줄 안 글자 그대로), lines[i].tips: 만점공략 [{q, note}]
//  - PDF에만 있는 대화는 새 대화문으로 넣는다(extra)
// 사용: npx tsx --env-file=.env.local scripts/middle-school/communication/apply.mts <키> [--apply]
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const key = process.argv[2]!;
const APPLY = process.argv.includes("--apply");
type Tip = { q: string; note: string };
type LineIn = { speaker: string; en: string; ko: string; key?: string[]; tips?: Tip[] };
const data = JSON.parse(fs.readFileSync(`scripts/middle-school/communication/data/${key}.json`, "utf8")) as {
  unitId: string;
  communication: unknown[];
  dialogues: Array<{ part: string; marks: Array<{ line: number; key?: string[]; tips?: Tip[] }> }>;
  extra?: Array<{ part: string; title: string | null; lines: LineIn[] }>;
};

const { data: unit } = await db.from("ms_units").select("id,workbook").eq("id", data.unitId).single();
const { data: texts } = await db.from("ms_texts").select("id,kind,part,order_index,lines").eq("unit_id", data.unitId).eq("kind", "대화문").order("order_index");
const errs: string[] = [];
const updates: Array<{ id: string; lines: LineIn[] }> = [];
for (const d of data.dialogues) {
  const t = (texts ?? []).find((x) => x.part === d.part);
  if (!t) { errs.push(`대화 없음 ${d.part}`); continue; }
  const lines = (t.lines as LineIn[]).map((l) => ({ speaker: l.speaker, en: l.en, ko: l.ko }));
  for (const m of d.marks) {
    const l = lines[m.line];
    if (!l) { errs.push(`${d.part} ${m.line}번 줄 없음`); continue; }
    for (const k of m.key ?? []) if (!l.en.includes(k)) errs.push(`${d.part} ${m.line} 핵심표현 「${k}」 줄에 없음`);
    for (const tp of m.tips ?? []) if (!l.en.includes(tp.q)) errs.push(`${d.part} ${m.line} 만점공략 「${tp.q}」 줄에 없음`);
    if (m.key?.length) l.key = m.key;
    if (m.tips?.length) l.tips = m.tips;
  }
  updates.push({ id: t.id, lines });
}
for (const x of data.extra ?? []) {
  if ((texts ?? []).some((t) => t.part === x.part)) errs.push(`이미 있음 ${x.part}`);
  for (const l of x.lines) {
    for (const k of l.key ?? []) if (!l.en.includes(k)) errs.push(`${x.part} 핵심표현 「${k}」 줄에 없음`);
    for (const tp of l.tips ?? []) if (!l.en.includes(tp.q)) errs.push(`${x.part} 만점공략 「${tp.q}」 줄에 없음`);
  }
}
console.log(`의사소통 ${data.communication.length} · 대화 표시 ${updates.length} · 새 대화 ${(data.extra ?? []).length} · 문제 ${errs.length}`);
for (const e of errs) console.log("  ✗", e);
if (!APPLY || errs.length) process.exit(errs.length ? 1 : 0);

const wb = { ...((unit!.workbook as Record<string, unknown> | null) ?? {}), communication: data.communication };
const { error: e1 } = await db.from("ms_units").update({ workbook: wb }).eq("id", data.unitId);
if (e1) throw e1;
for (const u of updates) {
  const { error } = await db.from("ms_texts").update({ lines: u.lines }).eq("id", u.id);
  if (error) throw error;
}
let order = Math.max(...(texts ?? []).map((t) => Number(t.order_index ?? 0)));
for (const x of data.extra ?? []) {
  const { error } = await db.from("ms_texts").insert({
    unit_id: data.unitId,
    kind: "대화문",
    part: x.part,
    title: x.title,
    order_index: order + 0.5 > order ? ++order : order,
    lines: x.lines,
    english_text: x.lines.map((l) => `${l.speaker}: ${l.en}`).join("\n"),
    korean_text: x.lines.map((l) => `${l.speaker}: ${l.ko}`).join("\n"),
  });
  if (error) throw error;
}
console.log("적용 끝");
