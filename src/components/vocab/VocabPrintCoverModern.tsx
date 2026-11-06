"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  resolveVocabCoverLevel,
  VOCAB_COVER_LEVELS,
  type VocabPrintCoverSettings,
} from "@/lib/vocab/vocab-print-cover";

/** 새 표지(타이포 블록 · 다크 네온 · 블록+네온)에 쓰는 글꼴 */
const COVER_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Anton&display=swap";

const ANTON = "'Anton', 'Arial Narrow', sans-serif";
const HANGUL_DISPLAY = "'Black Han Sans', 'Noto Sans KR', sans-serif";
const SERIF_DISPLAY = "'Noto Serif KR', Georgia, serif";

export type VocabCoverStats = { days: number; words: number };

type Props = {
  cover: VocabPrintCoverSettings;
  stats: VocabCoverStats;
};

/** 시안(794px 폭) 기준 px → 표지 폭 대비 단위 */
const u = (px: number) => `${(px / 7.94).toFixed(3)}cqw`;

/** 글자 폭을 대충 세어(한글 1, 영문·숫자 0.6) 한 줄에 들어가는 제목 크기를 고른다 */
function titleSize(title: string, basePx: number, maxWidthPx: number, factor: number) {
  let w = 0;
  for (const ch of title) {
    if (/\s/.test(ch)) w += 0.3;
    else if (/[가-힣]/.test(ch)) w += 0.98;
    else w += 0.6;
  }
  const fit = maxWidthPx / Math.max(w, 1);
  return u(Math.min(basePx * factor, fit));
}

const SIZE_FACTOR = { md: 0.85, lg: 1, xl: 1.12 } as const;

function Grain({ opacity }: { opacity: number }) {
  return (
    <svg
      aria-hidden
      focusable="false"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    >
      <filter id="vocab-cover-grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#vocab-cover-grain)" opacity={opacity} />
    </svg>
  );
}

function Abs({ style, children }: { style: CSSProperties; children?: ReactNode }) {
  return <div style={{ position: "absolute", ...style }}>{children}</div>;
}

function NameFields({ color, line }: { color: string; line: string }) {
  const cell: CSSProperties = {
    borderBottom: `1.5px solid ${line}`,
    paddingBottom: u(8),
  };
  return (
    <Abs
      style={{
        left: u(56),
        right: u(56),
        bottom: u(40),
        display: "grid",
        gridTemplateColumns: "1.4fr 1fr",
        gap: u(24),
        fontSize: u(13),
        fontWeight: 700,
        color,
      }}
    >
      <span style={cell}>이름</span>
      <span style={cell}>반</span>
    </Abs>
  );
}

