import { notFound, redirect } from "next/navigation";
import { ensureMsVocabSet } from "@/lib/middle-school/vocab-set";

export const dynamic = "force-dynamic";

/** 중학교 수업자료 단어 QR — 로그인 없이 그 과 단어학습으로 */
export default async function MsVocabQrPage({ params }: { params: Promise<{ unitId: string }> }) {
  const { unitId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(unitId)) notFound();
  const setId = await ensureMsVocabSet(unitId);
  if (!setId) notFound();
  redirect(`/exam-vocab/${setId}`);
}
