import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { isEogudokOpen, loadEgMeta, loadEgTest, parseGrade } from "@/lib/eogudok/data";
import { egTestHtml, parsePick } from "@/lib/eogudok/test-sheet";

/** 조교 1:1 주간 테스트 시안: ?g=1&w=3&form=A&en=10&ko=10&gram=10&pass=85 */
export async function GET(req: Request) {
  const profile = await getCurrentProfile();
  if (!profile?.academy_id || !(await isEogudokOpen(profile.academy_id))) return new NextResponse("not found", { status: 404 });
  const q = new URL(req.url).searchParams;
  const g = parseGrade(q.get("g"));
  const w = Number(q.get("w"));
  if (!g || !(w >= 1 && w <= 12)) return new NextResponse("bad params", { status: 400 });
  const num = (k: string, d: number, max: number) => Math.max(0, Math.min(max, Number(q.get(k) ?? d) || 0));
  const form = (["A", "B", "C"].includes(q.get("form") ?? "") ? q.get("form") : "A") as "A" | "B" | "C";
  const meta = await loadEgMeta(g);
  const html = egTestHtml(g, meta.weeks[w - 1], await loadEgTest(g, w), {
    form,
    en2ko: num("en", 15, 30),
    ko2en: num("ko", 15, 30),
    gram: num("gram", 15, 30),
    arr: num("arr", 6, 15),
    tr: num("tr", 6, 15),
    pick: parsePick(q.get("pick")),
    passPct: num("pass", 85, 100) || 85,
  });
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" } });
}
