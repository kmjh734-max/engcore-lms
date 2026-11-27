import { NextResponse } from "next/server";
import { flushAiUsage, setAiUsage } from "@/lib/ai-usage/context";
import { aiDailyCapError } from "@/lib/ai-usage/daily-cap";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { extractStudentRecordContent } from "@/lib/student-records/extract-content";
import { parseStudentRecordUpload } from "@/lib/student-records/parse-upload";
import {
  isCompleteStudentRecordOcr,
  readStudentRecordOcrCache,
  studentRecordOcrCacheKey,
  writeStudentRecordOcrCache,
} from "@/lib/student-records/ocr-cache";
import { resolveStudentRecordTarget } from "@/lib/student-records/resolve-student";

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, status = 200) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(request: Request) {
  try {
    const profile = await getCurrentProfile();
    if (!profile || (profile.role !== "admin" && profile.role !== "teacher")) {
      return jsonError("권한이 없습니다.", 403);
    }

    const formData = await request.formData();
    const studentId = String(formData.get("studentId") ?? "").trim();
    const manualName = String(formData.get("studentName") ?? "").trim();

    const target = await resolveStudentRecordTarget({
      role: profile.role,
      profileId: profile.id,
      studentId,
      manualName,
    });
    if (!target.ok) {
      return jsonError(target.message, target.status);
    }

    let parsed;
    try {
      parsed = await parseStudentRecordUpload(formData);
    } catch (e) {
      return jsonError(
        e instanceof Error ? e.message : "파일을 처리하지 못했습니다."
      );
    }

    const combinedText = parsed.textParts.join("\n\n");
    const hasMaterial =
      combinedText.trim().length > 0 ||
      parsed.imageDataUrls.length > 0 ||
      parsed.pdfDocuments.length > 0;

    if (!hasMaterial) {
      return jsonError(
        "학생부 텍스트를 붙여넣거나, PDF/이미지 파일을 업로드해 주세요."
      );
    }

    // 같은 쪽 묶음을 다시 보내면(실패 후 다시 시도 등) 저장해 둔 글자를 쓰고 다시 읽지 않는다
    const academyId = (profile.academy_id as string | null) ?? null;
    const cacheKey = studentRecordOcrCacheKey({
      academyId,
      studentName: target.studentName,
      text: combinedText,
      imageDataUrls: parsed.imageDataUrls,
      pdfDocuments: parsed.pdfDocuments,
    });
    const cachedText = cacheKey ? await readStudentRecordOcrCache(cacheKey) : null;
    if (cachedText) {
      return NextResponse.json({
        ok: true,
        text: cachedText,
        studentId: target.studentId,
        studentName: target.studentName,
      });
    }

    // 읽기는 값을 따로 받지 않으므로 학원마다 하루 호출 3000번까지(2026-11-28)
    if (parsed.imageDataUrls.length > 0 || parsed.pdfDocuments.length > 0) {
      const capped = await aiDailyCapError({
        academyId,
        usedFor: "student_record_read",
        maxPerDay: 3000,
        requireBalance: false,
      });
      if (capped) return capped;
    }

    /*
     * 원가 귀속(2026-10-01): 학생부 PDF를 읽는 호출이 여기서 나가는데 테두리가 없어
     * 학원도 안 붙고 기록을 밀어 넣지도 않았다. 읽기는 값을 따로 받지 않으므로
     * 기능 키는 비우고 학원·쓰인 자리만 남긴다.
     */
    setAiUsage({
      academyId,
      actorId: profile.id,
      usedFor: "student_record_read",
    });

    const result = await extractStudentRecordContent({
      studentId: target.studentId,
      studentName: target.studentName,
      text: combinedText,
      imageDataUrls: parsed.imageDataUrls,
      pdfDocuments: parsed.pdfDocuments,
    });

    // 못 읽었어도 부른 값은 나갔다. 기록은 남긴다.
    await flushAiUsage();

    if (!result.ok) {
      return jsonError(result.message);
    }

    if (cacheKey && isCompleteStudentRecordOcr(result.text, parsed.pdfDocuments)) {
      await writeStudentRecordOcrCache({ key: cacheKey, academyId, text: result.text });
    }

    return NextResponse.json({
      ok: true,
      text: result.text,
      studentId: target.studentId,
      studentName: target.studentName,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "자료 읽기 오류";
    return jsonError(message, 500);
  }
}
