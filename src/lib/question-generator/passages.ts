import type {
  GenerationRequestConfig,
  PassageInput,
} from "@/lib/question-generator/types";

export type ResolvedPassage = {
  title: string;
  text: string;
  sourceDetail: string;
  clientId?: string;
};

/** config에서 유효 지문 목록 추출 (다중 우선, 없으면 단일 passage) */
export function resolvePassages(
  config: GenerationRequestConfig
): ResolvedPassage[] {
  const sharedTitle = (config.title ?? "").trim() || "무제 지문";
  const sharedDetail = (config.sourceDetail ?? "").trim();

  const fromList: ResolvedPassage[] = [];
  for (let i = 0; i < (config.passages ?? []).length; i++) {
    const p = config.passages![i]!;
    const text = (p.text ?? "").trim();
    if (!text) continue;
    const title =
      (p.title ?? "").trim() ||
      ((config.passages?.length ?? 0) > 1
        ? `${sharedTitle} · 지문 ${i + 1}`
        : sharedTitle);
    fromList.push({
      title,
      text,
      sourceDetail: (p.sourceDetail ?? "").trim() || sharedDetail,
      clientId: p.clientId,
    });
  }

  if (fromList.length > 0) return fromList;

  const single = (config.passage ?? "").trim();
  if (!single) return [];
  return [
    {
      title: sharedTitle,
      text: single,
      sourceDetail: sharedDetail,
    },
  ];
}

export function emptyPassageInput(clientId?: string): PassageInput {
  return {
    clientId:
      clientId ??
      `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    title: "",
    sourceDetail: "",
    text: "",
  };
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * 지문 끝 문장이 잘렸는지 — 잘린 지문은 검수가 「문장이 미완성」이라며 계속 되돌려 원가만 커진다
 * (미금 「…in face-to-face」 작업 2026-11-27: 호출 948번, 31문항 못 만듦, 원가가 크레딧보다 컸다).
 * 마지막 마침표 뒤에 남은 말이 여섯 낱말 이상이고 소문자로 시작하는 낱말이 절반 이상일 때만 잡는다 —
 * 교과서 소제목(Hip-Hop in the 21st Century)·끝인사(Best regards, Minjun)·서명은 지나간다.
 * 지난 지문 6,917개에 대 보니 6개가 걸렸다(잘린 것 2·마침표만 빠진 것 4). 잘렸으면 끝 말을, 아니면 null.
 */
export function truncatedPassageEnd(text: string): string | null {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  // 낱말 풀이(*)·도표 표시·출처 줄은 본문 끝이 아니다
  while (lines.length && /^(\*|※|\[\[FIG|\(?출처|<.*>$|\[[^\]]*\]$)/.test(lines[lines.length - 1]!)) lines.pop();
  const body = lines.join(" ").replace(/[\s"'”’)\]»」』]+$/u, "");
  if (!body || /[.!?…:;。]$/.test(body)) return null;
  const tail = body.split(/[.!?…:;。]["'”’)\]]*\s+/u).pop() ?? "";
  const words = tail.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (words.length < 6) return null;
  if (words.filter((w) => /^[a-z]/.test(w)).length / words.length < 0.5) return null;
  return words.slice(-6).join(" ");
}

/** 이보다 긴 지문은 나눠 넣게 한다 — 지난 지문 5,893개 중 가장 긴 것이 346낱말(99%가 244낱말 이하, 2026-11-28) */
export const MAX_PASSAGE_WORDS = 350;

/**
 * 만들기 전에 막는 지문 문제(선생님 2026-11-28 「이상한 지문이나 너무 긴 지문은 쪼개라고」). 잘못된 지문은 검수가 계속
 * 되돌려 호출만 쌓인다. 고칠 말을 돌려주고, 문제가 없으면 null.
 */
export function passageInputProblem(text: string): string | null {
  const words = wordCount(text);
  if (words > MAX_PASSAGE_WORDS) {
    return `${words}낱말로 너무 깁니다. ${MAX_PASSAGE_WORDS}낱말 이하가 되게 문단이 바뀌는 곳에서 두 지문으로 나눠 넣어 주세요.`;
  }
  const body = text
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => !/^\s*(\*|※|\[\[FIG|\(?출처)/.test(l));
  const ko = body.map((l) => /[가-힣]{2,}[^\n]{0,12}/.exec(l)?.[0]).find(Boolean);
  if (ko) return `영어 본문에 한글이 섞여 있습니다(「${ko}」). 영어 원문만 넣어 주세요(낱말 풀이는 * 로 시작하는 줄에).`;
  const glued = body.join(" ").match(/\b[a-z]{2,}\.[a-z]{2,}\b/g)?.find((g) => !/^(e\.g|i\.e|www|[a-z]+\.(com|org|net|kr|edu|gov))$/i.test(g));
  if (glued) return `「${glued}」처럼 마침표 뒤 띄어쓰기가 빠진 곳이 있습니다. 문장이 붙었거나 잘못 옮겨진 곳을 고쳐 넣어 주세요.`;
  return null;
}

