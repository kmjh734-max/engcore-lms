import type { SupabaseClient } from "@supabase/supabase-js";
import { getKoreaYearMonth, parseKoreaMonthParam } from "@/lib/date/korea-today";
import { fetchPagesParallel } from "@/lib/fetch-pages";
import { createAdminClient } from "@/lib/supabase/admin";
import { expireAcademyCredits } from "@/lib/credits";
import {
  cleanCreditText,
  featureGroup,
  featureLabel,
  featurePriceUnit,
  featureUnit,
  featureUsageText,
  usedForLabel,
} from "@/lib/credits/feature-labels";

export type CreditKind = "use" | "charge" | "grant" | "adjust" | "refund";

export interface CreditTxnView {
  id: string;
  createdAt: string;
  kind: CreditKind;
  /** 부호 포함 (+ 들어옴, − 나감) */
  delta: number;
  balanceAfter: number;
  text: string;
  /** 어느 자료에 썼나(지문 제목·변형문제 작업 이름·워크북 이름 등). 모르면 null */
  material: string | null;
  /**
   * 작업 한 번을 한 줄로 묶었을 때의 세부 차감(선생님 2026-11-28 「한 번 작업당 크레딧, 지금은 너무 세분화」).
   * 두 줄 이상 묶였을 때만 있다.
   */
  parts?: { id: string; createdAt: string; delta: number; text: string; material: string | null }[];
}

/** 같은 작업으로 볼 차감 사이 간격(워크북 하나는 지문·유형마다 1분 안팎으로 나눠 차감된다) */
const SAME_WORK_GAP_MS = 5 * 60_000;

export interface CreditReceiptView {
  id: string;
  at: string;
  name: string;
  paymentAmount: number;
  totalCredit: number;
  bonusCredit: number;
  status: string;
  receiptUrl: string | null;
}

export interface CreditPriceView {
  key: string;
  label: string;
  unit: string;
  cost: number;
}

export interface CreditsPageData {
  balance: number;
  thisMonth: { year: number; month: number; used: number; charged: number };
  /** 이번 달 쓰는 속도로 남은 크레딧을 쓸 수 있는 주 수 */
  weeksLeft: number | null;
  usageGroups: { label: string; amount: number }[];
  selectedMonth: string;
  monthOptions: { value: string; label: string }[];
  transactions: CreditTxnView[];
  receipts: CreditReceiptView[] | null;
  prices: CreditPriceView[];
}

type RawTxn = {
  id: string;
  type: string;
  amount: number;
  balance_after: number;
  feature_key: string | null;
  note: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function monthStartUtc(year: number, month: number): string {
  return new Date(`${monthKey(year, month)}-01T00:00:00+09:00`).toISOString();
}

function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

function toKind(t: RawTxn): { kind: CreditKind; sign: 1 | -1 } {
  switch (t.type) {
    case "debit":
      return { kind: "use", sign: -1 };
    case "charge":
      return { kind: "charge", sign: 1 };
    case "grant":
      return { kind: "grant", sign: 1 };
    case "refund":
      return { kind: "refund", sign: -1 };
    default:
      return {
        kind: "adjust",
        sign: (t.metadata?.direction as string | undefined) === "debit" ? -1 : 1,
      };
  }
}

async function loadMonthTxns(
  supabase: SupabaseClient,
  academyId: string,
  year: number,
  month: number
): Promise<RawTxn[]> {
  const next = nextMonth(year, month);
  try {
    // 한 달 거래가 1000건을 넘으면 나머지 쪽은 차례로가 아니라 동시에 읽는다
    return await fetchPagesParallel<RawTxn>((from, to, withCount) =>
      supabase
        .from("credit_transactions")
        .select(
          "id, type, amount, balance_after, feature_key, note, metadata, created_at",
          withCount ? { count: "exact" } : undefined
        )
        .eq("academy_id", academyId)
        .gte("created_at", monthStartUtc(year, month))
        .lt("created_at", monthStartUtc(next.year, next.month))
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)
    );
  } catch {
    return [];
  }
}

