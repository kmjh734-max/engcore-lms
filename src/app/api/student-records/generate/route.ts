import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { CREDIT_FEATURES } from "@/lib/credits";
import { debitLessonCredits, lessonCreditShortfall } from "@/lib/credits/lesson-credits";
import { flushAiUsage, setAiUsage } from "@/lib/ai-usage/context";
import {
  extractStudentIdentityFromRecordText,
  extractStudentNameFromReportHtml,
} from "@/lib/student-records/extract-identity";
import { generateStudentRecordReport } from "@/lib/student-records/generate-report";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAcademyBranding } from "@/lib/tenant/academy-branding";

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

    const body = (await request.json()) as {
      studentId?: string | null;
      studentName?: string;
      text?: string;
      analysisInstructions?: string;
    };

    const studentName = String(body.studentName ?? "").trim() || "학생";
    const studentId = String(body.studentId ?? "").trim() || null;
    const text = String(body.text ?? "").trim();
    const analysisInstructions = String(body.analysisInstructions ?? "").trim();

    if (!text) {
      return jsonError("분석할 학생부 내용이 없습니다.");
    }

    let academyId = (profile.academy_id as string | null) ?? null;
    if (studentId) {
      const admin = createAdminClient();
      const { data: studentProfile } = await admin
        .from("profiles")
        .select("academy_id")
        .eq("id", studentId)
        .maybeSingle();
      if (
        !studentProfile ||
        !studentProfile.academy_id ||
        studentProfile.academy_id !== profile.academy_id
      ) {
        return jsonError("우리 학원 학생이 아닙니다.", 403);
      }
      academyId = studentProfile.academy_id as string;
    }
    const branding = await getAcademyBranding(academyId);

    // 화면의 학생부 분석은 이 경로로 보고서를 만든다(내용 추출은 그 준비 단계라 따로 받지 않는다).
    // 보고서 한 건을 만들 때 한 번 쓴다. 모자라면 만들지 않는다.
    const payerAcademyId = (profile.academy_id as string | null) ?? null;
    if (payerAcademyId) {
      const shortfall = await lessonCreditShortfall(payerAcademyId, CREDIT_FEATURES.student_record_analyze);
      if (shortfall) return jsonError(shortfall, 402);
    }

    const result = await generateStudentRecordReport(studentName, text, {
      analysisInstructions,
      branding,
    });
    if (!result.ok) {
      return jsonError(result.message);
    }
    if (payerAcademyId) {
      await debitLessonCredits({
        academyId: payerAcademyId,
        actorId: profile.id,
        featureKey: CREDIT_FEATURES.student_record_analyze,
        metadata: { student_id: studentId },
        note: `학생부 분석 · ${studentName}`,
      });
    }

    const generatedAt = new Date().toISOString();

    // 학생 미선택(placeholder) 시 보고서 제목 → 학생부 본문 순으로 성명을 보충
    const identity = extractStudentIdentityFromRecordText(text);
    const effectiveStudentName =
      studentName !== "학생"
        ? studentName
        : extractStudentNameFromReportHtml(result.html) ??
          identity.name ??
          studentName;
    const school = identity.school;

    // 분석 기록 저장 — 실패해도 보고서 응답은 정상 반환
    let recordId: string | null = null;
    try {
      const admin = createAdminClient();
      const row = {
        student_id: studentId,
        student_name: effectiveStudentName,
        html: result.html,
        generated_at: generatedAt,
        created_by: profile.id,
        academy_id: academyId,
      };
      const { data, error } = await admin
        .from("student_record_analyses")
        .insert({ ...row, school })
        .select("id")
        .single();
      recordId = (data?.id as string | undefined) ?? null;
      if (error) {
        console.error(
          "[student-records/generate] history insert failed:",
          error.message
        );
        // school 컬럼 미적용(마이그레이션 전) 환경에서도 기록은 남긴다
        if (/school/i.test(error.message)) {
          const { data: retry } = await admin
            .from("student_record_analyses")
            .insert(row)
            .select("id")
            .single();
          recordId = (retry?.id as string | undefined) ?? null;
        }
      }
      setAiUsage({
        academyId: payerAcademyId,
        actorId: profile.id,
        featureKey: CREDIT_FEATURES.student_record_analyze,
        usedFor: "student_record",
      });
    } catch (e) {
      console.error("[student-records/generate] history insert failed:", e);
    }

    return NextResponse.json({
      ok: true,
      html: result.html,
      studentName: effectiveStudentName,
      school,
      generatedAt,
      recordId,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "보고서 생성 오류";
    return jsonError(message, 500);
  }
}
