"use client";

import type { ReactNode } from "react";

/**
 * 유형에 마우스를 올리면 뜨는 미리보기 칸(선생님 2026-10-26: 워크북·변형문제 모두, 실제 자료 캡처로).
 * 올린 줄의 오른쪽에 띄우고, 오른쪽에 자리가 없으면 왼쪽에 띄운다. 화면 아래로 넘치지 않게 위로 당긴다.
 * 마우스를 가로막지 않게 pointer-events 는 끈다.
 */
export function HoverPreview({
  anchor,
  width,
  height,
  children,
}: {
  /** 마우스를 올린 줄의 화면 위치(getBoundingClientRect) */
  anchor: { left: number; right: number; top: number };
  /** 칸 너비·대략 높이(px) */
  width: number;
  height: number;
  children: ReactNode;
}) {
  const vw = typeof window === "undefined" ? 1400 : window.innerWidth;
  const vh = typeof window === "undefined" ? 900 : window.innerHeight;
  const w = Math.min(width, vw - 32);
  const left =
    anchor.right + 12 + w <= vw - 16
      ? anchor.right + 12
      : anchor.left - 12 - w >= 16
        ? anchor.left - 12 - w
        : Math.max(16, vw - 16 - w);
  const top = Math.max(12, Math.min(anchor.top, vh - 12 - Math.min(height, vh - 24)));
  return (
    <div
      className="pointer-events-none fixed z-[80] overflow-hidden rounded-xl border border-slate-300 bg-white p-3 shadow-2xl"
      style={{ left, top, width: w, maxHeight: vh - 24 }}
    >
      {children}
    </div>
  );
}

/** 캡처 그림 한 장. 화면 높이를 넘으면 비율을 지켜 줄인다. */
export function PreviewShot({ src, w, h, alt }: { src: string; w: number; h: number; alt: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      width={w}
      height={h}
      alt={alt}
      className="mx-auto block h-auto max-w-full rounded-md border border-slate-200"
      // 칸 너비를 꽉 채운다(11-24 「자세하게 잘 보이도록」). 11-26 「너무 커서 화면을 가린다」 — 칸 540px·높이 화면 70%까지
      style={{ maxHeight: "70vh", width: "100%", objectFit: "contain" }}
    />
  );
}
