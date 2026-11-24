"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/layout/NavIcon";
import type { MockSlot } from "@/lib/exam-analysis/blueprint";
import { billingFeatureFor } from "@/lib/question-generator/billing-buckets";
import { QUESTION_TYPE_GROUPS } from "@/lib/question-generator/question-types";
import type { MaterialPassage } from "@/lib/exam-analysis/load";
import { MockPassagePickerModal, type PickedMockPassage } from "@/components/mock-passages/MockPassagePickerModal";
import { askCreditConfirm } from "@/lib/credits/confirm-store";

/*
 * 지문 이름은 출처를 앞세운다 — 선생님 요청(2026-09-30).
 * 설계도에서 어느 교과서 몇 과인지가 한눈에 보여야 한다. 출처를 안 적어 둔
 * 자료는 예전처럼 폴더·제목으로 보여 준다.
 */
function passageLabel(m: { project: string; title: string; source?: string }): string {
  const src = String(m.source ?? "").trim();
  return src ? `${src} · ${m.title}` : `${m.project} · ${m.title}`;
}

type Chosen =
  | { kind: "material"; id: string; label: string; words: number }
  | { kind: "text"; key: string; title: string; text: string };

const LV: Record<string, string> = { 하: "bg-[#f1e3c6] text-[#6b5f4b]", 중: "bg-[#f3a712] text-white", 상: "bg-[#e4572e] text-white" };

