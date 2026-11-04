/**
 * 학교별 시험 묶음(로컬 dev 3000): 과마다 최종통합자료를 찍어 문제 쪽·정답 쪽으로 가르고,
 * 표지 하나·목차·과 간지를 앞에 붙여 문제 파일 + 정답지 파일을 만든다. 쪽 번호는 파일 전체로 잇는다.
 *   node scripts/middle-school/shot-book.mjs <출력 폴더>
 * 표지·간지는 임시 화면 /admin/ms-book-draft 로 뽑는다. 합치기는 scratchpad 의 merge 파이썬(JSON 계획을 받음).
 */
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const OUT = process.argv[2];
const TMP = path.join(OUT, "_tmp");
fs.mkdirSync(TMP, { recursive: true });
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ACADEMY = "79ea0a71-d148-46ac-8c8f-a3a3e4961838";
const ACADEMY_NAME = "정수학원";
const { data: who } = await admin.from("profiles").select("email").eq("role", "admin").eq("academy_id", ACADEMY).limit(1).single();
const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: who.email });
if (error) throw error;
const jar = new Map();
const sb = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach((c) => jar.set(c.name, c.value)) } });
const u = new URL(link.properties.action_link);
const { error: e2 } = await sb.auth.verifyOtp({ type: "magiclink", token_hash: u.searchParams.get("token") ?? u.searchParams.get("token_hash") });
if (e2) throw e2;

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 900000 });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.setViewport({ width: 1500, height: 1100 });
await page.setCookie(...[...jar.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 한 권만: --book=학교,중1,이,7-8 (없으면 동암중·발곡중 5~8과 네 권)
const one = process.argv.find((x) => x.startsWith("--book="))?.slice(7).split(",");
const pub = (k) => (k === "이" ? { publisher: "동아(이병민)", tag: "동아(이)" } : { publisher: "동아(윤정미)", tag: "동아(윤)" });
const BOOKS = one
  ? [{ school: one[0], grade: one[1], ...pub(one[2]) }]
  : [
      { school: "동암중", grade: "중1", ...pub("이") },
      { school: "동암중", grade: "중2", ...pub("이") },
      { school: "발곡중", grade: "중1", ...pub("윤") },
      { school: "발곡중", grade: "중2", ...pub("윤") },
    ];
const [fromL, toL] = (one?.[3] ?? "5-8").split("-").map(Number);
const LESSONS = Array.from({ length: toL - fromL + 1 }, (_, i) => fromL + i);
const RANGE = `${fromL}~${toL}과`;
const COLORS = ["#1d2a8f", "#0f8a7e", "#b4610a", "#6a4bd8"];
const AREAS = [["words", "단어"], ["dialogue", "대화문"], ["grammar", "문법"], ["reading", "본문"], ["exam", "변형문제"]];
const plan = [];

for (const b of BOOKS) {
  const name = `${b.school}_${b.grade}_${b.tag}_${fromL}-${toL}과`;
  const prob = { parts: [], pages: {}, dividers: [], lessons: [] };
  const ans = { parts: [], pages: {}, dividers: [], lessons: [] };
  let pn = 3; // 표지 1, 목차 2
  let an = 3;
  for (const [i, L] of LESSONS.entries()) {
    const { data: unit } = await admin.from("ms_units").select("id,title").eq("academy_id", ACADEMY).eq("grade", b.grade).eq("publisher", b.publisher).eq("lesson_no", L).single();
    await page.goto(`http://localhost:3000/admin/middle-school/${unit.id}`, { waitUntil: "networkidle0", timeout: 300000 });
    await page.evaluate(() => [...document.querySelectorAll("button")].find((el) => el.textContent?.trim().startsWith("최종통합자료"))?.click());
    await wait(12000);
    if (process.argv.includes("--분석지빼고")) {
      const off = await page.evaluate(() => {
        const l = [...document.querySelectorAll("aside label")].find((x) => x.textContent?.trim().startsWith("분석지"));
        const c = l?.querySelector("input");
        if (c?.checked) c.click();
        return !!c && !c.checked;
      });
      if (!off) throw new Error("분석지 칸을 못 끔");
    }
    await wait(10000);
    const info = await page.evaluate(() => {
      const sheets = [...document.querySelectorAll("#tb-print-root .tb-sheet, #tb-print-root .qg-print-page")].filter((el) => !el.closest(".tb-measure"));
      const parts = {};
      document.querySelectorAll("#tb-print-root [data-toc]").forEach((w) => {
        const f = [...w.querySelectorAll(".tb-sheet, .qg-print-page")].find((el) => !el.closest(".tb-measure"));
        parts[w.dataset.toc] = sheets.indexOf(f) + 1;
      });
      return { total: sheets.length, parts, overflow: sheets.filter((s) => s.scrollHeight - s.clientHeight > 1).length };
    });
    const ansStart = info.parts.answers;
    const part = { id: `L${L}`, no: String(L).padStart(2, "0"), en: `Lesson ${L}`, ko: unit.title, color: COLORS[i] };
    // 문제: 원본 3 ~ ansStart-1 / 정답: ansStart+1 ~ 끝(정답지 간지는 과 간지로 대신)
    const pDivider = pn;
    const pFirst = pn + 1;
    const pOffset = pFirst - 3;
    const aDivider = an;
    const aFirst = an + 1;
    const aOffset = aFirst - (ansStart + 1);
    // 쪽 머리 작은 글씨는 한 과 통합자료의 묶음 번호(「PART 06 · ANSWER KEY」)라 합본 과 간지(PART 07)와 어긋난다 → 「LESSON 7 · …」로
    await page.evaluate((L) => {
      document.querySelectorAll("#tb-print-root [data-toc]").forEach((w) => {
        const v = w.style.getPropertyValue("--tb-part");
        if (v) w.style.setProperty("--tb-part", v.replace(/PART \d+/, `LESSON ${L}`));
      });
    }, L);
    await page.evaluate(({ ansStart, pOffset, aOffset }) => {
      const st = document.createElement("style");
      st.textContent = ".ms-renum{font-size:0 !important}.ms-renum::after{content:attr(data-no);font-size:var(--ms-fs)}";
      document.head.appendChild(st);
      const sheets = [...document.querySelectorAll("#tb-print-root .tb-sheet, #tb-print-root .qg-print-page")].filter((el) => !el.closest(".tb-measure"));
      sheets.forEach((el, idx) => {
        const n = idx + 1;
        const no = el.querySelector(":scope > .tb-foot .tb-pgno") ?? el.querySelector(".qg-print-footer-page");
        if (!no) return;
        no.style.setProperty("--ms-fs", getComputedStyle(no).fontSize);
        no.setAttribute("data-no", `- ${n >= ansStart ? n + aOffset : n + pOffset} -`);
        no.classList.add("ms-renum");
      });
    }, { ansStart, pOffset, aOffset });
    const file = path.join(TMP, `${name}_L${L}.pdf`);
    await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true, timeout: 600000 });
    const items = AREAS.filter(([k]) => info.parts[k]).map(([k, ko], idx) => ({ id: k, index: idx, title: ko, source: null, page: info.parts[k] + pOffset }));
    prob.parts.push({ ...part, sub: items.map((x) => x.title).join(" · ") });
    prob.pages[part.id] = pDivider;
    prob.dividers.push({ part: { ...part, sub: "단어 · 대화문 · 문법 · 본문 · 변형문제" }, items });
    prob.lessons.push({ file, from: 3, to: ansStart - 1 });
    const aCount = info.total - ansStart;
    ans.parts.push({ ...part, sub: "워크북 정답 · 문제 해설" });
    ans.pages[part.id] = aDivider;
    ans.dividers.push({ part: { ...part, sub: "워크북 정답 · 문제 해설" }, items: [] });
    ans.lessons.push({ file, from: ansStart + 1, to: info.total });
    pn = pFirst + (ansStart - 3);
    an = aFirst + aCount;
    console.log(name, `${L}과`, "전체", info.total, "정답 시작", ansStart, "넘침", info.overflow);
  }
  for (const [kind, x, total, material] of [["문제", prob, pn - 1, "최종통합자료"], ["정답지", ans, an - 1, "최종통합자료 정답지"]]) {
    const d = { school: b.school, grade: b.grade, publisher: b.publisher, range: RANGE, material, title: `${b.school} ${b.grade} ${RANGE} ${material}`, academy: ACADEMY_NAME, parts: x.parts, pages: x.pages, total, dividers: x.dividers };
    await page.goto(`http://localhost:3000/admin/ms-book-draft?d=${encodeURIComponent(JSON.stringify(d))}`, { waitUntil: "networkidle0", timeout: 300000 });
    await wait(3000);
    const front = path.join(TMP, `${name}_${kind}_front.pdf`);
    await page.pdf({ path: front, preferCSSPageSize: true, printBackground: true });
    plan.push({ out: path.join(OUT, `${name}_${kind}.pdf`), front, lessons: x.lessons, total });
  }
}
fs.writeFileSync(path.join(TMP, "plan.json"), JSON.stringify(plan, null, 1));
await browser.close();
console.log("끝");
