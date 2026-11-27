import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";

/**
 * 수업자료 하나(lesson_material_projects) = 지문 하나. 지문은 문장 단위(lesson_material_items)로 나뉘어
 * 저장되어 있으므로 순서대로 이어 붙여 한 지문으로 만든다.
 */
export type MaterialPassageFull = {
  projectId: string;
  /** 대조 결과를 걸 첫 문장 id (school_exam_items.matched_item_id) */
  firstItemId: string;
  folder: string;
  title: string;
  /** 자료에 적어 둔 출처 (예: 공통영어2 YBM(박준언) 1과 본문1). 없으면 빈 글 */
  source: string;
  text: string;
  updatedAt: string;
};

export async function loadAcademyMaterialPassages(
  admin: SupabaseClient,
  academyId: string,
  projectIds?: string[]
): Promise<MaterialPassageFull[]> {
  // 1,000개 상한을 넘겨 끝까지 읽는다
  type ProjectRow = { id: string; title: string | null; source: string | null; updated_at: string | null; folder: { name: string } | { name: string }[] | null };
  const list = await fetchAllRows<ProjectRow>((from, to) => {
    let pq = admin
      .from("lesson_material_projects")
      .select("id, title, source, updated_at, folder:lesson_material_folders(name)")
      .eq("academy_id", academyId);
    if (projectIds?.length) pq = pq.in("id", projectIds);
    return pq.order("id").range(from, to);
  });
  if (list.length === 0) return [];

  /*
   * 문장 조각은 많을 수 있어 여러 번에 나눠 읽는다.
   * 서버는 한 번에 1,000줄까지만 돌려준다 — 200지문씩 읽으면 뒤쪽 문장이 잘려 지문이 짧아졌다
   * (10-14: 7문장 본문이 4문장으로 읽힘). 1,000줄씩 끊어 끝까지 읽는다.
   */
  const ids = list.map((p) => p.id as string);
  const items: { id: string; project_id: string; english_text: string; order_index: number }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    for (let from = 0; ; from += 1000) {
      const { data } = await admin
        .from("lesson_material_items")
        .select("id, project_id, english_text, order_index")
        .in("project_id", ids.slice(i, i + 200))
        .order("id")
        .range(from, from + 999);
      items.push(...((data ?? []) as typeof items));
      if (!data || data.length < 1000) break;
    }
  }
  const byProject = new Map<string, typeof items>();
  for (const it of items) byProject.set(it.project_id, [...(byProject.get(it.project_id) ?? []), it]);

  return list
    .map((p) => {
      const rows = (byProject.get(p.id as string) ?? []).sort((a, b) => a.order_index - b.order_index);
      const folder = Array.isArray(p.folder) ? p.folder[0] : p.folder;
      return {
        projectId: p.id as string,
        firstItemId: rows[0]?.id ?? "",
        folder: (folder?.name as string | undefined) ?? "미분류",
        title: (p.title as string) || "수업자료",
        source: String(p.source ?? "").trim(),
        text: rows.map((r) => String(r.english_text ?? "").trim()).filter(Boolean).join(" "),
        updatedAt: String(p.updated_at ?? ""),
      };
    })
    .filter((p) => p.firstItemId && p.text);
}

/** 「공통영어2 NE능률(오선영) 2과 본문7」 → 「공통영어2 NE능률(오선영) 2과」. 본문 번호가 없으면 빈 글 */
function unitOfSource(source: string): string {
  const m = source.match(/^(.*?)\s*본문\s*\d+\s*$/);
  return m ? m[1]!.trim() : "";
}

/**
 * 짧은 본문은 같은 과의 앞 본문을 붙여 쓴다(동형 만들기용, 수업자료는 그대로 둔다).
 *
 * 10-14 점검: 교과서 한 과를 본문1~8로 나눠 둔 수업자료에서 2~4문장짜리 본문이 그대로 동형 지문이 됐다.
 * 「These two examples…」「In the end, …」가 가리키는 앞 내용이 지문에 없어 주제·제목·요지가 흔들렸고,
 * 하 문장삽입·내용일치는 「5문장뿐」「사실 부족」으로 다른 유형으로 바뀌었다(경민고1 4~8차).
 * 앞 본문을 붙이는 까닭은 지시어·연결어가 앞을 가리키기 때문이다. 과의 첫 본문이면 뒤 본문을 붙인다.
 */
export async function extendShortMaterialPassages(
  admin: SupabaseClient,
  academyId: string,
  passages: MaterialPassageFull[],
  countSentences: (text: string) => number,
  minSentences = 5
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const short = passages.filter((p) => unitOfSource(p.source) && countSentences(p.text) < minSentences);
  if (short.length === 0) return out;

  const sources = await sourcesOfUnits(admin, academyId, short);
  const { data: projects } = await admin
    .from("lesson_material_projects")
    .select("id, folder_id, source, order_index, deleted_at")
    .eq("academy_id", academyId)
    .in("source", sources)
    .limit(2000);
  const live = (projects ?? []).filter((p) => !p.deleted_at);
  const byId = new Map(live.map((p) => [p.id as string, p]));
  const siblings = await loadAcademyMaterialPassages(admin, academyId, live.map((p) => p.id as string));
  const textOf = new Map(siblings.map((s) => [s.projectId, s.text]));

  for (const p of short) {
    const me = byId.get(p.projectId);
    if (!me) continue;
    const unit = unitOfSource(p.source);
    const chain = live
      .filter((x) => x.folder_id === me.folder_id && unitOfSource(String(x.source ?? "")) === unit && textOf.get(x.id as string))
      .sort((a, b) => Number(a.order_index) - Number(b.order_index));
    const at = chain.findIndex((x) => x.id === p.projectId);
    if (at < 0) continue;
    let lo = at;
    let hi = at;
    const joined = () => chain.slice(lo, hi + 1).map((x) => textOf.get(x.id as string)!).join(" ");
    while (countSentences(joined()) < minSentences && (lo > 0 || hi < chain.length - 1)) {
      if (lo > 0) lo -= 1;
      else hi += 1;
    }
    if (lo !== at || hi !== at) out.set(p.projectId, joined());
  }
  return out;
}

/** 짧은 본문들이 속한 과의 모든 본문 출처 이름 */
async function sourcesOfUnits(admin: SupabaseClient, academyId: string, short: MaterialPassageFull[]): Promise<string[]> {
  const units = new Set(short.map((p) => unitOfSource(p.source)));
  const data = await fetchAllRows<{ source: string | null }>((from, to) =>
    admin
      .from("lesson_material_projects")
      .select("source")
      .eq("academy_id", academyId)
      .like("source", "%본문%")
      .order("id")
      .range(from, to)
  );
  return [...new Set(data.map((r) => String(r.source ?? "")).filter((s) => units.has(unitOfSource(s))))];
}
