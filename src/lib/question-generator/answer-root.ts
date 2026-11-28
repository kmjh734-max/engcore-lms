/**
 * 요약표 빈칸처럼 「형태를 바꿔 쓰는」 답이 지문에 뿌리가 있는지 — 앞 글자 맞대기로 모르는 불규칙 꼴만 본다.
 * 만들 때 검사(generate-question)와 규칙 검수(validate-question)가 같은 잣대를 쓴다(2026-11-28: 만들 때는 loss를 받고
 * 검수는 「본문에 없는 낱말」로 버려 요약표가 73원까지 갔다).
 */
import { verbBaseForms } from "@/lib/question-generator/verb-forms";

/**
 * 앞 글자만 맞대서는 한 뿌리인 줄 모르는 파생어 묶음(요약표 빈칸 「지문에 뿌리가 있는지」 검사).
 * 다섯 글자 이상은 그 글자로 시작하면, 짧은 것은 그 말과 -s·-d·-ed·-es 꼴만 같은 뿌리로 본다
 * (see → seem 처럼 짧은 말이 엉뚱한 낱말에 붙지 않게).
 */
export const IRREGULAR_DERIVATIVES: string[][] = [
  ["lose", "loses", "losing", "lost", "loss", "losses"],
  ["choose", "chose", "chosen", "choosing", "choice"],
  ["think", "thought"],
  ["deep", "depth"],
  ["long", "length", "lengthen"],
  ["strong", "strength"],
  ["wide", "width", "widen"],
  ["broad", "breadth"],
  ["high", "height", "heighten"],
  ["true", "truth", "truly"],
  ["speak", "spoke", "spoken", "speech"],
  ["believe", "belief"],
  ["prove", "proof"],
  ["sell", "sold", "sale"],
  ["live", "living", "life", "lives"],
  ["die", "dying", "dead", "death", "deadly"],
  ["fly", "flies", "flight"],
  ["see", "seen", "sight"],
  ["able", "ability", "abilities"],
  ["poor", "poverty"],
  ["proud", "pride"],
  ["wise", "wisdom"],
  ["decide", "decision"],
  ["divide", "division"],
  ["explain", "explanation"],
  ["describe", "description"],
  ["receive", "reception"],
  ["perceive", "perception"],
  ["pronounce", "pronunciation"],
  ["maintain", "maintenance"],
  ["sustain", "sustenance"],
  ["retain", "retention"],
  ["intend", "intention", "intent"],
  ["extend", "extension", "extent"],
  ["respond", "response", "responsive"],
  ["defend", "defense", "defensive"],
  ["pursue", "pursuit"],
  ["fail", "failure"],
  ["please", "pleasure", "pleasant"],
  ["hot", "heat"],
  ["bear", "born", "birth"],
];

export function isFormOf(word: string, form: string): boolean {
  if (form.length >= 5) return word.startsWith(form);
  return [form, `${form}s`, `${form}d`, `${form}ed`, `${form}es`].includes(word);
}

/** 불규칙 파생어 묶음(lose → loss)이나 불규칙 동사 꼴(wins → won)로 지문 낱말과 한 뿌리인가 */
export function rootedByIrregular(w: string, bodyWords: string[]): boolean {
  if (IRREGULAR_DERIVATIVES.some((fam) => fam.some((m) => isFormOf(w, m)) && bodyWords.some((b) => fam.some((m) => isFormOf(b, m))))) return true;
  const bases = new Set(verbBaseForms(w));
  return bodyWords.some((b) => verbBaseForms(b).some((x) => x.length >= 3 && bases.has(x)));
}
