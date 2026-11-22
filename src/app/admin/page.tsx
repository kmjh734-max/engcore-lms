import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { getAcademyBrandingForCurrentUser } from "@/lib/tenant/academy-branding";
import { loadHomeDashboard } from "@/lib/home/load-home";
import { koreaDateLabel } from "@/lib/home/date-label";
import { HomeDashboard } from "@/components/home/HomeDashboard";
import { GettingStarted } from "@/components/home/GettingStarted";
import { TutorialDialog } from "@/components/home/TutorialDialog";
import { getAdminNavItems } from "@/lib/nav/menus";

export default async function AdminDashboardPage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const [data, branding, nav] = await Promise.all([
    loadHomeDashboard(supabase, {
      role: "admin",
      viewerId: profile!.id,
      academyId: profile?.academy_id ?? null,
    }),
    getAcademyBrandingForCurrentUser(),
    getAdminNavItems(profile?.academy_id),
  ]);
  // 사용법 창도 그 학원에 열린 메뉴만 설명한다.
  const menus = nav.map((i) => i.href.slice(6)).filter(Boolean);

  return (
    <>
    <TutorialDialog menus={menus} />
    <GettingStarted academyId={profile?.academy_id ?? null} />
    <HomeDashboard
      role="admin"
      title="관리 홈"
      dateLabel={koreaDateLabel()}
      academyName={branding.name}
      data={data}
    />
    </>
  );
}
