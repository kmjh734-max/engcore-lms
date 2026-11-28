import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { buildEgAnswers, buildEgBook, isEogudokOpen, parseGrade } from "@/lib/eogudok/data";

/** 어구독 인쇄 쪽: ?g=1&weeks=1,2&mode=student|teacher|answers&front=1 */
export async function GET(req: Request) {
  const profile = await getCurrentProfile();
  if (!profile?.academy_id || !(await isEogudokOpen(profile.academy_id))) return new NextResponse("not found", { status: 404 });
  const u = new URL(req.url);
  const g = parseGrade(u.searchParams.get("g"));
  if (!g) return new NextResponse("bad grade", { status: 400 });
  const weeks = (u.searchParams.get("weeks") ?? "").split(",").map(Number).filter((n) => n >= 1 && n <= 12);
  const mode = u.searchParams.get("mode");
  const html =
    mode === "answers"
      ? await buildEgAnswers(g, weeks)
      : await buildEgBook(g, mode === "teacher" ? "teacher" : "student", weeks, u.searchParams.get("front") === "1");
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" } });
}
