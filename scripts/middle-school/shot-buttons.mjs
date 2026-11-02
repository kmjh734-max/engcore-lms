/** 과 카드 버튼 시안 확인: node scripts/middle-school/shot-buttons.mjs <출력 폴더> */
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ACADEMY = "79ea0a71-d148-46ac-8c8f-a3a3e4961838";
const { data: who } = await admin.from("profiles").select("email").eq("role", "admin").eq("academy_id", ACADEMY).limit(1).single();
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: who.email });
const jar = new Map();
const sb = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach((c) => jar.set(c.name, c.value)) } });
const u = new URL(link.properties.action_link);
await sb.auth.verifyOtp({ type: "magiclink", token_hash: u.searchParams.get("token") ?? u.searchParams.get("token_hash") });
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.setViewport({ width: 1500, height: 1000 });
await page.setCookie(...[...jar.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto("http://localhost:3000/admin/middle-school", { waitUntil: "networkidle0", timeout: 300000 });
await wait(1500);
await page.screenshot({ path: `${OUT}/1-과목록.png` });
const hrefs = await page.evaluate(() => [...document.querySelectorAll("a")].filter((a) => /출력$/.test(a.textContent.trim())).map((a) => [a.textContent.trim(), a.getAttribute("href")]));
console.log("버튼 수", hrefs.length, hrefs.slice(0, 2));
const [voc, tst] = [hrefs.find((h) => h[0].startsWith("단어"))[1], hrefs.find((h) => h[0].startsWith("테스트"))[1]];
for (const [name, h] of [["2-단어시험지", voc], ["3-테스트지", tst]]) {
  const r = await page.goto("http://localhost:3000" + h, { waitUntil: "networkidle0", timeout: 300000 });
  await wait(8000);
  const info = await page.evaluate(() => ({ sheets: document.querySelectorAll(".tb-sheet:not(.tb-measure .tb-sheet)").length, text: document.body.innerText.replace(/\s+/g, " ").slice(0, 160), head: [...document.querySelectorAll(".tb-sheet h2")].slice(0, 2).map((x) => x.textContent) }));
  console.log(name, r.status(), JSON.stringify(info));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await page.emulateMediaType("print");
  await page.pdf({ path: `${OUT}/${name}.pdf`, preferCSSPageSize: true, printBackground: true });
  await page.emulateMediaType("screen");
}
await browser.close();
