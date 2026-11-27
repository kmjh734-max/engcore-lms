/** SSRF 방지: 공개 http(s)만, 내부망/localhost/파일 프로토콜 차단 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
]);

export const NELT_URL_MAX_BYTES = 8 * 1024 * 1024;
export const NELT_URL_TIMEOUT_MS = 20_000;
export const NELT_URL_MAX_REDIRECTS = 5;

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // 통신사 공유 주소
  if (a === 192 && b === 0 && parts[2] === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true; // 멀티캐스트·예약
  return false;
}

/** IPv6: 루프백·사설(fc00::/7)·링크로컬(fe80::/10)·IPv4 매핑 사설 주소 */
function isPrivateIpv6(addr: string): boolean {
  const a = addr.toLowerCase().replace(/^\[|\]$/g, "");
  if (a === "::" || a === "::1") return true;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  if (mapped) return isPrivateIpv4(mapped[1]);
  if (/^::ffff:/.test(a)) return true;
  if (/^f[cd]/.test(a)) return true;
  if (/^fe[89ab]/.test(a)) return true;
  if (/^ff/.test(a)) return true;
  return false;
}

/**
 * 이름이 내부 주소로 풀리는 경우(예: 사설 IP 를 가리키는 도메인)도 막는다.
 * 주소를 찾지 못하면 fetch 가 어차피 실패하므로 여기서 같은 말로 멈춘다.
 */
async function assertResolvesPublic(host: string): Promise<void> {
  if (isIP(host)) return; // 숫자 주소는 assertSafePublicUrl 이 이미 봄
  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("링크 주소를 찾을 수 없습니다.");
  }
  for (const { address, family } of addrs) {
    const bad = family === 6 ? isPrivateIpv6(address) : isPrivateIpv4(address);
    if (bad) throw new Error("내부 주소에는 접근할 수 없습니다.");
  }
}

export function assertSafePublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("올바른 URL 형식이 아닙니다.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("http와 https만 허용됩니다.");
  }
  if (url.username || url.password) {
    throw new Error("인증 정보가 포함된 URL은 사용할 수 없습니다.");
  }

  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("내부 주소에는 접근할 수 없습니다.");
  }
  if (isPrivateIpv4(host) || host.includes(":")) {
    // IPv6 literal — block for safety
    if (host.includes(":")) {
      throw new Error("내부 주소에는 접근할 수 없습니다.");
    }
    throw new Error("내부 주소에는 접근할 수 없습니다.");
  }

  return url;
}

export type SafeFetchResult = {
  finalUrl: string;
  contentType: string;
  body: Buffer;
};

function mergeSetCookie(
  jar: Map<string, string>,
  setCookieHeaders: string[]
): void {
  for (const raw of setCookieHeaders) {
    const pair = raw.split(";")[0]?.trim();
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}

function cookieHeader(jar: Map<string, string>): string | undefined {
  if (jar.size === 0) return undefined;
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

/** Browser-like UA — custom bots are sometimes blocked by NELT/Netutor CDN. */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export async function fetchPublicUrlSafe(
  rawUrl: string
): Promise<SafeFetchResult> {
  let current = assertSafePublicUrl(rawUrl).toString();
  let redirects = 0;
  const cookieJar = new Map<string, string>();

  while (redirects <= NELT_URL_MAX_REDIRECTS) {
    await assertResolvesPublic(assertSafePublicUrl(current).hostname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NELT_URL_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        "User-Agent": BROWSER_UA,
        Accept:
          "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      };
      const cookie = cookieHeader(cookieJar);
      if (cookie) headers.Cookie = cookie;

      const res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers,
      });

      const setCookies =
        typeof res.headers.getSetCookie === "function"
          ? res.headers.getSetCookie()
          : [];
      if (setCookies.length > 0) {
        mergeSetCookie(cookieJar, setCookies);
      } else {
        const single = res.headers.get("set-cookie");
        if (single) mergeSetCookie(cookieJar, [single]);
      }

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get("location");
        if (!loc) throw new Error("리다이렉트 위치를 확인할 수 없습니다.");
        current = new URL(loc, current).toString();
        redirects += 1;
        continue;
      }

      if (!res.ok) {
        throw new Error(`링크 응답 오류 (${res.status})`);
      }

      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      const allowed =
        contentType.includes("text/html") ||
        contentType.includes("application/xhtml") ||
        contentType.includes("application/pdf") ||
        contentType.includes("application/octet-stream") ||
        contentType.includes("text/plain") ||
        contentType === "";
      if (!allowed) {
        throw new Error(`허용되지 않은 응답 형식입니다 (${contentType || "unknown"}).`);
      }

      const lenHeader = res.headers.get("content-length");
      if (lenHeader && Number(lenHeader) > NELT_URL_MAX_BYTES) {
        throw new Error("다운로드 파일 크기 제한을 초과했습니다.");
      }

      const ab = await res.arrayBuffer();
      if (ab.byteLength > NELT_URL_MAX_BYTES) {
        throw new Error("다운로드 파일 크기 제한을 초과했습니다.");
      }

      return {
        finalUrl: current,
        contentType,
        body: Buffer.from(ab),
      };
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        throw new Error("요청 시간이 초과되었습니다.");
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("리다이렉트가 너무 많습니다.");
}
