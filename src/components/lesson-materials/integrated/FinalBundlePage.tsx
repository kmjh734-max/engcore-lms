import { createAdminClient } from "@/lib/supabase/admin";
import { isAcademyFeatureOn } from "@/lib/academies/features";
import { normalizeLessonBookOptions } from "@/lib/lesson-materials/lesson-book-options";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { getAcademyBrandingForCurrentUser } from "@/lib/tenant/academy-branding";
import { normalizeIntegratedPayload } from "@/lib/lesson-materials/integrated";
import { orderWorkbookTypes, type WorkbookTypeId } from "@/lib/lesson-materials/workbook-types";
import {
  loadAnalysisReportProjects,
  loadBundleExtraProjects,
} from "@/lib/lesson-materials/load-material-payloads";
import {
  FinalBundleClient,
  type FinalBundleMaterials,
} from "@/components/lesson-materials/integrated/FinalBundleClient";

/**
 * 최종통합자료 화면(서버). 통합자료 파일의 구성대로 고른 파일들의 데이터를 모아 넘긴다.
 * 조회는 사용자 세션이라 남의 파일은 RLS가 막는다.
 */
export async function FinalBundlePage({ role, docId }: { role: "admin" | "teacher"; docId?: string }) {
  const base = role === "admin" ? "/admin/lesson-materials" : "/teacher/lesson-materials";
  const notFound = (
    <div className="px-4 py-10">
      <p className="text-sm text-slate-600">통합자료 파일을 찾을 수 없습니다.</p>
      <Link href={base} className="mt-3 inline-block text-sm text-violet-700">
        ← 자료함
      </Link>
    </div>
  );
  if (!docId) return notFound;

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("lesson_material_documents")
    .select("id,name,payload,kind")
    .eq("id", docId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!row || row.kind !== "integrated") return notFound;
  const payload = normalizeIntegratedPayload(row.payload);

  const docIds = [
    ...payload.selections.lesson_pack,
    ...payload.selections.analysis_report,
    ...payload.selections.workbook,
  ];
  const { data: docs } = docIds.length
    ? await supabase
        .from("lesson_material_documents")
        // 워크북은 고른 유형만(학습 계획표 이수 칸을 워크북을 보고 만든다) — payload 통째로는 읽지 않는다
        .select("id,name,kind,project_ids,wbt:payload->selectedTypes,wbo:payload->typeOrder,lpo:payload->options")
        .in("id", docIds)
        .is("deleted_at", null)
    : { data: [] as Array<{ id: string; name: string; kind: string; project_ids: string[] }> };
  const docById = new Map((docs ?? []).map((d) => [d.id as string, d] as const));
  const pick = (id: string, kind: string) => {
    const d = docById.get(id);
    return d && d.kind === kind ? d : null;
  };

  // 계획표·전체 단어장·백지노트는 고른 파일들의 지문으로(처음 나온 순서, 겹치면 한 번)
  const extraIds = [
    ...new Set(
      [...payload.selections.lesson_pack, ...payload.selections.analysis_report, ...payload.selections.workbook].flatMap(
        (id) => ((docById.get(id)?.project_ids as string[] | undefined) ?? [])
      )
    ),
  ];

  /*
   * 수업용 자료 지문은 늘 extraIds 안에 있다 — 한 번만 읽어 같은 것을 쓴다(2026-10-29 속도: 같은 지문 재료를
   * 두 번 읽어 두 번 실어 보냈다). 같은 객체라 화면으로도 한 번만 간다.
   */
  const extraJob = loadBundleExtraProjects(supabase, extraIds);
  const [lessonPacks, analyses, extraProjects] = await Promise.all([
    Promise.all(
      payload.selections.lesson_pack.map(async (id) => {
        const d = pick(id, "lesson_pack");
        if (!d) return null;
        const byId = new Map((await extraJob).map((p) => [p.id, p] as const));
        return {
          docId: id,
          name: d.name as string,
          // 파일에 저장된 수업용 자료 설정(해석 등) — 없으면 null
          options: normalizeLessonBookOptions((d as { lpo?: unknown }).lpo),
          // 수업용 자료는 테스트 교재 모양(단어 정리·문장별 해석) — 같은 재료를 읽는다
          projects: ((d.project_ids as string[]) ?? []).map((pid) => byId.get(pid)).filter((p) => !!p),
        };
      })
    ),
    Promise.all(
      payload.selections.analysis_report.map(async (id) => {
        const d = pick(id, "analysis_report");
        if (!d) return null;
        return {
          docId: id,
          name: d.name as string,
          projects: await loadAnalysisReportProjects(supabase, (d.project_ids as string[]) ?? []),
        };
      })
    ),
    extraJob,
  ]);

  const profile = await getCurrentProfile();
  let jobsQuery = supabase
    .from("question_generation_jobs")
    .select("id,title:request_config->>title")
    .in("id", payload.selections.questions.length ? payload.selections.questions : ["00000000-0000-0000-0000-000000000000"]);
  if (profile?.academy_id) jobsQuery = jobsQuery.eq("academy_id", profile.academy_id);
  if (profile?.role === "teacher") jobsQuery = jobsQuery.eq("created_by", profile.id);
  const { data: jobs } = await jobsQuery;
  const jobTitle = new Map((jobs ?? []).map((j) => [String((j as { id: string }).id), String((j as { title?: string }).title ?? "")] as const));

  const materials: FinalBundleMaterials = {
    lessonPacks: lessonPacks.filter((m): m is NonNullable<typeof m> => !!m && m.projects.length > 0),
    analyses: analyses.filter((m): m is NonNullable<typeof m> => !!m && m.projects.length > 0),
    workbooks: payload.selections.workbook
      .map((id) => pick(id, "workbook"))
      .filter((d): d is NonNullable<typeof d> => !!d)
      .map((d) => {
        const raw = d as unknown as { wbt?: unknown; wbo?: unknown };
        const list = (v: unknown) => (Array.isArray(v) ? (v.map(String) as WorkbookTypeId[]) : []);
        return {
          docId: d.id as string,
          name: d.name as string,
          types: orderWorkbookTypes(list(raw.wbt), list(raw.wbo)),
        };
      }),
    questions: payload.selections.questions
      .filter((id) => jobTitle.has(id))
      .map((id) => ({ jobId: id, title: jobTitle.get(id) || "변형문제" })),
    extraProjects,
  };

  const branding = await getAcademyBrandingForCurrentUser();
  return (
    <FinalBundleClient
      role={role}
      docId={row.id as string}
      name={row.name as string}
      initialPayload={payload}
      materials={materials}
      logoSrc={branding.logoUrl}
      academyName={branding.name || ""}
      classView={await isAcademyFeatureOn(createAdminClient(), profile?.academy_id, "lesson_class_view")}
      workbookByPassage={await isAcademyFeatureOn(createAdminClient(), profile?.academy_id, "bundle_workbook_by_passage")}
    />
  );
}
