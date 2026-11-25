import type { SupabaseClient } from "@supabase/supabase-js";
import { ALL_QUESTION_OPTIONS } from "@/lib/question-generator/question-types";
import { examChat } from "@/lib/exam-analysis/openai";
import { isAcademyFeatureOn } from "@/lib/academies/features";
import {
  matchLessonMaterials,
  matchMockPassages,
  matchTextbookPassages,
} from "@/lib/exam-analysis/match-materials";
import { typeNameFromKey } from "@/lib/exam-analysis/types";
import { measureExamPages, measureText } from "@/lib/exam-analysis/reading-level";

type RawItem = {
  no?: string | number;
  points?: number | null;
  format?: string;
  stem?: string;
  passage_excerpt?: string;
  passage_words?: number;
  type_key?: string;
  difficulty?: number;
  level?: string;
  difficulty_reason?: string;
  grammar_point?: string;
  subjective_conditions?: string;
  answer_guess?: string;
  confidence?: number;
  answer_style?: string;
  answer_text?: string;
  choice_lang?: string;
  choice_avg_words?: number;
  choice_vocab?: string;
  choice_note?: string;
  distractor_method?: string;
  passage_change?: string;
};

type RawResult = {
  meta?: {
    school?: string;
    grade?: string | number;
    subject?: string;
    exam?: string;
    total_points?: number;
    missing?: string;
    note?: string;
    vocab_level?: string;
    level_summary?: string;
  };
  items?: RawItem[];
  features?: string[];
  strategy?: string[];
};

