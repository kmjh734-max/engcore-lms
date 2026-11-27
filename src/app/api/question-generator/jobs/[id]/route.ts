import { after } from "next/server";
import {
  jsonError,
  jsonOk,
  requireStaffProfile,
} from "@/lib/question-generator/api-helpers";
import {
  resumeGenerationJobIfIdle,
  runGenerationChunkAndChain,
} from "@/lib/question-generator/job-chain";
import { isGenerationJobStale } from "@/lib/question-generator/run-generation-job";
import { CREDIT_FEATURES } from "@/lib/credits/charge";
import { lessonCreditShortfall } from "@/lib/credits/lesson-credits";
import type { GenerationRequestConfig } from "@/lib/question-generator/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { pageRows } from "@/lib/supabase/fetch-all-rows";

export const maxDuration = 300;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireStaffProfile();
    const { id } = await ctx.params;
    const supabase = await createClient();
    const origin = new URL(req.url).origin;

    // 진행 막대용 가벼운 조회: 문항·지문 본문 없이 상태만 (몇 초마다 불린다)
    // poll=1: 생성 중 상세 화면용 — 상태 + 문항 id 순서 + since 이후 새 문항만 (지문 본문·옛 문항 다시 안 보냄)
    const sp = new URL(req.url).searchParams;
    const pollMode = sp.get("poll") === "1";
    if (sp.get("lite") === "1" || pollMode) {
      let liteQuery = supabase
        .from("question_generation_jobs")
        .select(
          "id,status,progress_message,total_completed,total_requested,total_failed,error_message,created_at,title:request_config->>title,run:request_config->_run,english_source_passages(title)"
        )
        .eq("id", id);
      if (profile.role === "teacher") liteQuery = liteQuery.eq("created_by", profile.id);
      const { data: lite, error: liteErr } = await liteQuery.single();
      if (liteErr || !lite) return jsonError("작업을 찾을 수 없습니다.", 404);
      const row = lite as Record<string, unknown>;
      const resumeLite = resumeGenerationJobIfIdle(
        {
          id: String(row.id),
          status: String(row.status),
          created_at: row.created_at as string | null,
          total_completed: row.total_completed as number | null,
          request_config: { _run: row.run ?? undefined },
        },
        origin
      );
      if (resumeLite) after(resumeLite);
      const { run: _run, title, ...rest } = row;
      void _run;
      if (!pollMode) return jsonOk({ job: { ...rest, request_config: { title } } });

      // 순서(id만)는 매번 전부, 본문이 있는 행은 since 이후 것만
      // 1000문항 넘는 작업도 끝까지(한 번에 1000행까지만 온다)
      const orderPage = await pageRows<{ id: string; slot_index: number | null; passage_id: string | null }>(
        (from, to) => {
          let q = supabase
            .from("generated_english_questions")
            .select("id,slot_index,passage_id")
            .eq("generation_job_id", id)
            .neq("status", "archived")
            .order("slot_index", { ascending: true, nullsFirst: false })
            .order("created_at", { ascending: true })
            .order("id", { ascending: true });
          if (profile.role === "teacher") q = q.eq("created_by", profile.id);
          return q.range(from, to);
        }
      );
      if (orderPage.error) return jsonError("조회에 실패했습니다.", 500);
      const orderRows = orderPage.data;
      const { data: cfgRow } = await supabase
        .from("question_generation_jobs")
        .select("passageIds:request_config->passageIds")
        .eq("id", id)
        .single();
      const pollInputIds = ((cfgRow as { passageIds?: unknown } | null)?.passageIds ?? []) as unknown;
      const pollRank = new Map<string, number>();
      (Array.isArray(pollInputIds) ? pollInputIds : []).forEach((pid, i) => {
        if (typeof pid === "string" && !pollRank.has(pid)) pollRank.set(pid, i);
      });
      const order = (orderRows ?? [])
        .map((q, i) => ({ q, i }))
        .sort((a, b) => {
          const sa = a.q.slot_index as number | null;
          const sb = b.q.slot_index as number | null;
          if (sa != null || sb != null) return a.i - b.i;
          const ra = pollRank.get(String(a.q.passage_id ?? "")) ?? Number.MAX_SAFE_INTEGER;
          const rb = pollRank.get(String(b.q.passage_id ?? "")) ?? Number.MAX_SAFE_INTEGER;
          return ra - rb || a.i - b.i;
        })
        .map((x) => String(x.q.id));

      const since = sp.get("since");
      const newPage = await pageRows<Record<string, unknown>>((from, to) => {
        let q = supabase
          .from("generated_english_questions")
          .select("*")
          .eq("generation_job_id", id)
          .neq("status", "archived");
        // 새로 생긴 문항 + 생성 중 다시 고쳐 쓴 문항(redo·검수 반영)도 함께 — 화면이 옛 글을 붙들지 않게
        if (since) q = q.or(`created_at.gte.${since},updated_at.gte.${since}`);
        if (profile.role === "teacher") q = q.eq("created_by", profile.id);
        return q.order("id", { ascending: true }).range(from, to);
      });
      if (newPage.error) return jsonError("조회에 실패했습니다.", 500);
      const newQuestions = newPage.data;
      return jsonOk({
        job: { ...rest, request_config: { title } },
        order,
        newQuestions: newQuestions ?? [],
      });
    }

    let jobQuery = supabase
      .from("question_generation_jobs")
      .select("*, english_source_passages(*)")
      .eq("id", id);

    if (profile.role === "teacher") {
      jobQuery = jobQuery.eq("created_by", profile.id);
    }

    const { data: job, error } = await jobQuery.single();
    if (error || !job) return jsonError("작업을 찾을 수 없습니다.", 404);

    // 실행이 끊겨 멈췄거나 다음 실행이 이어 받지 못한 작업은 여기서 이어 간다.
    const resume = resumeGenerationJobIfIdle(job, origin);
    if (resume) after(resume);

    const { data: rawQuestions } = await pageRows<Record<string, unknown>>((from, to) => {
      let q = supabase
        .from("generated_english_questions")
        .select("*")
        .eq("generation_job_id", id)
        // 숨긴 문항(같은 지문의 사실상 같은 문항 등)은 상세·문제지에 내지 않는다
        .neq("status", "archived")
        // 동형모의고사(설계도)는 시험지 번호 순서, 나머지는 만든 순서
        .order("slot_index", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        // 같은 시각에 한꺼번에 넣은 문항은 순서가 불러올 때마다 바뀌어 문제지·해설지 번호가 어긋났다(2026-11-24)
        .order("id", { ascending: true });
      if (profile.role === "teacher") q = q.eq("created_by", profile.id);
      return q.range(from, to);
    });
    /*
     * 지문은 넣은 순서대로. 문항은 32개씩 동시에 만들어 「만든 시각」 순서가 지문 순서와 어긋난다
     * (윌링어학원 30지문 150문항, 2026-11-20 「입력한 순서대로 지문이 안 나옴」). 설계도(slot_index)가
     * 있는 문항은 그 번호가 먼저고, 없는 문항만 입력한 지문 차례 → 만든 차례로 놓는다.
     */
    const inputIds = ((job.request_config as { passageIds?: unknown } | null)?.passageIds ?? []) as unknown[];
    const rank = new Map<string, number>();
    inputIds.forEach((pid, i) => {
      if (typeof pid === "string" && !rank.has(pid)) rank.set(pid, i);
    });
    const questions = (rawQuestions ?? [])
      .map((q, i) => ({ q, i }))
      .sort((a, b) => {
        const sa = a.q.slot_index as number | null;
        const sb = b.q.slot_index as number | null;
        if (sa != null || sb != null) return a.i - b.i;
        const ra = rank.get(String(a.q.passage_id ?? "")) ?? Number.MAX_SAFE_INTEGER;
        const rb = rank.get(String(b.q.passage_id ?? "")) ?? Number.MAX_SAFE_INTEGER;
        return ra - rb || a.i - b.i;
      })
      .map((x) => x.q);

    // 문항 번호 위에 작게 다는 지문 출처.
    // 지문이 하나여도 보낸다 — 출처가 적혀 있으면 문항마다 달라는 선생님 요청(2026-09-30).
    const passageIds = [...new Set((questions ?? []).map((q) => q.passage_id).filter(Boolean))] as string[];
    let passages: Array<{ id: string; title: string | null; source_detail: string | null }> = [];
    if (passageIds.length > 0) {
      const { data } = await supabase
        .from("english_source_passages")
        .select("id, title, source_detail")
        .in("id", passageIds);
      passages = data ?? [];
    }
    return jsonOk({ job, questions: questions ?? [], passages });
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonError("조회에 실패했습니다.", 500);
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireStaffProfile();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { action?: string };

    if (body.action === "process" || body.action === "retry") {
      const supabase = await createClient();
      const admin = createAdminClient();

      const { data: jobRow } = await admin
        .from("question_generation_jobs")
        .select(
          "id, academy_id, created_by, total_requested, total_failed, total_completed, status, created_at, request_config"
        )
        .eq("id", id)
        .maybeSingle();
      if (!jobRow) return jsonError("작업을 찾을 수 없습니다.", 404);
      // 실행 중인 작업을 다시 시작하면 같은 문항이 두 번 만들어진다.
      if (
        ["analyzing", "generating", "validating"].includes(jobRow.status as string) &&
        !isGenerationJobStale(jobRow)
      ) {
        return jsonError("아직 만드는 중인 작업입니다. 끝난 뒤에 다시 시도해 주세요.", 409);
      }
      if (
        jobRow.academy_id &&
        profile.academy_id &&
        jobRow.academy_id !== profile.academy_id
      ) {
        return jsonError("다른 학원 작업입니다.", 403);
      }
      if (profile.role === "teacher" && jobRow.created_by !== profile.id) {
        return jsonError("권한이 없습니다.", 403);
      }

      const requested = Math.max(1, Number(jobRow.total_requested) || 1);
      const failed = Math.max(0, Number(jobRow.total_failed) || 0);
      const quantity =
        body.action === "retry" && failed > 0 ? failed : requested;

      // 크레딧은 실제로 만들어진 문항 수만큼 작업이 끝날 때 차감한다(run-generation-job의
      // finalizeGenerationJob). 예전에는 요청한 문항 수를 먼저 차감해, 품질 기준에 떨어져
      // 버려지거나 생략된 문항까지 값을 받았다. 여기서는 잔액이 충분한지만 본다.
      const academyId = (jobRow.academy_id as string) || profile.academy_id;
      if (!academyId) return jsonError("소속 학원 정보가 없습니다.", 403);
      const shortfall = await lessonCreditShortfall(
        academyId,
        CREDIT_FEATURES.qg_generate_job,
        quantity
      );
      if (shortfall) return jsonError(shortfall, 402);
      const rc = (jobRow.request_config ?? {}) as GenerationRequestConfig;
      if (!rc._billing || !rc._billing.billedAt) {
        // 지금까지 저장된 문항(예전에 미리 차감한 작업의 재시도 등)은 다시 받지 않고,
        // 지금부터 새로 저장되는 문항만 받는다.
        const { data: lastRow } = await admin
          .from("generated_english_questions")
          .select("created_at")
          .eq("generation_job_id", id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        await admin
          .from("question_generation_jobs")
          .update({
            request_config: {
              ...rc,
              _billing: {
                mode: "post",
                billed: rc._billing?.billed ?? (Number(jobRow.total_completed) || 0),
                billedAt: (lastRow?.created_at as string | undefined) ?? new Date(0).toISOString(),
              },
            },
          })
          .eq("id", id);
      }

      if (body.action === "retry") {
        const { data: updated, error: updErr } = await admin
          .from("question_generation_jobs")
          .update({
            status: "pending",
            error_message: null,
            progress_message: "재시도 대기",
            completed_at: null,
          })
          .eq("id", id)
          .in("status", [
            "failed",
            "partially_completed",
            "completed",
            "analyzing",
            "generating",
            "validating",
            "pending",
          ])
          .select("id")
          .maybeSingle();
        if (updErr) return jsonError(updErr.message, 500);
        if (!updated) {
          return jsonError("재시도할 수 없는 상태입니다.", 400);
        }
      }
      // 응답은 바로 하고 생성은 after에서 한다. 한 실행에 다 못 만들면 다음 실행이
      // 이어 받는다(job-chain.ts). 진행 상황은 화면이 GET으로 조회한다.
      const origin = new URL(req.url).origin;
      after(() => runGenerationChunkAndChain(id, origin));
      const { data: job } = await supabase
        .from("question_generation_jobs")
        .select("*")
        .eq("id", id)
        .single();
      return jsonOk({ job });
    }

    return jsonError("알 수 없는 요청입니다.");
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonError(
      e instanceof Error ? e.message : "처리에 실패했습니다.",
      500
    );
  }
}
