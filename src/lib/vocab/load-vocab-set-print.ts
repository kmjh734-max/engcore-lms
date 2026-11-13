import type { SupabaseClient } from "@supabase/supabase-js";
import type { VocabItem, VocabSet } from "@/types/database";
import type { VocabPassageGroup, VocabPrintSection } from "@/lib/vocab/vocab-print-types";
import { chunkIds, fetchAllRows } from "@/lib/supabase/fetch-all-rows";

const VOCAB_ITEM_PRINT_COLS =
  "id, set_id, word, meaning, part_of_speech, example_sentence, example_meaning, synonyms, antonyms, forms, confusables, order_index, created_at";

export interface VocabSetPrintData {
  set: VocabSet;
  items: VocabItem[];
  passageGroups: VocabPassageGroup[];
}

/**
 * 수업자료(최종통합자료·테스트 교재·수업용 자료)에서 「단어학습에 등록」한 단어장이면, 단어마다 어느 지문 단어인지
 * 찾아 지문별 번호 구간을 만든다. 등록할 때처럼 지문 차례대로, 같은 단어는 처음 나온 지문 것으로 본다.
 * 수업자료에서 만든 단어장이 아니면 빈 목록.
 */
export async function loadVocabPassageGroups(
  supabase: SupabaseClient,
  setId: string,
  items: Pick<VocabItem, "word">[]
): Promise<VocabPassageGroup[]> {
  if (!items.length) return [];
  const { data: docs } = await supabase
    .from("lesson_material_documents")
    .select("project_ids")
    .eq("payload->>vocabSetId", setId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1);
  const ids = ((docs?.[0]?.project_ids as string[] | null) ?? []).filter(Boolean);
  if (!ids.length) return [];
  const { data: projects } = await supabase
    .from("lesson_material_projects")
    .select("id,title,source,words:lesson_pack_json->testBookMaterial->vocab")
    .in("id", ids);
  const byId = new Map((projects ?? []).map((p) => [p.id as string, p] as const));
  const owner = new Map<string, string>();
  const labelOf = new Map<string, string>();
  const metaOf = new Map<string, { source: string | null; title: string | null }>();
  for (const id of ids) {
    const p = byId.get(id);
    if (!p) continue;
    labelOf.set(id, String(p.source || p.title || "지문"));
    metaOf.set(id, { source: (p.source as string | null) ?? null, title: (p.title as string | null) ?? null });
    for (const row of (Array.isArray(p.words) ? p.words : []) as Array<{ word?: unknown }>) {
      const k = String(row?.word ?? "").trim().toLowerCase();
      if (k && !owner.has(k)) owner.set(k, id);
    }
  }
  if (!owner.size) return [];
  // 단어 차례대로 이어진 같은 지문을 한 구간으로. 찾지 못한 단어(나중에 넣은 것)는 앞 구간에 붙인다.
  const groups: Array<VocabPassageGroup & { id: string }> = [];
  items.forEach((it, i) => {
    const id = owner.get(String(it.word ?? "").trim().toLowerCase()) ?? groups.at(-1)?.id ?? null;
    if (!id) return;
    const last = groups.at(-1);
    if (last && last.id === id) last.to = i + 1;
    else groups.push({ id, label: labelOf.get(id) ?? "지문", from: i + 1, to: i + 1 });
  });
  if (groups.length < 2) return [];
  // 한 지문이 여러 토막으로 흩어진 단어장(나중에 더한 낱말이 뒤에 붙은 옛 단어장)은 나누지 않고 한 덩어리로
  if (new Set(groups.map((g) => g.id)).size !== groups.length) return [];
  const seen = new Map<string, number>();
  return groups.map(({ id, label, from, to }) => {
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    return { label: n > 1 ? `${label} (${n})` : label, from, to, ...(metaOf.get(id) ?? {}) };
  });
}

/** RLS가 읽기 권한을 결정한다(강사: 본인 세트 + 잠금 커리큘럼). */
export async function loadVocabSetPrintData(
  supabase: SupabaseClient,
  setId: string
): Promise<VocabSetPrintData | null> {
  const [{ data: set }, items] = await Promise.all([
    supabase.from("vocab_sets").select("*").eq("id", setId).maybeSingle(),
    fetchAllRows<VocabItem>((from, to) =>
      supabase
        .from("vocab_items")
        .select(VOCAB_ITEM_PRINT_COLS)
        .eq("set_id", setId)
        .order("order_index")
        .order("created_at")
        .range(from, to)
    ),
  ]);
  if (!set) return null;

  return {
    set: set as VocabSet,
    items,
    passageGroups: await loadVocabPassageGroups(supabase, setId, items).catch(() => []),
  };
}

async function loadSetsByIds(
  supabase: SupabaseClient,
  setIds: string[]
): Promise<VocabSet[]> {
  const sets: VocabSet[] = [];
  for (const batch of chunkIds(setIds, 80)) {
    const { data, error } = await supabase
      .from("vocab_sets")
      .select("*")
      .in("id", batch);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) sets.push(row as VocabSet);
  }
  return sets;
}

async function loadItemsBySetIds(
  supabase: SupabaseClient,
  setIds: string[]
): Promise<VocabItem[]> {
  const items: VocabItem[] = [];
  for (const batch of chunkIds(setIds, 80)) {
    const batchItems = await fetchAllRows<VocabItem>((from, to) =>
      supabase
        .from("vocab_items")
        .select(VOCAB_ITEM_PRINT_COLS)
        .in("set_id", batch)
        .order("order_index", { ascending: true })
        .order("created_at", { ascending: true })
        .range(from, to)
    );
    items.push(...batchItems);
  }
  return items;
}

export async function loadVocabSetsPrintData(
  supabase: SupabaseClient,
  setIds: string[]
): Promise<VocabPrintSection[]> {
  const uniqueIds = [...new Set(setIds.filter(Boolean))];
  if (uniqueIds.length === 0) return [];

  const sets = await loadSetsByIds(supabase, uniqueIds);
  if (!sets.length) return [];

  const allowedSetIds = sets.map((s) => s.id);
  const items = await loadItemsBySetIds(supabase, allowedSetIds);

  const itemsBySet = new Map<string, VocabItem[]>();
  for (const item of items) {
    const sid = item.set_id;
    const list = itemsBySet.get(sid) ?? [];
    list.push(item);
    itemsBySet.set(sid, list);
  }

  for (const [sid, list] of itemsBySet) {
    list.sort((a, b) => {
      if (a.order_index !== b.order_index) return a.order_index - b.order_index;
      return a.created_at.localeCompare(b.created_at);
    });
    itemsBySet.set(sid, list);
  }

  const setById = new Map(sets.map((s) => [s.id, s]));
  const sections: VocabPrintSection[] = [];

  for (const setId of uniqueIds) {
    const set = setById.get(setId);
    const setItems = itemsBySet.get(setId);
    if (!set || !setItems?.length) continue;
    sections.push({
      setId: set.id,
      title: set.title,
      description: set.description,
      items: setItems,
    });
  }

  return sections;
}
