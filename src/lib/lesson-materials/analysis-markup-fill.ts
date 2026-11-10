/**
 * 지문분석서 성분 표시에서 모델이 자주 빠뜨리거나 자르는 것을 채운다(2026-10-27 저녁 22개 분석지 점검에서 33곳 —
 * 선생님 「그런 거 제대로 오류 안 나도록 해 놔」). 만들 때와 저장본을 읽을 때 둘 다 거친다(analysis-markup.ts).
 *  1. 의문문 앞 조동사(Will we be ~? Can we stop ~?)에 V가 없으면 단다.
 *  2. 주절 V가 없으면 S 바로 뒤 조동사·be·have부터 본동사까지 단다(are now looking — 사이의 M은 V 안으로).
 *  3. 주절 S가 없으면 문장 첫머리부터 V 앞까지를 S로 단다(긴 「명사 + 수식어」 주어).
 *  4. be able to를 C[able] + M[to …]로 쪼갠 것을 C[able to …] 하나로 합친다.
 *  5. 목적어·보어 자리 명사절(that 생략 포함) 괄호에 주절 O·C가 없으면 단다 — be동사 따위 뒤면 C, 아니면 O.
 *  6. to부정사로 끝나 목적어가 잘린 구간(to have killed | 50 to 100 million people)을 절 끝까지 넓힌다.
 * 선생님이 고친 문장(edited 표시가 하나라도 있음)은 건드리지 않는다. 확실하지 않으면 손대지 않는다.
 */
import type { MarkupBracket, MarkupRoleMark, MarkupSpan } from "@/lib/lesson-materials/analysis-markup";

const AUX_Q = new Set(["will", "would", "can", "could", "shall", "should", "may", "might", "must", "do", "does", "did"]);
const BE = new Set(["am", "is", "are", "was", "were", "be", "been", "being", "isn't", "aren't", "wasn't", "weren't"]);
const HAVE = new Set(["have", "has", "had"]);
const MODAL = new Set(["will", "would", "can", "could", "shall", "should", "may", "might", "must", "cannot", "won't", "can't", "do", "does", "did", "don't", "doesn't", "didn't"]);
const ADV_IN_V = /^(?:not|never|also|just|still|now|already|only|even|always|often|usually|really|recently|currently|actually|further|yet|ever|\w+ly)$/i;
/** 뒤에 오는 명사절이 주격보어가 되는 동사(나머지는 목적어) */
const LINK = new Set([...BE, "become", "becomes", "became", "seem", "seems", "seemed", "remain", "remains", "remained", "appear", "appears", "appeared"]);
/** 첫 낱말이 이것이면 주어가 아니다(전치사구·부사절·접속부사) */
const NOT_SUBJECT_START = new Set([
  "in", "on", "at", "with", "after", "before", "when", "whenever", "if", "unless", "because", "although", "though", "while", "as", "since",
  "by", "for", "during", "despite", "through", "without", "to", "however", "therefore", "thus", "moreover", "furthermore", "also", "instead",
  "then", "now", "today", "yet", "so", "and", "but", "or", "once", "until", "upon", "from", "of", "like", "unlike", "among", "according",
  "there", "here", "let's", "let’s", "what", "who", "which", "where", "why", "how", "whether", "do", "does", "did", "is", "are", "was", "were",
  "can", "could", "will", "would", "should", "may", "might", "must", "have", "has", "had", "not", "never", "only", "even", "just", "first",
  "please", "kindly", "it",
]);
/** 명사절(that절·간접의문문)을 목적어로 받는 동사(원형). 이 밖의 동사 뒤 that절은 동격·진주어일 수 있어 건드리지 않는다 */
const CLAUSE_VERB = new Set([
  "say", "tell", "think", "believe", "know", "argue", "claim", "show", "find", "realize", "mean", "prove", "state", "suggest", "explain",
  "notice", "learn", "understand", "see", "hope", "feel", "wonder", "discover", "remember", "forget", "decide", "expect", "report", "agree",
  "admit", "insist", "assume", "guess", "imagine", "recognize", "reveal", "indicate", "demonstrate", "write", "ask", "highlight", "involve",
  "determine", "recall", "predict", "confirm", "doubt", "acknowledge", "note", "observe", "conclude", "announce", "emphasize", "warn",
  "promise", "deny", "ensure", "consider", "describe", "teach", "check", "figure", "work", "illustrate", "emphasise", "recognise", "realise",
]);
const IRREGULAR_BASE: Record<string, string> = {
  said: "say", told: "tell", thought: "think", knew: "know", known: "know", found: "find", felt: "feel", saw: "see", seen: "see",
  wrote: "write", written: "write", taught: "teach", meant: "mean", understood: "understand", forgot: "forget", forgotten: "forget",
};
function clauseVerb(w: string): boolean {
  if (IRREGULAR_BASE[w]) return true;
  const cands = [w, w.replace(/s$/, ""), w.replace(/es$/, ""), w.replace(/ies$/, "y"), w.replace(/ied$/, "y"), w.replace(/ed$/, ""), w.replace(/d$/, ""), w.replace(/ing$/, ""), w.replace(/ing$/, "e")];
  return cands.some((c) => CLAUSE_VERB.has(c));
}
/** 구간 끝이 이 낱말이면 관계사·전치사 앞에서 끊긴 것이라 넓히지 않는다 */
const FUNCTION_END = new Set(["who", "whom", "whose", "which", "that", "where", "when", "the", "a", "an", "of", "to", "and", "or", "but", "as", "than", "with", "for", "in", "on", "at", "by", "from", "its", "their", "his", "her", "our"]);
/** to 뒤 이 낱말이면 전치사 to(to them, to humans)로 본다 */
const NOT_VERB_AFTER_TO = new Set(["me", "you", "him", "her", "it", "us", "them", "this", "that", "these", "those", "the", "a", "an", "his", "its", "our", "their", "my", "your"]);
const PARTICLE = "(?:up|down|away|out|off|on|over|in|back|around|through)";
/** 구간이 「to + 동사원형」(병렬·완료·수동 포함)으로 끝난다 */
const ENDS_WITH_TO_V = new RegExp(
  `(?:^|\\s)to(?:\\s+\\w+ly)?\\s+(?:(?:have|be|have\\s+been)\\s+)?([a-z]+)(?:\\s+${PARTICLE})?(?:\\s+(?:and|or)\\s+[a-z]+(?:\\s+${PARTICLE})?)?$`,
  "i"
);

