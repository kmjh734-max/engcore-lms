"use client";

/**
 * 인쇄 직전에 반투명 효과를 같은 모양의 불투명 색으로 바꾼다(선생님 2026-11-06 「인쇄 스풀링이 너무 오래 걸린다」).
 *
 * 자료 쪽마다 반투명 장식(오른쪽 위 번지는 원, 끝이 흐려지는 밑줄, 반투명 바탕, 그림자, 투명 바탕 로고)이 있었다.
 * PDF·인쇄 파일에 반투명이 있으면 프린터 드라이버가 그 쪽을 통째로 그림으로 바꿔(투명 평탄화) 보내므로 스풀링이 오래 걸린다.
 * 반투명 색은 바로 밑 바탕색과 섞은 불투명 색으로, 그림자·흐림은 없애고, 투명 바탕 그림은 바탕색을 깐 그림판으로 바꾼다.
 * 쪽 나누기에 영향이 없게 색만 바꾸고, 인쇄가 끝나면 되돌린다.
 */

type Rgb = [number, number, number];

/** rgba(r,g,b,a) · color(srgb r g b / a) (color-mix 결과) */
const ANY_COLOR = /rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)|color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)\s*(?:\/\s*([\d.]+))?\s*\)/g;

function parseColor(v: string): { rgb: Rgb; a: number } | null {
  const m = v.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (m) return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: m[4] === undefined ? 1 : Number(m[4]) };
  const c = v.match(/color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)\s*(?:\/\s*([\d.]+))?\s*\)/);
  if (c) return { rgb: [Number(c[1]) * 255, Number(c[2]) * 255, Number(c[3]) * 255], a: c[4] === undefined ? 1 : Number(c[4]) };
  return null;
}

/** 글(그라데이션 등) 안의 반투명 색을 밑 바탕색과 섞은 불투명 색으로 */
function flatColors(text: string, under: Rgb): string {
  return text.replace(ANY_COLOR, (_m, r, g, b, a, sr, sg, sb, sa) => {
    if (r !== undefined) return mix([Number(r), Number(g), Number(b)], Number(a), under);
    return mix([Number(sr) * 255, Number(sg) * 255, Number(sb) * 255], sa === undefined ? 1 : Number(sa), under);
  });
}

