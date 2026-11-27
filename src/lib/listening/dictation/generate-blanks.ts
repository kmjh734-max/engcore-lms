import { blankCountRange } from "@/lib/listening/dictation/blank-level";
import {
  buildFallbackDictationBlanks,
  ensureOneBlankPerSpokenLine,
} from "@/lib/listening/dictation/fallback-blanks";
import { anchorDictationBlankItems } from "@/lib/listening/dictation/anchor-blank-items";
import { collectDictationLines } from "@/lib/listening/dictation/spoken-lines";
import { filterWordOnlyBlankItems, wordInLine } from "@/lib/listening/dictation/word-only";
import { isGoodRuleBlank } from "@/lib/listening/dictation/content-word-score";
import {
  buildDictationSystemPrompt,
  buildDictationUserPrompt,
  parseDictationAiResponse,
} from "@/lib/listening/dictation/prompt";
import type {
  DictationBlankItem,
  DictationBlankLevel,
} from "@/lib/listening/dictation/types";
import { listeningChatJson } from "@/lib/listening/openai-listening-chat";

export interface GenerateDictationBlanksInput {
  apiKey: string;
  questionType: string;
  scriptText: string;
  segments: Array<{ speaker: string; text: string }>;
  answerClue: string;
  blankLevel: DictationBlankLevel;
  previousBlankWords: string[];
}

/**
 * 규칙으로 만든 빈칸만으로 충분한지.
 *
 * 처음에는 "말하는 줄마다 한 칸"을 그대로 기준으로 삼았는데, 그러면 80문항 중 71문항이
 * 모델로 넘어갔다. 실제로 모델이 주는 빈칸도 줄 수보다 적고(실측 문항당 9.5개, 규칙은 11.8개),
 * 같은 단어가 여러 줄에 나오면 어느 경로든 그 줄은 비워 둔다. 그래서 기준을
 * "모든 칸이 규칙에 맞고, 줄 수의 60% 이상을 덮는다"로 잡는다 — 모델이 주던 수준보다 높다.
 */
const RULE_BLANK_COVERAGE = 0.6;

function ruleBlanksAreEnough(
  items: DictationBlankItem[],
  spoken: Array<{ speaker: string; text: string }>,
  min: number
): boolean {
  const needed = Math.max(3, Math.ceil(Math.min(min, spoken.length) * RULE_BLANK_COVERAGE));
  if (items.length < needed) return false;
  for (const it of items) {
    const sentence = (it.original_sentence || "").trim();
    if (!sentence) return false;
    if (!isGoodRuleBlank(it.answer, sentence)) return false;
    if (!wordInLine(sentence, it.answer)) return false;
  }
  return true;
}

export async function generateDictationBlanks(
  input: GenerateDictationBlanksInput
): Promise<DictationBlankItem[]> {
  const spoken = collectDictationLines({
    scriptText: input.scriptText,
    segments: input.segments,
  });
  const sentenceCount = spoken.length || 3;
  const { min, max } = blankCountRange(input.blankLevel, sentenceCount);

  // 1) 규칙으로 먼저 만든다 — 좋은 빈칸의 조건(내용어·대본에 있는 말·이름 아님)은 이미 정해져 있다.
  //    문장마다 규칙에 맞는 칸이 나오면 모델을 부르지 않는다 (문항당 ~40원 절약).
  const ruleItems = filterWordOnlyBlankItems(
    buildFallbackDictationBlanks({
      scriptText: input.scriptText,
      segments: input.segments,
      blankLevel: input.blankLevel,
      previousBlankWords: input.previousBlankWords,
      answerClue: input.answerClue,
    })
  );
  if (ruleBlanksAreEnough(ruleItems, spoken, min)) {
    return ruleItems.slice(0, max);
  }

  try {
    const parsed = await listeningChatJson<{ blank_items?: unknown[] }>(
      input.apiKey,
      {
        system: buildDictationSystemPrompt(),
        user: buildDictationUserPrompt({
          questionType: input.questionType,
          scriptText: input.scriptText,
          segmentsJson: JSON.stringify(spoken, null, 2),
          answerClue: input.answerClue,
          blankMin: min,
          blankMax: max,
          previousBlankWords: input.previousBlankWords,
        }),
        // 받아쓰기 라우트가 120초라 그보다 짧게
        timeoutMs: 90_000,
        temperature: 0.5,
      }
    );
    let items = anchorDictationBlankItems(parseDictationAiResponse(parsed), {
      scriptText: input.scriptText,
      segments: input.segments,
    });
    items = ensureOneBlankPerSpokenLine(
      items,
      spoken,
      input.previousBlankWords
    );
    items = anchorDictationBlankItems(items, {
      scriptText: input.scriptText,
      segments: input.segments,
    });
    items = filterWordOnlyBlankItems(items);
    if (items.length >= Math.min(1, min)) {
      return items.slice(0, max);
    }
  } catch {
    /* fallback below */
  }

  return ruleItems.length > 0
    ? ruleItems.slice(0, max)
    : buildFallbackDictationBlanks({
        scriptText: input.scriptText,
        segments: input.segments,
        blankLevel: input.blankLevel,
        previousBlankWords: input.previousBlankWords,
        answerClue: input.answerClue,
      });
}
