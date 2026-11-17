/**
 * 중학교 수업용 자료 탭을 고른 영역만 켜서 찍고 PDF로 뽑는다(로컬 dev 또는 운영).
 *   node --env-file=.env.local scripts/middle-school/shot-lesson.mjs <unitId> <출력 폴더> <영역들 "대화문,본문"> [base]
 */
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const [unitId, OUT, wantArg, base0] = process.argv.slice(2);
const BASE = base0 || "http://localhost:3000";
const host = new URL(BASE).hostname;
const want = (wantArg || "대화문,본문").split(",");
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: "js83719392@jslms.local" });
if (error) throw error;
const jar = new Map();
const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  cookies: { getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach((c) => jar.set(c.name, c.value)) },
});
const u = new URL(link.properties.action_link);
const { error: e2 } = await sb.auth.verifyOtp({ type: "magiclink", token_hash: u.searchParams.get("token") ?? u.searchParams.get("token_hash") });
if (e2) throw e2;
const b = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 3600000 });
const p = await b.newPage();
await p.setViewport({ width: 1400, height: 1000 });
await p.setCookie(...[...jar.entries()].map(([name, value]) => ({ name, value, domain: host, path: "/", secure: BASE.startsWith("https") })));
await p.goto(`${BASE}/admin/middle-school/${unitId}`, { waitUntil: "networkidle2", timeout: 240000 });
await wait(4000);
// 넣을 자료: 원하는 것만 켠다
await p.evaluate((want) => {
  for (const lab of document.querySelectorAll("aside label")) {
    const box = lab.querySelector("input[type=checkbox]");
    const name = lab.textContent.trim();
    if (!box || !["단어", "대화문", "문법", "본문"].some((k) => name.startsWith(k))) continue;
    const on = want.some((w) => name.startsWith(w));
    if (box.checked !== on) box.click();
  }
}, want);
await wait(5000);
const info = await p.evaluate(() => {
  const sheets = [...document.querySelectorAll("#tb-print-root .tb-sheet")].filter((el) => !el.closest(".tb-measure"));
  return { sheets: sheets.length, overflow: sheets.map((s, i) => [i + 1, s.scrollHeight - s.clientHeight]).filter(([, d]) => d > 1) };
});
console.log("쪽", info.sheets, "넘침", JSON.stringify(info.overflow));
await p.evaluate(() => document.querySelectorAll("main, .overflow-auto").forEach((x) => { x.style.overflow = "visible"; x.style.height = "auto"; }));
const els = [];
for (const e of await p.$$("#tb-print-root .tb-sheet")) if (!(await e.evaluate((x) => !!x.closest(".tb-measure")))) els.push(e);
for (const [i, e] of els.slice(0, Number(process.env.SHOTS || 3)).entries()) { await e.scrollIntoView(); await wait(400); await e.screenshot({ path: `${OUT}/p${i + 1}.png` }); }
if (process.env.PDF) {
  await p.pdf({ path: `${OUT}/${process.env.PDF}`, preferCSSPageSize: true, printBackground: true });
  console.log("PDF", process.env.PDF);
}
await b.close();
