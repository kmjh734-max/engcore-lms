/**
 * 문장성분 표시를 표기 규칙대로 맞춘다(2026-10-22 선생님 확정). 만들 때와 저장본을 읽을 때 둘 다 지나므로
 * 규칙을 고치면 예전 분석지에도 바로 반영된다. 모델이 무엇을 내놓든 아래만은 코드가 지킨다.
 *
 *  1. 5형식 목적격보어 자리의 준동사(allows hanji to maintain, make you feel)는 V가 아니라 C.
 *  2. 준동사(to부정사·동명사·분사)는 동사가 아니다 — V를 떼고, 그 준동사가 거느린 안쪽 성분(목적어 등)도 뗀다.
 *     명사를 꾸미는 분사(systems found in ~, people called ~)도 같다.
 *  3. 술어 V는 조동사·be·have부터 한 구간(found → was found, influence → can significantly influence).
 *  4. There·Let's와 관계대명사에는 S를 달지 않는다.
 *  5. 넓힌 V 안에 들어간 M 같은 겹친 표시는 뗀다.
 * 확실하지 않으면 손대지 않는다(틀린 표시를 새로 만들지 않는다).
 */
import type { MarkupBracket, MarkupRoleMark, MarkupSpan } from "@/lib/lesson-materials/analysis-markup";

const AUX = new Set([
  "am", "is", "are", "was", "were", "be", "been", "being",
  "has", "have", "had", "do", "does", "did",
  "can", "could", "will", "would", "shall", "should", "may", "might", "must", "cannot",
  "not", "isn't", "aren't", "wasn't", "weren't", "don't", "doesn't", "didn't", "can't", "couldn't",
  "won't", "wouldn't", "shouldn't", "mustn't", "haven't", "hasn't", "hadn't",
]);
/** 조동사와 본동사 사이에 낄 수 있는 부사 */
const BETWEEN = /^(never|also|just|still|often|always|already|even|only|really|truly|actually|probably|likely|certainly|simply|usually|sometimes|ever|soon|then|now|all|both|first|once|again|[a-z]+ly)$/i;
/** to 앞에서 조동사처럼 묶이는 말(have to · used to · be going to · be able to · ought to) */
const TO_MODAL = new Set(["have", "has", "had", "used", "going", "able", "ought"]);
/** 목적어 뒤에 준동사를 목적격보어로 두는 동사(원형) */
const OC_VERBS = new Set([
  "allow", "enable", "cause", "want", "ask", "tell", "expect", "encourage", "force", "help", "make", "let",
  "have", "get", "see", "watch", "hear", "feel", "notice", "find", "keep", "leave", "imagine", "convince",
  "persuade", "advise", "order", "urge", "permit", "invite", "remind", "warn", "beg", "witness", "observe",
]);
/** 능동에서 목적격보어로 to 없는 원형·분사만 받는 동사(make O to V는 목적격보어가 아니다) */
const BARE_OC = new Set(["make", "let", "have", "see", "watch", "hear", "feel", "notice", "witness", "observe"]);
const PRONOUN_SUBJECT = new Set(["i", "you", "he", "she", "it", "we", "they", "who", "which", "that"]);
const IRREGULAR_PP = new Set([
  "found", "made", "called", "known", "born", "built", "shown", "given", "taken", "written", "seen", "done",
  "used", "left", "kept", "held", "brought", "set", "put", "lit", "led", "grown", "thrown", "worn", "torn",
  "chosen", "frozen", "spoken", "broken", "hidden", "driven", "drawn", "eaten", "fallen", "forgotten",
  "gotten", "hung", "laid", "lost", "paid", "read", "sold", "sent", "spent", "told", "understood", "won",
  "bought", "caught", "taught", "thought", "felt", "heard", "meant", "run", "cut", "hit", "shut", "spread",
]);
const NO_SUBJECT = new Set(["there", "let's", "let’s", "lets"]);
const RELATIVE_PRONOUN = new Set(["who", "whom", "whose", "which", "that"]);
/** 이 낱말 바로 뒤의 who·which·that은 관계대명사가 아니다(앞에 선행사 명사가 없다) */
// how·what·why·where·whether 뒤 that은 간접의문문 안 지시대명사 주어(how that might change — 2026-11-10)
const AFTER_CONJ = /\b(if|when|because|since|although|though|while|unless|once|until|and|but|or|so|how|what|why|where|whether)\s*,?\s*$/i;
const ING_BASE = new Set(["bring", "sing", "ring", "swing", "cling", "fling", "sting", "spring", "string", "wring", "sling"]);

type Tok = { w: string; start: number; end: number };

