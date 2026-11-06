import { seatLockScreen } from "@/components/credits/SeatLockedNotice";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { VocabSetPrintView } from "@/components/vocab/VocabSetPrintView";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { getAcademyBrandingForCurrentUser } from "@/lib/tenant/academy-branding";
import { loadVocabSetPrintData } from "@/lib/vocab/load-vocab-set-print";
import { createClient } from "@/lib/supabase/server";

interface PageProps {
  params: Promise<{ setId: string }>;
}

export default async function TeacherVocabSetPrintPage({ params }: PageProps) {
  const { setId } = await params;
  // 이용 확인은 자료를 불러오는 동안 함께 한다
  const lockPromise = seatLockScreen("vocab", "/teacher", `/teacher/vocab/set/${setId}`);
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "teacher") {
    redirect("/login");
  }

  const supabase = await createClient();
  const [loaded, branding] = await Promise.all([
    loadVocabSetPrintData(supabase, setId),
    getAcademyBrandingForCurrentUser(),
  ]);
  if (!loaded) notFound();

  const backHref = `/teacher/vocab/set/${setId}`;

  const locked = await lockPromise;
  if (locked) return locked;

  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-sm text-slate-500">인쇄 미리보기 준비 중…</div>
      }
    >
      <VocabSetPrintView
        sections={[
          {
            setId: loaded.set.id,
            title: loaded.set.title,
            description: loaded.set.description,
            items: loaded.items,
            passageGroups: loaded.passageGroups,
          },
        ]}
        backHref={backHref}
        academyName={branding.name}
        logoSrc={branding.logoUrl}
      />
    </Suspense>
  );
}
