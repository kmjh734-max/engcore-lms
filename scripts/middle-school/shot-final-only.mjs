/**
 * 중학교 최종통합자료 PDF만 뽑는다(로컬 dev 3000, 정수학원 관리자 매직링크 세션). 쪽 수·묶음 첫 쪽·넘침도 알려 준다.
 *   node scripts/middle-school/shot-final-only.mjs <PDF 경로> [과] [중1|중2]
 */
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const OUT = process.argv[2];
const LESSON = Number(process.argv[3] ?? 1);
const GRADE = (process.argv[4] ?? "중1").replace(/이$/, ""); // 동아(이병민)은 중1이
const PUBLISHER = (process.argv[4] ?? "").endsWith("이") ? "동아(이병민)" : "동아(윤정미)";
const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }),
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ACADEMY = "79ea0a71-d148-46ac-8c8f-a3a3e4961838";
const { data: who } = await admin.from("profiles").select("email").eq("role", "admin").eq("academy_id", ACADEMY).limit(1).single();
const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: who.email });
if (error) throw error;
const jar = new Map();
const sb = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  cookies: { getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach((c) => jar.set(c.name, c.value)) },
});
const u = new URL(link.properties.action_link);
const { error: e2 } = await sb.auth.verifyOtp({ type: "magiclink", token_hash: u.searchParams.get("token") ?? u.searchParams.get("token_hash") });
if (e2) throw e2;
const { data: unit } = await admin.from("ms_units").select("id").eq("academy_id", ACADEMY).eq("grade", GRADE).eq("publisher", PUBLISHER).eq("lesson_no", LESSON).single();

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 900000 });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.setViewport({ width: 1500, height: 1100 });
await page.setCookie(...[...jar.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
await page.goto(`http://localhost:3000/admin/middle-school/${unit.id}`, { waitUntil: "networkidle0", timeout: 300000 });
await page.evaluate(() => [...document.querySelectorAll("button")].find((el) => el.textContent?.trim().startsWith("최종통합자료"))?.click());
await new Promise((r) => setTimeout(r, 20000));
const info = await page.evaluate(() => {
  const sheets = [...document.querySelectorAll("#tb-print-root .tb-sheet, #tb-print-root .qg-print-page")].filter((el) => !el.closest(".tb-measure"));
  const parts = {};
  document.querySelectorAll("#tb-print-root [data-toc]").forEach((w) => {
    const f = [...w.querySelectorAll(".tb-sheet, .qg-print-page")].find((el) => !el.closest(".tb-measure"));
    parts[w.dataset.toc] = sheets.indexOf(f) + 1;
  });
  return { sheets: sheets.length, parts, overflow: sheets.map((s, i) => [i + 1, s.scrollHeight - s.clientHeight]).filter(([, d]) => d > 1) };
});
// 인쇄 모양을 미리 켜 두면 쪽 나누기가 그 상태로 다시 돌아 측정이 틀어질 수 있어 곧바로 PDF로 찍는다
await page.pdf({ path: OUT, preferCSSPageSize: true, printBackground: true, timeout: 600000 });
console.log(JSON.stringify(info));
await browser.close();
