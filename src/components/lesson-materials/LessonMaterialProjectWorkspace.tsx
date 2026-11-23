"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { LessonMaterialLogicalFlow } from "@/components/lesson-materials/LessonMaterialLogicalFlow";
import { LessonMaterialComicFrame } from "@/components/lesson-materials/LessonMaterialComicFrame";
import type { LessonMaterialAnalysisCard } from "@/lib/lesson-materials/generate-organization";
import { translateLessonMaterialLinesAction } from "@/lib/lesson-materials/line-actions";
import { saveLessonMaterialProjectWorkspace } from "@/lib/lesson-materials/library-ops";
import { ensureLessonMaterialTitleEnAction } from "@/lib/lesson-materials/lesson-pack-actions";
import { generateLessonMaterialsOrganizationDraftAction as generateAdminOrganizationDraft } from "@/app/admin/lesson-materials/actions";
import { generateLessonMaterialsOrganizationDraftAction as generateTeacherOrganizationDraft } from "@/app/teacher/lesson-materials/actions";
import { askCreditConfirm } from "@/lib/credits/confirm-store";

export type LessonMaterialItemDraft = {
  id: string;
  label: string | null;
  title: string;
  english_text: string;
  korean_text: string | null;
  order_index: number;
};

export function LessonMaterialProjectWorkspace({
  role,
  project,
  items,
  analysis_json,
  illustration_prompt,
  illustration_url,
  illustration_captions,
}: {
  role: "admin" | "teacher";
  project: {
    id: string;
    title: string;
    titleEn?: string | null;
    source?: string | null;
  };
  items: LessonMaterialItemDraft[];
  analysis_json?: unknown;
  illustration_prompt?: string | null;
  illustration_url?: string | null;
  illustration_captions?: string[] | null;
}) {
  const router = useRouter();
  const generateAction =
    role === "admin"
      ? generateAdminOrganizationDraft
      : generateTeacherOrganizationDraft;

  const [title, setTitle] = useState(project.title);
  const [titleEn, setTitleEn] = useState(project.titleEn ?? "");
  const [source, setSource] = useState(project.source ?? "");
  const [ensuringTitleEn, setEnsuringTitleEn] = useState(
    () => !(project.titleEn ?? "").trim()
  );
  const [itemsDraft, setItemsDraft] = useState(() =>
    items.map((it) => ({
      id: it.id,
      label: it.label,
      title: it.title,
      english_text: it.english_text,
      korean_text: it.korean_text ?? "",
      order_index: it.order_index,
    }))
  );
  const [analysisCards, setAnalysisCards] = useState<
    LessonMaterialAnalysisCard[]
  >(() =>
    Array.isArray(analysis_json)
      ? (analysis_json as LessonMaterialAnalysisCard[])
      : []
  );
  const [illustrationPrompt, setIllustrationPrompt] = useState(
    illustration_prompt ?? ""
  );
  const [illustrationUrl, setIllustrationUrl] = useState<string | null>(
    illustration_url ?? null
  );
  const [comicCaptions, setComicCaptions] = useState<string[]>(() =>
    Array.isArray(illustration_captions)
      ? illustration_captions.map((c) => String(c ?? ""))
      : []
  );
  const [saving, setSaving] = useState(false);
  const [generatingOrganization, setGeneratingOrganization] = useState(false);
  const [generatingIllustration, setGeneratingIllustration] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const totalCount = itemsDraft.length;
  const koreanCount = useMemo(
    () => itemsDraft.filter((it) => it.korean_text.trim().length > 0).length,
    [itemsDraft]
  );

  const base =
    role === "admin" ? "/admin/lesson-materials" : "/teacher/lesson-materials";

  // English title is AI-generated — backfill if missing (no manual typing)
  useEffect(() => {
    if (titleEn.trim()) {
      setEnsuringTitleEn(false);
      return;
    }
    let cancelled = false;
    setEnsuringTitleEn(true);
    void (async () => {
      const res = await ensureLessonMaterialTitleEnAction(role, {
        projectId: project.id,
      });
      if (cancelled) return;
      if (res.ok) {
        setTitleEn(res.titleEn);
        router.refresh();
      }
      setEnsuringTitleEn(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  function updateItem(
    id: string,
    patch: Partial<{ english_text: string; korean_text: string }>
  ) {
    setItemsDraft((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  }

  async function persist(extra?: {
    analysisCards?: LessonMaterialAnalysisCard[];
    illustrationPrompt?: string;
    illustrationUrl?: string | null;
    comicCaptions?: string[];
    title?: string;
    titleEn?: string;
    source?: string;
  }) {
    const res = await saveLessonMaterialProjectWorkspace(role, {
      projectId: project.id,
      title: extra?.title ?? title,
      titleEn: extra?.titleEn ?? titleEn,
      source: extra?.source ?? source,
      analysisCards: extra?.analysisCards ?? analysisCards,
      illustrationPrompt: extra?.illustrationPrompt ?? illustrationPrompt,
      illustrationUrl:
        extra?.illustrationUrl !== undefined
          ? extra.illustrationUrl
          : illustrationUrl,
      illustrationCaptions: extra?.comicCaptions ?? comicCaptions,
      items: itemsDraft.map((it) => ({
        id: it.id,
        english: it.english_text,
        korean: it.korean_text,
      })),
    });
    return res;
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const out = await persist();
      if (!out.ok) {
        setError(out.message);
        return;
      }
      setMessage("저장되었습니다.");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleRegenerateFlow() {
    setGeneratingOrganization(true);
    setError(null);
    setMessage(null);
    try {
      const res = await generateAction({
        items: itemsDraft.map((it) => ({
          english: it.english_text,
          korean: it.korean_text,
        })),
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setAnalysisCards(res.analysisCards);
      setIllustrationPrompt(res.illustrationPrompt);
      setComicCaptions(res.comicCaptions ?? []);
      if (res.passageTitle) setTitle(res.passageTitle);
      if (res.passageTitleEn) setTitleEn(res.passageTitleEn);

      const saved = await persist({
        analysisCards: res.analysisCards,
        illustrationPrompt: res.illustrationPrompt,
        comicCaptions: res.comicCaptions ?? [],
        title: res.passageTitle || title,
        titleEn: res.passageTitleEn || titleEn,
      });
      if (!saved.ok) {
        setError(saved.message);
        return;
      }
      setMessage("논리 흐름을 다시 만들었습니다.");
      router.refresh();
    } finally {
      setGeneratingOrganization(false);
    }
  }

  // 입력 단계(LessonMaterialsInputWizard)와 같이, 저장된 장면 설명이 없으면 지문으로 그린다.
  const passageForIllustration = itemsDraft
    .map((it) => it.english_text)
    .join("\n")
    .trim();
  function resolveIllustrationPrompt(): string {
    const direct = illustrationPrompt.trim();
    if (direct.length >= 8) return direct;
    const hint = passageForIllustration.slice(0, 600);
    if (hint.length >= 20) {
      return `One continuous 2x2 educational manhwa about this passage idea. Same characters in all panels. Soft narrative arc. No text, no speech bubbles in the art. Passage: ${hint}`;
    }
    return "";
  }

  async function handleRegenerateIllustration() {
    const prompt = resolveIllustrationPrompt();
    if (prompt.length < 8) {
      setError("삽화에 쓸 지문이 없습니다. 영어 지문을 넣거나 논리 흐름을 다시 만든 뒤 눌러 주세요.");
      return;
    }
    setGeneratingIllustration(true);
    setError(null);
    setMessage(null);
    try {
      const captions =
        comicCaptions.length > 0
          ? comicCaptions
          : [
              "이게 정말 맞을까?",
              "잠깐, 문제가 보이네",
              "다시 생각해 보자",
              "이제 이해가 됐어!",
            ];
      // 그림 한 장마다 크레딧이 나간다.
      if (!(await askCreditConfirm({
        title: "지문 삽화",
        description: "지문 장면을 그림 한 장으로 그려 자료에 넣습니다. 장면 설명을 고쳐 다시 그릴 수 있습니다.",
        subject: "그림 1장",
        items: [{ feature: "lesson_illustration", quantity: 1 }],
        sample: "illustration",
      }))) return;
      const res = await fetch("/api/lesson-materials/illustration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          illustrationPrompt: prompt,
          passageHint: itemsDraft
            .map((it) => it.english_text)
            .join("\n")
            .slice(0, 800),
          captions,
        }),
      });
      let img: { ok: true; url: string } | { ok: false; message: string };
      try {
        img = (await res.json()) as typeof img;
      } catch {
        setError(`삽화 응답을 읽지 못했습니다 (HTTP ${res.status}).`);
        return;
      }
      if (!res.ok || !img.ok) {
        setError(!img.ok ? img.message : `삽화 생성 실패 (HTTP ${res.status})`);
        return;
      }
      setIllustrationUrl(img.url);
      setIllustrationPrompt(prompt);
      const saved = await persist({
        illustrationUrl: img.url,
        comicCaptions: captions,
        illustrationPrompt: prompt,
      });
      if (!saved.ok) {
        setError(saved.message);
        return;
      }
      setMessage("삽화를 만들었습니다.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "삽화 생성 중 오류");
    } finally {
      setGeneratingIllustration(false);
    }
  }

  /** 고른 문장들을 한꺼번에 자동 해석한다 */
  async function translateMany(ids: string[]) {
    const targets = itemsDraft.filter((it) => ids.includes(it.id) && it.english_text.trim());
    if (targets.length === 0) return;
    setTranslating(true);
    setError(null);
    try {
      const res = await translateLessonMaterialLinesAction({
        lines: targets.map((t) => t.english_text),
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      targets.forEach((t, i) => updateItem(t.id, { korean_text: res.korean[i] ?? "" }));
    } finally {
      setTranslating(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <label className="block space-y-1">
            <span className="text-xs font-bold text-slate-500">출처</span>
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-violet-300"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="예: 2024 수능특강 / OO고 기출 / 26년도 1학기 중간고사 대비"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-bold text-slate-500">한국어 제목</span>
            <input
              className="w-full border-0 bg-transparent text-2xl font-bold text-slate-900 outline-none"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="한국어 제목"
            />
          </label>
          {titleEn.trim() ? (
            <p className="text-base font-medium text-slate-600">{titleEn}</p>
          ) : ensuringTitleEn ? (
            <p className="text-sm text-slate-400">영어 제목 준비 중…</p>
          ) : (
            <p className="text-sm text-slate-400">
              영어 제목은 자료 생성 시 자동으로 붙습니다
            </p>
          )}
          <p className="text-sm text-slate-600">
            {totalCount}개 문장 • 한글 입력 {koreanCount}개
          </p>
        </div>
        <Link
          href={base}
          className="inline-flex shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          자료함으로 ←
        </Link>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {message ? <Alert variant="success">{message}</Alert> : null}

      <section className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <LessonMaterialLogicalFlow
          cards={analysisCards.length > 0 ? analysisCards : null}
          loading={generatingOrganization && analysisCards.length === 0}
          regenerating={generatingOrganization}
          onRegenerate={() => void handleRegenerateFlow()}
        />
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-bold text-slate-900">4컷 만화 삽화</h2>
          <div className="mt-3">
            <LessonMaterialComicFrame
              imageUrl={illustrationUrl}
              emptyHint={
                generatingIllustration
                  ? "4컷 만화를 그리는 중입니다. 최대 1~2분 걸릴 수 있습니다."
                  : "「삽화 만들기」를 누르면 생성됩니다."
              }
            />
          </div>
          {comicCaptions.length > 0 ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {comicCaptions.map((c, i) => (
                <input
                  key={i}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                  value={c}
                  onChange={(e) => {
                    const v = e.target.value;
                    setComicCaptions((prev) => {
                      const next = [...prev];
                      next[i] = v;
                      return next;
                    });
                  }}
                  placeholder={`${i + 1}컷 대사`}
                />
              ))}
            </div>
          ) : null}
          <div className="mt-3">
            <Button
              type="button"
              size="sm"
              className="bg-brand-600 hover:bg-brand-700"
              disabled={
                generatingIllustration ||
                generatingOrganization ||
                (illustrationPrompt.trim().length < 8 &&
                  passageForIllustration.length < 20)
              }
              onClick={() => void handleRegenerateIllustration()}
            >
              {generatingIllustration
                ? "생성 중…"
                : illustrationUrl
                  ? "삽화만 다시 그리기"
                  : "삽화 만들기"}
            </Button>
          </div>
        </div>
      </section>

      <SentenceGrid
        rows={itemsDraft.slice().sort((a, b) => a.order_index - b.order_index)}
        translating={translating}
        onChange={updateItem}
        onTranslate={(ids) => void translateMany(ids)}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          disabled={saving || generatingOrganization || generatingIllustration}
          onClick={() => {
            setTitle(project.title);
            setTitleEn(project.titleEn ?? "");
            setSource(project.source ?? "");
            setItemsDraft(
              items.map((it) => ({
                id: it.id,
                label: it.label,
                title: it.title,
                english_text: it.english_text,
                korean_text: it.korean_text ?? "",
                order_index: it.order_index,
              }))
            );
            setAnalysisCards(
              Array.isArray(analysis_json)
                ? (analysis_json as LessonMaterialAnalysisCard[])
                : []
            );
            setIllustrationPrompt(illustration_prompt ?? "");
            setIllustrationUrl(illustration_url ?? null);
            setComicCaptions(
              Array.isArray(illustration_captions)
                ? illustration_captions.map((c) => String(c ?? ""))
                : []
            );
            setError(null);
            setMessage(null);
          }}
        >
          변경 취소
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={() => void handleSave()}
          disabled={saving || generatingOrganization || generatingIllustration}
        >
          {saving ? "저장 중…" : "변경 사항 저장"}
        </Button>
      </div>
    </div>
  );
}

type GridRow = { id: string; english_text: string; korean_text: string };

/**
 * 문장 표(엑셀처럼) — 지인에듀 입력 표를 본떠(선생님 2026-11-23 「엑셀처럼 편하게 수정」).
 * 칸을 누르면 바로 고친다(「영어 편집하기」 단추 없음). Tab·Shift+Tab은 옆 칸, Enter는 아래 칸(줄바꿈은 Shift+Enter),
 * 위·아래 화살표는 칸 맨 앞·맨 끝에서 윗줄·아랫줄로 간다. 엑셀에서 「영어⇥해석」 여러 줄을 복사해 붙이면 그 줄부터 아래로 채운다.
 */
function SentenceGrid({
  rows,
  translating,
  onChange,
  onTranslate,
}: {
  rows: GridRow[];
  translating: boolean;
  onChange: (id: string, patch: Partial<{ english_text: string; korean_text: string }>) => void;
  onTranslate: (ids: string[]) => void;
}) {
  const refs = useRef(new Map<string, HTMLTextAreaElement>());
  const cellKey = (r: number, c: number) => `${r}:${c}`;
  const focusCell = (r: number, c: number) => {
    const el = refs.current.get(cellKey(r, c));
    if (!el) return false;
    el.focus();
    return true;
  };
  const field = (c: number) => (c === 0 ? "english_text" : "korean_text") as "english_text" | "korean_text";
  const emptyKo = rows.filter((r) => r.english_text.trim() && !r.korean_text.trim()).map((r) => r.id);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>, r: number, c: number) {
    const el = e.currentTarget;
    if (e.key === "Tab") {
      const next = e.shiftKey ? (c === 1 ? [r, 0] : [r - 1, 1]) : c === 0 ? [r, 1] : [r + 1, 0];
      if (focusCell(next[0]!, next[1]!)) e.preventDefault();
    } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      if (focusCell(r + 1, c)) e.preventDefault();
    } else if (e.key === "ArrowUp" && el.selectionStart === 0 && el.selectionEnd === 0) {
      if (focusCell(r - 1, c)) e.preventDefault();
    } else if (e.key === "ArrowDown" && el.selectionStart === el.value.length) {
      if (focusCell(r + 1, c)) e.preventDefault();
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>, r: number, c: number) {
    const text = e.clipboardData.getData("text/plain");
    // 탭이나 여러 줄이 든 표 붙여넣기만 가로챈다. 한 줄 글은 보통대로 붙는다.
    if (!text.includes("\t") && !/\n\s*\S/.test(text.trim())) return;
    const lines = text.replace(/\r/g, "").replace(/\n+$/, "").split("\n");
    e.preventDefault();
    lines.forEach((line, i) => {
      const row = rows[r + i];
      if (!row) return;
      line.split("\t").forEach((v, j) => {
        const col = c + j;
        if (col > 1) return;
        onChange(row.id, { [field(col)]: v.trim() });
      });
    });
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-300 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <p className="text-[11px] text-slate-500">
          칸을 눌러 바로 고칩니다 · Tab 옆 칸 · Enter 아래 칸(줄바꿈은 Shift+Enter) · 엑셀에서 「영어 ⇥ 해석」 여러 줄을 복사해 붙이면 아래로 채웁니다
        </p>
        <button
          type="button"
          className="rounded-md border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 disabled:opacity-50"
          disabled={translating || emptyKo.length === 0}
          onClick={() => onTranslate(emptyKo)}
        >
          {translating ? "해석 중…" : `빈 해석 모두 자동 (${emptyKo.length})`}
        </button>
      </div>
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-12" />
          <col />
          <col />
          <col className="w-16" />
        </colgroup>
        <thead>
          <tr className="bg-slate-100 text-[11px] font-bold text-slate-600">
            <th className="border-r border-slate-200 py-1.5">#</th>
            <th className="border-r border-slate-200 py-1.5 pl-2 text-left">영어</th>
            <th className="border-r border-slate-200 py-1.5 pl-2 text-left">한글 해석</th>
            <th className="py-1.5">자동</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={row.id} className="border-t border-slate-200 align-top">
              <td className="border-r border-slate-200 bg-slate-50 pt-2 text-center text-xs font-semibold text-slate-500">{r + 1}</td>
              {[0, 1].map((c) => (
                <td
                  key={c}
                  className="border-r border-slate-200 p-0 focus-within:outline focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-brand-400"
                >
                  <textarea
                    ref={(el) => {
                      if (el) refs.current.set(cellKey(r, c), el);
                      else refs.current.delete(cellKey(r, c));
                    }}
                    rows={1}
                    value={row[field(c)]}
                    onChange={(e) => onChange(row.id, { [field(c)]: e.target.value })}
                    onKeyDown={(e) => onKeyDown(e, r, c)}
                    onPaste={(e) => onPaste(e, r, c)}
                    placeholder={c === 0 ? "영어 문장" : "한글 해석"}
                    className={`block w-full resize-none border-0 px-2 py-1.5 leading-relaxed outline-none [field-sizing:content] ${
                      c === 0 ? "text-slate-900" : "text-slate-700"
                    } ${c === 1 && row.english_text.trim() && !row.korean_text.trim() ? "bg-amber-50/60" : "bg-transparent"}`}
                  />
                </td>
              ))}
              <td className="p-1 text-center">
                <button
                  type="button"
                  title="이 문장 한글 해석 자동"
                  className="rounded-md px-1.5 py-1 text-[11px] text-brand-700 hover:bg-brand-50 disabled:opacity-40"
                  disabled={translating || !row.english_text.trim()}
                  onClick={() => onTranslate([row.id])}
                >
                  해석
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
