import {
  isGpt5FamilyModel,
  isModelUnavailableError,
  isUnsupportedParameterError,
  isUnsupportedTemperatureError,
  studentRecordModelSupportsTemperature,
} from "@/lib/student-records/model";
import {
  WORKBOOK_TF_SYSTEM_PROMPT,
  buildWorkbookTfUserPrompt,
} from "@/lib/lesson-materials/workbook-tf-prompt";
import {
  clampTfCount,
  defaultWorkbookTitle,
  DEFAULT_WORKBOOK_BLANK_OPTIONS,
  joinWorkbookPassageLines,
  type WorkbookData,
  type WorkbookPassageSection,
  type WorkbookTfItem,
  type WorkbookTfOptions,
} from "@/lib/lesson-materials/workbook-types";

import { runWithConcurrency } from "@/lib/run-with-concurrency";
import { openAiFetch } from "@/lib/ai-usage/openai-fetch";

/** T/F에서 동시에 처리하는 지문 수. */
const TF_PASSAGE_CONCURRENCY = 8;

function parseJsonSafe<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeAnswer(raw: unknown): "T" | "F" | null {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (s === "T" || s === "TRUE" || s === "참" || s === "O") return "T";
  if (s === "F" || s === "FALSE" || s === "거짓" || s === "X") return "F";
  return null;
}

function mapItems(
  rawItems: unknown,
  expected: number
): { ok: true; items: WorkbookTfItem[] } | { ok: false; message: string } {
  if (!Array.isArray(rawItems)) {
    return { ok: false, message: "T/F 응답 형식이 올바르지 않습니다." };
  }
  const items: WorkbookTfItem[] = [];
  for (let i = 0; i < rawItems.length; i++) {
    const row = rawItems[i] as Record<string, unknown>;
    const statement = String(row.statement ?? "").trim();
    const answer = normalizeAnswer(row.answer);
    const explanation = String(row.explanation ?? "").trim();
    const corrected = String(row.correctedStatement ?? "").trim();
    if (!statement || !answer) continue;
    if (answer === "F" && !corrected) {
      return {
        ok: false,
        message: `F 문항(${i + 1})에 바르게 고친 문장이 없습니다.`,
      };
    }
    // 고친 문장이 진술문과 사실상 같으면 처음부터 맞는 문장이었다 — F로 싣지 않는다(2026-11-02)
    const same = (x: string) => x.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "");
    if (answer === "F" && same(corrected) === same(statement)) {
      return { ok: false, message: `F 문항(${i + 1})의 고친 문장이 원래 문장과 같습니다.` };
    }
    items.push({
      index: items.length + 1,
      statement,
      answer,
      explanation:
        explanation ||
        (answer === "T"
          ? "지문의 내용과 일치한다."
          : "지문의 내용과 일치하지 않는다."),
      correctedStatement: answer === "F" ? corrected : undefined,
    });
  }
  // 넘치게 준 것은 요청한 개수만 쓴다. 모자라면 다시 만들어야 한다.
  if (items.length > expected) items.length = expected;
  if (items.length !== expected) {
    return {
      ok: false,
      message: `T/F 문항 수가 ${expected}개가 아닙니다(실제 ${items.length}개).`,
    };
  }
  if (expected >= 2) {
    const hasT = items.some((x) => x.answer === "T");
    const hasF = items.some((x) => x.answer === "F");
    if (!hasT || !hasF) {
      return {
        ok: false,
        message: "T와 F 문항이 모두 포함되어야 합니다.",
      };
    }
  }
  return { ok: true, items };
}

