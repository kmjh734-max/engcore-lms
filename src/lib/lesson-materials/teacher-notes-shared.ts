/** 교사용 해설 — 화면(브라우저)과 서버가 같이 쓰는 작은 함수(서버 모듈을 끌고 오지 않게 따로 둔다) */
/** 반의어로 쓸 만한지 — 부정·동사구로 만든 표현(fail to handle, remained in office)과 네 낱말 이상은 뺀다 */
export function isUsableAntonym(a: string): boolean {
  const t = a.trim();
  if (!t) return false;
  if (t.split(/\s+/).length > 3) return false;
  return !/^(fail|failed|fails|not|never|stay|stayed|stays|remain|remained|remains|accurate|counter)/i.test(t);
}
