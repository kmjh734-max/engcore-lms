import Link from "next/link";
import { pageRows } from "@/lib/supabase/fetch-all-rows";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { SignOutButton } from "@/components/layout/SignOutButton";
import { SuperAdminStats } from "@/components/super-admin/SuperAdminStats";
import { SuperAdminAcademiesClient } from "@/components/super-admin/SuperAdminAcademiesClient";
import { readAcademyFeatures } from "@/lib/academies/features";

export default async function SuperAdminHomePage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "super_admin") {
    redirect("/login");
  }

  const supabase = await createClient();
  const { data: academies } = await supabase
    .from("academies")
    .select(
      "id, name, slug, status, primary_color, secondary_color, logo_url, description, phone, address, created_at, updated_at, settings"
    )
    .order("created_at", { ascending: true });

  const academyIds = (academies ?? []).map((a) => a.id);
  const countsByAcademy: Record<
    string,
    { students: number; teachers: number; courses: number }
  > = {};

  for (const id of academyIds) {
    countsByAcademy[id] = { students: 0, teachers: 0, courses: 0 };
  }

  if (academyIds.length > 0) {
    const [{ data: profiles }, { data: courses }] = await Promise.all([
      // 전체 인원이 1000명을 넘으면 학원별 인원이 적게 나왔다 — 끝까지 센다
      pageRows((from, to) =>
        supabase
          .from("profiles")
          .select("academy_id, role")
          .in("academy_id", academyIds)
          .order("id")
          .range(from, to)
      ),
      pageRows((from, to) =>
        supabase.from("courses").select("academy_id").in("academy_id", academyIds).order("id").range(from, to)
      ),
    ]);

    for (const p of profiles ?? []) {
      const aid = p.academy_id as string | null;
      if (!aid || !countsByAcademy[aid]) continue;
      if (p.role === "student") countsByAcademy[aid].students += 1;
      if (p.role === "teacher") countsByAcademy[aid].teachers += 1;
    }
    for (const c of courses ?? []) {
      const aid = c.academy_id as string | null;
      if (!aid || !countsByAcademy[aid]) continue;
      countsByAcademy[aid].courses += 1;
    }
  }

  const rows = (academies ?? []).map(({ settings, ...a }) => {
    const signup = (settings as { signup?: { member_type?: string; owner_name?: string; contact_email?: string } } | null)?.signup;
    return {
    ...a,
    memberType: (signup?.member_type === "personal" ? "personal" : "academy") as "academy" | "personal",
    selfSignup: Boolean(signup),
    ownerName: signup?.owner_name ?? null,
    contactEmail: signup?.contact_email ?? null,
    features: readAcademyFeatures(settings),
    students: countsByAcademy[a.id]?.students ?? 0,
    teachers: countsByAcademy[a.id]?.teachers ?? 0,
    courses: countsByAcademy[a.id]?.courses ?? 0,
    };
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader
        title="EngCore Admin"
        description="전체 학원을 관리합니다. 영어교육의 중심, EngCore"
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/super-admin/credits"
              className="rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-900 hover:bg-brand-100"
            >
              크레딧 관리
            </Link>
            <Link
              href="/super-admin/ai-usage"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              모델 사용량
            </Link>
            <Link
              href="/super-admin/reports"
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 hover:bg-rose-100"
            >
              오류 신고
            </Link>
            <SignOutButton />
          </div>
        }
      />
      <p className="mb-4 text-sm text-slate-600">
        {profile.name} · {profile.email}
      </p>
      <SuperAdminStats />
      <SuperAdminAcademiesClient initialRows={rows} />
    </div>
  );
}
