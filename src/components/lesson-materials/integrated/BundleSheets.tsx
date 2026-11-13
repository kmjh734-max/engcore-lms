"use client";

import type { CSSProperties, ReactNode } from "react";
import type { CoverPreset, IntegratedCover } from "@/lib/lesson-materials/integrated";
import { BookBackCover, BookCover } from "@/components/lesson-materials/book-cover/BookCover";
import { coverTitle, examLine, legacyCoverSpec, mergeCoverSpec, type BookCoverSpec } from "@/lib/lesson-materials/book-cover";

/**
 * 최종통합자료의 앞표지 · 뒤표지 · 목차 · 간지 쪽. 모두 A4 한 쪽이고, 인쇄에서 배경색까지 그대로
 * 찍히게 한다. 앞 · 뒤표지는 내신 표지(BookCover)가 그리고, 프리셋은 판과 배색만 고른다.
 * 선생님 2026-10-22: 예전 여덟 가지 표지 · 색 번짐은 지움.
 */

const SHEET_STYLE: CSSProperties = {
  width: "210mm",
  height: "297mm",
  boxSizing: "border-box",
  WebkitPrintColorAdjust: "exact",
  printColorAdjust: "exact",
};

function Sheet({
  children,
  style,
  last,
}: {
  children: ReactNode;
  style?: CSSProperties;
  last?: boolean;
}) {
  return (
    <article
      className={`final-bundle-sheet relative overflow-hidden bg-white shadow-xl print:shadow-none ${
        last ? "final-bundle-sheet--last" : ""
      }`}
      style={{ ...SHEET_STYLE, ...style }}
    >
      {children}
    </article>
  );
}

/** 표지 칸: 자료 이름 · 예전 칸에서 읽은 값 위에 선생님이 고친 칸(cover.exam)을 얹는다. */
export function bundleCoverSpec(cover: IntegratedCover, examDefaults?: { material?: string; range?: string }): BookCoverSpec {
  return mergeCoverSpec(legacyCoverSpec(cover, examDefaults), cover.exam);
}

/** 목차 · 간지 꼬릿말: 「호원고 1학년 · 통합 테스트북」 / 「2026 2학기 기말고사 대비」 */
function footerLines(cover: IntegratedCover): [string, string] {
  const spec = bundleCoverSpec(cover);
  const exam = examLine(spec);
  return [[coverTitle(spec), spec.material].filter((v) => v.trim()).join(" · "), exam ? `${exam} 대비` : ""];
}

function designOf(preset: CoverPreset) {
  return { style: preset.coverStyle ?? "premium", paletteId: preset.paletteId ?? "black", paper: "A4" as const };
}

/**
 * 앞표지. 학교 · 학년 · 시험 · 교과서 · 범위는 자료 이름 · 예전 칸에서 읽고, 고친 칸을 그 위에 얹는다.
 * examDefaults는 칸이 비었을 때 쓰는 자료 이름 · 범위(테스트 교재: 지문 출처).
 */
export function FrontCover({
  preset,
  cover,
  logoSrc,
  examDefaults,
}: {
  preset: CoverPreset;
  cover: IntegratedCover;
  logoSrc?: string | null;
  examDefaults?: { material?: string; range?: string };
}) {
  return (
    <Sheet>
      <BookCover spec={bundleCoverSpec(cover, examDefaults)} design={designOf(preset)} logoSrc={logoSrc} />
    </Sheet>
  );
}

/** 뒤표지: 앞표지와 같은 바탕 · 이 교재의 구성(목차) · 특장점 · 학원 로고와 이름(BookBackCover). */
export function BackCover({
  preset,
  cover,
  logoSrc,
  entries,
}: {
  preset: CoverPreset;
  cover: IntegratedCover;
  logoSrc?: string | null;
  entries?: ContentsEntry[];
}) {
  return (
    <Sheet last>
      <BookBackCover
        spec={bundleCoverSpec(cover)}
        design={designOf(preset)}
        logoSrc={logoSrc}
        contents={(entries ?? []).map((e) => ({
          number: e.number,
          title: e.sub || e.en,
          en: e.en,
          pages: e.from != null && e.to != null ? `${e.from} – ${e.to}` : "",
        }))}
      />
    </Sheet>
  );
}

