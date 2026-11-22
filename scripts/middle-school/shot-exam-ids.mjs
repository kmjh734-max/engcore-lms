/**
 * 문제 은행 문항 몇 개만 변형문제 인쇄 화면으로 찍는다(로컬 dev 3000, 정수학원 관리자 매직링크).
 *   node scripts/middle-school/shot-exam-ids.mjs <출력 png> <unitId> <id,id,...> [exam|answers]
 */
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const [OUT, UNIT, IDS, MODE = "exam"] = process.argv.slice(2);
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
  cookies: { getAll: () => [...jar.entries()].map(([n, v]) => ({ name: n, value: v })), setAll: (cs) => cs.forEach((c) => jar.set(c.name, c.value)) },
});
const u = new URL(link.properties.action_link);
const { error: e2 } = await sb.auth.verifyOtp({ type: "magiclink", token_hash: u.searchParams.get("token") ?? u.searchParams.get("token_hash") });
if (e2) throw e2;
const sel = IDS.split(",").map((n) => Number(n).toString(36)).join(".");
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 1400, deviceScaleFactor: 1.5 });
await page.setCookie(...[...jar.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
await page.goto(`http://localhost:3000/admin/middle-school/${UNIT}/exam/${sel}/print?mode=${MODE}`, { waitUntil: "networkidle0", timeout: 300000 });
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: OUT, fullPage: true });
await browser.close();
console.log(OUT);
