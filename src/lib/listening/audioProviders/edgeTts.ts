import { randomUUID } from "crypto";
import WebSocket from "ws";
import { replaceSpokenFillers } from "@/lib/listening/spoken-fillers";
import type { ListeningSpeakerType } from "@/lib/listening/types";
import { edgeMuid, secMsGecV2 } from "@/lib/listening/audioProviders/edgeSecMsGec";

/**
 * Edge 읽어주기 음성(Microsoft 신경망 목소리)으로 대사를 mp3로 만든다.
 *
 * 값이 들지 않는다(선생님 결정 2026-09-21). 예전에는 ElevenLabs를 썼고 세트 한 개에 1,300원쯤 들었다.
 * 브라우저 읽어주기가 쓰는 공개 창구에 웹소켓으로 붙어 24kHz·48kbps 모노 mp3를 받는다.
 */

const TRUSTED_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WSS = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const CHROMIUM_VERSION = "143.0.3650.75";

/** 화자별 목소리 — 안내는 여성 아나운서, 대화는 남녀 한 명씩 */
export const EDGE_VOICES: Record<ListeningSpeakerType, string> = {
  ANN: "en-US-AriaNeural",
  M: "en-US-AndrewNeural",
  W: "en-US-EmmaNeural",
};

export function edgeVoiceFor(speaker: ListeningSpeakerType, override?: string | null): string {
  const picked = override?.trim();
  if (picked && /^[a-z]{2}-[A-Z]{2}-\w+$/.test(picked)) return picked;
  return EDGE_VOICES[speaker] ?? EDGE_VOICES.M;
}

/** 배속 0.9 → "-10%" 처럼 바꾼다 */
export function edgeRate(speed: number | undefined): string {
  const v = typeof speed === "number" && speed > 0 ? Math.min(Math.max(speed, 0.5), 2) : 1;
  const pct = Math.round((v - 1) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function ssml(text: string, voice: string, rate: string): string {
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
    `<voice name='${voice}'><prosody pitch='+0Hz' rate='${rate}' volume='+0%'>` +
    `${escapeXml(text)}</prosody></voice></speak>`
  );
}

export interface GenerateEdgeSegmentOpts {
  text: string;
  speaker: ListeningSpeakerType;
  /** en-US-EmmaNeural 같은 목소리 이름 (없으면 화자 기본값) */
  voice?: string | null;
  speed?: number;
}

/** 대사 한 줄 → mp3 버퍼 */
export async function generateEdgeSpeechSegment(
  opts: GenerateEdgeSegmentOpts
): Promise<Buffer> {
  // 추임새(Hmm·Um)는 음성 엔진이 이상한 소리로 읽는다 — 녹음 직전에 한 번 더 고친다
  const spoken = replaceSpokenFillers(opts.text.trim());
  if (!spoken) throw new Error("빈 대사는 음성으로 만들 수 없습니다.");

  const voice = edgeVoiceFor(opts.speaker, opts.voice);
  const rate = edgeRate(opts.speed);
  const url =
    `${WSS}?TrustedClientToken=${TRUSTED_TOKEN}` +
    `&Sec-MS-GEC=${secMsGecV2()}&Sec-MS-GEC-Version=2-${CHROMIUM_VERSION}` +
    `&ConnectionId=${randomUUID().replace(/-/g, "")}`;

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: {
        "User-Agent":
          `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_VERSION.split(".")[0]}.0.0.0 Safari/537.36 Edg/${CHROMIUM_VERSION.split(".")[0]}.0.0.0`,
        Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
        // 2026-11 창구가 v2 확인값과 함께 muid 쿠키를 요구한다(없으면 403)
        Cookie: `muid=${edgeMuid()};`,
      },
    });
    ws.binaryType = "arraybuffer";

    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* 이미 닫힘 */
      }
      reject(new Error("Edge 음성 응답이 오지 않습니다(30초 초과)."));
    }, 30_000);

    const done = (err?: Error) => {
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };

    ws.onopen = () => {
      const stamp = new Date().toString();
      ws.send(
        `X-Timestamp:${stamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
          JSON.stringify({
            context: {
              synthesis: {
                audio: {
                  metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "false" },
                  outputFormat: OUTPUT_FORMAT,
                },
              },
            },
          })
      );
      ws.send(
        `X-RequestId:${randomUUID().replace(/-/g, "")}\r\nContent-Type:application/ssml+xml\r\n` +
          `X-Timestamp:${stamp}Z\r\nPath:ssml\r\n\r\n${ssml(spoken, voice, rate)}`
      );
    };

    ws.onmessage = (event: { data: unknown }) => {
      if (typeof event.data === "string") {
        if (event.data.includes("Path:turn.end")) {
          try {
            ws.close();
          } catch {
            /* 이미 닫힘 */
          }
          done();
        }
        return;
      }
      const buf = Buffer.from(event.data as ArrayBuffer);
      // 앞 2바이트가 머리글 길이, 그 뒤가 머리글, 나머지가 소리
      const headerLen = buf.readUInt16BE(0);
      const header = buf.subarray(2, 2 + headerLen).toString("utf8");
      if (header.includes("Path:audio")) chunks.push(buf.subarray(2 + headerLen));
    };

    ws.onerror = (e: { message?: string }) => done(new Error(`Edge 음성 창구에 붙지 못했습니다: ${e?.message ?? ""}`));
    ws.onclose = () => done();
  });

  const out = Buffer.concat(chunks);
  if (out.length < 100) throw new Error("Edge 음성이 비어 있는 음원을 반환했습니다.");
  return out;
}