async function callTfOpenAI(input: {
  title?: string;
  passage: string;
  options: WorkbookTfOptions;
}): Promise<WorkbookTfItem[]> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY가 설정되어 있지 않습니다.");

  const count = clampTfCount(input.options.count);
  const options = { ...input.options, count };
  const userContent = buildWorkbookTfUserPrompt({
    title: input.title,
    passage: input.passage,
    options,
  });

  const configured = process.env.OPENAI_MODEL_WORKBOOK?.trim();
  // Prefer fast models for workbook T/F. gpt-5 + medium reasoning was too slow.
  const candidates = configured
    ? configured.startsWith("gpt-5")
      ? [configured, "gpt-4o"]
      : [configured]
    : ["gpt-5.6-luna", "gpt-4o"];
  /*
   * 모델 견줌(2026-10-01): 지문 4개로 여덟 벌씩 만들어 눈가림 채점했다.
   *   gpt-4o        괜찮음 7/8 · 건당 $0.0074
   *   gpt-5.6-luna  괜찮음 8/8 · 건당 $0.0010   ← 7배 싸고 더 정확
   *   gpt-5-mini    괜찮음 8/8 · 건당 $0.0021
   * 그래서 luna 를 먼저 쓰고, 안 되면 예전 모델로 넘어간다.
   */

  const controller = new AbortController();
  // 지문당 최대 20문항이라 응답이 길다. 워크북 라우트 한도(300초) 안에서 넉넉히 둔다.
  const timer = setTimeout(() => controller.abort(), 180_000);

  try {
    let bodyText = "";
    let lastErr = "";
    let ok = false;

    for (const model of candidates) {
      let includeTemperature = studentRecordModelSupportsTemperature(model);
      let includeReasoningEffort = isGpt5FamilyModel(model);
      let includeJsonMode = true;

      for (let attempt = 0; attempt < 4; attempt++) {
        const body: Record<string, unknown> = {
          model,
          messages: [
            { role: "system", content: WORKBOOK_TF_SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
          // 앞부분(지시·규칙·지문)이 그대로라 다시 읽힐 까닭이 없다 — 같은 자리로 모이게 이름표를 준다
          prompt_cache_key: "workbook-tf",
        };
        if (includeJsonMode) body.response_format = { type: "json_object" };
        if (includeTemperature) body.temperature = 0.35;
        else delete body.temperature;
        if (isGpt5FamilyModel(model)) {
          body.max_completion_tokens = 16_000;
          // low > medium: large latency win for T/F stems
          if (includeReasoningEffort) body.reasoning_effort = "low";
          else delete body.reasoning_effort;
        } else {
          body.max_tokens = 10_000;
        }

        const res = await openAiFetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          signal: controller.signal,
          body: JSON.stringify(body),
        });
        bodyText = await res.text();
        if (res.ok) {
          ok = true;
          break;
        }
        if (includeTemperature && isUnsupportedTemperatureError(bodyText)) {
          includeTemperature = false;
          continue;
        }
        if (
          includeReasoningEffort &&
          isUnsupportedParameterError(bodyText, "reasoning_effort")
        ) {
          includeReasoningEffort = false;
          continue;
        }
        if (
          includeJsonMode &&
          isUnsupportedParameterError(bodyText, "response_format")
        ) {
          includeJsonMode = false;
          continue;
        }
        if (isModelUnavailableError(res.status, bodyText)) {
          lastErr = bodyText.slice(0, 200);
          break;
        }
        lastErr = bodyText.slice(0, 200);
        break;
      }
      if (ok) break;
    }

    if (!ok) {
      throw new Error(
        `T/F 생성 실패${lastErr ? `: ${lastErr}` : ""}`.slice(0, 180)
      );
    }

    const envelope = parseJsonSafe<{
      choices?: { message?: { content?: string } }[];
    }>(bodyText);
    const content = envelope?.choices?.[0]?.message?.content ?? bodyText;
    const parsed = parseJsonSafe<{ items?: unknown }>(content);
    const mapped = mapItems(parsed?.items, count);
    if (!mapped.ok) throw new Error(mapped.message);
    return mapped.items;
  } finally {
    clearTimeout(timer);
  }
}

export async function generateWorkbookTf(input: {
  title?: string;
  passages: Array<{
    projectId: string;
    title: string;
    source?: string | null;
    englishLines: string[];
  }>;
  options: WorkbookTfOptions;
}): Promise<WorkbookData> {
  const options: WorkbookTfOptions = {
    ...input.options,
    count: clampTfCount(input.options.count),
  };

  const sections: WorkbookPassageSection[] = [];
  /**
   * 지문끼리 독립인데 순서대로 기다리고 있었다. 호출이 지문당 하나라
   * 실행 시간이 지문 수에 비례했다. 결과 순서는 runWithConcurrency가 지킨다.
   */
  const perPassage = await runWithConcurrency(
    input.passages,
    TF_PASSAGE_CONCURRENCY,
    async (p) => {
      const passage = joinWorkbookPassageLines(p.englishLines);
      if (!passage) {
        throw new Error(`「${p.title}」에 영어 지문이 없습니다.`);
      }
      const items = await callTfOpenAI({
        title: p.title,
        passage,
        options,
      });
      return {
        projectId: p.projectId,
        title: p.title,
        source: p.source ?? null,
        passage,
        items,
      };
    }
  );
  sections.push(...perPassage);

  const now = new Date();
  return {
    metadata: {
      title: input.title?.trim() || defaultWorkbookTitle(now),
      createdAt: now.toISOString(),
    },
    selectedTypes: ["tf"],
    tfOptions: options,
    blankOptions: DEFAULT_WORKBOOK_BLANK_OPTIONS,
    sections,
    blankSections: [],
  };
}
