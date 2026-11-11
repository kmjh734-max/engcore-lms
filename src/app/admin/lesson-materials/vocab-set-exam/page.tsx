import { createClient } from "@/lib/supabase/server";
import { LessonPackVocabExam } from "@/components/lesson-materials/LessonPackVocabExam";
import { loadVocabSetPrintData } from "@/lib/vocab/load-vocab-set-print";
import { vocabSetAsProjects } from "@/lib/lesson-materials/vocab-set-exam";
import { getAcademyBrandingForCurrentUser } from "@/lib/tenant/academy-branding";
import Link from "next/link";

/** 자료함 「단어」 탭 단어장으로 단어 시험지 — 수업용 자료 「단어 시험지」와 같은 화면(선생님 2026-10-29) */
export default async function AdminVocabSetExamPage({
  searchParams,
}: {
  searchParams: Promise<{ set?: string; view?: string }>;
}) {
  const { set: setId, view } = await searchParams;
  const supabase = await createClient();
  const loaded = setId?.trim() ? await loadVocabSetPrintData(supabase, setId.trim()) : null;

  if (!loaded) {
    return (
      <div className="px-4 py-10">
        <p className="text-sm text-slate-600">단어장을 찾을 수 없습니다.</p>
        <Link href="/admin/lesson-materials" className="mt-3 inline-block text-sm text-violet-700">
          ← 자료함
        </Link>
      </div>
    );
  }

  const branding = await getAcademyBrandingForCurrentUser();
  return (
    <LessonPackVocabExam
      role="admin"
      docName={loaded.set.title}
      projects={vocabSetAsProjects(loaded.set, loaded.items, loaded.passageGroups)}
      fromWordSet
      listOnly={view === "list"}
      editHref={`/admin/vocab/set/${loaded.set.id}`}
      examHref={`/admin/lesson-materials/vocab-set-exam?set=${loaded.set.id}`}
      logoSrc={branding.logoUrl}
      academyName={branding.name || ""}
    />
  );
}