const hasAlpha = (text: string) => /rgba\(|color\(srgb[^)]*\//.test(text);

function mix(c: Rgb, a: number, under: Rgb): string {
  const ch = (i: number) => Math.round(c[i]! * a + under[i]! * (1 - a));
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
}

/** 요소 밑에 깔린 불투명 바탕색(조상 가운데 처음으로 불투명한 바탕색, 없으면 흰색) */
function underColor(el: Element, cache: Map<Element, Rgb>): Rgb {
  let n: Element | null = el.parentElement;
  const path: Element[] = [];
  let found: Rgb = [255, 255, 255];
  while (n) {
    const hit = cache.get(n);
    if (hit) {
      found = hit;
      break;
    }
    path.push(n);
    const c = parseColor(getComputedStyle(n).backgroundColor);
    if (c && c.a >= 0.999) {
      found = c.rgb;
      break;
    }
    n = n.parentElement;
  }
  for (const p of path) cache.set(p, found);
  return found;
}

type Saved = { el: HTMLElement; props: Array<[string, string, string]> };

/** 반투명을 불투명으로 바꾸고, 되돌리는 함수를 준다 */
export function flattenForPrint(root: ParentNode = document.body, opts: { images?: boolean } = {}): () => void {
  const saved: Saved[] = [];
  const added: Array<{ canvas: HTMLCanvasElement; img: HTMLImageElement; display: string }> = [];
  const cache = new Map<Element, Rgb>();
  const set = (el: HTMLElement, rec: Saved, prop: string, value: string) => {
    rec.props.push([prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
    el.style.setProperty(prop, value, "important");
  };
  const rules: string[] = [];
  const tagged: Element[] = [];
  let pfSeq = 0;
  const all = root.querySelectorAll("*");
  for (const node of Array.from(all)) {
    if (!(node instanceof HTMLElement) && !(node instanceof SVGElement)) continue;
    const el = node as HTMLElement;
    const cs = getComputedStyle(el);
    if (cs.display === "none") continue;
    const rec: Saved = { el, props: [] };
    let under: Rgb | null = null;
    const base = () => (under ??= underColor(el, cache));

    const bgc = parseColor(cs.backgroundColor);
    if (bgc && bgc.a > 0 && bgc.a < 0.999) set(el, rec, "background-color", mix(bgc.rgb, bgc.a, base()));

    const bgi = cs.backgroundImage;
    if (bgi && bgi !== "none" && bgi.includes("gradient") && hasAlpha(bgi)) {
      // 그라데이션 안의 반투명 색(투명 = rgba(0,0,0,0) 포함)을 밑 바탕색과 섞는다
      const below = bgc && bgc.a >= 0.999 ? bgc.rgb : base();
      set(el, rec, "background-image", flatColors(bgi, below));
    }

    // ::before·::after 장식(번지는 원·흐려지는 밑줄 등)은 인라인으로 못 바꾸니 규칙을 따로 단다
    for (const pseudo of ["::before", "::after"] as const) {
      const ps = getComputedStyle(el, pseudo);
      if (!ps.content || ps.content === "none" || ps.display === "none") continue;
      const decl: string[] = [];
      const pbg = parseColor(ps.backgroundColor);
      const below = bgc && bgc.a >= 0.999 ? bgc.rgb : base();
      if (pbg && pbg.a > 0 && pbg.a < 0.999) decl.push(`background-color:${mix(pbg.rgb, pbg.a, below)}`);
      const pbi = ps.backgroundImage;
      if (pbi && pbi !== "none" && pbi.includes("gradient") && hasAlpha(pbi)) decl.push(`background-image:${flatColors(pbi, below)}`);
      if (ps.boxShadow && ps.boxShadow !== "none") decl.push("box-shadow:none");
      if (ps.filter && ps.filter !== "none") decl.push("filter:none");
      const po = parseFloat(ps.opacity);
      if (po < 1 && po > 0 && !decl.length && pbg) decl.push(`background-color:${mix(pbg.rgb, pbg.a * po, below)}`);
      if (po < 1 && po > 0) decl.push("opacity:1");
      if (!decl.length) continue;
      let id = el.getAttribute("data-pf");
      if (!id) {
        id = String(++pfSeq);
        el.setAttribute("data-pf", id);
        tagged.push(el);
      }
      rules.push(`[data-pf="${id}"]${pseudo}{${decl.map((d) => `${d} !important`).join(";")}}`);
    }

    for (const side of ["top", "right", "bottom", "left"] as const) {
      const w = parseFloat(cs.getPropertyValue(`border-${side}-width`));
      if (!w) continue;
      const c = parseColor(cs.getPropertyValue(`border-${side}-color`));
      if (c && c.a > 0 && c.a < 0.999) set(el, rec, `border-${side}-color`, mix(c.rgb, c.a, base()));
    }

    const color = parseColor(cs.color);
    if (color && color.a > 0 && color.a < 0.999 && el.childNodes.length) set(el, rec, "color", mix(color.rgb, color.a, bgc && bgc.a >= 0.999 ? bgc.rgb : base()));

    if (cs.boxShadow && cs.boxShadow !== "none") set(el, rec, "box-shadow", "none");
    if (cs.textShadow && cs.textShadow !== "none") set(el, rec, "text-shadow", "none");
    if (cs.filter && cs.filter !== "none") set(el, rec, "filter", "none");
    if (cs.backdropFilter && cs.backdropFilter !== "none") set(el, rec, "backdrop-filter", "none");
    if (cs.mixBlendMode && cs.mixBlendMode !== "normal") set(el, rec, "mix-blend-mode", "normal");

    if (rec.props.length) saved.push(rec);

    // 투명 바탕 그림(로고 등): 밑 바탕색을 깐 불투명 그림판으로 바꿔 그린다(그림판은 바로 그려져 인쇄에 바로 나온다)
    if (opts.images !== false && el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0) {
      const src = el.currentSrc || el.src;
      if (/\.(jpe?g)(\?|$)/i.test(src) || src.startsWith("data:image/jpeg")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const scale = Math.min(3, Math.max(1, 600 / Math.max(r.width, r.height)));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(r.width * scale);
      canvas.height = Math.round(r.height * scale);
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) continue;
      const u = base();
      ctx.fillStyle = `rgb(${u[0]}, ${u[1]}, ${u[2]})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      try {
        // object-fit: contain 처럼 그린다(로고 비율 유지)
        const k = Math.min(canvas.width / el.naturalWidth, canvas.height / el.naturalHeight);
        const fit = cs.objectFit === "contain" || cs.objectFit === "scale-down";
        const dw = fit ? el.naturalWidth * k : canvas.width;
        const dh = fit ? el.naturalHeight * k : canvas.height;
        ctx.drawImage(el, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
      } catch {
        continue;
      }
      canvas.className = el.className;
      canvas.setAttribute("style", el.getAttribute("style") ?? "");
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      canvas.style.display = cs.display === "inline" ? "inline-block" : cs.display;
      canvas.style.verticalAlign = cs.verticalAlign;
      el.after(canvas);
      added.push({ canvas, img: el, display: el.style.display });
      el.style.display = "none";
    }
  }
  let sheet: HTMLStyleElement | null = null;
  if (rules.length) {
    sheet = document.createElement("style");
    sheet.setAttribute("data-print-flatten", "");
    sheet.textContent = rules.join("\n");
    document.head.appendChild(sheet);
  }
  return () => {
    sheet?.remove();
    for (const el of tagged) el.removeAttribute("data-pf");
    for (const { canvas, img, display } of added) {
      canvas.remove();
      img.style.display = display;
    }
    for (const { el, props } of saved.reverse()) {
      for (const [p, v, pr] of props.reverse()) {
        if (v) el.style.setProperty(p, v, pr);
        else el.style.removeProperty(p);
      }
    }
  };
}
