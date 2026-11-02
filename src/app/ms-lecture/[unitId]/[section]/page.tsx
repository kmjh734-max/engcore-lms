import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VimeoPlayer } from "@/components/vimeo/VimeoPlayer";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadMsLectures } from "@/lib/middle-school/lectures";
import { MS_LECTURE_SECTIONS, type MsLectureSlug } from "@/lib/middle-school/qr-url";

export const dynamic = "force-dynamic";
// 인쇄물 QR로만 들어오는 곳 — 검색에 올리지 않는다
export const metadata: Metadata = { title: "강의", robots: { index: false, follow: false } };

/** 중학교 수업자료 강의 QR — 로그인 없이 그 과·그 영역 강의만 본다 */
export default async function MsLecturePage({ params }: { params: Promise<{ unitId: string; section: string }> }) {
  const { unitId, section } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(unitId) || !(section in MS_LECTURE_SECTIONS)) notFound();
  const slug = section as MsLectureSlug;
  const { data: unit } = await createAdminClient()
    .from("ms_units")
    .select("academy_id, grade, publisher, lesson_no, title")
    .eq("id", unitId)
    .maybeSingle();
  if (!unit) notFound();
  const lectures = await loadMsLectures({ academyId: unit.academy_id, grade: unit.grade, publisher: unit.publisher, lessonNo: unit.lesson_no });
  const videos = lectures[slug];
  if (!videos.length) notFound();
  const prefix = `${unit.lesson_no}과 `;
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <p className="text-sm text-slate-500">
            {unit.grade} {unit.publisher} {unit.lesson_no}과 · {unit.title}
          </p>
          <h1 className="text-xl font-bold text-slate-900">{MS_LECTURE_SECTIONS[slug].ko} 강의</h1>
        </header>
        {videos.map((v) => (
          <section key={v.id} className="space-y-2">
            {videos.length > 1 ? <h2 className="font-semibold text-slate-800">{v.title.replace(prefix, "").replace(/^문법 - /, "")}</h2> : null}
            <VimeoPlayer
              vimeoUrl={v.vimeo_url}
              vimeoVideoId={v.vimeo_video_id}
              youtubeUrl={v.youtube_url}
              youtubeVideoId={v.youtube_video_id}
              videoProvider={v.video_provider}
              title={v.title}
            />
          </section>
        ))}
      </div>
    </main>
  );
}
