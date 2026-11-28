import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { isEogudokOpen, loadEgTest, parseGrade } from "@/lib/eogudok/data";

/** 조교 테스트 「직접 고르기」용 — 그 주 문항 전체 */
export async function GET(req: Request) {
  const profile = await getCurrentProfile();
  if (!profile?.academy_id || !(await isEogudokOpen(profile.academy_id))) return new NextResponse("not found", { status: 404 });
  const q = new URL(req.url).searchParams;
  const g = parseGrade(q.get("g"));
  const w = Number(q.get("w"));
  if (!g || !(w >= 1 && w <= 12)) return new NextResponse("bad params", { status: 400 });
  return NextResponse.json(await loadEgTest(g, w));
}
