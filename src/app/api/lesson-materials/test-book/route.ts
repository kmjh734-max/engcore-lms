import { NextResponse } from "next/server";
import {
  chargeTestDrawAction,
  prepareWorkbookChunkGlossAction,
  prepareWorkbookExtrasAction,
  loadDrawProjectsAction,
  prepareTestBookPassageAction,
  prepareTeacherNotesAction,
  loadClassViewDataAction,
  registerTestBookVocabAction,
  saveTestBookOptionsAction,
} from "@/lib/lesson-materials/test-book-actions";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * 테스트 교재: 지문 하나의 재료를 준비하거나(prepare, 기본) 교재 설정을 파일에 저장한다
 * (saveOptions). 1장 자료 라우트와 같은 이유로 서버 액션을 fetch로 부른다(post-json.ts).
 * 권한·학원 기능은 액션 안에서 확인한다.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      op?: string;
      role?: string;
      projectId?: string;
      forceRegenerate?: boolean;
      regenerate?: string[];
      id?: string;
      options?: unknown;
      title?: string;
      projectIds?: string[];
      seed?: string;
      typeCount?: number;
      snapshot?: unknown;
      chargeKey?: string;
      lessonTab?: boolean;
      classView?: boolean;
      tbTypes?: unknown[];
      name?: unknown;
    };
    const role = body.role === "admin" ? "admin" : "teacher";
    if (body.op === "registerVocab") {
      return NextResponse.json(
        await registerTestBookVocabAction(role, {
          docId: body.id ? String(body.id) : null,
          title: String(body.title ?? ""),
          projectIds: Array.isArray(body.projectIds) ? body.projectIds.map(String) : [],
          lessonTab: body.lessonTab === true,
        })
      );
    }
    if (body.op === "teacherNotes") {
      return NextResponse.json(
        await prepareTeacherNotesAction(role, { projectId: String(body.projectId ?? ""), regenerate: body.forceRegenerate === true })
      );
    }
    if (body.op === "classData") {
      return NextResponse.json(
        await loadClassViewDataAction(role, { projectIds: Array.isArray(body.projectIds) ? body.projectIds.map(String) : [] })
      );
    }
    if (body.op === "loadDraw") {
      return NextResponse.json(
        await loadDrawProjectsAction(role, {
          projectIds: Array.isArray(body.projectIds) ? body.projectIds.map(String) : [],
        })
      );
    }
    if (body.op === "prepareWorkbook") {
      return NextResponse.json(
        await prepareWorkbookExtrasAction(role, {
          projectId: String(body.projectId ?? ""),
          regenerate: Array.isArray(body.regenerate)
            ? (body.regenerate.filter((x) => x === "vocab" || x === "gloss" || x === "content") as Array<"vocab" | "gloss" | "content">)
            : undefined,
          vocabTab: body.lessonTab === true,
          classView: body.classView === true,
          tbTypes: Array.isArray(body.tbTypes) ? body.tbTypes.map(String) : undefined,
        })
      );
    }
    if (body.op === "chunkGloss") {
      return NextResponse.json(
        await prepareWorkbookChunkGlossAction(role, {
          projectId: String(body.projectId ?? ""),
          chargeKey: typeof body.chargeKey === "string" ? body.chargeKey : undefined,
        })
      );
    }
    if (body.op === "chargeDraw") {
      return NextResponse.json(
        await chargeTestDrawAction(role, {
          seed: String(body.seed ?? ""),
          projectIds: Array.isArray(body.projectIds) ? body.projectIds.map(String) : [],
          typeCount: Number(body.typeCount ?? 0),
          snapshot: body.snapshot,
          name: typeof body.name === "string" ? body.name : null,
        })
      );
    }
    if (body.op === "saveOptions") {
      return NextResponse.json(await saveTestBookOptionsAction(role, { id: String(body.id ?? ""), options: body.options }));
    }
    return NextResponse.json(
      await prepareTestBookPassageAction(role, {
        projectId: String(body.projectId ?? ""),
        forceRegenerate: body.forceRegenerate === true,
        regenerate: Array.isArray(body.regenerate)
          ? (body.regenerate.filter((x) => x === "vocab" || x === "gloss" || x === "content") as Array<"vocab" | "gloss" | "content">)
          : undefined,
      })
    );
  } catch (e) {
    return NextResponse.json({
      ok: false as const,
      message: e instanceof Error ? e.message : "테스트 교재를 만들지 못했습니다.",
    });
  }
}
