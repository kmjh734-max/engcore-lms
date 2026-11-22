import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { getAdminNavItems } from "@/lib/nav/menus";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Suspense } from "react";
import { LowCreditBanner } from "@/components/credits/LowCreditBanner";
import { CreditWall } from "@/components/credits/CreditWall";
import { CreditConfirmHost } from "@/components/credits/CreditConfirmHost";
import { GuideBanner } from "@/components/home/GuideBanner";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();

  if (!profile || profile.role !== "admin") {
    redirect("/login");
  }

  const navItems = await getAdminNavItems(profile.academy_id);

  return (
    <DashboardLayout
      profile={profile}
      navItems={navItems}
    >
      <LowCreditBanner academyId={profile.academy_id} canCharge />
      <CreditWall academyId={profile.academy_id} canCharge />
      <CreditConfirmHost chargeHref="/admin/credits/charge" />
      <Suspense fallback={null}>
        <GuideBanner />
      </Suspense>
      {children}
    </DashboardLayout>
  );
}