export type ContentsEntry = {
  number: string;
  en: string;
  sub: string;
  from: number | null;
  to: number | null;
  /** 세부 항목(워크북 유형·수업용 자료 지문)과 쪽 범위 */
  children?: Array<{ label: string; note?: string; from: number; to: number }>;
};

/**
 * 목차를 몇 쪽에 나눠 실을지: 묶음마다 높이를 어림해(세부 항목 줄 수·출처 줄) 한 쪽에 안 들어가면 다음 쪽으로 넘긴다
 * (선생님 2026-11-13 「지문이 많으면 목차가 깨진다 — 두 쪽으로」). 돌려주는 값은 쪽마다 실을 묶음 수.
 */
export function contentsPageSplit(shape: Array<{ children: number; notes: boolean }>): number[] {
  const ROOM_MM = 200; // 제목·바닥글을 뺀 자리
  const out: number[] = [];
  let used = 0;
  let n = 0;
  for (const e of shape) {
    const cols = e.children > 16 ? 3 : 2;
    const rows = Math.ceil(e.children / cols);
    const h = 21 + (rows ? 2.5 + rows * (e.notes ? 8.4 : 5.2) : 0);
    if (n > 0 && used + h > ROOM_MM) {
      out.push(n);
      used = 0;
      n = 0;
    }
    used += h;
    n += 1;
  }
  if (n > 0 || !out.length) out.push(n);
  return out;
}