export function systemPrompt(): string {
  const typeList = ALL_QUESTION_OPTIONS.map((o) => `${o.key} = ${o.label}${o.isObjective ? "" : " (서술형)"}`).join("\n");
  return `당신은 한국 고등학교 영어 내신 시험을 분석하는 전문가다. 옮겨 적은 시험지 글을 보고 문항정보표를 만든다.
규칙:
- 시험지에 있는 모든 문항을 시험지 순서대로 빠짐없이 적는다(선택형·서술형 모두). 한 지문에 여러 문항이 달려도 문항마다 한 줄.
- no: 선택형은 "1", "2" …, 서술형은 "서술 1", "서술 2" … (시험지가 논술형·서답형이라 불러도 "서술 n").
- 배점은 시험지에 적힌 값 그대로. 없으면 null.
- 묶음 발문: "[1 ~ 2]", "[5 ~ 7]" 처럼 여러 문항에 걸친 발문은 그 범위의 문항 **모두**에 그대로 쓴다. 쪽이 바뀌어 학교 이름·쪽 번호·날짜 같은 머리글이 끼어들어도 발문은 이어진다. 문항 번호 뒤에 발문이 없으면 앞에서 가장 가까운 묶음 발문을 찾아 쓴다. stem에도 그 발문을 적는다.
- 유형(type_key)은 아래 목록에서 가장 가까운 key 하나. 맞는 게 없으면 "other:유형이름"(예: other:대화문, other:영영풀이, other:우리말 조건 영작, other:본문 찾아 쓰기, other:요약표 수정).
- 발문에 "모두 고르시오"가 있으면 **개수** 유형이다(어법개수·어휘개수). 하나만 고르게 하면 추론 유형이다(어법추론·어휘추론). 이 둘을 바꿔 적지 않는다.
- 난이도(difficulty 1~5, level 상/중/하)는 해당 학년 학생 기준. 근거(difficulty_reason)는 한 문장: 지문 길이·어휘 수준·유형 자체 난도·선택지 매력도·서술형 조건 수.
- passage_excerpt: 문항이 딸린 영어 지문의 첫 30단어 정도를 시험지 그대로(빈칸·밑줄 표시는 빼고). 지문이 없으면 "".
- grammar_point: 어법·서술형이면 묻는 문법 요소를 짧게.
- subjective_conditions: 서술형이면 조건(단어 수, 보기 단어 모두 사용, 어형 변화 등)을 짧게.
- answer_guess: 직접 풀어서 추정. 서술형은 모범답안 요지. 확신이 낮으면 confidence를 낮게. 학생 풀이 흔적은 정답 근거로 쓰지 않는다.
- 지문 출처(교과서·모의고사 등)는 짐작하지 않는다.
- 문항마다 「어떻게 냈는지」를 적는다(동형모의고사가 그대로 따라 만든다. 유형만 같으면 그 학교 시험 같지 않다).
  · answer_text: 빈칸·요약 문항만. 정답 선지(요약은 정답 선지의 (A)·(B) 낱말)를 시험지 글 그대로 적는다(기호 ①~⑤는 빼고). 다른 유형은 "".
  · answer_style: 빈칸·요약 문항만. 정답이 지문 속 표현 그대로면 "verbatim", 같은 뜻을 다른 말로 바꿨으면 "paraphrase", 일부 낱말만 같으면 "partial". 다른 유형은 "".
  · choice_lang: 선택지가 영어면 "en", 한글이면 "ko", 섞였으면 "mixed", 선택지가 없거나 ①~⑤ 기호뿐이면 "".
  · choice_avg_words: 영어 선택지 다섯 개의 평균 낱말 수(세어서). 한글 선택지나 기호뿐이면 0.
  · choice_vocab: 선택지 어휘 수준 한 마디(예: 중3 교과서, 고1 교과서, 고2 모의고사, 수능, 수능 이상).
  · choice_note: 선택지 난이도 한 문장 — 구문(절·분사구·명사구), 추상도, 오답이 얼마나 그럴듯한지.
  · distractor_method: 오답을 만든 방법 한 마디(예: 본문 낱말 재활용, 정답 반대말, 반쯤 맞는 말, 정답과 낱말 하나 차이).
  · passage_change: 지문을 원문에서 바꾼 정도. "none"(그대로) / "light: …"(낱말 몇 개) / "heavy: …"(문장 추가·삭제·바꿔 쓰기)처럼 짧게. 원문을 모르면 시험지 글이 교과서·모의고사 글로 자연스러운지로 판단하고, 판단이 어려우면 "".
- 쪽 아래 "7-1", "2/8" 같은 쪽 번호와 문항 번호가 건너뛴 곳을 보고, 올라오지 않은 쪽·문항을 meta.missing 에 적는다(예: "7쪽 중 2·4·6쪽 없음 (6~9·15~20번)"). 빠짐이 없으면 "". 빠진 문항은 items에 넣지 않는다.
- features: 출제 특징 3~5개, strategy: 다음 시험 대비 전략 3~5개. 선생님이 학부모 상담에 그대로 쓸 수 있게 구체적으로.
- meta.vocab_level: 지문에 쓰인 어휘 수준을 한 마디로 (예: 중3 교과서, 고1 교과서, 고2 모의고사, 수능, 수능 이상). 세지 말고 읽은 느낌으로 정한다.
- meta.level_summary: 이 시험지의 수준을 한 문장으로. 지문 어휘와 선택지 문장이 어느 정도인지 적는다.
JSON 하나만 출력:
{"meta":{"school":"","grade":"","subject":"","exam":"","total_points":0,"missing":"","note":"","vocab_level":"","level_summary":""},
 "items":[{"no":"1","points":2.9,"format":"objective|subjective","stem":"발문","passage_excerpt":"","passage_words":0,
   "type_key":"","difficulty":3,"level":"중","difficulty_reason":"","grammar_point":"","subjective_conditions":"","answer_guess":"","confidence":0.0,
   "answer_text":"","answer_style":"","choice_lang":"","choice_avg_words":0,"choice_vocab":"","choice_note":"","distractor_method":"","passage_change":""}],
 "features":[],"strategy":[]}

유형 목록:
${typeList}`;
}

const LEVELS = new Set(["상", "중", "하"]);

