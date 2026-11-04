/**
 * 중학교 테스트지 작업대 전수 점검(로컬 dev 3000, 값 없음).
 *   node scripts/middle-school/audit-test.mjs <출력.json>
 * 과마다 「보통」·「길게」로 열어: 쪽 수·넘침·깨진 글자·빈 쪽(빈 쪽 끼움 말고)·홀수 쪽 시작·차시마다 시험지·정답지가 있는지.
 */
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const OUT = process.argv[2];
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ACADEMY = "79ea0a71-d148-46ac-8c8f-a3a3e4961838";
const { data: who } = await admin.from("profiles").select("email").eq("role", "admin").eq("academy_id", ACADEMY).limit(1).maybeSingle();
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: who.email });
const jar = new Map();
const sb = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach((c) => jar.set(c.name, c.value)) } });
const lu = new URL(link.properties.action_link);
await sb.auth.verifyOtp({ type: "magiclink", token_hash: lu.searchParams.get("token") ?? lu.searchParams.get("token_hash") });
const { data: units } = await admin.from("ms_units").select("id,grade,publisher,lesson_no").eq("academy_id", ACADEMY).order("publisher").order("grade").order("lesson_no");
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 900000 });
const page = await browser.newPage();
let errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 160)));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|Download the React|hydrat|Failed to load resource/i.test(m.text())) errs.push("console: " + m.text().slice(0, 160)); });
await page.setViewport({ width: 1500, height: 1100 });
await page.setCookie(...[...jar.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const measure = () =>
  page.evaluate(() => {
    if (!document.getElementById("audit-cv")) {
      const st = document.createElement("style");
      st.id = "audit-cv";
      st.textContent = "*{content-visibility:visible !important}";
      document.head.appendChild(st);
    }
    const root = document.getElementById("tb-print-root");
    const sheets = [...root.querySelectorAll(".tb-sheet, .qg-print-page")].filter((el) => !el.closest(".tb-measure, .qg-print-measure"));
    const blank = (s) => s.classList.contains("ms-blank-page");
    const text = (s) => (s.textContent || "").replace(/\s+/g, " ");
    // 홀수 쪽 시작: 표식(span[hidden]) 앞에 쌓인 쪽 수 + (빈 쪽이 끼었으면 1)이 짝수여야
    const marks = [...root.querySelectorAll("span[hidden]")];
    const badStarts = marks
      .map((m) => {
        const before = sheets.filter((s) => (s.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).length;
        const next = m.nextElementSibling;
        const add = next && next.classList.contains("ms-blank-page") ? 1 : 0;
        return (before + add) % 2;
      })
      .filter((x) => x === 1).length;
    const heads = sheets.filter((s) => !blank(s)).map((s) => (s.querySelector("h2 small")?.textContent || s.querySelector("h2")?.textContent || "").trim());
    return {
      sheets: sheets.length,
      blanks: sheets.filter(blank).length,
      over: sheets.map((s, i) => [i + 1, s.scrollHeight - s.clientHeight]).filter(([, d]) => d > 1).map(([i]) => i),
      empty: sheets.filter((s) => !blank(s) && text(s).replace(/\s/g, "").length < 40).length,
      junk: sheets
        .map((s, i) => [i + 1, text(s).match(/<u>|<\/u>|<blank|undefined|NaN|\[object Object\]|null/)?.[0]])
        .filter(([, m]) => m)
        .map(([i, m]) => `${i}:${m}`),
      badStarts,
      rounds: [...new Set(heads.map((h) => h.match(/(\d)차/)?.[1]).filter(Boolean))].join(""),
      answerRounds: [...new Set(heads.filter((h) => /정답/.test(h)).map((h) => h.match(/(\d)차/)?.[1]).filter(Boolean))].join(""),
      side: [...document.querySelectorAll("aside li")].map((l) => l.textContent).join(" ‖ "),
    };
  });

const result = [];
for (const u of units) {
  const key = `${u.publisher.includes("이병민") ? "이" : "윤"} ${u.grade} ${u.lesson_no}과`;
  const row = { key, id: u.id };
  errs = [];
  await page.goto(`http://localhost:3000/admin/middle-school/${u.id}?test=1`, { waitUntil: "networkidle0", timeout: 300000 });
  await wait(9000);
  row.normal = { ...(await measure()), errors: [...new Set(errs)] };
  errs = [];
  await page.evaluate(() => [...document.querySelectorAll("aside button")].find((b) => b.textContent.trim() === "길게")?.click());
  await wait(7000);
  row.long = { ...(await measure()), errors: [...new Set(errs)] };
  result.push(row);
  const bad = ["normal", "long"].filter((k) => {
    const v = row[k];
    return v.over.length || v.empty || v.junk.length || v.badStarts || v.errors.length || v.rounds !== v.answerRounds || !v.sheets;
  });
  console.log(key, `보통 ${row.normal.sheets}쪽(빈 ${row.normal.blanks}) 차시 ${row.normal.rounds}`, `길게 ${row.long.sheets}쪽`, bad.length ? "← 확인 " + bad.join(",") + " " + JSON.stringify(bad.map((k) => ({ over: row[k].over, empty: row[k].empty, junk: row[k].junk, bad: row[k].badStarts, r: row[k].rounds, a: row[k].answerRounds, e: row[k].errors }))) : "");
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
}
await browser.close();
console.log("끝");
