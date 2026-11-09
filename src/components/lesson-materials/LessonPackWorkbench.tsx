"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { isPrinting } from "@/lib/print/is-printing";
import { useDocumentName } from "@/components/lesson-materials/useDocumentName";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { usePdfPrefetch, usePdfSave } from "@/components/pdf/usePdfSave";
import { collectPrintPages } from "@/lib/pdf/download-sheets-pdf";
import {
  buildChoiceList,
  vocabNeedsAntonymRefresh,
  type LessonPackVocabItem,
} from "@/lib/lesson-materials/generate-lesson-pack";
import type { LessonMaterialAnalysisCard } from "@/lib/lesson-materials/generate-organization";
import {
  generateAndSaveLessonPackVocabAction,
  regenerateLessonPackTranslationsAction,
  saveLessonPackAction,
  type ensureLessonMaterialTitleEnAction,
} from "@/lib/lesson-materials/lesson-pack-actions";
import { LOGO_SRC } from "@/lib/branding";
import { postJson } from "@/lib/lesson-materials/post-json";
import { runWithConcurrency } from "@/lib/run-with-concurrency";
import {
  closeTabOrGo,
  useCreateDocumentFromUrl,
} from "@/components/lesson-materials/open-new-document";
import { useScaledHeight } from "@/components/lesson-materials/use-scaled-height";
import "./lesson-pack-print-styles.css";
import { watchPageNumbersById } from "@/lib/lesson-materials/page-numbers";
import {
  LessonPackExtrasControls,
  LessonPackExtrasSheets,
  useExtrasProjects,
  useLessonPackExtras,
} from "@/components/lesson-materials/test-book/LessonPackExtras";

/** 인쇄·PDF로 세는 쪽(테스트 교재 자료 쪽 포함, 쪽 나눔 측정 틀 안의 것은 뺀다) */
const LP_PAGE_SELECTOR = ":is(.lesson-pack-a4-sheet, .tb-sheet:not(.tb-measure .tb-sheet))";

/** 수업자료 준비(단어·동반의어, 영어 제목)를 동시에 돌리는 지문 수. */
const LESSON_PACK_PREP_CONCURRENCY = 8;

export type LessonPackProjectInput = {
  id: string;
  title: string;
  titleEn: string | null;
  source: string | null;
  folderName: string;
  analysisCards: LessonMaterialAnalysisCard[];
  headerLabel: string;
  vocab: LessonPackVocabItem[];
  /** 반의어 보강을 이미 한 번 했다(열 때마다 다시 만들지 않는다). */
  antonymChecked?: boolean;
  illustrationUrl: string | null;
  items: Array<{
    id: string;
    english_text: string;
    korean_text: string | null;
    order_index: number;
  }>;
};

/*
 * 수업용 자료 모양. 분석지·변형문제·워크북과 같은 시안 셋(A 교재 세리프 · B 깔끔한 산세리프 ·
 * C 클래식 인쇄) 가운데 하나를 고른다(기본은 A). 글꼴·색·선은 lesson-pack-print-styles.css의
 * .lp-style-*가 정한다.
 */
type LessonPackDesignStyle = "a" | "b" | "c";
const DESIGN_STYLE_KEY = "lesson-pack-design-style";
/** 쪽번호를 넣을지 (선생님이 자료마다 고른다) */
const PAGE_NUMBER_KEY = "lesson-pack-page-numbers";
const DESIGN_STYLES: Array<{ id: LessonPackDesignStyle; label: string; hint: string }> = [
  { id: "a", label: "A", hint: "교재 세리프" },
  { id: "b", label: "B", hint: "깔끔한 산세리프" },
  { id: "c", label: "C", hint: "클래식 인쇄" },
];
/** A·B·C가 쓰는 글꼴. */
const DESIGN_FONTS_HREF =
  "/fonts/print/fonts.css";

function designClass(style: LessonPackDesignStyle): string {
  return `lp-style lp-style-${style}`;
}

/** 쪽 머리 한 줄(첫 쪽 제외)과 본문 사이 간격(px). */
const RUN_HEADER_GAP_PX = 10;

/** A4 sheet */
const A4_WIDTH = "210mm";
const A4_HEIGHT = "297mm";
const A4_PAD_MM = 10;
const A4_PAD = `${A4_PAD_MM}mm`;
/** Usable body height inside padding (mm) */
const A4_BODY_MM = 297 - A4_PAD_MM * 2;

function A4Sheet({
  children,
  label,
  style,
  className,
  footerLogoSrc,
}: {
  children: ReactNode;
  label: string;
  style?: CSSProperties;
  className?: string;
  footerLogoSrc?: string | null;
}) {
  return (
    <article
      className={`lesson-pack-a4-sheet relative box-border overflow-hidden bg-white shadow-xl print:shadow-none ${className ?? ""}`.trim()}
      style={{
        width: A4_WIDTH,
        minHeight: A4_HEIGHT,
        padding: A4_PAD,
        paddingBottom: footerLogoSrc ? "16mm" : A4_PAD,
        ...style,
      }}
    >
      {children}
      {footerLogoSrc ? (
        <div className="lesson-pack-footer-logo pointer-events-none absolute bottom-[6mm] left-[10mm] right-[10mm] flex items-center justify-center border-t border-slate-200 pt-2 print:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={footerLogoSrc}
            alt=""
            className="h-7 w-auto max-w-[32mm] object-contain opacity-90"
          />
        </div>
      ) : null}
      <span className="sheet-preview-page-label pointer-events-none absolute bottom-2 right-3 text-[10px] text-slate-400 print:hidden">
        {label}
      </span>
    </article>
  );
}

/**
 * 영어 문장에서 단어정리 단어를 표시한다. 위첨자 번호는 단어정리 표의 번호(표 순서)와 같다.
 * 긴 단어부터 맞추는 것은 짝짓기 순서일 뿐이다("roll back"이 "roll"보다 먼저 잡히게).
 */