export function VocabPrintCoverModern({ cover, stats }: Props) {
  const { level, index } = resolveVocabCoverLevel(cover.color, cover.title, cover.seriesLabel);
  const title = cover.title || "단어장";
  const factor = SIZE_FACTOR[cover.titleSize];
  const titleFont = cover.fontFamily === "serif" ? SERIF_DISPLAY : HANGUL_DISPLAY;
  const titleWeight = cover.fontFamily === "serif" ? 900 : 400;
  const seriesText = [cover.seriesLabel, cover.badge, cover.heroMark]
    .map((s) => s.trim())
    .filter(Boolean)
    .join("  ·  ");
  const subLine = [cover.subtitle, cover.metaLine].map((s) => s.trim()).filter(Boolean).join("  ·  ");
  const words = stats.words.toLocaleString("en-US");
  const levelNo = index >= 0 ? index + 1 : null;

  const stage: CSSProperties = {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    containerType: "size",
    fontFamily: "'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
    WebkitPrintColorAdjust: "exact",
    printColorAdjust: "exact",
  };

  const topBar = (color: string, academyColor: string) => (
    <Abs
      style={{
        left: u(56),
        right: u(56),
        top: u(50),
        display: "flex",
        justifyContent: "space-between",
        fontSize: u(13),
        fontWeight: 700,
        letterSpacing: u(3),
        color,
      }}
    >
      <span>VOCABULARY</span>
      <span style={{ letterSpacing: 0, color: academyColor }}>{cover.academyName}</span>
    </Abs>
  );

  const footer = (color: string) =>
    cover.footerText.trim() ? (
      <Abs
        style={{
          left: u(56),
          right: u(56),
          bottom: u(cover.showNameFields ? 14 : 40),
          fontSize: u(10),
          color,
          textAlign: "right",
        }}
      >
        {cover.footerText}
      </Abs>
    ) : null;

  const fonts = <link rel="stylesheet" href={COVER_FONTS_HREF} />;

  if (cover.theme === "block") {
    const shade = `color-mix(in srgb, ${level.deep} 78%, #000)`;
    const tint = `color-mix(in srgb, ${level.bright} 45%, #fff)`;
    const stat = (value: string, label: string) => (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontFamily: ANTON, fontSize: u(48), lineHeight: 1 }}>{value}</span>
        <span style={{ fontSize: u(12), fontWeight: 700, letterSpacing: u(1) }}>{label}</span>
      </div>
    );
    return (
      <div style={{ ...stage, background: level.deep, color: "#fff" }}>
        {fonts}
        <Grain opacity={0.16} />
        <Abs
          style={{
            left: u(-12),
            top: u(70),
            fontFamily: ANTON,
            fontSize: u(360),
            lineHeight: 0.82,
            letterSpacing: u(-4),
            color: shade,
            whiteSpace: "nowrap",
          }}
        >
          VOCA
          <br />
          BULA
          <br />
          RY
        </Abs>
        {topBar(tint, tint)}
        <Abs style={{ left: u(56), right: u(56), top: u(410), display: "flex", flexDirection: "column", gap: u(10) }}>
          {seriesText ? (
            <span style={{ fontSize: u(20), fontWeight: 800, letterSpacing: u(3), color: tint }}>{seriesText}</span>
          ) : null}
          <span
            style={{
              fontFamily: titleFont,
              fontWeight: titleWeight,
              fontSize: titleSize(title, 176, 680, factor),
              lineHeight: 0.98,
              overflowWrap: "anywhere",
            }}
          >
            {title}
          </span>
          {subLine ? <span style={{ fontSize: u(17), fontWeight: 700, color: tint }}>{subLine}</span> : null}
          {cover.slogan.trim() ? (
            <span style={{ fontSize: u(15), fontWeight: 700, color: "#fff", opacity: 0.9 }}>{cover.slogan}</span>
          ) : null}
        </Abs>
        <Abs
          style={{
            left: 0,
            right: 0,
            top: u(860),
            height: u(120),
            background: level.point,
            color: "#111827",
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            alignItems: "center",
            padding: `0 ${u(56)}`,
            boxSizing: "border-box",
          }}
        >
          {stat(String(stats.days), stats.days === 1 ? "DAY" : "DAYS")}
          {stat(words, "WORDS")}
          {levelNo ? stat(`LV.${levelNo}`, level.name) : <span />}
        </Abs>
        {cover.showNameFields ? <NameFields color={tint} line={tint} /> : null}
        {footer(tint)}
      </div>
    );
  }

  if (cover.theme === "neon") {
    const neon = level.bright;
    return (
      <div style={{ ...stage, background: "#0a0f14", color: "#fff" }}>
        {fonts}
        <Grain opacity={0.1} />
        <svg
          viewBox="0 0 794 1123"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden
          focusable="false"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        >
          <defs>
            <filter id="vocab-cover-glow">
              <feGaussianBlur stdDeviation="6" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <text
            x="40"
            y="630"
            fontFamily={ANTON}
            fontSize="330"
            fill="none"
            stroke={neon}
            strokeWidth="2"
            {...(String(stats.words).length >= 4
              ? { textLength: "714", lengthAdjust: "spacingAndGlyphs" }
              : {})}
          >
            {String(stats.words)}
          </text>
          <text
            x="40"
            y="925"
            fontFamily={ANTON}
            fontSize="300"
            fill={neon}
            filter="url(#vocab-cover-glow)"
            textLength="714"
            lengthAdjust="spacingAndGlyphs"
          >
            WORDS
          </text>
          <line x1="56" y1="968" x2="738" y2="968" stroke={neon} strokeOpacity="0.5" />
        </svg>
        {topBar(neon, "#94a3b8")}
        <Abs style={{ left: u(56), right: u(56), top: u(105), display: "flex", flexDirection: "column", gap: u(12) }}>
          <div style={{ display: "flex", alignItems: "center", gap: u(18), flexWrap: "wrap" }}>
            <span
              style={{
                fontFamily: titleFont,
                fontWeight: titleWeight,
                fontSize: titleSize(title, 96, 560, factor),
                lineHeight: 1.02,
              }}
            >
              {title}
            </span>
            {levelNo ? (
              <span
                style={{
                  padding: `${u(4)} ${u(10)}`,
                  background: level.point,
                  color: "#0a0f14",
                  fontFamily: ANTON,
                  fontSize: u(20),
                  letterSpacing: u(2),
                }}
              >
                LV.{levelNo}
              </span>
            ) : null}
          </div>
          {seriesText ? (
            <span style={{ fontSize: u(16), fontWeight: 800, letterSpacing: u(2), color: neon }}>{seriesText}</span>
          ) : null}
          {subLine ? <span style={{ fontSize: u(15), color: "#94a3b8" }}>{subLine}</span> : null}
          {cover.slogan.trim() ? (
            <span style={{ fontSize: u(15), color: "#cbd5e1" }}>{cover.slogan}</span>
          ) : null}
        </Abs>
        {cover.showNameFields ? <NameFields color="#94a3b8" line={neon} /> : null}
        {footer("#64748b")}
      </div>
    );
  }

  // hybrid: 윗부분 색 블록 + 아래 어두운 바탕
  return (
    <div style={{ ...stage, background: "#0b1220", color: "#fff" }}>
      {fonts}
      <Grain opacity={0.1} />
      <Abs style={{ left: 0, top: 0, right: 0, height: u(470), background: level.deep }} />
      <Abs
        style={{
          left: u(50),
          top: u(40),
          fontFamily: ANTON,
          fontSize: u(300),
          lineHeight: 0.85,
          letterSpacing: u(-3),
          color: "#fff",
        }}
      >
        VOCA
      </Abs>
      <Abs
        style={{
          right: u(56),
          top: u(56),
          textAlign: "right",
          fontSize: u(13),
          fontWeight: 700,
          lineHeight: 1.8,
          color: `color-mix(in srgb, ${level.bright} 40%, #fff)`,
        }}
      >
        <span style={{ letterSpacing: u(3) }}>VOCABULARY</span>
        <br />
        {cover.academyName}
      </Abs>
      <Abs style={{ left: u(56), right: u(56), top: u(515), display: "flex", flexDirection: "column", gap: u(10) }}>
        {seriesText ? (
          <span style={{ fontSize: u(20), fontWeight: 800, letterSpacing: u(3), color: level.bright }}>{seriesText}</span>
        ) : null}
        <span
          style={{
            fontFamily: titleFont,
            fontWeight: titleWeight,
            fontSize: titleSize(title, 150, 680, factor),
            lineHeight: 1,
            overflowWrap: "anywhere",
          }}
        >
          {title}
        </span>
        {subLine ? <span style={{ fontSize: u(17), color: "#94a3b8" }}>{subLine}</span> : null}
        {cover.slogan.trim() ? (
          <span
            style={{
              marginTop: u(6),
              fontSize: u(15),
              fontWeight: 700,
              color: "#e2e8f0",
              borderLeft: `${u(3)} solid ${level.bright}`,
              paddingLeft: u(12),
            }}
          >
            {cover.slogan}
          </span>
        ) : null}
      </Abs>
      {index >= 0 ? (
        <Abs
          style={{
            left: u(56),
            right: u(56),
            top: u(890),
            display: "grid",
            gridTemplateColumns: `repeat(${VOCAB_COVER_LEVELS.length}, minmax(0, 1fr))`,
            gap: u(4),
          }}
        >
          {VOCAB_COVER_LEVELS.map((l, i) => (
            <div key={l.key} style={{ display: "flex", flexDirection: "column", gap: u(6) }}>
              <span
                style={{
                  height: u(8),
                  borderRadius: u(4),
                  background: i === index ? l.bright : "#1e293b",
                }}
              />
              <span
                style={{
                  fontSize: u(11),
                  fontWeight: i === index ? 900 : 500,
                  color: i === index ? l.bright : "#64748b",
                }}
              >
                {l.name}
              </span>
            </div>
          ))}
        </Abs>
      ) : null}
      <Abs
        style={{
          left: u(56),
          top: u(820),
          display: "flex",
          gap: u(28),
          fontSize: u(14),
          fontWeight: 700,
          color: "#cbd5e1",
        }}
      >
        <span>
          <b style={{ fontFamily: ANTON, fontSize: u(26), fontWeight: 400, color: "#fff" }}>{stats.days}</b> {stats.days === 1 ? "DAY" : "DAYS"}
        </span>
        <span>
          <b style={{ fontFamily: ANTON, fontSize: u(26), fontWeight: 400, color: "#fff" }}>{words}</b> WORDS
        </span>
      </Abs>
      {cover.showNameFields ? <NameFields color="#94a3b8" line="#334155" /> : null}
      {footer("#64748b")}
    </div>
  );
}
