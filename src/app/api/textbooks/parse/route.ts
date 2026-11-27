import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { flushAiUsage, setAiUsage } from "@/lib/ai-usage/context";
import { aiDailyCapError } from "@/lib/ai-usage/daily-cap";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { examChat } from "@/lib/exam-analysis/openai";

export const runtime = "nodejs";
export const maxDuration = 120;

const jsonError = (message: string, status = 400) =>
  NextResponse.json({ ok: false, message }, { status });

/** 엑셀 표 → 들여쓰기 목차. 왼쪽 빈 칸 수가 층, 마지막 숫자 칸이 쪽. */
function rowsToToc(rows: Array<Array<string>>): string {
  const lines: string[] = [];
  for (const row of rows) {
    const cells = row.map((c) => String(c ?? "").trim());
    const firstIdx = cells.findIndex((c) => c);
    if (firstIdx < 0) continue;
    const filled = cells.filter(Boolean);
    const last = filled[filled.length - 1] ?? "";
    const isPage = filled.length > 1 && /^[\d\s~\-–p.]+$/i.test(last);
    const title = (isPage ? filled.slice(0, -1) : filled).join(" ").trim();
    if (!title) continue;
    lines.push(`${"  ".repeat(Math.min(3, firstIdx))}${title}${isPage ? `  ${last}` : ""}`);
  }
  return lines.join("\n");
}

const OCR_SYSTEM = `교재 목차 사진을 글자로 옮긴다.
- 목차에 적힌 줄만 옮기고, 설명·머리말은 뺀다.
- 큰 단원은 왼쪽 끝에서 시작하고, 하위 항목은 공백 두 칸씩 들여쓴다(층마다 두 칸).
- 쪽 번호는 줄 끝에 그대로 둔다(예: "1과 The World of Words  8~21").
- 옮긴 글자만 출력한다. 설명을 붙이지 않는다.`;

/**
 * 교재 목차 파일 읽기 — 엑셀은 표에서, 사진·스캔 PDF는 글자를 읽어 들여쓰기 목차로 만든다.
 */
export async function POST(request: Request) {
  try {
    const profile = await getCurrentProfile();
    if (!profile || !["admin", "teacher"].includes(profile.role)) {
      return jsonError("권한이 없습니다.", 403);
    }

    const body = (await request.json().catch(() => ({}))) as {
      kind?: "xlsx" | "image";
      base64?: string;
      dataUrl?: string;
    };

    if (body.kind === "xlsx") {
      const buf = Buffer.from(String(body.base64 ?? ""), "base64");
      if (buf.length === 0) return jsonError("파일을 읽지 못했어요.");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      const sheet = wb.worksheets[0];
      if (!sheet) return jsonError("시트를 찾지 못했어요.");
      const rows: string[][] = [];
      sheet.eachRow((row) => {
        const cells: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          const v = cell.value as unknown;
          cells.push(
            v == null
              ? ""
              : typeof v === "object" && v !== null && "text" in (v as Record<string, unknown>)
                ? String((v as { text: unknown }).text ?? "")
                : String(v)
          );
        });
        rows.push(cells);
      });
      return NextResponse.json({ ok: true, toc: rowsToToc(rows) });
    }

    if (body.kind === "image") {
      const dataUrl = String(body.dataUrl ?? "");
      if (!dataUrl.startsWith("data:image/")) return jsonError("사진을 읽지 못했어요.");
      // 값 없는 보조 호출이라 학원마다 하루 300번까지(2026-11-28)
      const capped = await aiDailyCapError({
        academyId: profile.academy_id,
        usedFor: "textbook_toc_read",
        maxPerDay: 300,
        requireBalance: false,
      });
      if (capped) return capped;
      /*
       * 선생님 물음(2026-10-01): 원가가 제대로 책정되고 있는가.
       * 목차 사진 읽기는 그림을 높은 해상도로 보는 호출인데 테두리가 없어, 어느 학원
       * 것인지도 안 남고 기록을 밀어 넣지도 않았다. 값은 따로 받지 않는 보조 호출이라
       * 기능 키는 비우고, 학원·쓰인 자리만 남긴다.
       */
      setAiUsage({
        academyId: profile.academy_id,
        actorId: profile.id,
        usedFor: "textbook_toc_read",
      });
      const { text } = await examChat({
        model: "gpt-5.5",
        reasoning_effort: "low",
        messages: [
          { role: "system", content: OCR_SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: "이 교재 목차를 옮겨 적어 주세요." },
              { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
            ],
          },
        ],
      });
      await flushAiUsage();
      return NextResponse.json({ ok: true, toc: text.trim() });
    }

    return jsonError("알 수 없는 파일 종류예요.");
  } catch (error) {
    console.error("[POST /api/textbooks/parse]", error);
    return jsonError("파일을 읽지 못했어요.", 500);
  }
}