function tokens(text: string): Tok[] {
  const out: Tok[] = [];
  const re = /[A-Za-z0-9]+(?:['’][A-Za-z]+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ w: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

const lower = (s: string) => s.toLowerCase().replace(/’/g, "'");
const slice = (t: string, s: MarkupSpan) => t.slice(s.start, s.end);
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const inside = (a: MarkupSpan, b: MarkupSpan) => b.start <= a.start && a.end <= b.end;
const crosses = (a: MarkupSpan, b: MarkupSpan) =>
  a.start < b.end && b.start < a.end && !inside(a, b) && !inside(b, a);

/** 원형 비슷하게(makes→make, allowed→allow, helping→help). 목록 대조에만 쓴다. */
function lemma(w: string): string {
  const x = lower(w);
  if (x.endsWith("ies")) return x.slice(0, -3) + "y";
  if (/(ss|sh|ch|x|z)es$/.test(x)) return x.slice(0, -2);
  if (x.endsWith("ing")) return x.slice(0, -3);
  if (x.endsWith("ed")) return x.slice(0, -2);
  if (x.endsWith("s") && !x.endsWith("ss")) return x.slice(0, -1);
  return x;
}
const IRREGULAR_BASE: Record<string, string> = {
  made: "make", let: "let", had: "have", has: "have", got: "get", saw: "see", seen: "see", heard: "hear",
  felt: "feel", found: "find", kept: "keep", left: "leave", told: "tell", asked: "ask",
};
/** 동사 구간의 본동사 원형(목록에 없으면 "") */
function ocVerbBase(verbText: string): string {
  const head = lower(words(verbText).pop() ?? "");
  if (IRREGULAR_BASE[head]) return IRREGULAR_BASE[head]!;
  const l = lemma(head);
  for (const c of [head, l, l + "e"]) if (OC_VERBS.has(c)) return c;
  return "";
}
const isPastParticiple = (w: string) => /[a-z]ed$/i.test(w) || IRREGULAR_PP.has(lower(w));

/** 앞 낱말과 사이가 빈칸뿐인가(쉼표·따옴표가 끼면 다른 덩어리다) */
const gapIsSpace = (text: string, a: number, b: number) => /^\s*$/.test(text.slice(a, b));

export function normalizeMarkupRoles(
  text: string,
  roles: MarkupRoleMark[],
  brackets: MarkupBracket[] = []
): MarkupRoleMark[] {
  // 선생님이 고친 성분은 그대로 두고, 그 자리와 겹치는 나머지만 규칙대로 맞춘다
  const fixed = roles.filter((r) => r.edited);
  if (fixed.length > 0) {
    const rest = normalizeMarkupRoles(text, roles.filter((r) => !r.edited), brackets);
    const clash = (a: MarkupRoleMark) => fixed.some((f) => f.span.start === a.span.start && f.span.end === a.span.end);
    return [...rest.filter((r) => !clash(r)), ...fixed.map((r) => ({ ...r, span: { ...r.span } }))].sort(
      (a, b) => a.span.start - b.span.start
    );
  }
  const toks = tokens(text);
  const tokBefore = (pos: number): Tok | undefined => {
    let hit: Tok | undefined;
    for (const t of toks) {
      if (t.end <= pos) hit = t;
      else break;
    }
    return hit && gapIsSpace(text, hit.end, pos) ? hit : undefined;
  };

  let rs: MarkupRoleMark[] = roles
    .map((r) => ({ ...r, span: { ...r.span } }))
    .sort((a, b) => a.span.start - b.span.start);

  // 4. There · Let's 에 단 S
  // Let’s의 ’s 하나에만 단 S도 뗀다(2026-10-28 「Let’s take a look」에 S[’s])
  rs = rs.filter((r) => {
    if (r.role !== "S") return true;
    const w = lower(slice(text, r.span).trim());
    if (NO_SUBJECT.has(w)) return false;
    return !(w === "'s" && /\blet\s*$/i.test(text.slice(0, r.span.start)));
  });
  // 관계대명사 자체에는 S를 달지 않는다. 명사절 괄호 안의 의문대명사는 관계대명사가 아니므로 남긴다.
  // 접속사 바로 뒤의 that(If that were the case)은 지시대명사 주어라 남긴다(2026-10-28)
  rs = rs.filter((r) => {
    if (r.role !== "S" || !RELATIVE_PRONOUN.has(lower(slice(text, r.span).trim()))) return true;
    if (AFTER_CONJ.test(text.slice(0, r.span.start))) return true;
    // 문장 첫머리·세미콜론·콜론 뒤의 that은 지시대명사 주어다(…; that is why — 2026-11-10 점검 b147f2c5 #9)
    if (/(?:^|[;:])\s*["“]?\s*$/.test(text.slice(0, r.span.start))) return true;
    /*
     * 명사절 괄호 안의 의문대명사(I know who came)는 남긴다 — 단 괄호 맨 앞 낱말일 때만. 예전엔 괄호 안에 있기만 하면
     * 남겨, 목적어 that절 안의 관계대명사(space technology that has not yet been invented)에도 S가 보였다
     * (2026-11-10 전수 점검 96a2ac02 #10 등).
     */
    const startsNominalClause = brackets.some(
      (bracket) => bracket.kind === "nominal" && inside(r.span, bracket.span) && /^\s*$/.test(text.slice(bracket.span.start, r.span.start))
    );
    return r.level === 0 || startsNominalClause;
  });
  // 명사절 접속사(proves that the world is ~의 that)에 단 성분: 바로 뒤가 더 깊은 층의 S면 접속사다
  rs = rs.filter((r, i) => {
    if (!["that", "whether", "if"].includes(lower(slice(text, r.span).trim()))) return true;
    const next = rs[i + 1];
    return !(next && next.role === "S" && next.level > r.level);
  });

  // 3. 술어 V를 조동사부터 한 구간으로
  for (const r of rs) {
    if (r.role !== "V") continue;
    let start = r.span.start;
    let pos = start;
    let sawAux = false;
    let pendingBetween: number | null = null;
    for (let guard = 0; guard < 6; guard++) {
      const t = tokBefore(pos);
      if (!t) break;
      const w = lower(t.w);
      // I'd made · we've done 처럼 붙은 조동사: 따옴표부터만 붙인다
      const contr = /^[a-z]+(['](d|ve|ll|re|m|s))$/.exec(w);
      if (contr && !AUX.has(w) && w !== "let's") {
        start = t.end - contr[1]!.length;
        sawAux = true;
        break;
      }
      if (w === "to") {
        const prev = tokBefore(t.start);
        if (prev && TO_MODAL.has(lower(prev.w))) {
          start = prev.start;
          pos = prev.start;
          sawAux = true;
          pendingBetween = null;
          continue;
        }
        break;
      }
      if (AUX.has(w)) {
        start = t.start;
        pos = t.start;
        sawAux = true;
        pendingBetween = null;
        continue;
      }
      if (BETWEEN.test(w) && pendingBetween === null) {
        pendingBetween = start;
        pos = t.start;
        continue;
      }
      break;
    }
    // 부사만 건너고 조동사를 못 만났으면 되돌린다
    if (!sawAux || start >= r.span.start) continue;
    const next = { start, end: r.span.end };
    // 넓힌 자리가 다른 성분·괄호와 반쯤 걸치면 넓히지 않는다
    if (rs.some((o) => o !== r && crosses(o.span, next)) || brackets.some((b) => crosses(b.span, next))) continue;
    // 조동사 자리에 이미 다른 V가 있으면(따로 단 조동사) 건드리지 않는다
    if (rs.some((o) => o !== r && o.role === "V" && inside(o.span, next) && o.span.end <= r.span.start)) continue;
    r.span = next;
  }
  // 5. 넓힌 V 안에 들어간 다른 표시는 뗀다. V 안에 또 V가 있으면(is lit 안의 is) 같은 낱말의 다음 자리로 옮겨 본다
  const covered = (o: MarkupRoleMark) =>
    rs.some((v) => v !== o && v.role === "V" && inside(o.span, v.span) && !(o.span.start === v.span.start && o.span.end === v.span.end));
  for (const o of rs) {
    if (o.role !== "V" || !covered(o)) continue;
    const q = slice(text, o.span);
    const re = new RegExp(`(?<![A-Za-z0-9])${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const sp = { start: m.index, end: m.index + q.length };
      if (rs.some((x) => x !== o && x.span.start < sp.end && sp.start < x.span.end)) continue;
      o.span = sp;
      break;
    }
  }
  rs = rs.filter((o) => !covered(o)).sort((a, b) => a.span.start - b.span.start);

  const sameLevelS = (level: number) => rs.some((x) => x.role === "S" && x.level === level);
  const startsWithTo = (r: MarkupRoleMark) => /^to\s/i.test(slice(text, r.span));
  const afterTo = (r: MarkupRoleMark) => {
    const t = tokBefore(r.span.start);
    return !!t && lower(t.w) === "to";
  };

  // 1. 목적격보어 자리의 준동사 → C
  const toC = new Set<MarkupRoleMark>();
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i]!;
    if (r.role !== "V") continue;
    const w = words(slice(text, r.span));
    // 바로 앞이 목적어(사이에 to만 있을 수 있음)
    const prev = rs[i - 1];
    if (!prev || prev.role !== "O") continue;
    const gap = text.slice(prev.span.end, r.span.start);
    if (r.span.start < prev.span.end || !/^\s*(to\s+)?$/i.test(gap)) continue;
    // 그 목적어를 거느린 동사가 5형식 동사
    const verb = [...rs.slice(0, i - 1)].reverse().find((x) => x.role === "V" && x.level === prev.level);
    const base = verb ? ocVerbBase(slice(text, verb.span)) : "";
    if (!base) continue;
    const hasTo = /^\s*to\s+$/i.test(gap) || startsWithTo(r);
    const isBareComplement = !hasTo && BARE_OC.has(base) && w.length >= 1;
    const looksNonFinite =
      startsWithTo(r) ||
      afterTo(r) ||
      isBareComplement ||
      /ing$/i.test(w[0] ?? "") ||
      (w.length === 1 && (isPastParticiple(w[0]!) || r.level > 0));
    if (!looksNonFinite) continue;
    // to 뒤 -ing는 전치사 to(contribution to promoting), make·let·지각동사 뒤 to V는 목적격보어가 아니다
    if (hasTo && (/ing$/i.test(w[w.length - 1] ?? "") || BARE_OC.has(base))) continue;
    if (/^\s*to\s+$/i.test(gap)) r.span = { start: prev.span.end + gap.indexOf("to"), end: r.span.end };
    r.role = "C";
    r.level = prev.level;
    toC.add(r);
  }
  // 목적격보어끼리 and로 이어진 것(being kidnapped ... and taken)
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i]!;
    if (r.role !== "V" || r.level === 0) continue;
    const t = tokBefore(r.span.start);
    if (!t || !["and", "or"].includes(lower(t.w))) continue;
    const sib = [...rs.slice(0, i)].reverse().find((x) => toC.has(x));
    if (!sib) continue;
    const between = rs.slice(rs.indexOf(sib) + 1, i);
    if (between.some((x) => (x.role === "S" || x.role === "V") && x.level <= r.level)) continue;
    r.role = "C";
    r.level = sib.level;
    toC.add(r);
  }

  // 2. 준동사 V를 떼고, 그 준동사가 거느린 성분도 뗀다
  const drop = new Set<MarkupRoleMark>();
  /**
   * 준동사가 거느린 성분: 뒤로 이어지는 같은 층의 O·C·M·A, and로 이어진 같은 층 준동사(weed, dig, and firm),
   * 그보다 깊은 층 가운데 S·V가 없는 것(to access Korean content의 O2). 깊은 층에 S·V가 있으면 따로 선 절이라 둔다.
   */
  const dropRun = (from: number, level: number) => {
    const deeper: MarkupRoleMark[] = [];
    for (let j = from + 1; j < rs.length; j++) {
      const x = rs[j]!;
      if (x.level < level) break;
      if (x.level === level && x.role === "S") break;
      if (x.level === level && x.role === "V") {
        const t = tokBefore(x.span.start);
        const coord = (!!t && ["and", "or"].includes(lower(t.w))) || /,\s*$/.test(text.slice(0, x.span.start));
        if (!coord || words(slice(text, x.span)).length !== 1) break;
        drop.add(x);
        continue;
      }
      if (x.level === level) drop.add(x);
      else deeper.push(x);
    }
    for (const lv of new Set(deeper.map((x) => x.level))) {
      const at = deeper.filter((x) => x.level === lv);
      if (!at.some((x) => x.role === "S" || x.role === "V")) at.forEach((x) => drop.add(x));
    }
  };
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i]!;
    if (toC.has(r)) {
      dropRun(i, r.level + 1);
      continue;
    }
    if (r.role !== "V" || r.level === 0) continue;
    const w = words(slice(text, r.span));
    const head = w[0] ?? "";
    const prevTok = tokBefore(r.span.start);
    // 도치 의문문(What are you doing ~?)은 조동사가 주어 앞으로 가 있어 -ing가 술어다
    const prevRole = rs[i - 1];
    if (prevRole && prevRole.role === "S" && prevRole.level === r.level) {
      const auxTok = tokBefore(prevRole.span.start);
      if (auxTok && AUX.has(lower(auxTok.w))) continue;
    }
    const nonFinite =
      startsWithTo(r) ||
      afterTo(r) ||
      // 술어 -ing는 늘 be와 함께다. 한 낱말 -ing는 준동사(bring·sing 같은 원형은 뺀다)
      (w.length === 1 && /ing$/i.test(head) && !ING_BASE.has(lower(head))) ||
      (w.length === 1 &&
        isPastParticiple(head) &&
        !sameLevelS(r.level) &&
        !(prevTok && PRONOUN_SUBJECT.has(lower(prevTok.w))));
    if (!nonFinite) continue;
    drop.add(r);
    dropRun(i, r.level);
  }
  rs = rs.filter((r) => !drop.has(r));
  // 종속 층에 V가 하나도 남지 않았으면 그 층의 성분은 기댈 데가 없다(준동사 안쪽이었거나 절이 깨진 것)
  const levelsWithV = new Set(rs.filter((r) => r.role === "V").map((r) => r.level));
  return rs.filter((r) => r.level === 0 || levelsWithV.has(r.level));
}
