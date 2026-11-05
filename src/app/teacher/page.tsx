import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { getAcademyBrandingForCurrentUser } from "@/lib/tenant/academy-branding";
import { loadHomeDashboard } from "@/lib/home/load-home";
import { koreaDateLabel } from "@/lib/home/date-label";
import { HomeDashboard } from "@/components/home/HomeDashboard";
import { TutorialDialog } from "@/components/home/TutorialDialog";

export default async function TeacherDashboardPage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const [data, branding] = await Promise.all([
    loadHomeDashboard(supabase, {
      role: "teacher",
      viewerId: profile!.id,
      academyId: profile?.academy_id ?? null,
    }),
    getAcademyBrandingForCurrentUser(),
  ]);

  return (
    <>
      <TutorialDialog role="teacher" />
      <HomeDashboard
        role="teacher"
        title="강사 홈"
        dateLabel={koreaDateLabel()}
        academyName={branding.name}
        data={data}
      />
    </>
  );
}
