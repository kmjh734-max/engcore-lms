import { createAdminClient } from "@/lib/supabase/admin";
import type { MsWord } from "./queries";

const POS = /^((?:n|v|a|adj|adv|prep|conj|pron|int)\.)\s*/;

/** 어느 과의 단어장인지 설명 칸에 적어 두고 찾는다 */
const marker = (unitId: string) => `중학교 수업자료 단어 ${unitId}`;

/**
 * 수업자료 단어 QR(로그인 없이 — 선생님 2026-11-02): 과마다 시험지 QR과 같은 공개 단어장(exam_compact) 하나.
 * 있으면 그대로 쓴다(학생 기록 보호), 처음 찍을 때만 만든다.
 */
export async function ensureMsVocabSet(unitId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: found } = await admin
    .from("vocab_sets")
    .select("id")
    .eq("description", marker(unitId))
    .eq("exam_compact", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (found) return found.id as string;

  const { data: unit } = await admin
    .from("ms_units")
    .select("academy_id, grade, publisher, lesson_no, title, words")
    .eq("id", unitId)
    .maybeSingle();
  if (!unit) return null;
  const seen = new Set<string>();
  const words = ((unit.words ?? []) as MsWord[]).filter((w) => {
    const key = w.word.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!words.length) return null;

  const { data: owner } = await admin
    .from("profiles")
    .select("id")
    .eq("academy_id", unit.academy_id)
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();
  if (!owner) return null;

  const { data: created, error } = await admin
    .from("vocab_sets")
    .insert({
      title: `${unit.grade} ${unit.lesson_no}과 ${unit.title} 단어`.slice(0, 80),
      description: marker(unitId),
      teacher_id: owner.id,
      created_by: owner.id,
      is_published: true,
      exam_compact: true,
      folder_id: null,
      order_index: 0,
      academy_id: unit.academy_id,
    })
    .select("id")
    .single();
  if (error || !created) {
    console.error("ms vocab set create failed", error?.message);
    return null;
  }
  const { error: itemErr } = await admin.from("vocab_items").insert(
    words.map((w, i) => ({
      set_id: created.id,
      word: w.word.trim(),
      meaning: w.meaning.replace(POS, ""),
      part_of_speech: w.meaning.match(POS)?.[1] ?? null,
      example_sentence: w.examples?.[0]?.en ?? null,
      example_meaning: w.examples?.[0]?.ko ?? null,
      order_index: i,
    })),
  );
  if (itemErr) {
    console.error("ms vocab items insert failed", itemErr.message);
    await admin.from("vocab_sets").delete().eq("id", created.id);
    return null;
  }
  return created.id as string;
}
