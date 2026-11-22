import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { getTeacherNavItems } from "@/lib/nav/menus";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { LowCreditBanner } from "@/components/credits/LowCreditBanner";
import { CreditWall } from "@/components/credits/CreditWall";
import { CreditConfirmHost } from "@/components/credits/CreditConfirmHost";

export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();

  if (!profile || profile.role !== "teacher") {
    redirect("/login");
  }

  if (profile.is_active === false) {
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login?inactive=1");
  }

  const navItems = await getTeacherNavItems(profile.academy_id);

  return (
    <DashboardLayout profile={profile} navItems={navItems}>
      <LowCreditBanner academyId={profile.academy_id} canCharge={false} />
      <CreditWall academyId={profile.academy_id} canCharge={false} />
      <CreditConfirmHost chargeHref="/admin/credits/charge" />
      {children}
    </DashboardLayout>
  );
}
