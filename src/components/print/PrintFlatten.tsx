"use client";

import { useEffect } from "react";
import { flattenForPrint } from "@/lib/print/flatten-for-print";

/** 모든 화면: 인쇄 직전 반투명 효과를 불투명으로 바꾸고 인쇄가 끝나면 되돌린다(스풀링 — 선생님 2026-11-06) */
export function PrintFlatten() {
  useEffect(() => {
    let restore: (() => void) | null = null;
    const before = () => {
      restore?.();
      try {
        restore = flattenForPrint(document.body);
      } catch {
        restore = null;
      }
    };
    const after = () => {
      restore?.();
      restore = null;
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
  return null;
}