/** 쓴 내역마다 「어느 자료에 썼나」 이름을 찾는다(선생님 2026-11-26). 행에 남은 id로 한 번씩만 묻는다. */
async function loadMaterialNames(
  academyId: string,
  txns: RawTxn[]
): Promise<(t: RawTxn) => string | null> {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const projectIds = new Set<string>();
  const jobIds = new Set<string>();
  const analysisIds = new Set<string>();
  const setIds = new Set<string>();
  for (const t of txns) {
    if (t.type !== "debit") continue;
    const m = t.metadata ?? {};
    if (str(m.material_name)) continue;
    const job = str(m.job_id);
    const analysis = str(m.analysis_id);
    const project = str(m.project_id);
    const set = str(m.set_id);
    if (job) jobIds.add(job);
    else if (analysis) analysisIds.add(analysis);
    else if (project) projectIds.add(project);
    else if (set) setIds.add(set);
    else if (Array.isArray(m.project_ids)) {
      const first = str(m.project_ids[0]);
      if (first) projectIds.add(first);
    }
  }
  const admin = createAdminClient();
  const chunk = (ids: Set<string>): string[][] => {
    const all = [...ids];
    const out: string[][] = [];
    for (let i = 0; i < all.length; i += 200) out.push(all.slice(i, i + 200));
    return out;
  };
  const names = new Map<string, string>();
  const tasks: Promise<void>[] = [];
  for (const ids of chunk(projectIds))
    tasks.push(
      (async () => {
        const { data } = await admin
          .from("lesson_material_projects")
          .select("id, title, source")
          .eq("academy_id", academyId)
          .in("id", ids);
        // 출처가 있으면 출처를 앞에(선생님 2026-11-26 「출처도 뜨도록」)
        for (const r of data ?? []) {
          const title = String(r.title ?? "").trim();
          const source = String(r.source ?? "").trim();
          const name = source && title && source !== title ? `${source} · ${title}` : source || title;
          if (name) names.set(r.id as string, name);
        }
      })()
    );
  for (const ids of chunk(jobIds))
    tasks.push(
      (async () => {
        const { data } = await admin
          .from("question_generation_jobs")
          .select("id, title:request_config->>title")
          .eq("academy_id", academyId)
          .in("id", ids);
        for (const r of (data ?? []) as Array<{ id: string; title: string | null }>)
          if (r.title) names.set(r.id, r.title.trim());
      })()
    );
  for (const ids of chunk(analysisIds))
    tasks.push(
      (async () => {
        const { data } = await admin
          .from("school_exam_analyses")
          .select("id, school_name, grade, subject, exam_label")
          .eq("academy_id", academyId)
          .in("id", ids);
        for (const r of data ?? []) {
          const g = r.grade != null && String(r.grade).trim() ? String(r.grade).trim() : "";
          const name = [
            r.school_name,
            g ? (/^\d+$/.test(g) ? `${g}학년` : g) : "",
            r.subject,
            r.exam_label,
          ]
            .map((x) => (x == null ? "" : String(x).trim()))
            .filter(Boolean)
            .join(" ");
          if (name) names.set(r.id as string, name);
        }
      })()
    );
  for (const ids of chunk(setIds))
    tasks.push(
      (async () => {
        const { data } = await admin
          .from("listening_sets")
          .select("id, title")
          .eq("academy_id", academyId)
          .in("id", ids);
        for (const r of data ?? []) if (r.title) names.set(r.id as string, String(r.title));
      })()
    );
  // 예전 테스트지 뽑기(11-26 전)는 id가 없다 — 뽑자마자 저장한 파일(몇 초 뒤)의 이름으로 찾는다
  const oldDraws = txns.filter(
    (t) => t.type === "debit" && t.feature_key === "lesson_test_draw" && !str(t.metadata?.material_name)
  );
  const drawDocs: Array<{ at: number; name: string }> = [];
  if (oldDraws.length) {
    const times = oldDraws.map((t) => Date.parse(t.created_at));
    tasks.push(
      (async () => {
        const { data } = await admin
          .from("lesson_material_documents")
          .select("name, created_at")
          .eq("academy_id", academyId)
          .eq("kind", "test_draw")
          .gte("created_at", new Date(Math.min(...times)).toISOString())
          .lte("created_at", new Date(Math.max(...times) + 120_000).toISOString())
          .limit(1000);
        for (const r of data ?? [])
          if (r.name) drawDocs.push({ at: Date.parse(r.created_at as string), name: String(r.name) });
      })()
    );
  }
  try {
    await Promise.all(tasks);
  } catch {
    // 이름을 못 찾아도 내역은 그대로 보인다
  }

  return (t) => {
    if (t.type !== "debit") return null;
    const m = t.metadata ?? {};
    const own = str(m.material_name);
    if (own) return own;
    for (const key of ["job_id", "analysis_id", "project_id", "set_id"]) {
      const id = str(m[key]);
      if (id && names.has(id)) return names.get(id)!;
    }
    if (t.feature_key === "lesson_test_draw" && drawDocs.length) {
      const at = Date.parse(t.created_at);
      let best: { at: number; name: string } | null = null;
      for (const d of drawDocs)
        if (d.at >= at && d.at - at <= 120_000 && (!best || d.at < best.at)) best = d;
      if (best) return best.name;
    }
    if (Array.isArray(m.project_ids)) {
      const first = str(m.project_ids[0]);
      const title = first ? names.get(first) : undefined;
      if (title) {
        const n = Number(m.passage_count ?? m.project_ids.length) || 1;
        return n > 1 ? `${title} 외 ${n - 1}지문` : title;
      }
    }
    return null;
  };
}