const within = (a: MarkupSpan, b: MarkupSpan) => b.start <= a.start && a.end <= b.end;
const overlaps = (a: MarkupSpan, b: MarkupSpan) => a.start < b.end && b.start < a.end;
const crosses = (a: MarkupSpan, b: MarkupSpan) => overlaps(a, b) && !within(a, b) && !within(b, a);
const words = (s: string) => s.toLowerCase().match(/[a-z’']+/g) ?? [];
const looksLikeVerb = (w: string) => /(?:ing|ed|en)$/.test(w) || ["made", "done", "gone", "known", "seen", "found", "built", "kept", "left", "brought", "thought", "taught", "held", "told", "sold", "paid", "put", "set", "led", "met", "won", "lost", "felt", "heard", "meant", "run", "cut", "shown", "grown", "drawn", "given", "taken", "written", "driven", "chosen", "spoken"].includes(w);

type Tok = { w: string; start: number; end: number };
function tokens(text: string, from: number, to: number): Tok[] {
  const out: Tok[] = [];
  const re = /[A-Za-z’'-]+|\d[\d,.%]*/g;
  re.lastIndex = from;
  for (let m = re.exec(text); m && m.index < to; m = re.exec(text)) out.push({ w: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  return out;
}

export function fillMissingRoles(text: string, roles: MarkupRoleMark[], brackets: MarkupBracket[]): MarkupRoleMark[] {
  if (roles.some((r) => r.edited)) return roles;
  let rs = roles.map((r) => ({ ...r, span: { ...r.span } }));
  const sort = () => rs.sort((a, b) => a.span.start - b.span.start || b.span.end - a.span.end);
  const covered = (s: MarkupSpan, level = 2) => rs.some((r) => r.level <= level && overlaps(r.span, s));
  const clashes = (s: MarkupSpan) => brackets.some((b) => crosses(b.span, s)) || rs.some((r) => crosses(r.span, s));
  const add = (span: MarkupSpan, role: MarkupRoleMark["role"], level: MarkupRoleMark["level"]) => {
    if (span.end <= span.start || clashes(span)) return false;
    rs.push({ span, role, level });
    sort();
    return true;
  };
  sort();
  const main = (role: string) => rs.filter((r) => r.level === 0 && r.role === role);

  // 1. 의문문 앞 조동사
  const all = tokens(text, 0, text.length);
  const first = all[0];
  if (first && /\?["”’)]*\s*$/.test(text) && (AUX_Q.has(first.w) || BE.has(first.w) || HAVE.has(first.w)) && !covered(first)) {
    const next = rs.find((r) => r.span.start >= first.end);
    if (next && next.level === 0 && next.role === "S") add({ start: first.start, end: first.end }, "V", 0);
  }

  // 2. 주절 V: S 바로 뒤 조동사·be·have부터
  if (!main("V").length) {
    for (const s of main("S")) {
      const after = tokens(text, s.span.end, text.length);
      const head = after[0];
      if (!head || !/^\s*$/.test(text.slice(s.span.end, head.start))) continue;
      if (!MODAL.has(head.w) && !BE.has(head.w) && !HAVE.has(head.w)) continue;
      let end = head.end;
      let i = 1;
      while (after[i] && ADV_IN_V.test(after[i]!.w)) i++;
      const verb = after[i];
      const chain = verb && (MODAL.has(head.w) || looksLikeVerb(verb.w) || ((BE.has(verb.w) || HAVE.has(verb.w)) && after[i + 1] && looksLikeVerb(after[i + 1]!.w)));
      if (chain) end = (BE.has(verb.w) || HAVE.has(verb.w)) && !MODAL.has(head.w) ? after[i + 1]!.end : verb.end;
      const span = { start: head.start, end };
      // 넓힌 V 안에 든 같은 층 M(now·still)은 뗀다
      rs = rs.filter((r) => !(r.level === 0 && r.role === "M" && within(r.span, span)));
      if (rs.some((r) => overlaps(r.span, span))) continue;
      if (add(span, "V", 0)) break;
    }
  }

  // 3. 주절 S: 첫머리(앞쪽 M·삽입 뒤)부터 V 앞까지
  const v0 = main("V")[0];
  if (v0 && !main("S").length) {
    let from = 0;
    for (const r of rs) if (r.level === 0 && r.role === "M" && r.span.end <= v0.span.start && /^[\s,]*$/.test(text.slice(from, r.span.start))) from = r.span.end;
    const seg = tokens(text, from, v0.span.start);
    if (seg.length && !NOT_SUBJECT_START.has(seg[0]!.w) && /^[\s,“"]*$/.test(text.slice(from, seg[0]!.start))) {
      const span = { start: seg[0]!.start, end: seg[seg.length - 1]!.end };
      // 사이는 공백만, 같은 층 표시·부사절과 겹치지 않을 때
      if (/^[\s]*$/.test(text.slice(span.end, v0.span.start)) && !covered(span, 0) && !brackets.some((b) => b.kind === "adverbial" && overlaps(b.span, span))) add(span, "S", 0);
    }
  }

  // 4. be able to: C[able] + 바로 뒤 [to …]
  for (const c of rs.filter((r) => r.role === "C" && /^(?:(?:more|better|less)\s+)?(?:un)?able$/i.test(text.slice(r.span.start, r.span.end).trim()))) {
    const next = rs.find((r) => r !== c && r.level === c.level && r.span.start >= c.span.end && /^\s+$/.test(text.slice(c.span.end, r.span.start)));
    if (!next || !/^to\s/i.test(text.slice(next.span.start, next.span.end))) continue;
    c.span = { start: c.span.start, end: next.span.end };
    rs = rs.filter((r) => r !== next);
  }

  // 5. 동사 바로 뒤 명사절 괄호에 O·C
  for (const b of brackets) {
    if (b.kind !== "nominal") continue;
    const v = rs.filter((r) => r.role === "V" && r.span.end <= b.span.start && /^\s*$/.test(text.slice(r.span.end, b.span.start))).pop();
    if (!v) continue;
    // 그 층에 이미 이 자리를 덮는 표시가 있거나, 안쪽 성분이 같은 층이면(절로 안 봄) 건드리지 않는다
    if (rs.some((r) => r.level <= v.level && overlaps(r.span, b.span))) continue;
    if (!rs.some((r) => r.level > v.level && within(r.span, b.span))) continue;
    const vw = words(text.slice(v.span.start, v.span.end));
    const last = vw[vw.length - 1] ?? "";
    // 수동태(It is estimated that ~)·가주어 it(It seems that ~)은 진주어라 건드리지 않는다
    const passive = vw.some((w) => BE.has(w)) && looksLikeVerb(last) && !BE.has(last);
    const subj = rs.filter((r) => r.role === "S" && r.level === v.level && r.span.end <= v.span.start).pop();
    if (passive || (subj && /^it$/i.test(text.slice(subj.span.start, subj.span.end).trim()))) continue;
    if (LINK.has(last)) add(b.span, "C", v.level);
    else if (clauseVerb(last)) add(b.span, "O", v.level);
  }

  // 6. to부정사로 끝난 구간을 절 끝까지
  for (const r of rs) {
    if (r.role === "V" || r.role === "S") continue;
    const own = text.slice(r.span.start, r.span.end);
    const m = ENDS_WITH_TO_V.exec(own);
    const tw = m?.[1]?.toLowerCase() ?? "";
    // to them · to places(복수 명사)는 전치사 to
    if (!m || NOT_VERB_AFTER_TO.has(tw) || (/s$/.test(tw) && !/(?:ss|us)$/.test(tw))) continue;
    // 다음 경계: 같은 층 이하 표시 · 쉼표 따위 · 부사절 괄호
    let end = text.length;
    for (const o of rs) if (o !== r && o.level <= r.level && o.span.start >= r.span.end) end = Math.min(end, o.span.start);
    for (const b of brackets) if (b.kind === "adverbial" && b.span.start >= r.span.end) end = Math.min(end, b.span.start);
    const punct = /[,;:—–()?!]|\.(?=\s|["”’)]*$)/.exec(text.slice(r.span.end, end));
    if (punct) {
      end = r.span.end + punct.index;
      // 쉼표에서 멈췄는데 쉼표 뒤가 새 성분으로 시작하지 않으면 이름·나열 안의 쉼표일 수 있다(the Monuments, Fine Arts, and ~)
      if (punct[0] === ",") {
        const after = text.slice(end + 1).match(/^s*/)![0].length + end + 1;
        if (!rs.some((o) => o.level <= r.level && o.span.start === after) && !brackets.some((b) => b.span.start === after)) continue;
      }
    }
    let ext = text.slice(r.span.end, end).replace(/\s+(?:and|or|but)\s*$/i, "").replace(/\s+$/, "");
    if (!/[A-Za-z0-9]/.test(ext) || FUNCTION_END.has((ext.toLowerCase().match(/[a-z’']+$/) ?? [""])[0])) continue;
    // 사이에 같은 층 표시가 있으면(그 사이 표시가 이미 성분) 넓히지 않는다
    const span = { start: r.span.start, end: r.span.end + ext.length };
    if (rs.some((o) => o !== r && o.level <= r.level && overlaps(o.span, { start: r.span.end, end: span.end }))) continue;
    if (brackets.some((b) => crosses(b.span, span)) || rs.some((o) => o !== r && crosses(o.span, span))) continue;
    r.span = span;
    ext = "";
  }

  sort();
  return extendCutPhrases(text, rs, brackets);
}

/*
 * 7. 중심어에서 끊긴 주어·목적어·보어를 뒤 수식어까지(2026-11-10 전수 점검 — 214개 분석서 1,986문장 중 49곳으로 가장 많은 꼴):
 * S[less than ten percent] of the world’s plastic waste V[has been recycled] → S가 of구까지. 설명(★ 수일치 「of 뒤 명사」)은
 * 그 명사를 가리키는데 표시는 밖에 있어 학생이 헷갈렸다.
 * 넓히는 것: 구간 바로 뒤(빈칸만)에 표시 없는 수식어가 이어지고, 그다음 같은 층 이하 성분까지 쉼표·괄호 없이 닿을 때.
 *  - S: of·전치사구·관계사절·분사(-ing/-ed)·to부정사로 시작할 때
 *  - O·C: of구·관계사절(which·who·whom·whose)로 시작할 때만(gave O[the book] to her 같은 부사어, told O[me] that ~의
 *    둘째 목적어 that절을 먹지 않게)
 * 사이에 든 더 깊은 층 성분(관계사절 안 S1·V1)은 그대로 안에 둔다.
 */
const S_POSTMOD = /^(?:of|in|on|at|for|with|from|about|between|among|behind|around|near|inside|outside|like|to|that|which|who|whom|whose|where|[a-z]+ing|[a-z]+ed)$/i;
const OC_POSTMOD = /^(?:of|which|who|whom|whose)$/i;
/** 넓힌 구간 끝에 남으면 안 되는 낱말(뒤에 붙은 부사·기능어 — support of their team | sometimes) */
const TRAIL_DROP = /^(?:and|or|but|nor|to|of|the|a|an|sometimes|often|always|never|also|still|even|just|only|usually|typically|already|now|then|too|rarely|seldom|really|actually|probably|certainly|[a-z]+ly)$/i;
/** O·C를 넓힐 때 여기서 멈춘다 — 동사에 걸린 부사구(the benefits of space technology | in our daily lives) */
const ADV_PREP = /^(?:in|on|at|for|during|since|until|by|into|over|through|across|after|before|with|without|throughout)$/i;
const WH_WORD = /^(?:what|where|when|why|how|who|whom|whose|which|that|whether)$/i;

export function extendCutPhrases(text: string, roles: MarkupRoleMark[], brackets: MarkupBracket[]): MarkupRoleMark[] {
  if (roles.some((r) => r.edited)) return roles;
  const rs = roles.map((r) => ({ ...r, span: { ...r.span } })).sort((a, b) => a.span.start - b.span.start || b.span.end - a.span.end);
  for (const r of rs) {
    if (r.role !== "S" && r.role !== "O" && r.role !== "C") continue;
    const gapStart = r.span.end;
    const firstWord = /^\s+([A-Za-z’']+)/.exec(text.slice(gapStart));
    if (!firstWord) continue;
    const isS = r.role === "S";
    if (!(isS ? S_POSTMOD : OC_POSTMOD).test(firstWord[1]!)) continue;
    // 쉼표로 끝난 구간 뒤 which·who는 계속적 용법이라 성분 밖이다(“Sugungga,” which is ~)
    if (/,["”’]*\s*$/.test(text.slice(r.span.start, gapStart))) continue;
    const next = rs.find((o) => o !== r && o.level <= r.level && o.span.start >= gapStart);
    // S는 바로 다음 같은 층 성분이 V여야 한다(V가 C로 잘못 달린 문장에서 동사까지 먹지 않게). O·C는 없으면 문장 끝까지.
    if (isS && next?.role !== "V") continue;
    let gap = text.slice(gapStart, next ? next.span.start : text.length);
    if (!next) gap = gap.replace(/[\s.!?"”’]*$/, "");
    gap = gap.replace(/\s+$/, "");
    // 문장이 둘 붙었거나(마침표 뒤 대문자·□·!?) 쉼표·괄호·대시·따옴표가 끼면 다른 덩어리일 수 있어 넓히지 않는다
    if (!gap.trim() || /[,;:()—–"“”□!?]/.test(gap) || /\.\s+[A-Z]/.test(gap)) continue;
    // 낱말 단위로: O·C는 부사구 전치사에서 멈추고(의문사·관계사가 나온 뒤는 절 안이라 계속), 끝의 부사·기능어는 뗀다
    const toks = [...gap.matchAll(/[A-Za-z0-9’'.-]+/g)].map((m) => ({ w: m[0], end: m.index! + m[0].length }));
    let keep = toks.length;
    if (!isS) {
      let inClause = false;
      for (let i = 0; i < toks.length; i++) {
        if (WH_WORD.test(toks[i]!.w)) inClause = true;
        if (!inClause && i >= 2 && ADV_PREP.test(toks[i]!.w)) {
          keep = i;
          break;
        }
      }
    }
    while (keep > 0 && TRAIL_DROP.test(toks[keep - 1]!.w.replace(/\.$/, ""))) keep--;
    if (keep < 1 || (keep < 2 && !isS)) continue;
    const span = { start: r.span.start, end: gapStart + toks[keep - 1]!.end };
    // 사이에 같은 층 이하 표시가 있거나, 괄호·다른 표시와 엇갈리면 건드리지 않는다
    if (rs.some((o) => o !== r && o.level <= r.level && overlaps(o.span, { start: gapStart, end: span.end }))) continue;
    if (brackets.some((b) => crosses(b.span, span)) || rs.some((o) => o !== r && crosses(o.span, span))) continue;
    // 부사절 괄호가 사이에서 시작하면(S when ~ V) 넓히지 않는다
    if (brackets.some((b) => b.kind === "adverbial" && b.span.start >= gapStart && b.span.start < span.end)) continue;
    r.span = span;
  }
  return rs;
}
