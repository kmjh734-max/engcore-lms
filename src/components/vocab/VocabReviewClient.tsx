"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ReviewCard } from "@/lib/vocab/review";
import { blankOutWord, judgeReviewAnswer } from "@/lib/vocab/review-judge";
import { submitVocabReview } from "@/app/student/vocab/review/actions";

/** 보낸 답. 정답 여부는 화면에 바로 알려 주려고 매긴 것이고, 기록은 서버가 다시 매긴다. */
type Answered = { reviewId: string; answer: string; correct: boolean };

/** 뜻·철자·예문 — 틀렸던 단계에 맞춰 묻는다 */
function prompt(card: ReviewCard): { title: string; hint: string; placeholder: string } {
  if (card.stage === "spelling") {
    return { title: card.meaning, hint: "뜻을 보고 영어 단어를 쓰세요.", placeholder: "영어 단어" };
  }
  if (card.stage === "example") {
    return {
      title: blankOutWord(card.exampleSentence ?? "", card.word),
      hint: "문장에 들어갈 단어를 쓰세요.",
      placeholder: "영어 단어",
    };
  }
  return { title: card.word, hint: "이 단어의 뜻을 쓰세요.", placeholder: "우리말 뜻" };
}

export function VocabReviewClient({ cards, graduated }: { cards: ReviewCard[]; graduated: number }) {
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [shown, setShown] = useState<null | { correct: boolean }>(null);
  const [done, setDone] = useState<Answered[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [result, setResult] = useState<{ graduated: number; right: number } | null>(null);

  const card = cards[index];
  const view = useMemo(() => (card ? prompt(card) : null), [card]);

  function check() {
    if (!card || shown) return;
    const correct = judgeReviewAnswer(card.stage, card.word, card.meaning, answer);
    setShown({ correct });
    setDone((prev) => [...prev, { reviewId: card.id, answer, correct }]);
  }

  async function next() {
    if (saving) return;
    if (index + 1 < cards.length) {
      setShown(null);
      setAnswer("");
      setIndex(index + 1);
      return;
    }
    // 마지막 카드: 저장이 실패하면 「끝내기」를 다시 누를 수 있게 그대로 둔다(전에는 「저장하는 중…」에 멈춤)
    setSaving(true);
    setSaveError(null);
    try {
      const r = await submitVocabReview(done.map((d) => ({ reviewId: d.reviewId, answer: d.answer })));
      setResult({ graduated: r.graduated, right: r.results.filter((x) => x.correct).length });
    } catch {
      setSaveError("저장하지 못했어요. 인터넷 연결을 확인하고 「끝내기」를 다시 눌러 주세요.");
    } finally {
      setSaving(false);
    }
  }

  if (result) {
    const right = result.right;
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-2xl font-bold text-slate-900">
          {right}/{done.length} 맞혔어요
        </p>
        <p className="mt-2 text-sm text-slate-600">
          {result.graduated > 0 ? `${result.graduated}개는 두 번 연속 맞혀서 목록에서 빠졌어요.` : "틀린 단어는 내일 다시 나와요."}
        </p>
        <p className="mt-1 text-xs text-slate-400">지금까지 졸업한 단어 {graduated + result.graduated}개</p>
        <Link href="/student/vocab" className="mt-5 inline-block rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700">
          단어학습으로
        </Link>
      </div>
    );
  }

  if (!card || !view) return null;

  return (
    <div className="mx-auto max-w-md">
      <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
        <span>
          {index + 1} / {cards.length}
        </span>
        <span>{card.wrongCount > 1 ? `${card.wrongCount}번 틀린 단어` : "전에 틀린 단어"}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${((index + (shown ? 1 : 0)) / cards.length) * 100}%` }} />
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-center text-xl font-bold leading-relaxed text-slate-900">{view.title}</p>
        <p className="mt-2 text-center text-xs text-slate-500">{view.hint}</p>

        <input
          id="review-answer"
          autoFocus
          className="ui-input mt-5 h-11 w-full text-center text-base"
          placeholder={view.placeholder}
          value={answer}
          disabled={!!shown}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            if (shown) void next();
            else check();
          }}
        />

        {shown ? (
          <div className={`mt-4 rounded-xl px-4 py-3 text-center ${shown.correct ? "bg-emerald-50" : "bg-red-50"}`}>
            <p className={`text-sm font-bold ${shown.correct ? "text-emerald-700" : "text-red-700"}`}>
              {shown.correct ? "맞았어요" : "틀렸어요"}
            </p>
            <p className="mt-1 text-sm text-slate-700">
              <b>{card.word}</b> · {card.meaning}
            </p>
            {card.exampleSentence ? <p className="mt-1 text-xs text-slate-500">{card.exampleSentence}</p> : null}
          </div>
        ) : null}

        <button
          type="button"
          disabled={saving || (!shown && !answer.trim())}
          onClick={() => (shown ? void next() : check())}
          className="mt-5 h-11 w-full rounded-lg bg-brand-600 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-40"
        >
          {saving ? "저장하는 중…" : shown ? (index + 1 < cards.length ? "다음" : "끝내기") : "확인"}
        </button>
        {saveError ? <p className="mt-2 text-center text-xs text-red-600">{saveError}</p> : null}
      </div>
    </div>
  );
}