function markVocabInEnglish(english: string, vocab: LessonPackVocabItem[]): ReactNode {
  if (!english) return english;
  const numberByLower = new Map<string, number>();
  vocab.forEach((v, i) => {
    const key = v.word.trim().toLowerCase();
    if (key && !numberByLower.has(key)) numberByLower.set(key, i + 1);
  });
  if (numberByLower.size === 0) return english;
  const words = [...numberByLower.keys()].sort((a, b) => b.length - a.length);
  const re = new RegExp(
    `\\b(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
    "gi"
  );
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(english)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    if (m.index > last) parts.push(english.slice(last, m.index));
    const n = numberByLower.get(m[0].toLowerCase()) ?? 0;
    parts.push(
      <span key={`${m.index}-${m[0]}`} className="lp-vw">
        {m[0]}
        {n > 0 ? <sup>{n}</sup> : null}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < english.length) parts.push(english.slice(last));
  return parts;
}

/** "고2 9월 모의고사 (총 12지문)" → 제목과 지문 수를 나눠 지문 수만 작게 찍는다. */
function splitDocTitle(title: string): { main: string; count: string | null } {
  const m = /^(.*?)\s*\((총\s*\d+\s*지문)\)\s*$/.exec(title);
  if (!m || !m[1]) return { main: title, count: null };
  return { main: m[1], count: m[2] ?? null };
}

type PackBlock = {
  id: string;
  keepTogether: boolean;
  stickToNext?: boolean;
  forceNewPage?: boolean;
  gap: number;
};

export function LessonPackWorkbench({
  role,
  projects: initialProjects,
  logoSrc = LOGO_SRC,
  regenerate = false,
  embedded = false,
}: {
  role: "admin" | "teacher";
  projects: LessonPackProjectInput[];
  logoSrc?: string;
  /** 제작 버튼으로 열었다: 이미 만든 지문도 단어·동반의어를 새로 만든다. */
  regenerate?: boolean;
  /** 최종통합자료 안에 쪽만 끼워 넣는다(설정 창·생성·편집 없이 저장된 내용 그대로). */
  embedded?: boolean;
}) {
  const base =
    role === "admin" ? "/admin/lesson-materials" : "/teacher/lesson-materials";
  useCreateDocumentFromUrl(
    role,
    "lesson_pack",
    initialProjects.map((p) => p.id)
  );
  /** 새로 만들기는 첫 준비 한 번에만 적용한다(다시 시도는 못 끝난 지문만). */
  const regenerateOnce = useRef(regenerate);
  const [projects, setProjects] = useState(initialProjects);
  /** PDF로 바로 저장(인쇄 창 없이) */
  const pdf = usePdfSave();
  // 미리 PDF를 만들어 두어 「PDF로 저장」을 누르면 바로 받아진다
  usePdfPrefetch("lesson-pack-print-root", LP_PAGE_SELECTOR, { enabled: !embedded });
  /*
   * 테스트 교재 자료 더하기(선생님 2026-10-21) — 수업용 자료 뒤에 붙는다(계획표는 최종통합자료에서만). 최종통합자료에
   * 끼울 때는 통합자료가 같은 묶음을 따로 켜고 끄므로 여기서는 싣지 않는다(두 번 들어가지 않게).
   */
  const extras = useLessonPackExtras();
  const extraData = useExtrasProjects(
    role,
    initialProjects.map((p) => p.id),
    extras.any && !embedded
  );
  const showExtras = !embedded && extras.any && !!extraData.projects;
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [prepLoading, setPrepLoading] = useState(() =>
    !embedded && (regenerate ||
    initialProjects.some(
      (p) =>
        p.vocab.length === 0 ||
        (!p.antonymChecked && vocabNeedsAntonymRefresh(p.vocab)) ||
        !p.titleEn?.trim()
    ))
  );
  const [prepProgress, setPrepProgress] = useState({
    done: 0,
    total: Math.max(
      1,
      initialProjects.filter(
        (p) =>
          p.vocab.length === 0 ||
          (!p.antonymChecked && vocabNeedsAntonymRefresh(p.vocab)) ||
          !p.titleEn?.trim()
      ).length
    ),
  });
  const [prepRetryKey, setPrepRetryKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [showKorean, setShowKorean] = useState(true);
  const [boldLessonBody, setBoldLessonBody] = useState(true);
  const [showLogo, setShowLogo] = useState(true);

  /** PDF 저장 이름은 자료 이름으로(선생님 2026-11-06) */
  const docName = useDocumentName(role);
  // Document settings
  const [docTitle, setDocTitle] = useState(() => {
    const first = initialProjects[0];
    return first ? `${first.folderName} (총 ${initialProjects.length}지문)` : "수업용 자료";
  });
  const [headerLabel, setHeaderLabel] = useState(
    () => initialProjects[0]?.headerLabel || "26년도 1학기 중간고사 대비"
  );
  const [lineHeightPct, setLineHeightPct] = useState(180);
  const [fontSizePx, setFontSizePx] = useState(13);
  /** 자료 모양(A·B·C). 최종통합자료에 끼워 넣을 때도 같은 저장값을 읽는다. 옛 "base"·잘못된 값은 A. */
  const [designStyle, setDesignStyle] = useState<LessonPackDesignStyle>("a");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(DESIGN_STYLE_KEY);
      if (saved === "a" || saved === "b" || saved === "c") setDesignStyle(saved);
    } catch {
      /* 저장소를 못 쓰면 A */
    }
  }, []);
  /** 쪽번호 — 인쇄물 오른쪽 아래에 1부터 찍는다. 최종통합자료에 끼울 때는 통합자료가 센다. */
  const [pageNumbers, setPageNumbers] = useState(false);
  useEffect(() => {
    try {
      setPageNumbers(window.localStorage.getItem(PAGE_NUMBER_KEY) === "on");
    } catch {
      /* 저장소를 못 쓰면 끈 채로 */
    }
  }, []);
  const choosePageNumbers = (on: boolean) => {
    setPageNumbers(on);
    try {
      window.localStorage.setItem(PAGE_NUMBER_KEY, on ? "on" : "off");
    } catch {
      /* 무시 */
    }
  };
  useEffect(
    () => watchPageNumbersById("lesson-pack-print-root", pageNumbers && !embedded),
    [pageNumbers, embedded]
  );

  const chooseDesignStyle = (style: LessonPackDesignStyle) => {
    setDesignStyle(style);
    try {
      window.localStorage.setItem(DESIGN_STYLE_KEY, style);
    } catch {
      /* 무시 */
    }
  };
  /*
   * 모양 글꼴은 늦게 들어와 글자 폭이 달라진다. 쪽 나눔은 잰 높이로 하므로 글꼴이 들어온 뒤
   * 한 번 더 잰다(안 그러면 쪽이 넘쳐 아래가 잘린다).
   */
  const [fontsTick, setFontsTick] = useState(0);
  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts) return;
    let alive = true;
    const bump = () => alive && !isPrinting() && setFontsTick((t) => t + 1);
    void document.fonts.ready.then(bump);
    document.fonts.addEventListener?.("loadingdone", bump);
    return () => {
      alive = false;
      document.fonts.removeEventListener?.("loadingdone", bump);
    };
  }, [designStyle]);
  const [zoom, setZoom] = useState(70);
  const scaled = useScaledHeight<HTMLDivElement>(zoom / 100);

  const project = projects[0] ?? null;

  type TestRow = {
    word: string;
    choices: string[];
    answers: string[];
  };

  const testsByProject = useMemo(() => {
    return projects.map((p) => {
      const poolBase = p.vocab.flatMap((v) => [
        ...v.synonyms,
        ...v.antonyms,
        v.word,
      ]);
      const syn: TestRow[] = p.vocab
        .filter((v) => v.synonyms.length > 0)
        .map((v) => {
          const pool = p.vocab
            .filter((o) => o.word !== v.word)
            .flatMap((o) => [...o.synonyms, ...o.antonyms, o.word]);
          return {
            word: v.word,
            choices: buildChoiceList(v.synonyms, v.antonyms, pool),
            answers: v.synonyms,
          };
        });
      const ant: TestRow[] = p.vocab
        .filter((v) => v.antonyms.length > 0)
        .map((v) => {
          const pool = p.vocab
            .filter((o) => o.word !== v.word)
            .flatMap((o) => [...o.synonyms, ...o.antonyms, o.word]);
          return {
            word: v.word,
            choices: buildChoiceList(v.antonyms, v.synonyms, pool),
            answers: v.antonyms,
          };
        });
      void poolBase;
      return { syn, ant };
    });
  }, [projects]);

  const packMeasureRef = useRef<HTMLDivElement>(null);
  const runMeasureRef = useRef<HTMLDivElement>(null);
  const [pageChunks, setPageChunks] = useState<string[][]>([[]]);

  const vocabFingerprint = useMemo(
    () =>
      projects
        .map((p) =>
          p.vocab
            .map(
              (v) =>
                `${v.word}|${v.synonyms.join(",")}|${v.antonyms.join(",")}`
            )
            .join(";")
        )
        .join("||"),
    [projects]
  );

  /**
   * All passages in selection order. New passages start on a fresh page.
   * gap = 같은 쪽에서 앞 블록과의 간격(px). 쪽 첫 블록이면 0. 표 줄·문장 줄은 붙여 찍는다.
   */
  const packBlocks = useMemo(() => {
    const blocks: PackBlock[] = [{ id: "doc-header", keepTogether: true, gap: 0 }];

    projects.forEach((p, pi) => {
      const tests = testsByProject[pi] ?? { syn: [], ant: [] };
      const items = p.items
        .slice()
        .sort((a, b) => a.order_index - b.order_index);

      blocks.push({
        id: `p${pi}:passage-bar`,
        keepTogether: true,
        stickToNext: true,
        forceNewPage: pi > 0,
        gap: 12,
      });
      blocks.push({
        id: `p${pi}:vocab-heading`,
        keepTogether: true,
        stickToNext: true,
        gap: 16,
      });
      blocks.push({
        id: `p${pi}:vocab-head`,
        keepTogether: true,
        stickToNext: true,
        gap: 4,
      });
      for (let i = 0; i < p.vocab.length; i++) {
        blocks.push({ id: `p${pi}:vocab-row:${i}`, keepTogether: true, gap: 0 });
      }

      blocks.push({
        id: `p${pi}:test-heading`,
        keepTogether: true,
        stickToNext: true,
        gap: 18,
      });
      if (tests.syn.length > 0 || tests.ant.length > 0) {
        blocks.push({ id: `p${pi}:test-questions`, keepTogether: true, gap: 6 });
        blocks.push({ id: `p${pi}:test-answers`, keepTogether: true, gap: 10 });
      } else {
        blocks.push({ id: `p${pi}:test-empty`, keepTogether: true, gap: 6 });
      }

      blocks.push({
        id: `p${pi}:lesson-heading`,
        keepTogether: true,
        stickToNext: true,
        forceNewPage: true,
        gap: 16,
      });
      for (let i = 0; i < items.length; i++) {
        blocks.push({ id: `p${pi}:lesson-item:${i}`, keepTogether: true, gap: i === 0 ? 4 : 0 });
      }
      blocks.push({ id: `p${pi}:flow`, keepTogether: true, gap: 18 });
    });

    return blocks;
  }, [projects, testsByProject]);
  const gapById = useMemo(
    () => new Map(packBlocks.map((b) => [b.id, b.gap])),
    [packBlocks]
  );

  useEffect(() => {
    const id = "lesson-pack-print-page-size-style";
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = id;
    }
    el.textContent = `
@media print {
  @page { size: 210mm 297mm; margin: 0; }
  @page app-print-a4 { size: 210mm 297mm; margin: 0; }
  #lesson-pack-print-root { transform: none !important; gap: 0 !important; }
}
`;
    document.body.appendChild(el);
    return () => {
      el?.remove();
    };
  }, []);

  // Auto-generate/refresh vocab; backfill English title without wiping good vocab
  useEffect(() => {
    // 최종통합자료에 끼워 넣을 때는 저장된 내용만 보여 준다(만들지 않는다).
    if (embedded) return;
    const regenerateAll = regenerateOnce.current;
    const pending = projects
      .map((p, i) => ({ p, i }))
      .filter(
        ({ p }) =>
          regenerateAll ||
          p.vocab.length === 0 ||
          (!p.antonymChecked && vocabNeedsAntonymRefresh(p.vocab)) ||
          !p.titleEn?.trim()
      );
    if (pending.length === 0) {
      setPrepLoading(false);
      return;
    }

    let cancelled = false;
    setPrepLoading(true);
    setError(null);
    setPrepProgress({ done: 0, total: pending.length });

    void (async () => {
      setGenerating(true);
      let done = 0;
      // 지문끼리는 독립이라 함께 준비한다. 서버 액션은 브라우저에서 한 번에 하나씩만
      // 돌기 때문에 API 라우트로 보낸다(post-json.ts).
      const failures = await runWithConcurrency(
        pending,
        LESSON_PACK_PREP_CONCURRENCY,
        async ({ p, i }): Promise<string | null> => {
          if (cancelled) return null;
          const needsVocab =
            regenerateAll || p.vocab.length === 0 || (!p.antonymChecked && vocabNeedsAntonymRefresh(p.vocab));
          let failure: string | null = null;
          if (needsVocab) {
            const res = await postJson<
              Awaited<ReturnType<typeof generateAndSaveLessonPackVocabAction>>
            >("/api/lesson-materials/lesson-pack-prep", {
              role,
              projectId: p.id,
              kind: "vocab",
            });
            if (!res.ok) {
              failure = res.message;
            } else if (!cancelled) {
              setProjects((prev) =>
                prev.map((row, idx) =>
                  idx === i
                    ? {
                        ...row,
                        vocab: res.vocab,
                        headerLabel: res.headerLabel,
                        titleEn: res.titleEn ?? row.titleEn,
                      }
                    : row
                )
              );
              if (i === 0) setHeaderLabel(res.headerLabel);
            }
          } else if (!p.titleEn?.trim()) {
            const res = await postJson<
              Awaited<ReturnType<typeof ensureLessonMaterialTitleEnAction>>
            >("/api/lesson-materials/lesson-pack-prep", {
              role,
              projectId: p.id,
              kind: "titleEn",
            });
            if (!res.ok) {
              failure = res.message;
            } else if (!cancelled) {
              setProjects((prev) =>
                prev.map((row, idx) =>
                  idx === i ? { ...row, titleEn: res.titleEn } : row
                )
              );
            }
          }
          done += 1;
          if (!cancelled) setPrepProgress({ done, total: pending.length });
          return failure ? `지문 ${i + 1}: ${failure}` : null;
        }
      );
      setGenerating(false);
      if (cancelled) return;
      const failed = failures.filter((row): row is string => row !== null);
      if (failed.length > 0) {
        // 로딩 화면에 오류와 "다시 시도"가 있다. 다시 시도하면 못 끝난 지문만 돈다.
        setError(failed.join(" / "));
        return;
      }
      regenerateOnce.current = false;
      setPrepLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.map((p) => p.id).join(","), prepRetryKey]);

  async function autoGenerate(projectId: string, idx: number) {
    setGenerating(true);
    setError(null);
    try {
      const res = await generateAndSaveLessonPackVocabAction(role, {
        projectId,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setProjects((prev) =>
        prev.map((p, i) =>
          i === idx
            ? {
                ...p,
                vocab: res.vocab,
                headerLabel: res.headerLabel,
                titleEn: res.titleEn ?? p.titleEn,
              }
            : p
        )
      );
      if (idx === 0) setHeaderLabel(res.headerLabel);
    } finally {
      setGenerating(false);
    }
  }

  function updateVocabAt(
    pi: number,
    index: number,
    patch: Partial<LessonPackVocabItem>
  ) {
    setProjects((prev) =>
      prev.map((p, i) => {
        if (i !== pi) return p;
        const vocab = p.vocab.map((v, vi) =>
          vi === index ? { ...v, ...patch } : v
        );
        return { ...p, vocab };
      })
    );
  }

  function updateVocabListFieldAt(
    pi: number,
    index: number,
    field: "synonyms" | "antonyms",
    text: string
  ) {
    const list = text
      .split(/[,/|]/)
      .map((s) => s.trim())
      .filter(Boolean);
    updateVocabAt(pi, index, { [field]: list });
  }

  function removeVocabRowAt(pi: number, index: number) {
    setProjects((prev) =>
      prev.map((p, i) =>
        i === pi
          ? { ...p, vocab: p.vocab.filter((_, vi) => vi !== index) }
          : p
      )
    );
  }

  async function handleSave(): Promise<boolean> {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      for (const p of projects) {
        const res = await saveLessonPackAction(role, {
          projectId: p.id,
          headerLabel,
          vocab: p.vocab.filter((v) => v.word.trim()),
          title: p.title,
          titleEn: p.titleEn,
          source: p.source,
        });
        if (!res.ok) {
          setError(res.message);
          return false;
        }
      }
      setMessage(
        projects.length > 1
          ? `${projects.length}개 지문을 저장했습니다.`
          : "저장되었습니다."
      );
      return true;
    } catch {
      setError("저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  /**
   * 「저장 후 닫기」: 예전에는 자료함으로 가는 링크라 저장하지 않고 나갔다.
   * 저장한 뒤 제작 버튼으로 연 탭이면 닫고, 닫히지 않으면(직접 연 탭) 자료함으로 간다.
   */
  async function saveAndClose() {
    if (generating) {
      closeTabOrGo(base);
      return;
    }
    const ok = await handleSave();
    if (!ok) return;
    closeTabOrGo(base);
  }

  // Titles/subtitles stay fixed; only body blocks use fontSizePx / lineHeight.
  const bodyStyle = useMemo((): CSSProperties => {
    return {
      fontSize: `${fontSizePx}px`,
      lineHeight: `${lineHeightPct / 100}`,
    };
  }, [fontSizePx, lineHeightPct]);

  // Pack continuous blocks onto A4 pages. keepTogether → move whole block to next page
  // rather than clipping; stickToNext → don't leave a heading alone at page bottom.
  // 첫 쪽(문서 머리)을 뺀 쪽에는 쪽 머리 한 줄이 붙으므로 그만큼 덜 싣는다.
  useLayoutEffect(() => {
    if (projects.length === 0) {
      setPageChunks([[]]);
      return;
    }
    const root = packMeasureRef.current;
    if (!root) return;

    const widthPx = root.offsetWidth || 1;
    const pxPerMm = widthPx / 210;
    // Extra bottom padding when footer logo is on (16mm vs 10mm)
    const bodyMm = showLogo ? 297 - A4_PAD_MM - 16 : A4_BODY_MM;
    const pageBodyPx = bodyMm * pxPerMm;
    const runReservePx =
      (runMeasureRef.current?.offsetHeight ?? 0) + RUN_HEADER_GAP_PX;

    const heightById = new Map<string, number>();
    for (const el of Array.from(
      root.querySelectorAll<HTMLElement>("[data-pack-block]")
    )) {
      const id = el.dataset.packBlock;
      if (id) heightById.set(id, el.offsetHeight);
    }

    const pages: string[][] = [];
    let cur: string[] = [];
    let used = 0;
    const limit = () =>
      (pages.length === 0 ? pageBodyPx : pageBodyPx - runReservePx) - 2;

    const flush = () => {
      if (cur.length === 0) return;
      pages.push(cur);
      cur = [];
      used = 0;
    };

    for (let i = 0; i < packBlocks.length; i++) {
      const block = packBlocks[i]!;
      if (block.forceNewPage && cur.length > 0) {
        flush();
      }
      const h = heightById.get(block.id) ?? 24;
      const next = block.stickToNext ? packBlocks[i + 1] : undefined;
      const nh = next ? (heightById.get(next.id) ?? 24) : 0;

      // Keep heading with the full next block when that next block fits on one page.
      // Otherwise the title would sit alone at the bottom while content moves on.
      let placeHeight = h;
      if (next && nh <= limit()) {
        placeHeight = h + next.gap + nh;
      }

      const leadingGap = cur.length > 0 ? block.gap : 0;
      if (cur.length > 0 && used + leadingGap + placeHeight > limit()) {
        flush();
      }

      used += (cur.length > 0 ? block.gap : 0) + h;
      cur.push(block.id);
    }
    flush();
    setPageChunks(pages.length > 0 ? pages : [[]]);
  }, [
    projects,
    packBlocks,
    vocabFingerprint,
    fontSizePx,
    lineHeightPct,
    showKorean,
    boldLessonBody,
    docTitle,
    headerLabel,
    testsByProject,
    showLogo,
    logoSrc,
    designStyle,
    fontsTick,
  ]);

  if (!project) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="text-center">
          <Alert variant="error">선택된 자료가 없습니다.</Alert>
          <Link href={base} className="mt-4 inline-block text-sm text-violet-700">
            ← 자료함으로
          </Link>
        </div>
      </div>
    );
  }

  if (prepLoading) {
    const pct =
      prepProgress.total > 0
        ? Math.round((prepProgress.done / prepProgress.total) * 100)
        : 0;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-200">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
          <p className="text-center text-lg font-bold text-slate-900">
            수업용 자료 준비 중
          </p>
          <p className="mt-2 text-center text-sm text-slate-600">
            단어·동반의어를 생성하고 있습니다…
          </p>
          <div className="mt-6 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-violet-600 transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-3 text-center text-2xl font-bold text-violet-700">
            {pct}%
          </p>
          <p className="mt-1 text-center text-xs text-slate-400">
            {prepProgress.done}/{prepProgress.total} 지문 · 완료 후 미리보기가
            열립니다
          </p>
          {error ? (
            <div className="mt-4 space-y-3 text-center">
              <p className="text-sm text-rose-600">{error}</p>
              <button
                type="button"
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
                onClick={() => {
                  setError(null);
                  setPrepRetryKey((k) => k + 1);
                }}
              >
                다시 시도
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  function parseBlockId(blockId: string): {
    pi: number;
    kind: string;
    sub: string | null;
  } | null {
    if (blockId === "doc-header") return { pi: -1, kind: "doc-header", sub: null };
    const m = /^p(\d+):([^:]+)(?::(.+))?$/.exec(blockId);
    if (!m) return null;
    return {
      pi: Number(m[1]),
      kind: m[2]!,
      sub: m[3] ?? null,
    };
  }

  function renderSectionHead(no: number, title: string, en: string, instruction?: string): ReactNode {
    return (
      <div className="lp-sec-head">
        <h2 className="lp-sec-h">
          <span className="lp-sec-n">
            <i>{no}</i>
          </span>
          <span className="lp-sec-t">{title}</span>
          <span className="lp-sec-e">{en}</span>
        </h2>
        {instruction ? <p className="lp-in lp-sec-ins">{instruction}</p> : null}
      </div>
    );
  }

  /** 쪽 머리 한 줄: 왼쪽 상단 라벨, 오른쪽 그 쪽 지문 번호·제목·출처. */
  function renderRunHeader(pi: number): ReactNode {
    const board = projects[pi];
    const right = board
      ? [
          `${String(pi + 1).padStart(2, "0")} ${board.title}`,
          board.source?.trim() || null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
    return (
      <header className="lp-run">
        <span className="lp-run-l">{headerLabel}</span>
        <span className="lp-run-r">{right}</span>
      </header>
    );
  }

  function renderPackBlock(blockId: string, interactive: boolean): ReactNode {
    const parsed = parseBlockId(blockId);
    if (!parsed) return null;

    if (parsed.kind === "doc-header") {
      const { main, count } = splitDocTitle(docTitle);
      return (
        <header className="lp-doc-top">
          <div className="min-w-0">
            {headerLabel.trim() ? <p className="lp-kicker">{headerLabel}</p> : null}
            <h1 className="lp-doc-title">
              {main}
              {count ? <span className="lp-doc-count">{count}</span> : null}
            </h1>
          </div>
          <p className="lp-doc-kind">수업용 자료</p>
        </header>
      );
    }

    const board = projects[parsed.pi];
    if (!board) return null;
    const tests = testsByProject[parsed.pi] ?? { syn: [], ant: [] };
    const lessonItems = board.items
      .slice()
      .sort((a, b) => a.order_index - b.order_index);
    const pi = parsed.pi;

    if (parsed.kind === "passage-bar") {
      return (
        <div className="lp-pbar">
          <span className="lp-pno">{String(pi + 1).padStart(2, "0")}</span>
          <div className="min-w-0">
            <p className="lp-ptitle">{board.title}</p>
            {board.titleEn?.trim() ? (
              <p className="lp-ptitle-en">{board.titleEn.trim()}</p>
            ) : null}
          </div>
          {board.source?.trim() ? (
            <span className="lp-psrc">{board.source.trim()}</span>
          ) : (
            <span />
          )}
        </div>
      );
    }

    if (parsed.kind === "vocab-heading") {
      return renderSectionHead(1, "단어정리", "Vocabulary");
    }

    const vocabColumns = interactive
      ? "5% 15% 22% 27% 27% 4%"
      : "5% 16% 23% 28% 28%";

    if (parsed.kind === "vocab-head") {
      return (
        <div className="lp-in lp-voc-head grid" style={{ gridTemplateColumns: vocabColumns }}>
          <div>No.</div>
          <div>영어</div>
          <div>뜻</div>
          <div>동의어</div>
          <div>반의어</div>
          {interactive ? <div className="print:hidden" /> : null}
        </div>
      );
    }

    if (parsed.kind === "vocab-row") {
      const i = Number(parsed.sub);
      const v = board.vocab[i];
      if (!v) return null;
      return (
        <div
          className={`lp-in lp-voc-row grid items-start ${i % 2 === 1 ? "lp-voc-row--even" : ""}`}
          style={{ gridTemplateColumns: vocabColumns }}
        >
          <div className="lp-vn">{i + 1}</div>
          <div className="lp-vw-c">
            {interactive ? (
              <input
                className="w-full border-0 bg-transparent outline-none placeholder:text-slate-300"
                style={{ fontSize: "inherit" }}
                value={v.word}
                placeholder="단어"
                onChange={(e) =>
                  updateVocabAt(pi, i, { word: e.target.value })
                }
              />
            ) : (
              <span>{v.word}</span>
            )}
          </div>
          <div className="lp-vm">
            {interactive ? (
              <textarea
                className="w-full resize-none overflow-hidden border-0 bg-transparent outline-none"
                style={{ fontSize: "inherit", lineHeight: 1.25 }}
                value={v.meaning}
                onChange={(e) =>
                  updateVocabAt(pi, i, { meaning: e.target.value })
                }
                rows={Math.max(1, Math.ceil(v.meaning.length / 20))}
              />
            ) : (
              <span>{v.meaning}</span>
            )}
          </div>
          <div className="lp-vs">
            {interactive ? (
              <textarea
                className="w-full resize-none overflow-hidden break-words border-0 bg-transparent outline-none"
                style={{ fontSize: "inherit", lineHeight: 1.25 }}
                value={v.synonyms.join(", ")}
                onChange={(e) =>
                  updateVocabListFieldAt(pi, i, "synonyms", e.target.value)
                }
                rows={Math.max(1, Math.ceil(v.synonyms.join(", ").length / 26))}
              />
            ) : (
              <span>{v.synonyms.join(", ")}</span>
            )}
          </div>
          <div className="lp-vs">
            {interactive ? (
              <textarea
                className="w-full resize-none overflow-hidden break-words border-0 bg-transparent outline-none"
                style={{ fontSize: "inherit", lineHeight: 1.25 }}
                value={v.antonyms.join(", ")}
                onChange={(e) =>
                  updateVocabListFieldAt(pi, i, "antonyms", e.target.value)
                }
                rows={Math.max(1, Math.ceil(v.antonyms.join(", ").length / 26))}
              />
            ) : (
              <span>{v.antonyms.join(", ")}</span>
            )}
          </div>
          {interactive ? (
            <div className="print:hidden">
              <button
                type="button"
                className="text-rose-400"
                onClick={() => removeVocabRowAt(pi, i)}
              >
                ✕
              </button>
            </div>
          ) : null}
        </div>
      );
    }

    if (parsed.kind === "test-heading") {
      return renderSectionHead(
        2,
        "동/반의어 TEST",
        "Synonyms & Antonyms",
        "단어와 뜻이 같은(동의어) 또는 반대인(반의어) 낱말을 모두 고르세요."
      );
    }

    if (parsed.kind === "test-empty") {
      return (
        <p className="lp-in lp-sec-ins">
          동반의어가 있는 단어가 없어 테스트를 생략합니다.
        </p>
      );
    }

    if (parsed.kind === "test-questions") {
      const box = (kind: "syn" | "ant", rows: typeof tests.syn) => (
        <div className="lp-tbox">
          <p className="lp-tbox-h">
            <span>{kind === "syn" ? "동의어 찾기" : "반의어 찾기"}</span>
            <em>{rows.length}문항</em>
          </p>
          <ol className="lp-tq">
            {rows.map((row, i) => (
              <li key={`${kind}-q-${pi}-${i}`}>
                <span className="lp-q-n">{String(i + 1).padStart(2, "0")}</span>
                <span className="min-w-0 break-words">
                  <b className="lp-q-w">{row.word}</b>
                  <span className="lp-q-c">{row.choices.join(" / ")}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      );
      return (
        <div className="lp-in lp-tests">
          {tests.syn.length > 0 ? box("syn", tests.syn) : null}
          {tests.ant.length > 0 ? box("ant", tests.ant) : null}
        </div>
      );
    }

    if (parsed.kind === "test-answers") {
      const keyList = (kind: "syn" | "ant", rows: typeof tests.syn) => (
        <div className="min-w-0">
          <p className="lp-keys-k">{kind === "syn" ? "동의어" : "반의어"}</p>
          <p className="lp-keys-l">
            {rows.map((row, i) => (
              <span key={`${kind}-a-${pi}-${i}`} className="lp-key-it">
                <b>{String(i + 1).padStart(2, "0")}</b>
                {row.answers.join(", ")}
              </span>
            ))}
          </p>
        </div>
      );
      return (
        <div className="lp-in lp-keys">
          <p className="lp-keys-h">동/반의어 TEST 정답</p>
          <div className="lp-keys-grid">
            {tests.syn.length > 0 ? keyList("syn", tests.syn) : null}
            {tests.ant.length > 0 ? keyList("ant", tests.ant) : null}
          </div>
        </div>
      );
    }

    if (parsed.kind === "lesson-heading") {
      return renderSectionHead(3, "수업용자료", "Sentence by Sentence");
    }

    if (parsed.kind === "lesson-item") {
      const idx = Number(parsed.sub);
      const it = lessonItems[idx];
      if (!it) return null;
      return (
        <div className="lp-in lp-line" style={bodyStyle}>
          <span className="lp-ln-n">{idx + 1}</span>
          <p
            className={`lp-ln-en ${boldLessonBody ? "" : "lp-ln-en--regular"}`}
          >
            {markVocabInEnglish(it.english_text, board.vocab)}
          </p>
          <p
            className="lp-ln-ko"
            style={{ visibility: showKorean ? "visible" : "hidden" }}
            aria-hidden={!showKorean}
          >
            {it.korean_text?.trim() || <span className="opacity-40">—</span>}
          </p>
        </div>
      );
    }

    if (parsed.kind === "flow") {
      return (
        <div>
          {renderSectionHead(4, "논리 흐름 & 삽화", "Logical Flow")}
          <div
            className={`lp-in lp-flow ${board.illustrationUrl ? "lp-flow--two" : ""}`}
          >
            {board.analysisCards.length > 0 ? (
              <div
                className="lp-fbox"
                style={{ fontSize: Math.max(11, fontSizePx - 1) }}
              >
                <p className="lp-fbox-h">
                  LOGICAL FLOW <span>논리 흐름</span>
                </p>
                <ol className="lp-fl">
                  {board.analysisCards.map((c, i) => (
                    <li key={`${i}-${c.title}`}>
                      <span className="lp-fl-n">{i + 1}</span>
                      <div className="min-w-0">
                        <p className="lp-fl-t">{c.title}</p>
                        <p className="lp-fl-d">{c.desc}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <p className="lp-sec-ins">논리 흐름이 없습니다.</p>
            )}
            {board.illustrationUrl ? (
              <div className="lp-toon">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={board.illustrationUrl}
                  alt="4컷 삽화"
                  className="h-full w-full object-contain"
                />
              </div>
            ) : null}
          </div>
        </div>
      );
    }

    return null;
  }

  /** 쪽들(인쇄 대상). 최종통합자료에 끼워 넣을 때(embedded)도 같은 모양을 쓴다. */
  const printPages = (
    <>
      <link rel="stylesheet" href={DESIGN_FONTS_HREF} />
      {pageChunks
        .filter((chunk) => chunk.length > 0)
        .map((chunk, pageI, pages) => {
          const hasDocHeader = chunk.includes("doc-header");
          const runPi = parseBlockId(chunk[0] ?? "")?.pi ?? 0;
          return (
            <A4Sheet
              key={`pack-page-${pageI}`}
              label={`${pageI + 1} / ${pages.length}`}
              footerLogoSrc={showLogo ? logoSrc : null}
              className={
                pageI === pages.length - 1
                  ? "lesson-pack-a4-sheet--last"
                  : undefined
              }
            >
              {!hasDocHeader ? (
                <div style={{ marginBottom: RUN_HEADER_GAP_PX }}>
                  {renderRunHeader(Math.max(0, runPi))}
                </div>
              ) : null}
              <div className="flex flex-col">
                {chunk.map((blockId, bi) => (
                  <div
                    key={`${pageI}-${blockId}`}
                    className="break-inside-avoid"
                    style={bi > 0 ? { marginTop: gapById.get(blockId) ?? 10 } : undefined}
                  >
                    {renderPackBlock(blockId, true)}
                  </div>
                ))}
              </div>
            </A4Sheet>
          );
        })}

      {showExtras ? (
        <LessonPackExtrasSheets projects={extraData.projects!} opts={extras.opts} logoSrc={showLogo ? logoSrc : null} />
      ) : null}

      {showLogo && logoSrc && !embedded ? (
        <div
          aria-hidden
          className="lesson-pack-print-logo-fixed hidden print:flex"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoSrc}
            alt=""
            className="h-7 w-auto max-w-[32mm] object-contain opacity-90"
          />
        </div>
      ) : null}

      {/* Off-screen measure — must match on-screen interactive heights.
          높이 0인 틀 안에 둬서 스크롤 길이에 잡히지 않게 한다. */}
      <div aria-hidden className="pointer-events-none absolute left-0 top-0 h-0 w-0 overflow-hidden print:hidden">
        <div
          className={`lesson-pack-measure font-print -z-10 w-[210mm] opacity-0 ${designClass(designStyle)}`}
          style={{ padding: A4_PAD }}
        >
          <div ref={runMeasureRef}>{renderRunHeader(0)}</div>
          <div ref={packMeasureRef} className="flex flex-col">
            {packBlocks.map((b) => (
              <div key={`m-${b.id}`} data-pack-block={b.id}>
                {renderPackBlock(b.id, true)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );

  if (embedded) {
    return (
      <div
        id="lesson-pack-print-root"
        className={`flex flex-col gap-6 print:gap-0 ${designClass(designStyle)}`}
      >
        {printPages}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex bg-slate-200 print:static print:z-auto print:block print:bg-white">
      {/* Settings sidebar */}
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-slate-200 bg-white print:hidden">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveAndClose()}
            className="rounded-lg px-2 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            {saving ? "저장 중…" : "← 저장 후 닫기"}
          </button>
          <span className="text-sm font-bold text-slate-900">문서 설정</span>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 text-sm">
          <div className="space-y-1.5">
            <span className="text-xs font-bold text-slate-500">자료 모양</span>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
              {DESIGN_STYLES.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  title={d.hint}
                  onClick={() => chooseDesignStyle(d.id)}
                  className={`rounded-md px-1 py-1.5 text-xs font-bold transition ${
                    designStyle === d.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400">
              {DESIGN_STYLES.find((d) => d.id === designStyle)?.hint}
            </p>
          </div>

          <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
            <span className="text-xs font-bold text-slate-500">쪽번호 넣기</span>
            <input
              type="checkbox"
              checked={pageNumbers}
              onChange={(e) => choosePageNumbers(e.target.checked)}
              className="h-4 w-4 accent-violet-500"
            />
          </label>

          <LessonPackExtrasControls
            opts={extras.opts}
            update={extras.update}
            projects={extraData.projects ?? []}
            missing={extraData.missing}
            busy={extraData.busy}
            error={extraData.error}
            onPrepare={() => void extraData.prepareMissing()}
            onRegenerate={(ids, parts) => void extraData.regenerate(ids, parts)}
          />

          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-slate-500">상단 라벨 (소제목)</span>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
              value={headerLabel}
              onChange={(e) => setHeaderLabel(e.target.value)}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-slate-500">자료 제목</span>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
            />
          </label>

          {projects.map((p, pi) => (
            <div
              key={p.id}
              className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/80 p-3"
            >
              <p className="text-[11px] font-bold text-slate-500">
                지문 {String(pi + 1).padStart(2, "0")}
              </p>
              <label className="block space-y-1">
                <span className="text-[11px] font-bold text-slate-500">
                  한국어 제목
                </span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  value={p.title}
                  onChange={(e) => {
                    const v = e.target.value;
                    setProjects((prev) =>
                      prev.map((row, i) =>
                        i === pi ? { ...row, title: v } : row
                      )
                    );
                  }}
                />
              </label>
              {p.titleEn?.trim() ? (
                <p className="text-xs text-slate-600">
                  <span className="font-bold text-slate-500">영어 제목 · </span>
                  {p.titleEn}
                </p>
              ) : (
                <p className="text-[11px] text-slate-400">
                  영어 제목은 자동으로 채워집니다
                </p>
              )}
              <label className="block space-y-1">
                <span className="text-[11px] font-bold text-slate-500">출처</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  value={p.source ?? ""}
                  placeholder="예: 2024 수능특강"
                  onChange={(e) => {
                    const v = e.target.value;
                    setProjects((prev) =>
                      prev.map((row, i) =>
                        i === pi ? { ...row, source: v } : row
                      )
                    );
                  }}
                />
              </label>
            </div>
          ))}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">
                수업용자료 본문 줄간격
              </span>
              <span className="text-xs text-slate-500">{lineHeightPct}%</span>
            </div>
            <input
              type="range"
              min={120}
              max={260}
              step={10}
              value={lineHeightPct}
              onChange={(e) => setLineHeightPct(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">본문 폰트 크기</span>
              <span className="text-xs text-slate-500">{fontSizePx}px</span>
            </div>
            <input
              type="range"
              min={11}
              max={20}
              step={1}
              value={fontSizePx}
              onChange={(e) => setFontSizePx(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-[11px] text-slate-400">
              제목·소제목은 고정, 단어/테스트/지문 본문만 조절됩니다.
            </p>
          </div>

          <div className="space-y-3 border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">학원 로고</span>
              <button
                type="button"
                onClick={() => setShowLogo((v) => !v)}
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  showLogo
                    ? "bg-violet-600 text-white"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {showLogo ? "ON" : "OFF"}
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              각 페이지 하단(꼬리말)에 학원 로고를 표시합니다.
            </p>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">한글 해석 표시</span>
              <button
                type="button"
                onClick={() => setShowKorean((v) => !v)}
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  showKorean
                    ? "bg-violet-600 text-white"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {showKorean ? "ON" : "OFF"}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">영어 본문 Bold</span>
              <button
                type="button"
                onClick={() => setBoldLessonBody((v) => !v)}
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  boldLessonBody
                    ? "bg-violet-600 text-white"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {boldLessonBody ? "ON" : "OFF"}
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              수업용 자료 영어 문장을 Bold로 강조합니다. 한글은 일반 굵기입니다.
            </p>
          </div>

          {error ? <Alert variant="error">{error}</Alert> : null}
          {message ? <Alert variant="success">{message}</Alert> : null}
        </div>

        <div className="space-y-2 border-t border-slate-100 p-4">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="w-full"
            disabled={generating}
            onClick={() => {
              void (async () => {
                for (let i = 0; i < projects.length; i++) {
                  await autoGenerate(projects[i]!.id, i);
                }
              })();
            }}
          >
            {generating ? "단어 생성 중…" : "단어 다시 만들기"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="w-full"
            disabled={generating}
            onClick={() => {
              void (async () => {
                setGenerating(true);
                setError(null);
                setMessage(null);
                try {
                  let total = 0;
                  let skipped = 0;
                  for (const p of projects) {
                    const res = await regenerateLessonPackTranslationsAction(
                      role,
                      { projectId: p.id }
                    );
                    if (!res.ok) {
                      setError(res.message);
                      return;
                    }
                    total += res.regenerated;
                    skipped += res.skippedTeacher;
                    // Refresh korean in local state from server via router would be ideal;
                    // update items if we have them on project
                    setProjects((prev) =>
                      prev.map((row) =>
                        row.id === p.id
                          ? {
                              ...row,
                              items: row.items.map((it) => it),
                            }
                          : row
                      )
                    );
                  }
                  setMessage(
                    `해석 ${total}문장 재생성 완료` +
                      (skipped > 0
                        ? ` (교사 수정 ${skipped}문장 제외)`
                        : "") +
                      ". 미리보기를 새로고침하면 반영됩니다."
                  );
                  window.location.reload();
                } finally {
                  setGenerating(false);
                }
              })();
            }}
          >
            {generating ? "해석 생성 중…" : "해석 다시 생성"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="primary"
            className="w-full"
            disabled={saving || generating}
            onClick={() => void saveAndClose()}
          >
            {saving ? "저장 중…" : "저장 후 닫기"}
          </Button>
          <button
            type="button"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 text-xs font-bold text-slate-700"
            onClick={() => window.print()}
          >
            인쇄
          </button>
          <button
            type="button"
            className="w-full rounded-lg border border-violet-300 bg-white py-2 text-xs font-bold text-violet-800 disabled:opacity-50"
            disabled={!!pdf.busy}
            onClick={() =>
              void pdf.save(
                "수업용자료",
                collectPrintPages(document.getElementById("lesson-pack-print-root"), LP_PAGE_SELECTOR),
                [docName ?? docTitle]
              )
            }
          >
            PDF로 저장
          </button>
          {pdf.status ? (
            <p className={`text-[11px] font-semibold ${pdf.busy ? "text-violet-700" : "text-rose-600"}`}>{pdf.status}</p>
          ) : null}
        </div>
      </aside>

      {/* Preview canvas — continuous flow, soft A4 page breaks between blocks */}
      <main className="relative min-w-0 flex-1 overflow-auto print:static print:overflow-visible">
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-center gap-2 border-b border-slate-200/80 bg-white/90 px-4 py-2 backdrop-blur print:hidden">
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs"
            onClick={() => setZoom(100)}
          >
            100%
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs"
            onClick={() => setZoom((z) => Math.max(40, z - 10))}
          >
            −
          </button>
          <span className="text-xs font-semibold text-slate-600">{zoom}%</span>
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs"
            onClick={() => setZoom((z) => Math.min(120, z + 10))}
          >
            +
          </button>
        </div>

        <div className="flex justify-center p-6 print:p-0">
          <div style={scaled.frameStyle} className="print:!h-auto print:!overflow-visible">
          <div
            ref={scaled.ref}
            id="lesson-pack-print-root"
            className={`flex origin-top flex-col gap-6 print:gap-0 print:!transform-none ${designClass(designStyle)}`}
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: "top center",
            }}
          >
            {printPages}
          </div>
          </div>
        </div>
      </main>
    </div>
  );
}
