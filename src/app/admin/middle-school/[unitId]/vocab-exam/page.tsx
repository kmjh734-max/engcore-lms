import { MiddleSchoolVocabExamPage } from "@/components/middle-school/MiddleSchoolPages";

export default async function Page({ params }: { params: Promise<{ unitId: string }> }) {
  const { unitId } = await params;
  return <MiddleSchoolVocabExamPage base="/admin/middle-school" unitId={unitId} />;
}
