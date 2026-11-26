/** 교사용 해설 — 화면(브라우저)과 서버가 같이 쓰는 작은 함수(서버 모듈을 끌고 오지 않게 따로 둔다) */
/** 반의어로 쓸 만한지 — 부정·동사구로 만든 표현(fail to handle, remained in office)과 네 낱말 이상은 뺀다 */
export function isUsableAntonym(a: string): boolean {
  const t = a.trim();
  if (!t) return false;
  if (t.split(/\s+/).length > 3) return false;
  return !/^(fail|failed|fails|not|never|stay|stayed|stays|remain|remained|remains|accurate|counter)/i.test(t);
}

/**
 * 문장 안에서 출제 자리 어구 q 의 위치 — 낱말 경계를 지킨다(「it」이 「with」 안에 붙어 「wit(지칭)」로 나오던 것, 선생님 2026-11-26).
 * 대소문자 그대로 먼저, 없으면 대소문자 무시. 곧은/굽은 따옴표는 같게 본다. 못 찾으면 -1.
 */
export function findPhrase(sentence: string, q: string): number {
  const t = q.trim();
  if (!t) return -1;
  const fold = (s: string) => s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
  const src = fold(sentence);
  const pat = fold(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const head = /^[A-Za-z0-9]/.test(t) ? "(?<![A-Za-z0-9])" : "";
  const tail = /[A-Za-z0-9]$/.test(t) ? "(?![A-Za-z0-9])" : "";
  for (const flags of ["", "i"]) {
    const m = new RegExp(`${head}${pat}${tail}`, flags).exec(src);
    if (m) return m.index;
  }
  return -1;
}
