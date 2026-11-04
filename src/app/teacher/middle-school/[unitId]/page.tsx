import { MiddleSchoolUnitPage } from "@/components/middle-school/MiddleSchoolPages";

export default async function Page({ params, searchParams }: { params: Promise<{ unitId: string }>; searchParams: Promise<{ test?: string; book?: string }> }) {
  const { unitId } = await params;
  const { test, book } = await searchParams;
  return <MiddleSchoolUnitPage base="/teacher/middle-school" unitId={unitId} test={test === "1"} book={book === "answers" ? "answers" : book ? "book" : null} />;
}
