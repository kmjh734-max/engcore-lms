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
