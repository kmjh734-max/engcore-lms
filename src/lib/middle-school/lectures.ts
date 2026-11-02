import { createAdminClient } from "@/lib/supabase/admin";
import { MS_LECTURE_SECTIONS, type MsLectureSlug } from "./qr-url";

/**
 * 중학교 교과서 강의(선생님 2026-11-02): 「교과서」 폴더의 강좌 「중1 동아(윤)」에
 * 「1과 문법 - be동사…」「4과 대화문」「4과 본문」 이름으로 올라가 있다. 과·영역은 이름으로 찾는다.
 * 강좌는 비공개지만 수업자료 QR에서는 로그인 없이 보여 준다 — 그 과의 그 영역 영상만.
 */
export type MsLectureVideo = {
  id: string;
  title: string;
  vimeo_url: string | null;
  vimeo_video_id: string | null;
  youtube_url: string | null;
  youtube_video_id: string | null;
  video_provider: string | null;
};

type UnitKey = { academyId: string; grade: string; publisher: string; lessonNo: number };

const COLS = "id, title, vimeo_url, vimeo_video_id, youtube_url, youtube_video_id, video_provider";

function courseTitle(u: UnitKey): string {
  return `${u.grade} ${u.publisher.replace("(윤정미)", "(윤)").replace("(이병민)", "(이)")}`;
}

/** 그 과의 강의를 영역별로 */
export async function loadMsLectures(u: UnitKey): Promise<Record<MsLectureSlug, MsLectureVideo[]>> {
  const out: Record<MsLectureSlug, MsLectureVideo[]> = { dialogue: [], grammar: [], reading: [] };
  const admin = createAdminClient();
  const { data: course } = await admin
    .from("courses")
    .select("id")
    .eq("academy_id", u.academyId)
    .eq("title", courseTitle(u))
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (!course) return out;
  const { data } = await admin
    .from("lessons")
    .select(COLS)
    .eq("course_id", course.id)
    .eq("is_published", true)
    .like("title", `${u.lessonNo}과 %`)
    .order("order_index");
  for (const row of (data ?? []) as MsLectureVideo[]) {
    const rest = row.title.slice(`${u.lessonNo}과 `.length);
    for (const slug of Object.keys(MS_LECTURE_SECTIONS) as MsLectureSlug[]) {
      if (rest.startsWith(MS_LECTURE_SECTIONS[slug].prefix)) out[slug].push(row);
    }
  }
  return out;
}
