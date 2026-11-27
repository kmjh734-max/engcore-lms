import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  CreditError,
  InsufficientCreditsError,
  adjustAcademyCredits,
  debitFeatureCredits,
  getFeatureCost,
} from "@/lib/credits";
import { isFeatureFreeForAcademy } from "@/lib/credits/academy-free";

/**
 * 수업자료 기능 크레딧(가격은 feature_pricing). 원가(2026-09-14 실측)의 약 2배로 잡았다.
 * 새로 만들 때만 차감하고, 저장해 둔 결과를 다시 쓰면 차감하지 않는다.
 */
export const LESSON_CREDIT_FEATURES = {
  /** 수업용 자료(어휘·번역·빈칸 후보), 지문당 */
  lessonPack: "lesson_pack",
  /** 지문 분석서, 지문당 */
  analysisReport: "lesson_analysis_report",
  /** 지문 분석서 문장 하나 다시 만들기, 문장당(2026-10-21) */
  analysisSentence: "lesson_analysis_sentence",
  /** 워크북 어법 선택(어법 수정 포함), 지문당 */
  workbookGrammarChoice: "lesson_workbook_grammar_choice",
  /** 워크북 어휘 선택(어휘 수정 포함), 지문당 */
  workbookVocabChoice: "lesson_workbook_vocab_choice",
  /** 워크북 T/F, 지문당(10문항 넘으면 2배) */
  workbookTf: "lesson_workbook_tf",
  /** 지문 삽화, 장당 */
  illustration: "lesson_illustration",
  /**
   * 1장 요약직보자료, 지문당. 재료(주제·요약문·동반의어·어법 포인트·T/F)는 테스트와 함께 쓰지만
   * 값은 자료마다 따로 매긴다. 같은 지문으로 다시 열면 더 받지 않는다.
   */
  onePageSummary: "lesson_one_page_summary",
  /** 1장 테스트, 지문당 */
  onePageTest: "lesson_one_page_test",
  /** 워크북 제시어 배열 영작, 지문당 */
  workbookWordOrder: "lesson_workbook_word_order",
  /** 워크북 한 줄 해석·전체 영작, 지문당 */
  workbookLineTranslation: "lesson_workbook_line_translation",
  /** 워크북 제목·주제·요지 해석, 지문당(2026-10-24) */
  workbookGist: "lesson_workbook_gist",
  /** 워크북 규칙 유형(빈칸 채우기·문장 순서 배열·연결어·글의 순서·문장 삽입), 유형마다 지문당 5(2026-10-28) */
  workbookRuleType: "lesson_workbook_rule_type",
  /** 문장 해석 다시 만들기(자료함), 지문당 */
  lineTranslate: "lesson_line_translate",
} as const;

export type LessonCreditFeature =
  (typeof LESSON_CREDIT_FEATURES)[keyof typeof LESSON_CREDIT_FEATURES];

/**
 * 만들기 전에 부른다. 잔액이 모자라면 안내 문구를, 넉넉하면(또는 가격이 꺼져 있으면) null.
 * 실제 차감은 새로 만든 뒤 debitLessonCredits로 한다. 만들다 실패하면 차감하지 않는다.
 */
export async function lessonCreditShortfall(
  academyId: string,
  featureKey: LessonCreditFeature | string,
  quantity = 1
): Promise<string | null> {
  const admin = createAdminClient();
  const pricing = await getFeatureCost(admin, featureKey);
  if (!pricing || !pricing.active || pricing.cost <= 0) return null;
  if (isFeatureFreeForAcademy(academyId, featureKey)) return null;
  const need = pricing.cost * Math.max(1, Math.floor(quantity));
  const { data } = await admin
    .from("academy_wallets")
    .select("balance")
    .eq("academy_id", academyId)
    .maybeSingle();
  const balance = Number(data?.balance ?? 0);
  if (balance >= need) return null;
  return `크레딧이 부족합니다. ${pricing.label}에 ${need}크레딧이 필요한데 남은 크레딧은 ${balance}입니다. 학원 관리자에게 충전을 요청해 주세요.`;
}

/**
 * 새로 만든 뒤 차감한다(후불). 만들기 전 잔액 확인은 lessonCreditShortfall이 하고, 여기서는
 * 잔액이 모자라도 차감한다(잔액이 마이너스가 될 수 있다). 같은 잔액으로 동시에 시작한 작업들이
 * 모두 확인을 통과한 뒤 차감에 실패해 값을 받지 못하던 것을 막는다(마이그레이션 136).
 * 이미 만든 결과는 버리지 않으므로 차감이 실패해도 결과를 돌려준다. 가격 설정이 아직 없으면
 * 넘어간다. 차감했으면(또는 차감할 가격이 없으면) true.
 */
