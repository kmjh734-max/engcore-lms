import { normalizePassage } from "@/lib/question-generator/text-utils";
import { mergeMarkedPassages } from "@/lib/question-generator/passage-set-merge";
import { isSetMarkKey, setMarkFamily } from "@/lib/question-generator/passage-set";

export type MockRunRow = {
  passage_id?: string | null;
  option_key?: string | null;
  passage_original?: string | null;
  passage_modified?: string | null;
};

function questionPassage(q: MockRunRow): string {
  const mod = (q.passage_modified || "").trim();
  const orig = (q.passage_original || "").trim();
  if (mod && normalizePassage(mod) !== normalizePassage(orig)) return mod;
  return orig || mod;
}

/**
 * 동형모의고사: 이어진 같은 지문 문항들의 표시(어법 밑줄·빈칸 …)를 원문 위에 겹쳐 지문 하나로 찍을 묶음.
 * 윌링 2026-11-26 「어법 틀린 유형 + 빈칸 유형으로 한 지문 다문항」 — 따로 찍으면 어법 문항 지문에 빈칸 정답이 그대로 보였다.
 * 원문 그대로 푸는 문항(주제·일치 …)과 표시형 문항만 묶는다. 표시 갈래가 같으면(①~⑤ 둘) 번호가 겹쳐 묶지 않는다.
 * 지문을 자르거나 바꾸는 문항(순서·삽입·무관 …)이 끼면 거기서 끊는다.
 */
export function mockSharedRuns(qs: MockRunRow[]): { start: number; end: number; passage: string }[] {
  const marked = (q: MockRunRow) => normalizePassage(questionPassage(q)) !== normalizePassage((q.passage_original || "").trim());
  const ok = (q: MockRunRow) =>
    !/^(order|sentence_insertion|irrelevant_sentence):/.test(q.option_key ?? "") && (!marked(q) || isSetMarkKey(q.option_key ?? ""));
  const runs: { start: number; end: number; passage: string }[] = [];
  for (let i = 0; i < qs.length; ) {
    const pid = qs[i]!.passage_id;
    let j = i;
    while (pid && j < qs.length && qs[j]!.passage_id === pid && ok(qs[j]!)) j++;
    if (j - i >= 2) {
      const list = qs.slice(i, j);
      const original = (list[0]!.passage_original || "").trim();
      const markers = list.filter(marked);
      const fams = markers.map((q) => setMarkFamily(q.option_key ?? ""));
      let passage: string | null = null;
      if (markers.length === 0) passage = original;
      else if (markers.length === 1) passage = questionPassage(markers[0]!);
      else if (new Set(fams).size === fams.length && original)
        passage = mergeMarkedPassages(original, markers.map((q) => questionPassage(q)));
      if (passage) {
        runs.push({ start: i, end: j, passage });
        i = j;
        continue;
      }
    }
    i += 1;
  }
  return runs;
}
