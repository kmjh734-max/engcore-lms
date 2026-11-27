/** Supabase/PostgREST caps each response at 1000 rows by default. */
export const SUPABASE_PAGE_SIZE = 1000;

type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

/**
 * Drain a Supabase select past the default 1000-row cap via `.range()`.
 * `query` should return a fresh builder each call (filters/order already applied).
 */
export async function fetchAllRows<T>(
  query: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = SUPABASE_PAGE_SIZE
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await query(from, to);
    if (error) throw new Error(error.message);
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return rows;
}

/** Chunk `.in()` filters to keep request URLs under gateway limits. */
export function chunkIds<T>(ids: T[], size = 80): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    out.push(ids.slice(i, i + size));
  }
  return out;
}

/**
 * fetchAllRows 와 같되 오류가 나면 던지지 않고 읽은 데까지 돌려준다
 * (예전 `const { data } = await q` 처럼 오류를 빈 값으로 넘기던 자리를 바꿀 때 — 동작이 거칠어지지 않게).
 * 순서가 같은 행이 여러 페이지에 걸쳐 흔들리지 않도록 query 에 고유한 순서(.order("id") 등)를 붙일 것.
 */
export async function fetchAllRowsSoft<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = SUPABASE_PAGE_SIZE
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query(from, from + pageSize - 1);
    if (error || !data) break;
    rows.push(...(data as T[]));
    if (data.length < pageSize) break;
  }
  return rows;
}

/**
 * 끝까지 읽되 결과를 `{ data, error }` 꼴로 — 예전 `const { data, error } = await q` 자리를 그대로 바꿀 때.
 * 오류가 나면 data 는 읽은 데까지, error 는 그 오류.
 */
export async function pageRows<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = SUPABASE_PAGE_SIZE
): Promise<{ data: T[]; error: { message: string } | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query(from, from + pageSize - 1);
    if (error) return { data: rows, error };
    const chunk = (data ?? []) as T[];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return { data: rows, error: null };
}
