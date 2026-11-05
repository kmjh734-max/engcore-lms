import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { getAcademyBrandingForCurrentUser } from "@/lib/tenant/academy-branding";
import { loadHomeDashboard } from "@/lib/home/load-home";
import { koreaDateLabel } from "@/lib/home/date-label";
import { HomeDashboard } from "@/components/home/HomeDashboard";
import { GettingStarted } from "@/components/home/GettingStarted";
import { TutorialDialog } from "@/components/home/TutorialDialog";

export default async function AdminDashboardPage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const [data, branding] = await Promise.all([
    loadHomeDashboard(supabase, {
      role: "admin",
      viewerId: profile!.id,
      academyId: profile?.academy_id ?? null,
    }),
    getAcademyBrandingForCurrentUser(),
  ]);

  return (
    <>
    <TutorialDialog />
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
