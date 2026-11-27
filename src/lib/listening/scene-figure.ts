/**
 * 「그림 상황에 맞는 대화」 장면 그림 1장 (중2·중3).
 * 그림에는 글자·숫자·말풍선이 없어야 하고, 짧은 대화 5개 중 정답 대화의 상황만 그림과 맞아야 한다.
 * 그린 뒤 비전 검수로 (1) 글자가 없는지 (2) 정답 대화만 그림과 맞는지 확인하고, 통과한 그림만 쓴다.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildVerifyBody,
  choiceImageStoragePath,
  flattenPngOnWhite,
  generateImagePngBytes,
  uploadPng,
} from "@/lib/listening/generate-choice-images";
import { splitMiniDialogues } from "@/lib/listening/new-type-checks";
import { BW_FIGURE_RULES } from "@/lib/listening/print-bw";
import { openAiFetch } from "@/lib/ai-usage/openai-fetch";

const CIRCLED = ["①", "②", "③", "④", "⑤"];

export type SceneCheck = {
  ok: boolean;
  problems: string[];
  /** 대화마다 그림과 맞는지 (비전 판단) */
  matches: boolean[];
  textFound: boolean;
  note: string;
};

/** segments → 짧은 대화 5개 글 (검수·그림 프롬프트용) */
export function miniDialogueTexts(segments: Array<{ speaker: string; text: string }>): string[] | null {
  const groups = splitMiniDialogues(segments);
  if (!groups) return null;
  return groups.map((g) => g.map((s) => `${s.speaker}: ${s.text}`).join(" / "));
}

/** 시험지용 장면 그림 프롬프트 (글자 없음) */
export function buildScenePrompt(scene: string, correctDialogue?: string): string {
  return `Korean middle-school English listening exam illustration for the item "choose the dialogue that fits the picture".
Draw ONE clean scene: black line-art textbook illustration on a plain pure-white background (no vignette, no gradient, no dark edges). No photorealism, no 3D.
${BW_FIGURE_RULES}
ABSOLUTELY NO TEXT anywhere: no letters, numbers, signs with words, labels, captions, logos or speech bubbles.
Show clearly WHO is doing WHAT and WHERE, with the key objects large and easy to see, so a student can tell which short dialogue matches the picture.
Scene: ${scene}
${correctDialogue ? `The picture must match this exchange: ${correctDialogue}` : ""}`.slice(0, 3500);
}

/** 장면 그림 검수 */
export async function verifySceneFigure(
  png: Buffer,
  dialogues: string[],
  correctIndex: number
): Promise<SceneCheck> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, problems: ["OPENAI_API_KEY 없음 — 검수 불가"], matches: [], textFound: false, note: "" };
  }
  const models = [
    process.env.OPENAI_MODEL_LISTENING_IMAGE_PLAN?.trim(),
    "gpt-5.5",
    "gpt-4.1",
    "gpt-4o",
  ].filter(Boolean) as string[];
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
  const list = dialogues.map((d, i) => `${CIRCLED[i]} ${d}`).join("\n");
  let lastErr = "verify failed";
  for (const model of models) {
    try {
      const res = await openAiFetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        // 그림 한 장 검수라 보통 수십 초 — 멈추면 다음 모델로
        signal: AbortSignal.timeout(90_000),
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(
          buildVerifyBody(model, [
            {
              role: "system",
              content:
                'You strictly check a Korean English-listening exam picture for the item "choose the dialogue that fits the picture". Look at what the people are actually doing, where they are and which objects are visible. For EACH short dialogue decide whether it fits the picture (a dialogue fits only if the situation and actions in it are shown in the picture). Also report any visible text (letters, words, numbers, signs, speech bubbles). JSON only: {"matches":[true|false x5],"textFound":true|false,"cleanBackground":true|false,"note":"..."}',
            },
            {
              role: "user",
              content: [
                { type: "text", text: `Five short dialogues:\n${list}\n\nWhich dialogues fit the picture?` },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ])
        ),
      });
      const text = await res.text();
      if (!res.ok) {
        lastErr = `vision ${model} HTTP ${res.status}: ${text.slice(0, 200)}`;
        continue;
      }
      const json = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
      const parsed = JSON.parse(String(json.choices?.[0]?.message?.content ?? "{}")) as {
        matches?: boolean[];
        textFound?: boolean;
        cleanBackground?: boolean;
        note?: string;
      };
      const matches = CIRCLED.map((_, i) => parsed.matches?.[i] === true);
      const problems: string[] = [];
      if (!matches[correctIndex - 1]) problems.push(`정답 대화 ${CIRCLED[correctIndex - 1]}이 그림과 맞지 않음`);
      const extra = matches.map((m, i) => (m && i !== correctIndex - 1 ? CIRCLED[i] : null)).filter(Boolean);
      if (extra.length) problems.push(`정답이 아닌 ${extra.join(",")}도 그림과 맞음`);
      if (parsed.textFound) problems.push("그림에 글자가 있음");
      if (parsed.cleanBackground === false) problems.push("배경이 깨끗하지 않음");
      return {
        ok: problems.length === 0,
        problems,
        matches,
        textFound: Boolean(parsed.textFound),
        note: String(parsed.note ?? ""),
      };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, problems: [`검수 실패: ${lastErr}`], matches: [], textFound: false, note: lastErr };
}