export async function loadCreditsPageData(
  supabase: SupabaseClient,
  opts: { academyId: string; monthParam?: string; canCharge: boolean }
): Promise<CreditsPageData> {
  const now = getKoreaYearMonth();
  const selected = parseKoreaMonthParam(opts.monthParam, now);
  const isCurrent = selected.year === now.year && selected.month === now.month;

  // 1년 지난 크레딧은 잔액을 읽기 전에 소멸시켜 화면과 내역이 맞게 한다
  await expireAcademyCredits(createAdminClient(), opts.academyId);

  const [walletRes, currentTxns, selectedTxns, pricingRes, ordersRes] = await Promise.all([
    supabase
      .from("academy_wallets")
      .select("balance")
      .eq("academy_id", opts.academyId)
      .maybeSingle(),
    loadMonthTxns(supabase, opts.academyId, now.year, now.month),
    isCurrent
      ? Promise.resolve(null)
      : loadMonthTxns(supabase, opts.academyId, selected.year, selected.month),
    supabase
      .from("feature_pricing")
      .select("feature_key, label, credit_cost, billing_type")
      .eq("is_active", true)
      .order("feature_key"),
    opts.canCharge
      ? supabase
          .from("credit_payment_orders")
          .select(
            "id, payment_amount, bonus_credit, total_credit, status, receipt_url, approved_at, created_at, package:credit_packages(name)"
          )
          .eq("academy_id", opts.academyId)
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: null }),
  ]);

  const balance = Number(walletRes.data?.balance ?? 0);
  const dbLabels = new Map<string, string>();
  for (const p of pricingRes.data ?? []) {
    dbLabels.set(p.feature_key as string, p.label as string);
  }

  type OrderRow = {
    id: string;
    payment_amount: number;
    bonus_credit: number;
    total_credit: number;
    status: string;
    receipt_url: string | null;
    approved_at: string | null;
    created_at: string;
    package: { name: string } | { name: string }[] | null;
  };
  const orders = (ordersRes.data ?? null) as OrderRow[] | null;
  const packageNameByOrder = new Map<string, string>();
  const receipts: CreditReceiptView[] | null = orders
    ? orders.map((o) => {
        const pkg = Array.isArray(o.package) ? o.package[0] : o.package;
        const name = pkg?.name ? cleanCreditText(pkg.name) : "크레딧 충전";
        packageNameByOrder.set(o.id, name);
        return {
          id: o.id,
          at: o.approved_at || o.created_at,
          name,
          paymentAmount: Number(o.payment_amount),
          totalCredit: Number(o.total_credit),
          bonusCredit: Number(o.bonus_credit),
          status: o.status,
          receiptUrl: o.receipt_url,
        };
      })
    : null;

  const materialOf = await loadMaterialNames(opts.academyId, selectedTxns ?? currentTxns);

  function view(t: RawTxn): CreditTxnView {
    const { kind, sign } = toKind(t);
    const meta = t.metadata ?? {};
    let text: string;
    if (kind === "use") {
      const qty = Number(meta.quantity ?? 0) || null;
      text = featureUsageText(
        t.feature_key,
        qty,
        t.feature_key ? dbLabels.get(t.feature_key) : null,
        meta.used_for
      );
    } else if (kind === "charge") {
      const bonus = Number(meta.bonus_credit ?? 0);
      const orderId = meta.payment_order_id as string | undefined;
      const name = (orderId && packageNameByOrder.get(orderId)) || "크레딧 충전";
      text = bonus > 0 ? `${name} (보너스 +${bonus.toLocaleString("ko-KR")})` : name;
    } else if (kind === "refund") {
      text = "결제 취소";
    } else if (kind === "grant") {
      text = (t.note && cleanCreditText(t.note)) || "크레딧 지급";
    } else {
      const note = t.note && !["grant", "debit"].includes(t.note) ? cleanCreditText(t.note) : "";
      text = note || (t.feature_key ? featureLabel(t.feature_key, dbLabels.get(t.feature_key)) : "잔액 조정");
    }
    return {
      id: t.id,
      createdAt: t.created_at,
      kind,
      delta: sign * Number(t.amount),
      balanceAfter: Number(t.balance_after),
      text,
      material: materialOf(t),
    };
  }

  /**
   * 작업 한 번 = 한 줄. 변형문제는 작업 id 로, 나머지는 같은 기능 묶음(·같은 화면)이
   * 몇 분 안에 잇달아 차감된 것을 한 작업으로 본다. 충전·지급 등은 그대로 한 줄씩.
   */
  function workKey(t: RawTxn): string | null {
    if (t.type !== "debit") return null;
    const m = t.metadata ?? {};
    const job = typeof m.job_id === "string" && m.job_id ? m.job_id : "";
    if (job) return `job:${job}`;
    // 화면 표시(used_for)는 같은 워크북 안에서도 붙은 줄·안 붙은 줄이 섞여 있어 묶음 기준에서 뺀다
    return `grp:${featureGroup(t.feature_key)}`;
  }

  function groupWork(raw: RawTxn[]): CreditTxnView[] {
    const out: CreditTxnView[] = [];
    let run: RawTxn[] = [];
    const flush = () => {
      if (!run.length) return;
      if (run.length === 1) out.push(view(run[0]!));
      else out.push(mergeRun(run));
      run = [];
    };
    for (const t of raw) {
      const k = workKey(t);
      const prev = run[run.length - 1];
      const same =
        k != null &&
        prev != null &&
        workKey(prev) === k &&
        (k.startsWith("job:") ||
          Math.abs(Date.parse(prev.created_at) - Date.parse(t.created_at)) <= SAME_WORK_GAP_MS);
      if (!same) flush();
      if (k == null) out.push(view(t));
      else run.push(t);
    }
    flush();
    return out;
  }

  function mergeRun(run: RawTxn[]): CreditTxnView {
    // raw 는 최근 것이 앞이다 — 첫 줄이 작업이 끝난 때·그 뒤 잔액
    const parts = run.map(view);
    const head = run[0]!;
    const meta = head.metadata ?? {};
    const isJob = typeof meta.job_id === "string" && !!meta.job_id;
    const where = run.map((t) => usedForLabel(t.metadata?.used_for)).find(Boolean) ?? "";
    const keys = new Set(run.map((t) => t.feature_key));
    const oneKey = keys.size === 1 ? head.feature_key : null;
    // 한 기능만 여러 번이면 그 기능 이름, 섞였으면 화면(워크북 등)이나 묶음 이름
    const title = oneKey
      ? `${where ? `${where} · ` : ""}${featureLabel(oneKey, dbLabels.get(oneKey ?? ""))}`
      : where || featureGroup(head.feature_key);
    // 수량: 모두 「문항」이면 문항 수를 더하고, 아니면 지문 수(자료 id 가짓수)
    const units = new Set(run.map((t) => featureUnit(t.feature_key)));
    let count = "";
    if (oneKey && featureUnit(oneKey) && featureUnit(oneKey) !== "문항") {
      const q = run.reduce((s, t) => s + (Number(t.metadata?.quantity ?? 0) || 0), 0);
      if (q > 0) count = `${q.toLocaleString("ko-KR")}${featureUnit(oneKey)}`;
    } else if (units.size === 1 && units.has("문항")) {
      const q = run.reduce((s, t) => s + (Number(t.metadata?.quantity ?? 0) || 0), 0);
      if (q > 0) count = `${q.toLocaleString("ko-KR")}문항`;
    } else {
      const ids = new Set(
        run.map((t) => t.metadata?.project_id).filter((v): v is string => typeof v === "string" && !!v)
      );
      if (ids.size > 0) count = `${ids.size.toLocaleString("ko-KR")}지문`;
    }
    // 자료 이름: 작업 이름 → 직접 적힌 이름 → 지문 이름(여러 개면 「외 n지문」)
    let material: string | null = null;
    if (isJob) material = parts.find((p) => p.material)?.material ?? null;
    if (!material) {
      const named = run.find((t) => typeof t.metadata?.material_name === "string" && t.metadata.material_name);
      if (named) material = String(named.metadata!.material_name);
    }
    if (!material) {
      const names = [...new Set(parts.map((p) => p.material).filter((x): x is string => !!x))];
      if (names.length) material = names.length > 1 ? `${names[0]} 외 ${names.length - 1}지문` : names[0]!;
    }
    return {
      id: head.id,
      createdAt: head.created_at,
      kind: "use",
      delta: parts.reduce((s, p) => s + p.delta, 0),
      balanceAfter: Number(head.balance_after),
      text: count ? `${title} · ${count}` : title,
      material,
      parts: parts.map((p) => ({ id: p.id, createdAt: p.createdAt, delta: p.delta, text: p.text, material: p.material })),
    };
  }

  // 이번 달 요약
  let used = 0;
  let charged = 0;
  const groups = new Map<string, number>();
  for (const t of currentTxns) {
    const { kind, sign } = toKind(t);
    const amount = Number(t.amount);
    if (kind === "use" || (kind === "adjust" && sign < 0)) {
      used += amount;
      const g = kind === "use" ? featureGroup(t.feature_key) : "기타";
      groups.set(g, (groups.get(g) ?? 0) + amount);
    } else if (kind === "charge" || kind === "grant") {
      charged += amount;
    }
  }
  const sortedGroups = [...groups.entries()]
    .filter(([label]) => label !== "기타")
    .sort((a, b) => b[1] - a[1]);
  const other =
    (groups.get("기타") ?? 0) + sortedGroups.slice(5).reduce((s, [, v]) => s + v, 0);
  const usageGroups = sortedGroups.slice(0, 5).map(([label, amount]) => ({ label, amount }));
  if (other > 0) usageGroups.push({ label: "기타", amount: other });

  const dayOfMonth = Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", day: "2-digit" }).format(new Date())
  );
  const perWeek = (used / Math.max(dayOfMonth, 1)) * 7;
  const weeksLeft = used > 0 && perWeek > 0 ? Math.floor(balance / perWeek) : null;

  const monthOptions: { value: string; label: string }[] = [];
  let y = now.year;
  let m = now.month;
  for (let i = 0; i < 12; i++) {
    monthOptions.push({ value: monthKey(y, m), label: `${y}년 ${m}월` });
    if (m === 1) {
      y -= 1;
      m = 12;
    } else m -= 1;
  }
  const selectedKey = monthKey(selected.year, selected.month);
  if (!monthOptions.some((o) => o.value === selectedKey)) {
    monthOptions.push({ value: selectedKey, label: `${selected.year}년 ${selected.month}월` });
  }

  const prices: CreditPriceView[] = (pricingRes.data ?? [])
    .filter((p) => Number(p.credit_cost) > 0)
    .map((p) => ({
      key: p.feature_key as string,
      label: featureLabel(p.feature_key as string, p.label as string),
      unit: featurePriceUnit(p.feature_key as string, p.billing_type as string),
      cost: Number(p.credit_cost),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "ko"));

  return {
    balance,
    thisMonth: { year: now.year, month: now.month, used, charged },
    weeksLeft,
    usageGroups,
    selectedMonth: selectedKey,
    monthOptions,
    transactions: groupWork(selectedTxns ?? currentTxns),
    receipts,
    prices,
  };
}