/*
 * 정답·지문이 원문 그대로인지 — 선생님 지적(2026-11-25).
 *  「사용자가 파일을 올리면 난이도 분석부터 제대로 하는 게 중요해. 그 문제가 패러프레이징한 건지
 *   아닌 건지도 파악해야 해. 패러프레이징한 게 있으면 동형 만들 때도 그렇게 해야 해.」
 *  「어차피 DB가 있으니까 비교하기 쉽잖아.」
 * 교과서·모의고사 원문이 DB에 있으니 모델 짐작 대신 원문과 낱말로 대 본다.
 */
const normWords = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

const STOP = new Set(["a", "an", "the", "of", "to", "in", "on", "for", "and", "or", "is", "are", "be", "it", "that", "with", "as", "by", "at", "their", "its", "his", "her", "they", "we", "you"]);

/** 빈칸·요약 정답이 원문 표현 그대로인지. 원문이 없으면 모델 값 */
export function answerStyleFromSource(it: { answer_text?: string; answer_style?: string }, source: string): "verbatim" | "paraphrase" | "partial" | null {
  const modelValue = ["verbatim", "paraphrase", "partial"].includes(String(it.answer_style))
    ? (String(it.answer_style) as "verbatim" | "paraphrase" | "partial")
    : null;
  const ans = String(it.answer_text ?? "").trim();
  if (!modelValue && !ans) return null;
  if (!ans || !source.trim()) return modelValue;
  // 요약 (A)·(B)는 「a – b」로 오니 칸마다 따로 본다
  const parts = ans.split(/\s+[–\-—]\s+|\s*\/\s*/).map((p) => normWords(p)).filter((w) => w.length > 0);
  if (!parts.length) return modelValue;
  const src = ` ${normWords(source).join(" ")} `;
  const srcSet = new Set(normWords(source));
  if (parts.every((w) => src.includes(` ${w.join(" ")} `))) return "verbatim";
  const content = parts.flat().filter((w) => !STOP.has(w));
  if (!content.length) return modelValue;
  const inSrc = content.filter((w) => srcSet.has(w)).length / content.length;
  return inSrc >= 0.5 ? "partial" : "paraphrase";
}

/** 지문을 원문에서 얼마나 바꿨는지. 원문을 바꿔 쓴 글로 잡혔으면 heavy, 발췌가 원문에 그대로 있으면 none */
export function passageChangeFromSource(
  it: { passage_excerpt?: string; passage_change?: string },
  match: { how: "text" | "paraphrase"; text: string } | null
): string | null {
  const model = it.passage_change?.trim() || null;
  if (!match || !match.text.trim()) return model;
  if (match.how === "paraphrase") return `heavy: 원문을 바꿔 썼다(교과서·모의고사 원문 대조)${model && !model.startsWith("none") ? ` · ${model.replace(/^(heavy|light):?\s*/, "")}` : ""}`;
  const ex = normWords(String(it.passage_excerpt ?? ""));
  if (ex.length < 8) return model;
  const src = ` ${normWords(match.text).join(" ")} `;
  if (src.includes(` ${ex.join(" ")} `)) return model && !model.startsWith("none") ? model : "none";
  return model && !model.startsWith("none") ? model : "light: 원문과 낱말 몇 개가 다르다(원문 대조)";
}