export async function debitLessonCredits(params: {
  academyId: string;
  actorId: string;
  featureKey: LessonCreditFeature | string;
  quantity?: number;
  projectId?: string;
  /** 같은 차감을 두 번 하지 않게 하는 키. 없으면 매번 새로 차감한다. */
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  note?: string;
}): Promise<boolean> {
  // 키를 먼저 정해 두어 다시 시도해도 두 번 차감되지 않게 한다.
  const idempotencyKey =
    params.idempotencyKey ?? `${params.featureKey}:${params.projectId ?? "-"}:${randomUUID()}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await debitFeatureCredits(createAdminClient(), {
        academyId: params.academyId,
        featureKey: params.featureKey,
        actorId: params.actorId,
        idempotencyKey,
        metadata: {
          ...(params.projectId ? { project_id: params.projectId } : {}),
          ...(params.metadata ?? {}),
        },
        note: params.note,
        quantity: params.quantity,
        allowNegative: true,
      });
      return true;
    } catch (e) {
      if (e instanceof CreditError && e.code === "unknown_feature") return true;
      // 잔액 부족(136 미적용)·가격 꺼짐은 다시 해도 같다. 그 밖(네트워크 등)은 한 번 더 한다.
      const final =
        attempt > 0 ||
        e instanceof InsufficientCreditsError ||
        (e instanceof CreditError && e.code !== "credit_error");
      if (final) {
        console.error("[lesson-credits] debit failed", params.featureKey, e);
        return false;
      }
    }
  }
  return false;
}

/**
 * 만들기 <b>전에</b> 값을 먼저 잡아 둔다.
 *
 * 선생님 지적(2026-09-29): "크레딧이 -가 될 것 같으면 모자라다 하고 멈춰 달라."
 * 예전에는 만들기 전에 잔액만 보고(lessonCreditShortfall) 만든 뒤에 차감했는데,
 * 지문 여러 개가 동시에 돌면 모두 "넉넉하다"를 통과한 뒤 차례로 차감돼
 * 잔액이 마이너스까지 내려갔다(윌링어학원 -1,270). 차감은 DB 안에서 한 번에
 * 일어나므로, 먼저 차감하면 모자랄 때 그 자리에서 막힌다.
 *
 * 만들다 실패하면 refundLessonCredits로 되돌린다.
 */
export async function reserveLessonCredits(params: {
  academyId: string;
  actorId: string;
  featureKey: LessonCreditFeature | string;
  quantity?: number;
  projectId?: string;
  metadata?: Record<string, unknown>;
  note?: string;
}): Promise<
  | { ok: true; charged: number; idempotencyKey: string }
  | { ok: false; message: string }
> {
  const admin = createAdminClient();
  const pricing = await getFeatureCost(admin, params.featureKey);
  if (!pricing || !pricing.active || pricing.cost <= 0) {
    return { ok: true, charged: 0, idempotencyKey: "" };
  }
  const quantity = Math.max(1, Math.floor(params.quantity ?? 1));
  const idempotencyKey = `${params.featureKey}:${params.projectId ?? "-"}:${randomUUID()}`;
  try {
    const debit = await debitFeatureCredits(admin, {
      academyId: params.academyId,
      featureKey: params.featureKey,
      actorId: params.actorId,
      idempotencyKey,
      metadata: {
        ...(params.projectId ? { project_id: params.projectId } : {}),
        ...(params.metadata ?? {}),
      },
      note: params.note,
      quantity,
      // 잔액이 모자라면 차감하지 않고 막는다 — 마이너스로 내려가지 않게.
      allowNegative: false,
    });
    // 무료 학원 등으로 차감을 건너뛰었으면 잡은 값이 없다(되돌릴 것도 없다).
    if (debit.skipped) return { ok: true, charged: 0, idempotencyKey: "" };
    // 실제로 빠진 양(거래의 amount)을 돌려준다 — 그사이 값이 바뀌어도 되돌릴 양이 어긋나지 않게.
    const debited = Math.abs(Number((debit.transaction as { amount?: number } | null)?.amount ?? NaN));
    return {
      ok: true,
      charged: Number.isFinite(debited) && debited > 0 ? debited : pricing.cost * quantity,
      idempotencyKey,
    };
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      const { data } = await admin
        .from("academy_wallets")
        .select("balance")
        .eq("academy_id", params.academyId)
        .maybeSingle();
      const balance = Number(data?.balance ?? 0);
      const need = pricing.cost * quantity;
      return {
        ok: false,
        message: `크레딧이 부족합니다. ${pricing.label}에 ${need.toLocaleString("ko-KR")}크레딧이 필요한데 남은 크레딧은 ${balance.toLocaleString("ko-KR")}입니다. 학원 관리자에게 충전을 요청해 주세요.`,
      };
    }
    if (e instanceof CreditError) return { ok: false, message: e.message };
    return { ok: false, message: "크레딧을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
  }
}

/**
 * 잡아 둔 값을 되돌린다(만들다 실패했을 때). 되돌리지 못해도 만들기를 막지는 않는다.
 * reservationKey(reserveLessonCredits 의 idempotencyKey)를 주면 되돌림 키가 그 잡기에 묶여
 * 같은 잡기를 두 번 되돌리지 않는다.
 */
export async function refundLessonCredits(params: {
  academyId: string;
  actorId: string;
  amount: number;
  note: string;
  reservationKey?: string;
}): Promise<void> {
  if (!(params.amount > 0)) return;
  try {
    await adjustAcademyCredits(createAdminClient(), {
      academyId: params.academyId,
      amount: params.amount,
      direction: "grant",
      actorId: params.actorId,
      note: params.note,
      idempotencyKey: params.reservationKey
        ? `refund:${params.reservationKey}`
        : `refund:${randomUUID()}`,
    });
  } catch (e) {
    console.error("[credits] 되돌리기 실패", e);
  }
}