/** 목차 */
export function ContentsPage({
  entries,
  cover,
  accent,
  continued = false,
}: {
  entries: ContentsEntry[];
  cover: IntegratedCover;
  accent: string;
  /** 둘째 쪽부터 */
  continued?: boolean;
}) {
  return (
    <Sheet style={{ padding: "22mm 20mm" }}>
      <h2 className="text-[40pt] font-black leading-none tracking-tight text-slate-900" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
        CONTENTS
        {continued ? <span className="ml-[4mm] align-middle text-[12pt] font-bold tracking-normal text-slate-400">이어서</span> : null}
      </h2>
      <div className="mt-[4mm] h-[1.6mm] w-[22mm] bg-slate-900" />
      <ol className={`mt-[14mm] ${entries.some((e) => e.children?.length) ? "space-y-[5mm]" : "space-y-[7mm]"}`}>
        {entries.map((e) => (
          <li key={e.number} className="flex items-start gap-[6mm]">
            <span className="w-[14mm] text-[22pt] font-black leading-none" style={{ color: accent, fontFamily: "Georgia, serif" }}>
              {e.number}
            </span>
            <div className="min-w-0 flex-1 border-b border-slate-200 pb-[4mm]">
              <div className="flex items-baseline justify-between gap-4">
                <p className="text-[14pt] font-bold uppercase tracking-wide text-slate-900" style={{ fontFamily: "Georgia, serif" }}>
                  {e.en}
                </p>
                <p className="shrink-0 text-[10pt] text-slate-500">
                  {e.from != null && e.to != null ? `p. ${e.from} ~ ${e.to}` : ""}
                </p>
              </div>
              <p className="mt-1 text-[10pt] text-slate-500">{e.sub}</p>
              {e.children?.length ? (
                <ul
                  className="mt-[2.5mm] grid gap-x-[6mm] gap-y-[1.2mm] text-[8.5pt] leading-tight text-slate-700"
                  // 위에서 아래로 읽고 다음 단으로(지문 번호 차례대로)
                  style={(() => {
                    const cols = e.children.length > 16 ? 3 : 2;
                    return {
                      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                      gridTemplateRows: `repeat(${Math.ceil(e.children.length / cols)}, auto)`,
                      gridAutoFlow: "column",
                    };
                  })()}
                >
                  {e.children.map((c, ci) => (
                    <li key={`${ci}-${c.label}`} className="min-w-0">
                      <div className="flex min-w-0 items-baseline gap-[1.5mm]">
                        {/* 출처가 있으면 출처를 앞세운다(선생님 2026-11-13 「목차도 제목보다 출처가 더 중요」): 「01 출처」, 제목은 아랫줄 */}
                        <span className={`min-w-0 truncate ${c.note ? "font-semibold text-slate-800" : ""}`}>
                          {c.note ? `${c.label.match(/^\d+\s/)?.[0] ?? ""}${c.note}` : c.label}
                        </span>
                        <span className="min-w-[4mm] flex-1 border-b border-dotted border-slate-300" />
                        <span className="shrink-0 tabular-nums text-slate-500">{c.from === c.to ? c.from : `${c.from}~${c.to}`}</span>
                      </div>
                      {/* 출처(수업용 자료 지문) */}
                      {c.note ? <div className="truncate pl-[5mm] text-[7.5pt] text-slate-500">{c.label.replace(/^\d+\s/, "")}</div> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      <div className="absolute bottom-[16mm] left-[20mm] right-[20mm] border-t border-slate-300 pt-[3mm] text-right">
        <p className="text-[10pt] font-bold text-slate-800">{footerLines(cover)[0]}</p>
        <p className="text-[9pt] text-slate-500">{footerLines(cover)[1]}</p>
      </div>
    </Sheet>
  );
}

/** 간지: 자료 사이에 넣는 제목 쪽. */
export function DividerPage({
  number,
  en,
  title,
  sub,
  preset,
  cover,
}: {
  number: string;
  en: string;
  title: string;
  sub: string;
  preset: CoverPreset;
  cover: IntegratedCover;
}) {
  return (
    <Sheet>
      <div className="absolute inset-y-0 left-0 w-[14mm]" style={{ background: preset.strip }} />
      <div className="absolute left-[30mm] right-[20mm] top-[90mm]">
        <p className="text-[14pt] font-black tracking-[0.3em]" style={{ color: preset.accent }}>
          PART {number}
        </p>
        <h2 className="mt-[4mm] text-[34pt] font-black uppercase leading-tight text-slate-900" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
          {en}
        </h2>
        <div className="mt-[6mm] h-[1.2mm] w-[30mm]" style={{ background: preset.accent }} />
        <p className="mt-[6mm] text-[20pt] font-black text-slate-800">{title}</p>
        <p className="mt-[2mm] text-[11pt] text-slate-500">{sub}</p>
      </div>
      <div className="absolute bottom-[16mm] left-[30mm] right-[20mm] border-t border-slate-200 pt-[3mm] text-right">
        <p className="text-[10pt] font-bold text-slate-700">{footerLines(cover)[0]}</p>
        <p className="text-[9pt] text-slate-500">{footerLines(cover)[1]}</p>
      </div>
    </Sheet>
  );
}

/** 프리셋 고르기용 작은 표지 미리보기. */
export function CoverThumb({
  preset,
  cover,
  widthPx = 76,
  logoSrc,
  examDefaults,
}: {
  preset: CoverPreset;
  cover: IntegratedCover;
  widthPx?: number;
  logoSrc?: string | null;
  examDefaults?: { material?: string; range?: string };
}) {
  // A4 폭 210mm ≈ 793.7px(96dpi)를 썸네일 폭에 맞춰 줄인다.
  const scale = widthPx / 793.7;
  return (
    <div
      className="pointer-events-none relative overflow-hidden"
      style={{ width: widthPx, height: widthPx * (297 / 210) }}
    >
      <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: "210mm" }}>
        <FrontCover preset={preset} cover={cover} logoSrc={logoSrc} examDefaults={examDefaults} />
      </div>
    </div>
  );
}
