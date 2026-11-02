import { MiddleSchoolUnitPage } from "@/components/middle-school/MiddleSchoolPages";

export default async function Page({ params, searchParams }: { params: Promise<{ unitId: string }>; searchParams: Promise<{ test?: string }> }) {
  const { unitId } = await params;
  const { test } = await searchParams;
  return <MiddleSchoolUnitPage base="/teacher/middle-school" unitId={unitId} test={test === "1"} />;
}
