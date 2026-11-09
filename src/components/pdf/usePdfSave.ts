"use client";

import { useEffect, useRef, useState } from "react";
import {
  A4,
  collectPrintPages,
  downloadSheetsPdf,
  pdfFileName,
  type PdfPaper,
} from "@/lib/pdf/download-sheets-pdf";

/** 이만큼 걸리기 전에는 「PDF 만드는 중」을 띄우지 않는다(미리 만들어 두었으면 바로 받아진다). */
const SHOW_BUSY_AFTER_MS = 700;

/**
 * 「PDF로 저장」 버튼이 쓰는 상태. 화면마다 쪽을 골라 save에 넘기면 된다.
 * busy는 「문제지 2/5」처럼 진행을, error는 실패 까닭을 준다.
 */
export function usePdfSave() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  /** exactName: 파일 이름을 nameParts 그대로(뒤에 label을 붙이지 않는다) */
  async function save(
    label: string,
    pages: HTMLElement[],
    nameParts: Array<string | null | undefined>,
    paper?: PdfPaper,
    exactName = false
  ) {
    if (running.current) return;
    setError(null);
    if (pages.length === 0) {
      setError("저장할 쪽이 아직 없습니다.");
      return;
    }
    running.current = true;
    let progress = `${label} 0/${pages.length}`;
    const show = setTimeout(() => setBusy(progress), SHOW_BUSY_AFTER_MS);
    try {
      await downloadSheetsPdf(pages, (exactName ? pdfFileName(...nameParts) : pdfFileName(...nameParts, label)), {
        paper,
        onProgress: (done, total) => {
          progress = `${label} ${done}/${total}`;
          setBusy((b) => (b ? progress : b));
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF를 만들지 못했습니다.");
    } finally {
      clearTimeout(show);
      running.current = false;
      setBusy(null);
    }
  }
  /** 버튼 아래에 띄울 한 줄 */
  const status = busy ? `PDF 만드는 중… ${busy}` : error;
  return { busy, error, save, status };
}

/**
 * 인쇄 영역의 쪽을 미리 PDF로 만들어 둔다. 화면이 바뀌면 멈춘 뒤 다시(고친 쪽만) 만든다.
 * 그래서 「PDF로 저장」을 누르면 기다리지 않고 바로 받아진다.
 *
 * 선생님 말씀(2026-10-20): 저장할 때 「PDF 만드는 중」 없이 문제지 누르면 바로 받게.
 */
export function usePdfPrefetch(
  rootId: string,
  /** 버튼마다 고르는 쪽(문제지·정답지·전체 등). 쪽은 서로 나눠 쓰므로 여러 개여도 서버 일은 한 번이다. */
  selectors: string | string[],
  opts: { paper?: PdfPaper; enabled?: boolean } = {}
) {
  const enabled = opts.enabled ?? true;
  const selectorKey = (Array.isArray(selectors) ? selectors : [selectors]).join("|||");
  const paper = opts.paper ?? A4;
  const paperKey = `${paper.w}x${paper.h}`;
  /*
   * 다 만들어 두었는지(선생님 2026-11-09 「누르자마자 바로 다운받게」): 화면이 버튼을 「PDF 준비 중」으로 두었다가
   * 이것이 true가 되면 켠다 — 켜진 버튼은 누르면 바로 받아진다. 처음 한 번 다 만든 뒤에는 화면이 조금 바뀌어도
   * 다시 끄지 않는다(그때 누르면 바뀐 쪽만 잠깐 만든다). 미리 만들기가 실패해도 true(누를 때 만든다).
   */
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    if (!enabled || typeof window === "undefined") return;
    // 저장에 쓰는 코드(PDF 합치기 등)를 화면에 들어올 때 미리 불러 둔다 — 처음 누를 때 불러오느라 기다리지 않게
    void import("@/lib/pdf/server-pdf").catch(() => undefined);
    void import("pdf-lib").catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let observer: MutationObserver | null = null;
    let alive = true;
    /*
     * 화면이 쪽을 늘려 가는 동안(7쪽 → 52쪽 → 200쪽)에도 나온 쪽부터 바로 만든다(선생님 2026-11-09 「불러오는 동안
     * PDF 저장을 누르면 0/250이 뜬다」). 예전엔 화면 변화가 2.5초 멈출 때까지 기다려, 다 불러온 뒤에야 만들기 시작했다.
     * 쪽마다 기억해 두므로 다시 돌아도 새로 나온 쪽·바뀐 쪽만 만든다. 합치기는 화면이 멈춘 뒤에 한 번.
     */
    let running = false;
    let dirty = false;
    let lastChange = 0;
    const SETTLE_MS = 1500;
    const run = async () => {
      if (!alive) return;
      // 다른 탭에 가 있으면 만들지 않는다 — 버튼은 켜 둔다(누를 때 만든다)
      if (document.hidden) {
        setReady(true);
        return;
      }
      if (running) {
        dirty = true;
        return;
      }
      running = true;
      dirty = false;
      try {
        if (document.fonts) await document.fonts.ready;
        const { prefetchPagesPdf } = await import("@/lib/pdf/server-pdf");
        const settled = Date.now() - lastChange >= SETTLE_MS;
        // 가장 많은 쪽(전체)부터 만들어 두면 나머지는 기억해 둔 쪽을 합치기만 한다
        const sets = selectorKey
          .split("|||")
          .map((sel) => collectPrintPages(document.getElementById(rootId), sel))
          // 워크북 한 과가 370쪽까지 된다 — 300쪽에서 끊었더니 큰 자료는 미리 만들어지지 않았다(2026-11-09)
          .filter((pages) => pages.length > 0 && pages.length <= 1000)
          .sort((a, b) => b.length - a.length);
        for (const pages of settled ? sets : sets.slice(0, 1)) {
          if (!alive) return;
          await prefetchPagesPdf(pages, paper, { merge: settled }).catch(() => undefined);
        }
        if (!settled) dirty = true;
        else if (!dirty && alive) setReady(true);
      } catch {
        if (alive) setReady(true);
      } finally {
        running = false;
      }
      if (alive && dirty) schedule(Math.max(300, SETTLE_MS - (Date.now() - lastChange)));
    };
    const schedule = (ms = 400) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void run(), ms);
    };
    const onChange = () => {
      lastChange = Date.now();
      // 만드는 중이면 끝난 뒤 다시 돈다(dirty). 아니면 잠깐 모아서 바로 시작한다.
      if (running) dirty = true;
      else schedule();
    };
    const attach = () => {
      const root = document.getElementById(rootId);
      if (!root) {
        retry = setTimeout(attach, 1000);
        return;
      }
      observer = new MutationObserver(onChange);
      observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
      lastChange = Date.now();
      schedule();
    };
    attach();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      if (retry) clearTimeout(retry);
      observer?.disconnect();
    };
    // paper는 paperKey로 비교한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootId, selectorKey, enabled, paperKey]);
  return { ready };
}