/**
 * 장면 그림을 그리고 검수한다 (저장하지 않음). 검수를 통과하지 못하면 문제점을 넣어 다시 그린다.
 * 통과한 그림이 없으면 bytes = null.
 */
export async function drawCheckedSceneFigure(opts: {
  scenePrompt: string;
  segments: Array<{ speaker: string; text: string }>;
  correctAnswer: number;
  /** 그림 검수를 건너뛴다(눈으로 보고 고른다) */
  skipVerify?: boolean;
  maxRetries?: number;
  onAttempt?: (info: { attempt: number; check: SceneCheck; bytes: Buffer }) => void;
}): Promise<{ bytes: Buffer | null; check: SceneCheck | null; attempts: number }> {
  const dialogues = miniDialogueTexts(opts.segments);
  if (!dialogues) throw new Error("짧은 대화 5개 구조가 아니라 그림을 검수할 수 없습니다.");
  const correct = dialogues[opts.correctAnswer - 1];
  let prompt = buildScenePrompt(opts.scenePrompt, correct);
  let last: SceneCheck | null = null;
  const max = opts.maxRetries ?? 1;
  for (let attempt = 0; attempt <= max; attempt++) {
    const bytes = await flattenPngOnWhite(await generateImagePngBytes(prompt));
    if (opts.skipVerify) return { bytes, check: null, attempts: attempt + 1 };
    const check = await verifySceneFigure(bytes, dialogues, opts.correctAnswer);
    last = check;
    opts.onAttempt?.({ attempt: attempt + 1, check, bytes });
    if (check.ok) return { bytes, check, attempts: attempt + 1 };
    prompt = `${buildScenePrompt(opts.scenePrompt, correct)}

PREVIOUS DRAWING FAILED QA — ${check.problems.join(", ")}. ${check.note}
Make the matching situation unmistakable and make sure the other dialogues (below) do NOT fit the picture:
${dialogues.filter((_, i) => i !== opts.correctAnswer - 1).join("\n")}`.slice(0, 3800);
  }
  return { bytes: null, check: last, attempts: max + 1 };
}

/** 장면 그림을 그려 저장하고 choice_image_urls에 넣는다 (검수 통과한 그림만) */
export async function generateAndSaveSceneImage(opts: {
  setId: string;
  questionId: string;
  scenePrompt: string;
  segments: Array<{ speaker: string; text: string }>;
  correctAnswer: number;
  skipVerify?: boolean;
}): Promise<{ urls: string[]; generated: number; check: SceneCheck | null }> {
  const { bytes, check } = await drawCheckedSceneFigure({ ...opts, maxRetries: 1 });
  if (!bytes) {
    throw new Error(`그림 검수를 통과하지 못해 저장하지 않았습니다: ${check?.problems.join(", ") || "알 수 없는 오류"}`);
  }
  const admin = createAdminClient();
  const path = choiceImageStoragePath(opts.setId, opts.questionId, 0, String(Date.now()));
  const url = await uploadPng(admin, path, bytes);
  const { error } = await admin
    .from("listening_questions")
    .update({ choice_image_urls: [url] })
    .eq("id", opts.questionId);
  if (error) throw new Error(`choice_image_urls 저장 실패: ${error.message}`);
  return { urls: [url], generated: 1, check };
}
