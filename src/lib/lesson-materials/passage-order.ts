import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 자료(파일)에 들어가는 지문 차례를 폴더의 지문 차례로 맞춘다(선생님 2026-11-06: 테스트지·교재에서
 * 지문 순서가 섞인다). 누른 차례·나중에 붙인 지문 때문에 파일마다 차례가 달랐다.
 *
 * - 폴더가 여럿이면 폴더는 처음 나온 차례 그대로, 폴더 안에서는 order_index → 만든 때.
 * - 지문 정보를 못 읽은 id는 맨 뒤에 원래 차례로 둔다.
 */
export type PassageOrderMeta = { id: string; folder_id: string | null; order_index: number | null; created_at: string | null };

export function orderIdsByPassage(ids: string[], metas: PassageOrderMeta[]): string[] {
  const unique = [...new Set(ids)];
  const meta = new Map(metas.map((m) => [m.id, m] as const));
  const folderRank = new Map<string, number>();
  for (const id of unique) {
    const m = meta.get(id);
    if (!m) continue;
    const f = m.folder_id ?? "";
    if (!folderRank.has(f)) folderRank.set(f, folderRank.size);
  }
  const known = unique.filter((id) => meta.has(id));
  const unknown = unique.filter((id) => !meta.has(id));
  const pos = new Map(unique.map((id, i) => [id, i] as const));
  known.sort((a, b) => {
    const ma = meta.get(a)!;
    const mb = meta.get(b)!;
    return (
      folderRank.get(ma.folder_id ?? "")! - folderRank.get(mb.folder_id ?? "")! ||
      (ma.order_index ?? 0) - (mb.order_index ?? 0) ||
      (Date.parse(ma.created_at ?? "") || 0) - (Date.parse(mb.created_at ?? "") || 0) ||
      pos.get(a)! - pos.get(b)!
    );
  });
  return [...known, ...unknown];
}

export async function sortProjectIdsByPassageOrder(supabase: SupabaseClient, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
  if (unique.length < 2) return unique;
  const metas: PassageOrderMeta[] = [];
  for (let i = 0; i < unique.length; i += 200) {
    const { data } = await supabase
      .from("lesson_material_projects")
      .select("id,folder_id,order_index,created_at")
      .in("id", unique.slice(i, i + 200));
    metas.push(...((data ?? []) as PassageOrderMeta[]));
  }
  return orderIdsByPassage(unique, metas);
}

/** 원소가 어느 지문 것인지(워크북 칸: projectId, 문장 순서: passageId) */
function passageKey(el: unknown): string | null {
  if (!el || typeof el !== "object") return null;
  const o = el as { projectId?: unknown; passageId?: unknown };
  if (typeof o.projectId === "string" && o.projectId) return o.projectId;
  if (typeof o.passageId === "string" && o.passageId) return o.passageId;
  return null;
}

function sortList(list: unknown[], rank: Map<string, number>): unknown[] {
  if (!list.length || !list.every((el) => passageKey(el) != null)) return list;
  const big = Number.MAX_SAFE_INTEGER;
  return list
    .map((el, i) => ({ el, i, r: rank.get(passageKey(el)!) ?? big }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.el);
}

/**
 * 저장된 자료 안의 지문별 칸(워크북 유형별 칸·tbSections.유형 등 두 단계까지)을 지문 차례대로 다시 늘어놓는다.
 * 지문 열쇠가 없는 배열(유형 목록·단어 시험 칸 등)은 그대로 둔다.
 */
export function reorderPayloadByPassage<T>(payload: T, orderedIds: string[]): T {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const rank = new Map(orderedIds.map((id, i) => [id, i] as const));
  const walk = (o: Record<string, unknown>, depth: number): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...o };
    for (const [k, v] of Object.entries(o)) {
      if (Array.isArray(v)) out[k] = sortList(v, rank);
      else if (depth < 1 && v && typeof v === "object") out[k] = walk(v as Record<string, unknown>, depth + 1);
    }
    return out;
  };
  return walk(payload as Record<string, unknown>, 0) as T;
}

/** 자료 안 지문별 칸에 나오는 지문 id(차례대로, 겹치면 한 번) */
export function payloadPassageIds(payload: unknown): string[] {
  const out: string[] = [];
  const walk = (o: unknown, depth: number) => {
    if (!o || typeof o !== "object" || Array.isArray(o)) return;
    for (const v of Object.values(o as Record<string, unknown>)) {
      if (Array.isArray(v)) for (const el of v) { const k = passageKey(el); if (k) out.push(k); }
      else if (depth < 1) walk(v, depth + 1);
    }
  };
  walk(payload, 0);
  return [...new Set(out)];
}