/** 동형모의고사 만들기: 시험 범위 지문을 고르고, 원래 시험의 지문 묶음마다 새 지문을 배정한다 */
export function ExamMockBuilder({
  analysisId,
  examTitle,
  slots,
  groupCount,
  materials,
  backHref,
  generationsHref,
  pricePerQuestion,
  round,
  examVocabLevel = null,
  initialPassageIds = [],
  textbookOpen = false,
}: {
  analysisId: string;
  examTitle: string;
  slots: MockSlot[];
  groupCount: number;
  materials: MaterialPassage[];
  backHref: string;
  generationsHref: string;
  pricePerQuestion: number;
  /** 교과서 본문을 열어 준 학원인지 — 아니면 교과서 단추를 아예 안 보인다 */
  textbookOpen?: boolean;
  /** 이번에 만들 회차(이 시험으로 만든 동형모의고사 수 + 1) */
  round: number;
  /** 원래 시험지의 어휘 수준(우리 단어장 기준). 지문을 고를 때 견줘 볼 수 있게 보여 준다 */
  examVocabLevel?: string | null;
  /** 수업자료에서 골라 들어온 지문(수업자료 id) — 고른 순서대로 미리 넣어 둔다 */
  initialPassageIds?: string[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"material" | "paste">(materials.length ? "material" : "paste");
  const [mockOpen, setMockOpen] = useState(false);
  /** 지문 고르기 창을 열 때 모의고사·교과서 중 어느 쪽부터 보일지 */
  const [pickerSource, setPickerSource] = useState<"mock" | "textbook">("mock");
  const [query, setQuery] = useState("");
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [chosen, setChosen] = useState<Chosen[]>(() =>
    initialPassageIds
      .map((id) => materials.find((m) => m.id === id))
      .filter((m): m is MaterialPassage => Boolean(m))
      .map((m) => ({ kind: "material", id: m.id, label: passageLabel(m), words: m.words }))
  );
  const [draft, setDraft] = useState({ title: "", text: "" });
  const [override, setOverride] = useState<Record<number, number>>({});
  /** 한 번에 만들 회차 수 — 선생님 요청(2026-10-10). 2회차부터는 지문·유형 짝을 새로 섞는다 */
  const [rounds, setRounds] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /*
   * 고른 지문이 원래 시험의 지문 묶음보다 많으면 묶음을 푼다.
   *
   * 선생님 지적(2026-09-30): 지문을 다 골랐는데 고른 지문이 다 안 들어간다.
   * 묶음은 원래 시험에서 같은 지문을 쓴 문항끼리 묶은 것이라, 여덟 묶음짜리
   * 시험에 열일곱 지문을 고르면 여덟 개만 쓰였다. 묶음을 풀어 문항마다 지문을
   * 주면 문항 수만큼은 반드시 쓰인다 (24문항에 17지문이면 17개 다 들어간다).
   */
  /*
   * 변형문제 화면에 있던 만들기 설정을 여기에도 둔다.
   * 선생님 요청(2026-09-30): 동형모의고사 문항설계도에도 난이도·재진술 같은
   * 설정을 넣어 달라. 지금까지는 난이도가 「내신」으로 박혀 있었다.
   */
  const [overallDifficulty, setOverallDifficulty] = useState("내신");
  const [paraphraseGV, setParaphraseGV] = useState(false);
  const [wordOrderMode, setWordOrderMode] = useState<"passage" | "paraphrase">("passage");
  /** 순서 배열 지문 — 문항 난이도대로 / 본문 그대로 / 주어진 글만 바꿔 쓰기 / 지문 일부만(Jayden 선생님 제안 2026-11-24) */
  const [orderMode, setOrderMode] = useState<"level" | "original" | "paraphrase" | "excerpt">("level");
  const [grammarWritingMode, setGrammarWritingMode] = useState<"passage" | "paraphrase">("paraphrase");

  /*
   * 칸마다 유형·난이도를 바꾼다.
   *
   * 선생님 요청(2026-09-30): 동형모의고사에도 변형문제처럼 난이도·유형 조절을
   * 넣어 달라. 지금까지는 원래 시험에서 읽은 유형과 난이도를 그대로 쓸 수밖에
   * 없어, 그 지문에 안 맞는 유형이어도 바꿀 수가 없었다.
   */
  /*
   * 유형 목록 이름 — 갈래(어법/어휘/내용 일치 …)를 앞에, 무엇을 묻는지를 뒤에.
   * 선생님 2026-11-24(윌링): 「어법과 어휘가 함께 있는데 구분이 잘 안 된다」「대의파악 영·상이 2개씩 있는데 차이가 있는지」.
   * 전에는 「어법·어휘 · 어색한 것 고르기」처럼 어법인지 어휘인지, 「대의 파악 · (영) 상」처럼 제목인지 주제인지가 안 보였다.
   */
  const typeChoices = useMemo(() => {
    const fam = (o: { key: string; isObjective: boolean }) => {
      const [base] = o.key.split(":");
      // <보기> 불일치 개수는 객관식(개수 고르기)인데 isObjective 가 false 라 서술형에 섞였다 — 갈래를 먼저 본다
      if (base === "content_true" || base === "content_false" || base === "content_count") return "세부 정보(내용 일치)";
      if (base === "writing" || base === "summary_short" || /오류수정/.test(o.key) || !o.isObjective) return "서술형";
      if (base === "grammar") return "어법";
      if (base === "vocabulary") return "어휘";
      if (base === "title" || base === "topic" || base === "summary_mcq" || /요약완성AB/.test(o.key)) return "대의 파악(제목·주제·요지·요약)";
      return "추론(빈칸·순서·삽입 등)";
    };
    const NAME: Record<string, string> = {
      어법추론: "어법 · 밑줄 중 틀린 것 고르기",
      어법개수: "어법 · 틀린 것의 개수",
      어법통문장: "어법 · 틀린 문장 고르기",
      어휘추론: "어휘 · 낱말 쓰임이 어색한 것 고르기",
      어휘개수: "어휘 · 어색한 낱말의 개수",
      내용일치: "내용 일치",
      내용불일치: "내용 불일치",
      일치개수: "<보기> 진술 중 불일치 개수",
      제목추론: "제목",
      주제추론: "주제",
      요지추론: "요지",
      요약완성AB: "요약문 (A)(B) 낱말 고르기",
      순서추론: "순서 배열",
      빈칸추론: "빈칸(문장·어구)",
      빈칸단어: "빈칸(낱말 하나)",
      문장삽입: "문장 삽입",
      무관한문장: "무관한 문장",
      함축의미추론: "밑줄 함축 의미",
      목적추론: "글의 목적",
      심경추론: "심경 변화",
      연결어빈칸: "연결어 (A)(B)",
      답변가능개수: "답할 수 있는 질문 개수",
      사례분류: "사례 분류(성격이 다른 하나)",
      비유대응: "비유 표현 대응",
      // 서술형 — 무엇을 쓰는지가 보이게(윌링 「서술형 구문변환 등 어떤 식으로 출제되는지」)
      구문변환: "구문 변환 · 밑줄 문장을 <조건>대로 바꿔 쓰기(능동↔수동·분사구문·관계사절 등)",
      제시어배열기본: "제시어 배열 · 기본(우리말에 맞게 낱말 배열, 형태 그대로)",
      제시어배열어형변화: "제시어 배열 · 어형변화(배열하며 필요한 낱말 형태 바꾸기)",
      제시어배열단어추가: "제시어 배열 · 단어추가(낱말 더하기·형태 바꾸기)",
      문법조건영작: "제시어 배열 · 지정 문법(정해진 문법을 써서 문장 완성)",
      요약문빈칸영작: "요약문 빈칸 · <보기> 낱말 배열해 쓰기",
      요약문빈칸2단어: "요약문 빈칸 · 본문에서 2단어 찾아 쓰기",
      요약문빈칸3단어: "요약문 빈칸 · 본문에서 3단어 찾아 쓰기",
      요약표빈칸단어: "요약표 빈칸 · 본문 낱말 찾아 쓰기",
      주제문작성: "주제문 작성 · <보기> 낱말로 주제 명사구 쓰기",
      어휘빈칸공통: "어휘 빈칸 · 공통으로 들어갈 영어 한 단어 쓰기",
      대화문완성: "대화문 완성 · 대화 빈칸을 본문 어구로 채우기",
      내용매칭: "내용 매칭 · 개념에 맞는 예시 번호 쓰기",
      지칭대명사서술: "지칭 · 대명사·지시사가 가리키는 말 찾아 쓰기",
      특정표현의미서술: "지칭 · 밑줄 표현의 뜻을 본문에서 찾아 쓰기",
      어법오류수정2: "어법 수정 · 틀린 곳 2개 찾아 고쳐 쓰기",
      어법오류수정3: "어법 수정 · 틀린 곳 3개 찾아 고쳐 쓰기",
      어법문장오류수정: "어법 수정 · 틀린 문장 찾아 고쳐 쓰기",
    };
    const lv = (o: { choiceLanguage?: string | null; difficulty?: string }) =>
      [o.choiceLanguage === "english" ? "영어 선택지" : o.choiceLanguage === "korean" ? "한글 선택지" : "", o.difficulty === "high" ? "난이도 상" : o.difficulty === "low" ? "난이도 하" : ""]
        .filter(Boolean)
        .join(" · ");
    return QUESTION_TYPE_GROUPS.flatMap((g) =>
      g.options.map((o) => {
        const code = o.key.split(":").pop() ?? "";
        const name = NAME[code];
        const extra = lv(o as { choiceLanguage?: string | null; difficulty?: string });
        const label = name ? `${name}${extra ? ` (${extra})` : ""}` : `${o.label} — ${o.preview}`;
        return { key: o.key, label, family: fam(o as { key: string; isObjective: boolean }) };
      })
    );
  }, []);
  const typeFamilies = useMemo(() => [...new Set(typeChoices.map((t) => t.family))], [typeChoices]);
  const [slotEdit, setSlotEdit] = useState<
    Record<string, { optionKey?: string; level?: "상" | "중" | "하" }>
  >({});
  const editOf = (no: string) => slotEdit[no] ?? {};
  const setEdit = (no: string, patch: { optionKey?: string; level?: "상" | "중" | "하" }) =>
    setSlotEdit((p) => ({ ...p, [no]: { ...p[no], ...patch } }));

  /** 값 받는 갈래별 문항 수. 바꿔 둔 유형이 있으면 그것으로 센다(서버와 같은 잣대) */
  const mockBilling = useMemo(() => {
    const sum: Record<string, number> = {};
    for (const s of slots) {
      const key = slotEdit[s.no]?.optionKey ?? s.optionKey;
      const feature = billingFeatureFor(key);
      sum[feature] = (sum[feature] ?? 0) + 1;
    }
    return sum;
  }, [slots, slotEdit]);

  const perSlot = chosen.length > groupCount;
  /*
   * 묶음이 풀리고 다시 묶이면 손으로 바꿔 둔 자리의 번호 뜻이 달라진다
   * (묶음 번호 ↔ 문항 번호). 엉뚱한 지문이 붙지 않게 비운다.
   */
  useEffect(() => {
    setOverride({});
  }, [perSlot]);
  const groups = useMemo(() => {
    if (perSlot) return slots.map((s) => [s]);
    const out: MockSlot[][] = Array.from({ length: groupCount }, () => []);
    for (const s of slots) out[s.group]!.push(s);
    return out;
  }, [slots, groupCount, perSlot]);
  const assignment = groups.map((_, g) => {
    const o = override[g];
    // 회차마다 한 칸씩 밀어 같은 지문이 같은 번호에 다시 오지 않게 한다
    return chosen.length ? (o !== undefined && o < chosen.length ? o : (g + round - 1) % chosen.length) : -1;
  });

  /*
   * 최다빈 선생님 요청(2026-09-29):
   * "동형 모고 만들때 어떤 지문이 안쓰였는지 미사용 지문을 알 수 있는 표시가 따로 있을까요?"
   * "동형 모고에서 각 지문에 배정되는 문제 유형을 다시 섞이는 기능 부탁드려도 될까용?"
   *
   * 고른 지문이 묶음 수보다 많으면 남는 지문이 생기는데 그 표시가 없었다.
   * 배정도 회차마다 한 칸씩 미는 것뿐이라 손으로 바꾸는 수밖에 없었다.
   */
  const usedPassages = useMemo(() => new Set(assignment.filter((a) => a >= 0)), [assignment]);
  const unusedCount = chosen.length - usedPassages.size;

  /** 문항 묶음에 들어갈 지문을 다시 섞는다. 고른 지문은 그대로 두고 배정만 바꾼다. */
  function reshuffleAssignment() {
    if (chosen.length < 2) return;
    const order = chosen.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    const next: Record<number, number> = {};
    groups.forEach((_, g) => {
      next[g] = order[g % order.length]!;
    });
    setOverride(next);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return materials.filter((m) => !q || `${m.source} ${m.project} ${m.title} ${m.preview}`.toLowerCase().includes(q)).slice(0, 200);
  }, [materials, query]);
  const byProject = useMemo(() => {
    const map = new Map<string, MaterialPassage[]>();
    for (const m of filtered) map.set(m.project, [...(map.get(m.project) ?? []), m]);
    return [...map.entries()];
  }, [filtered]);

  const isChosen = (id: string) => chosen.some((c) => c.kind === "material" && c.id === id);
  function toggleMaterial(m: MaterialPassage) {
    setChosen((prev) =>
      isChosen(m.id)
        ? prev.filter((c) => !(c.kind === "material" && c.id === m.id))
        : [...prev, { kind: "material", id: m.id, label: passageLabel(m), words: m.words }]
    );
  }
  function addText() {
    const words = draft.text.trim().split(/\s+/).filter(Boolean).length;
    if (words < 40) {
      setMessage("영어 지문 전체(40단어 이상)를 붙여 넣어 주세요.");
      return;
    }
    setMessage(null);
    setChosen((prev) => [...prev, { kind: "text", key: `t${Date.now()}`, title: draft.title.trim() || `붙여 넣은 지문 ${prev.length + 1}`, text: draft.text.trim() }]);
    setDraft({ title: "", text: "" });
  }
  function addMock(list: PickedMockPassage[]) {
    setChosen((prev) => [
      ...prev,
      ...list
        .filter((m) => !prev.some((c) => c.kind === "text" && c.key === `m${m.id}`))
        .map((m) => ({ kind: "text" as const, key: `m${m.id}`, title: m.label, text: m.text })),
    ]);
    setMockOpen(false);
  }
  function move(i: number, d: -1 | 1) {
    setChosen((prev) => {
      const next = [...prev];
      const j = i + d;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }
  const labelOf = (c: Chosen) => (c.kind === "material" ? c.label : c.title);

  async function create() {
    // 만들면 문항 수만큼 크레딧이 나간다. 고른 지문이 맞는지 보고 한 번 더 묻는다.
    if (!(await askCreditConfirm({
      title: "동형모의고사",
      description: "분석해 둔 학교 시험과 같은 번호·유형·난이도·배점으로 새 시험지를 만듭니다.",
      subject:
        rounds > 1
          ? `고른 지문 ${chosen.length}개 · ${round}차~${round + rounds - 1}차 ${rounds}회 · 문항 ${slots.length * rounds}개`
          : `고른 지문 ${chosen.length}개 · 문항 ${slots.length}개`,
      /*
       * 갈래마다 값이 다른데 지문 수로 한 갈래만 세고 있었다 — 보신 금액과 빠져나간
       * 금액이 달랐다(2026-10-01 선생님 지적). 서버가 차감할 때와 같은 잣대로 센다.
       */
      items: Object.entries(mockBilling)
        .filter(([, q]) => q > 0)
        .map(([feature, quantity]) => ({ feature, quantity: quantity * rounds })),
      sample: "exam_mock_paper",
    }))) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/exam-analysis/${analysisId}/mock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passages: chosen.map((c) => (c.kind === "material" ? { materialItemId: c.id } : { text: c.text, title: c.title })),
          assignment,
          perSlot,
          slotEdit,
          overallDifficulty,
          paraphraseGrammarVocab: paraphraseGV,
          wordOrderMode,
          grammarWritingMode,
          orderMode,
          round,
          rounds,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; jobId?: string; jobIds?: string[] };
      if (!res.ok || !data.ok || !data.jobId) throw new Error(data.message ?? "만들지 못했어요.");
      // 여러 회차면 만든 문제 목록으로, 한 회차면 그 시험지로 간다
      router.push((data.jobIds?.length ?? 1) > 1 ? generationsHref : `${generationsHref}/${data.jobId}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "만들지 못했어요.");
      setBusy(false);
    }
  }

  const total = slots.reduce((s, x) => s + (x.points ?? 0), 0);
  const substituted = slots.filter((s) => s.substituted).length;

  return (
    <div className="space-y-5">
      <div>
        <Link href={backHref} className="inline-flex items-center gap-1 text-[13px] font-medium text-slate-500 hover:text-slate-900">
          <Icon name="left" size={16} />
          분석 보고서
        </Link>
        <h1 className="mt-2 text-xl font-bold tracking-tight text-slate-900 sm:text-[22px]">동형모의고사 만들기</h1>
        <p className="mt-1 text-sm text-slate-500">
          {examTitle}와 같은 번호·유형·난이도·배점으로 새 시험지를 만들어요. 시험 범위 지문만 골라 주세요.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">{slots.length}문항 · {Math.round(total * 10) / 10}점</span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">원래 시험 지문 {groupCount}개</span>
          {substituted ? (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-800">비슷한 유형으로 만드는 문항 {substituted}</span>
          ) : null}
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* 1. 지문 고르기 */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">1. 시험 범위 지문</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {perSlot
              ? `고른 ${chosen.length}개 지문이 문항마다 하나씩 다 들어가요.`
              : `원래 시험처럼 지문 ${groupCount}개를 고르면 한 지문씩 배정돼요. 적게 고르면 돌아가며 여러 번 써요.`}
          </p>
          <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
            <p className="text-xs font-bold text-slate-700">만들기 설정</p>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <span className="w-20 shrink-0 font-semibold">전체 난이도</span>
              <select
                value={overallDifficulty}
                onChange={(e) => setOverallDifficulty(e.target.value)}
                className="ui-input h-8 flex-1 text-xs"
              >
                <option value="내신">내신</option>
                <option value="기본">기본</option>
                <option value="심화">심화</option>
                <option value="수능">수능</option>
              </select>
            </label>
            <label className="flex items-start gap-2 text-[11px] text-slate-700">
              <input
                type="checkbox"
                checked={paraphraseGV}
                onChange={(e) => setParaphraseGV(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-brand-600"
              />
              <span>
                <b className="block text-slate-800">지문 바꿔 쓰기 (어법·어휘)</b>
                꺼 두면 지문이 원문 그대로 나오고 밑줄 자리만 바뀝니다. 켜면 밑줄 자리를
                만들려고 문장도 바꿔 씁니다.
              </span>
            </label>
            {slots.some((s) => (slotEdit[s.no]?.optionKey ?? s.optionKey).startsWith("order:")) ? (
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <span className="w-20 shrink-0 font-semibold">순서 배열</span>
                <select
                  value={orderMode}
                  onChange={(e) => setOrderMode(e.target.value as "level" | "original" | "paraphrase" | "excerpt")}
                  className="ui-input h-8 flex-1 text-xs"
                >
                  <option value="level">문항 난이도대로 (하: 본문 그대로 · 상: 주어진 글 바꿔 쓰기)</option>
                  <option value="original">본문 그대로</option>
                  <option value="paraphrase">일부 변형 (주어진 글만 바꿔 쓰기)</option>
                  <option value="excerpt">일부 내용만 (지문에서 이어진 7문장, (A)(B)(C) 두 문장씩)</option>
                </select>
              </label>
            ) : null}
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <span className="w-20 shrink-0 font-semibold">제시어 배열</span>
              <select
                value={wordOrderMode}
                onChange={(e) => setWordOrderMode(e.target.value as "passage" | "paraphrase")}
                className="ui-input h-8 flex-1 text-xs"
              >
                <option value="passage">지문 문장 그대로</option>
                <option value="paraphrase">고쳐 써서 내기</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <span className="w-20 shrink-0 font-semibold">지정 문법</span>
              <select
                value={grammarWritingMode}
                onChange={(e) =>
                  setGrammarWritingMode(e.target.value as "passage" | "paraphrase")
                }
                className="ui-input h-8 flex-1 text-xs"
              >
                <option value="paraphrase">문장을 그 문법으로 고쳐 쓰기</option>
                <option value="passage">그 문법이 이미 있는 문장으로만</option>
              </select>
            </label>
          </div>

          <div className="mt-3 flex gap-1 rounded-lg bg-slate-100 p-1 text-sm font-semibold">
            {(
              [
                ["material", `수업자료에서 고르기 ${materials.length ? `(${materials.length})` : ""}`],
                ["paste", "모의고사 · 붙여 넣기"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className={`flex-1 rounded-md py-1.5 ${tab === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>
                {l}
              </button>
            ))}
          </div>

          {tab === "material" ? (
            materials.length ? (
              <div className="mt-3">
                <input id="mock-search" className="ui-input h-9 text-sm" placeholder="자료 이름·지문으로 찾기" value={query} onChange={(e) => setQuery(e.target.value)} />
                <ul className="mt-2 max-h-[440px] space-y-1.5 overflow-y-auto pr-1">
                  {byProject.map(([folder, list]) => {
                    // 찾는 중이면 맞는 폴더를 모두 펼친다
                    const open = openFolders.has(folder) || query.trim().length > 0;
                    const picked = list.filter((m) => isChosen(m.id)).length;
                    const all = picked === list.length;
                    return (
                      <li key={folder} className="rounded-lg border border-slate-200">
                        <div className="flex items-center gap-2 px-2.5 py-2">
                          <input
                            type="checkbox"
                            aria-label={`${folder} 전체 선택`}
                            className="h-4 w-4 accent-brand-600"
                            checked={all}
                            ref={(el) => {
                              if (el) el.indeterminate = picked > 0 && !all;
                            }}
                            onChange={() =>
                              setChosen((prev) => {
                                const rest = prev.filter((c) => !(c.kind === "material" && list.some((m) => m.id === c.id)));
                                return all
                                  ? rest
                                  : [...rest, ...list.map((m) => ({ kind: "material" as const, id: m.id, label: passageLabel(m), words: m.words }))];
                              })
                            }
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setOpenFolders((prev) => {
                                const next = new Set(prev);
                                if (next.has(folder)) next.delete(folder);
                                else next.add(folder);
                                return next;
                              })
                            }
                            className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
                          >
                            <Icon name="folder" size={16} className="shrink-0 text-slate-400" />
                            <b className="truncate font-semibold text-slate-900">{folder}</b>
                            <span className="shrink-0 text-xs text-slate-400">
                              {picked ? `${picked}/` : ""}
                              {list.length}
                            </span>
                            <span className={`ml-auto shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`}>
                              <Icon name="down" size={14} />
                            </span>
                          </button>
                        </div>
                        {open ? (
                          <ul className="space-y-1 border-t border-slate-100 px-2 py-2">
                            {list.map((m) => (
                              <li key={m.id}>
                                <label className={`flex cursor-pointer gap-2 rounded-md px-2 py-1.5 text-sm ${isChosen(m.id) ? "bg-brand-50" : "hover:bg-slate-50"}`}>
                                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={isChosen(m.id)} onChange={() => toggleMaterial(m)} />
                                  <span className="min-w-0">
                                    {m.source ? (
                                      <b className="font-semibold text-slate-900">{m.source}</b>
                                    ) : (
                                      <b className="font-semibold text-slate-900">{m.title}</b>
                                    )}
                                    <span className="ml-1.5 text-xs text-slate-400">{m.words}단어</span>
                                    {m.level ? (
                                      <span
                                        className={`ml-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                                          examVocabLevel && m.level === examVocabLevel
                                            ? "bg-emerald-100 text-emerald-800"
                                            : "bg-slate-100 text-slate-600"
                                        }`}
                                        title={examVocabLevel ? `시험지 수준: ${examVocabLevel}` : undefined}
                                      >
                                        {m.level}
                                      </span>
                                    ) : null}
                                    <span className="block truncate text-xs text-slate-500">
                                      {m.source ? `${m.title} · ` : ""}
                                      {m.preview}…
                                    </span>
                                  </span>
                                </label>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <p className="mt-3 rounded-lg bg-slate-50 px-3 py-4 text-sm text-slate-500">아직 수업자료가 없어요. 지문을 직접 붙여 넣어 주세요.</p>
            )
          ) : (
            <div className="mt-3 space-y-2">
              <button
                type="button"
                onClick={() => {
                  setPickerSource("mock");
                  setMockOpen(true);
                }}
                className="flex h-10 w-full items-center justify-center rounded-lg border border-brand-300 bg-white text-sm font-semibold text-brand-700 hover:bg-brand-50"
              >
                모의고사 지문 불러오기
              </button>
              {textbookOpen ? (
                <button
                  type="button"
                  onClick={() => {
                    setPickerSource("textbook");
                    setMockOpen(true);
                  }}
                  className="flex h-10 w-full items-center justify-center rounded-lg border border-brand-300 bg-white text-sm font-semibold text-brand-700 hover:bg-brand-50"
                >
                  교과서 지문 불러오기
                </button>
              ) : null}
              <p className="pt-1 text-xs font-semibold text-slate-500">또는 직접 붙여 넣기</p>
              <input id="mock-paste-title" className="ui-input h-9 text-sm" placeholder="지문 이름 (예: 3과 본문)" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              <textarea id="mock-paste-text" rows={7} className="ui-input text-sm" placeholder="영어 지문 전체를 붙여 넣으세요" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
              <button type="button" onClick={addText} className="h-9 rounded-lg border border-brand-300 bg-brand-50 px-3.5 text-sm font-semibold text-brand-700 hover:bg-brand-100">
                + 이 지문 추가
              </button>
            </div>
          )}

          <div className="mt-4">
            <p className="text-sm font-bold text-slate-900">
              고른 지문 {chosen.length}
              {unusedCount > 0 ? (
                <span className="ml-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                  이번 회차에 안 쓰는 지문 {unusedCount}
                </span>
              ) : null}
            </p>
            {chosen.length ? (
              <ol className="mt-1.5 space-y-1">
                {chosen.map((c, i) => (
                  <li key={c.kind === "material" ? c.id : c.key} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-sm">
                    <span className="w-5 text-xs font-bold text-slate-400">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{labelOf(c)}</span>
                    {usedPassages.has(i) ? null : (
                      <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                        안 씀
                      </span>
                    )}
                    <button type="button" aria-label="위로" onClick={() => move(i, -1)} className="text-[10px] text-slate-400 hover:text-slate-700">▲</button>
                    <button type="button" aria-label="아래로" onClick={() => move(i, 1)} className="text-[10px] text-slate-400 hover:text-slate-700">▼</button>
                    <button type="button" aria-label="빼기" onClick={() => setChosen((p) => p.filter((_, k) => k !== i))} className="text-slate-400 hover:text-red-600">
                      <Icon name="x" size={14} />
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-1 text-xs text-slate-400">위에서 지문을 골라 주세요.</p>
            )}
          </div>
        </section>

        {/* 2. 설계도 */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-slate-900">2. 문항 설계도</h2>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={reshuffleAssignment}
                disabled={chosen.length < 2}
                className="h-8 rounded-lg border border-slate-300 px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                지문 다시 섞기
              </button>
              {Object.keys(override).length ? (
                <button
                  type="button"
                  onClick={() => setOverride({})}
                  className="h-8 rounded-lg px-2.5 text-[13px] font-semibold text-slate-500 hover:text-slate-800"
                >
                  처음대로
                </button>
              ) : null}
            </div>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            원래 시험의 지문 묶음마다 새 지문이 들어가요. 문항마다 난이도와 유형도 바꿀 수 있어요.
          </p>
          {slots.some((s) => /^(sentence_insertion|irrelevant_sentence):/.test(s.optionKey)) ? (
            <p className="mt-1 text-xs text-slate-500">
              문장 삽입·무관한 문장은 6문장 이상인 지문에서 만들어요. 고른 지문이 모두 짧으면 같은 난이도의 순서 배열로 만들어요.
            </p>
          ) : null}
          <ul className="mt-3 space-y-2">
            {groups.map((g, gi) => (
              <li key={gi} className="rounded-lg border border-slate-200 p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-500">지문 {gi + 1}</span>
                  <select
                    id={`assign-${gi}`}
                    className="ui-input h-8 max-w-[260px] py-0 text-[13px]"
                    value={assignment[gi] ?? -1}
                    disabled={!chosen.length}
                    onChange={(e) => setOverride({ ...override, [gi]: Number(e.target.value) })}
                  >
                    {!chosen.length ? <option value={-1}>지문을 먼저 골라 주세요</option> : null}
                    {chosen.map((c, i) => (
                      <option key={i} value={i}>
                        {i + 1}. {labelOf(c)}
                      </option>
                    ))}
                  </select>
                </div>
                <ul className="mt-1.5 space-y-1">
                  {g.map((s) => (
                    <li key={s.no} className="flex flex-wrap items-center gap-1.5 text-[13px]">
                      <b className="w-10 shrink-0">{s.no}</b>
                      <select
                        aria-label={`${s.no}번 난이도`}
                        className={`h-7 shrink-0 rounded border px-1 text-[11px] font-bold ${LV[editOf(s.no).level ?? s.level]}`}
                        value={editOf(s.no).level ?? s.level}
                        onChange={(e) => {
                          // 난이도를 바꾸면 상·하 버전이 있는 유형은 그 버전으로 같이 바꾼다(유형 이름의 「난이도 상/하」와 어긋나지 않게)
                          const level = e.target.value as "상" | "중" | "하";
                          const cur = editOf(s.no).optionKey ?? s.optionKey;
                          const [b, l, d, c] = cur.split(":");
                          let optionKey: string | undefined;
                          if ((d === "low" || d === "high" || d === "mid") && level !== "중") {
                            const want = `${b}:${l}:${level === "상" ? "high" : "low"}:${c}`;
                            if (typeChoices.some((t) => t.key === want)) optionKey = want;
                          }
                          setEdit(s.no, optionKey ? { level, optionKey } : { level });
                        }}
                      >
                        <option value="상">상</option>
                        <option value="중">중</option>
                        <option value="하">하</option>
                      </select>
                      <select
                        aria-label={`${s.no}번 유형`}
                        className="ui-input h-7 min-w-0 flex-1 py-0 text-[12px]"
                        value={editOf(s.no).optionKey ?? s.optionKey}
                        onChange={(e) => setEdit(s.no, { optionKey: e.target.value })}
                      >
                        {typeChoices.some((t) => t.key === (editOf(s.no).optionKey ?? s.optionKey)) ? null : (
                          <option value={s.optionKey}>{s.typeLabel}</option>
                        )}
                        {typeFamilies.map((f) => (
                          <optgroup key={f} label={f}>
                            {typeChoices
                              .filter((t) => t.family === f)
                              .map((t) => (
                                <option key={t.key} value={t.key}>
                                  {t.label}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                      </select>
                      <span className="shrink-0 tabular-nums text-slate-500">{s.points ?? "–"}점</span>
                      <span className={`w-full pl-11 text-[11px] ${s.substituted ? "text-amber-700" : "text-slate-400"}`}>
                        원래 시험지: {s.sourceType}
                        {s.substituted ? " → 똑같은 유형이 없어 가장 가까운 유형으로 만들어요" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="sticky bottom-3 flex flex-wrap items-center justify-end gap-3 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
        {message ? <span className="text-sm text-red-600">{message}</span> : null}
        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <span className="font-semibold">회차</span>
          <select
            aria-label="한 번에 만들 회차 수"
            value={rounds}
            onChange={(e) => setRounds(Number(e.target.value))}
            className="ui-input h-9 w-auto py-0 text-sm"
          >
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n === 1 ? `${round}차 1회` : `${round}차~${round + n - 1}차 ${n}회`}
              </option>
            ))}
          </select>
        </label>
        {rounds > 1 ? (
          <span className="text-xs text-slate-500">2회차부터는 지문마다 유형을 새로 섞어요</span>
        ) : null}
        <span className="text-sm text-slate-500">
          {slots.length * rounds}문항 · 약 {(slots.length * rounds * pricePerQuestion).toLocaleString("ko-KR")}크레딧 (만든 문항 수만큼)
        </span>
        <button
          type="button"
          onClick={create}
          disabled={busy || chosen.length === 0}
          className="h-10 rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? "만드는 중…" : rounds > 1 ? `동형모의고사 ${rounds}회 만들기` : "동형모의고사 만들기"}
        </button>
      </div>
      {mockOpen ? (
        <MockPassagePickerModal
          initialSource={pickerSource}
          allowTextbook={textbookOpen}
          onPick={addMock}
          onClose={() => setMockOpen(false)}
        />
      ) : null}
    </div>
  );
}