/** 읽어 둔 쪽 글자로 문항표를 만들어 저장하고, 수업자료와 대조한다 */
export async function analyzeExam(admin: SupabaseClient, analysisId: string, academyId: string): Promise<void> {
  const { data: pages } = await admin
    .from("school_exam_pages")
    .select("page_no, text")
    .eq("analysis_id", analysisId)
    .order("page_no");
  const transcript = (pages ?? []).map((p) => `===== ${p.page_no}쪽 =====\n${p.text}`).join("\n\n");
  if (!transcript.trim()) throw new Error("읽은 쪽이 없습니다.");

  /*
   * 문항표 모델 (2026-10-01 실측, 7쪽 시험지 하나로 설정마다 두 번씩).
   *
   * 유형 판정을 「시험지에 적힌 발문」과 사람이 대조해 채점했다(문항 7개: [1~2]·[5~7]
   * 묶음 발문과 「모두 고르시오」가 걸린 것들).
   *   묶음 발문 규칙을 넣기 전 — 5.5 medium 4.0/7 · 5.5 low 7.0/7 · sol medium 1.0/7
   *   넣은 뒤          — 5.5 medium 7.0/7 445원 · 5.5 low 7.0/7 304원
   *                      sol medium 7.0/7 270원 · terra medium 6.0/7 118원
   * 넷 다 문항 29개를 찾고 배점은 29/29 같았다. 갈리는 것은 유형·난이도뿐이었다.
   *
   * sol이 5.5와 같은 정확도로 39% 싸서 sol로 옮긴다. terra는 73% 싸지만 「주장하는 바」를
   * 주제추론으로 적어 쓰지 않는다. 추론은 medium을 지킨다 — low로 내리면 값은 더 싸지만
   * 긴 시험지에서 난이도 판정이 흔들렸다.
   */
  const { text } = await examChat({
    model: process.env.OPENAI_MODEL_EXAM_ANALYZE?.trim() || "gpt-5.6-sol",
    reasoning_effort: "medium",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt() },
      { role: "user", content: transcript },
    ],
  });
  const raw = JSON.parse(text) as RawResult;
  const items = (raw.items ?? []).filter((i) => i && (i.no ?? "") !== "");
  if (items.length === 0) throw new Error("문항을 찾지 못했습니다. 시험지 쪽이 모두 올라왔는지 확인해 주세요.");

  const { data: opt } = await admin.from("school_exam_analyses").select("match_materials").eq("id", analysisId).maybeSingle();
  // 수업자료 대조가 닫힌 학원(정수학원 말고 전부 — 선생님 결정 2026-10-02)은 대조하지 않는다
  const matchOpen = await isAcademyFeatureOn(admin, academyId, "exam_material_match");
  const matches =
    !matchOpen || opt?.match_materials === false
      ? new Map<string, { itemId: string; label: string }>()
      : await matchLessonMaterials(
          admin,
          academyId,
          items.map((it, i) => ({ key: String(i), excerpt: it.passage_excerpt ?? null }))
        );

  const excerptKeys = items.map((it, i) => ({
    key: String(i),
    excerpt: it.passage_excerpt ?? null,
  }));
  const mockMatches = await matchMockPassages(admin, excerptKeys);
  /*
   * 교과서 본문과도 대조한다 — 이득희 선생님 요청(2026-09-29).
   * 학교 시험은 교과서에서 많이 나오는데 그 비율을 낼 자료가 없었다.
   */
  const textbookMatches = await matchTextbookPassages(admin, academyId, excerptKeys);

  const rows = items.map((it, i) => {
    const isSubjective = String(it.format ?? "").startsWith("sub") || String(it.no).includes("서");
    const { name, category } = typeNameFromKey(String(it.type_key ?? "other:기타"), isSubjective);
    const level = LEVELS.has(String(it.level)) ? String(it.level) : "중";
    const match = matches.get(String(i));
    const mock = mockMatches.get(String(i));
    const textbook = textbookMatches.get(String(i));
    return {
      analysis_id: analysisId,
      order_index: i,
      item_no: String(it.no).trim(),
      points: typeof it.points === "number" ? it.points : null,
      is_subjective: isSubjective,
      category,
      type_key: it.type_key ?? null,
      type_name: name,
      level,
      difficulty: Math.min(5, Math.max(1, Math.round(Number(it.difficulty) || 3))),
      difficulty_reason: it.difficulty_reason || null,
      stem: it.stem || null,
      passage_excerpt: it.passage_excerpt || null,
      passage_words: typeof it.passage_words === "number" ? it.passage_words : null,
      grammar_point: it.grammar_point || null,
      conditions: it.subjective_conditions || null,
      answer_guess: it.answer_guess || null,
      confidence: typeof it.confidence === "number" ? it.confidence : null,
      // 문항마다 「어떻게 냈는지」(선생님 2026-11-25) — 동형모의고사가 그 번호에 그대로 넘긴다
      // 원문(교과서·모의고사 DB)이 잡혔으면 정답·지문을 원문과 코드로 대 본다. 못 잡았으면 모델이 본 값을 쓴다
      answer_style: answerStyleFromSource(it, textbook?.text || mock?.text || ""),
      choice_lang: ["en", "ko", "mixed"].includes(String(it.choice_lang)) ? String(it.choice_lang) : null,
      choice_avg_words: typeof it.choice_avg_words === "number" && it.choice_avg_words > 0 ? Math.round(it.choice_avg_words * 10) / 10 : null,
      vocab_level: it.choice_vocab?.trim() || null,
      level_reason: it.choice_note?.trim() || null,
      distractor_method: it.distractor_method?.trim() || null,
      passage_change: passageChangeFromSource(it, textbook ?? mock ?? null),
      matched_item_id: match?.itemId ?? null,
      matched_label: match?.label ?? null,
      matched_mock_id: mock?.mockId ?? null,
      matched_mock_label: mock?.label ?? null,
      matched_textbook_id: textbook?.textbookId ?? null,
      matched_textbook_label: textbook?.label ?? null,
      ...(() => {
        // 이 문항 지문의 수준. 교과서·모의고사 원문이 잡혔으면 원문 전체로 잰다(발췌 30낱말로는 렉사일이 안 나온다, 2026-11-25)
        const full = textbook?.text || mock?.text || "";
        const m = measureText(full.trim() ? full : String(it.passage_excerpt ?? ""));
        return {
          passage_sentence_words: m.wordCount > 0 ? m.sentenceWords : null,
          lexile: m.lexile,
        };
      })(),
    };
  });

  await admin.from("school_exam_items").delete().eq("analysis_id", analysisId);
  const { error } = await admin.from("school_exam_items").insert(rows);
  if (error) throw new Error(error.message);

  const meta = raw.meta ?? {};
  const { data: current } = await admin
    .from("school_exam_analyses")
    .select("school_name, grade, subject, exam_label")
    .eq("id", analysisId)
    .maybeSingle();
  const total = rows.reduce((s, r) => s + (r.points ?? 0), 0);
  /*
   * 수준(선생님 요청 2026-09-28)은 이미 읽어 둔 쪽 글자로 잰다. 모델에게 더 묻지 않으므로
   * 값이 들지 않고, 같은 시험지면 언제나 같은 값이 나온다. 어휘 등급만 모델이 준 것을 쓴다.
   */
  const level = measureExamPages((pages ?? []).map((pg) => String(pg.text ?? "")));
  await admin
    .from("school_exam_analyses")
    .update({
      // 선생님이 적어 둔 값이 있으면 그대로 둔다
      school_name: current?.school_name || meta.school || null,
      grade: current?.grade || (meta.grade != null ? String(meta.grade).replace(/학년/, "") : null),
      subject: current?.subject || meta.subject || null,
      exam_label: current?.exam_label || meta.exam || null,
      missing: meta.missing || null,
      note: meta.note || null,
      total_points: Math.round(total * 10) / 10,
      features: raw.features ?? [],
      strategy: raw.strategy ?? [],
      sentence_words: level.passage.sentenceWords || null,
      choice_words: level.choice.avgWords || null,
      lexile: level.passage.lexile,
      // 어휘 수준은 우리 단어장으로 잰 값을 쓴다. 모델이 본 것은 못 잴 때만 쓴다.
      vocab_level: level.vocab.label || meta.vocab_level || null,
      level_summary: meta.level_summary || null,
      status: "ready",
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", analysisId);
}
