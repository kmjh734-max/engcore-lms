/**
 * 내신콘서트 문제 인쇄 전수 점검(로컬 dev 3000, 값 없음).
 *   node scripts/middle-school/audit-concert-print.mjs <출력.json> [과 id 앞부분…]
 * 과마다 내신콘서트 문항 전부를 변형문제 인쇄 화면(문제지·해설지)으로 열어:
 *  - 쪽 넘침(쪽 안 글이 쪽 밖으로), 칸 밖으로 삐져나온 글(가로), 빈 쪽, 깨진 글자(<u>·undefined …)
 *  - 문항마다 발문 첫머리가 찍혔는지(빠진 문항), 해설지는 서술형 정답 첫머리가 찍혔는지
 *  - 해설지 정답 번호 글자색이 검정인지
 *  - PDF로 뽑아 쪽 수가 화면 쪽 수와 같은지(넘쳐서 쪽이 늘지 않았는지)
 */
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";

const OUT = process.argv[2];
const ONLY = process.argv.slice(3);
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
await page.setViewport({ width: 1400, height: 1100 });
await page.setCookie(...[...jar.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s ?? "").replace(/<\/?u>|<blank\/>/g, "").replace(/_{3,}/g, "").replace(/[\s\u00a0]+/g, "").toLowerCase();

const measure = () =>
  page.evaluate(() => {
    const st = document.getElementById("audit-cv") ?? Object.assign(document.createElement("style"), { id: "audit-cv", textContent: "*{content-visibility:visible !important}" });
    document.head.appendChild(st);
    const sheets = [...document.querySelectorAll("#qg-print-root .qg-print-page")];
    const text = (el) => (el.textContent || "").replace(/\s+/g, " ");
    const over = [];
    const wide = [];
    sheets.forEach((s, i) => {
      const r = s.getBoundingClientRect();
      const cs = getComputedStyle(s);
      const bottom = r.bottom - parseFloat(cs.paddingBottom) + 1;
      // 쪽 안 글자가 쪽 밖으로(세로) · 칸 밖으로(가로)
      for (const el of s.querySelectorAll(".qg-print-col *")) {
        if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const b = el.getBoundingClientRect();
        if (b.height === 0) continue;
        if (b.bottom > bottom) { over.push(`${i + 1}:${text(el).slice(0, 40)}`); break; }
      }
      for (const col of s.querySelectorAll(".qg-print-col")) {
        const cr = col.getBoundingClientRect();
        for (const el of col.querySelectorAll("*")) {
          const b = el.getBoundingClientRect();
          if (b.width && b.right > cr.right + 2) { wide.push(`${i + 1}:${text(el).slice(0, 40)}`); break; }
        }
      }
    });
    const marks = [...document.querySelectorAll("#qg-print-root .qg-print-answer-mark")];
    return {
      pages: sheets.length,
      over,
      wide,
      empty: sheets.filter((s) => text(s).replace(/\s/g, "").length < 60).map((_, i) => i + 1),
      junk: sheets.map((s, i) => [i + 1, text(s).match(/<u>|<\/u>|<blank|undefined|NaN|\[object Object\]|\bnull\b|\uFFFD/)?.[0]]).filter(([, m]) => m).map(([i, m]) => `${i}:${m}`),
      markColors: [...new Set(marks.map((m) => getComputedStyle(m).color))],
      all: norm2(sheets.map(text).join(" ")),
    };
    function norm2(s) { return s.replace(/_{3,}/g, "").replace(/[\s\u00a0]+/g, "").toLowerCase(); }
  });
const result = [];
for (const u of units) {
  const key = `${u.publisher.includes("이병민") ? "이" : "윤"} ${u.grade} ${u.lesson_no}과`;
  if (ONLY.length && !ONLY.some((o) => u.id.startsWith(o) || key.includes(o))) continue;
  const { data: qs0, error: qe } = await admin.from("ms_questions").select("id,source,no,kind,stem,body,answer,review").eq("unit_id", u.id).like("source", "내신콘서트%").order("id");
  const qs = (qs0 ?? []).filter((q) => !q.review);
  if (qe) console.log(key, qe.message);
  if (!qs.length) continue;
  const sel = qs.map((q) => q.id.toString(36)).join(".");
  const row = { key, n: qs.length };
  for (const mode of ["exam", "answers"]) {
    errs = [];
    await page.goto(`http://localhost:3000/admin/middle-school/${u.id}/exam/${sel}/print?mode=${mode}`, { waitUntil: "networkidle0", timeout: 300000 });
    await wait(6000);
    const m = await measure();
    // 빠진 문항: 발문 첫머리(묶음 아닌 서술형·객관식 모두) — 같은 발문이 많으니 문항 글(body) 첫 줄도 함께 본다
    const missing = [];
    if (mode === "exam")
    for (const q of qs) {
      const probe = norm((q.body?.[0] ?? q.stem)).slice(0, 18);
      if (probe.length >= 6 && !m.all.includes(probe)) missing.push(`${q.source.replace("내신콘서트 ", "")} ${q.no}`);
    }
    const missAns = [];
    if (mode === "answers")
      for (const q of qs) {
        if (q.kind !== "sa") continue;
        const probe = norm(q.answer).slice(0, 14);
        if (probe.length >= 3 && !m.all.includes(probe)) missAns.push(`${q.source.replace("내신콘서트 ", "")} ${q.no}`);
      }
    // PDF 쪽 수
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, timeout: 600000 });
    const pdfPages = (await PDFDocument.load(pdf)).getPageCount();
    const { all, ...rest } = m;
    row[mode] = { ...rest, pdfPages, missing: missing.slice(0, 20), missingN: missing.length, missAns: missAns.slice(0, 20), missAnsN: missAns.length, errors: [...new Set(errs)] };
    console.log(key, mode, JSON.stringify({ pages: m.pages, pdfPages, over: m.over.length, wide: m.wide.length, empty: m.empty.length, junk: m.junk.length, miss: missing.length, missAns: missAns.length, colors: m.markColors, errs: errs.length }));
  }
  result.push(row);
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
}
await browser.close();
