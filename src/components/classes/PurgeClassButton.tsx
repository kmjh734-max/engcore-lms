"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

interface PurgeClassButtonProps {
  classId: string;
  className: string;
  /** 지우기 전에 무엇이 함께 사라지는지 센다 */
  countLinks: (classId: string) => Promise<{
    ok: boolean;
    message?: string;
    name?: string;
    students?: number;
    courses?: number;
    assignments?: number;
  }>;
  /** 반 이름을 그대로 받아 적었을 때만 지운다 */
  purge: (
    classId: string,
    typedName: string
  ) => Promise<{ ok: boolean; message: string }>;
  redirectTo: string;
}

/** 반 완전 삭제 — 되돌릴 수 없으므로 무엇이 사라지는지 보이고 이름을 받아 적게 한다 */
export function PurgeClassButton({
  classId,
  className,
  countLinks,
  purge,
  redirectTo,
}: PurgeClassButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<{
    students: number;
    courses: number;
    assignments: number;
  } | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    const got = await countLinks(classId);
    setBusy(false);
    if (!got.ok) {
      setError(got.message ?? "반을 찾을 수 없습니다.");
      return;
    }
    setLinks({
      students: got.students ?? 0,
      courses: got.courses ?? 0,
      assignments: got.assignments ?? 0,
    });
    setTyped("");
    setOpen(true);
  }

  async function run() {
    setBusy(true);
    setError(null);
    const result = await purge(classId, typed);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.push(redirectTo);
    router.refresh();
  }

  if (!open) {
    return (
      <div className="flex flex-col items-start gap-2 sm:items-end">
        <Button variant="danger" onClick={start} disabled={busy}>
          {busy ? "세어 보는 중…" : "반 완전 삭제"}
        </Button>
        {error ? <p className="text-xs text-rose-700">{error}</p> : null}
      </div>
    );
  }

  const nothing =
    links !== null &&
    links.students === 0 &&
    links.courses === 0 &&
    links.assignments === 0;

  return (
    <div className="w-full rounded-md border border-rose-200 bg-rose-50 p-4">
      <p className="text-sm font-semibold text-rose-900">
        「{className}」 반을 아주 지웁니다. 되돌릴 수 없어요.
      </p>
      <ul className="mt-2 list-disc pl-5 text-sm text-rose-800">
        {nothing ? (
          <li>이 반에 딸린 것이 없습니다.</li>
        ) : (
          <>
            {links!.students > 0 ? <li>학생 {links!.students}명이 이 반에서 빠집니다</li> : null}
            {links!.courses > 0 ? <li>강좌 연결 {links!.courses}개가 사라집니다</li> : null}
            {links!.assignments > 0 ? (
              <li>이 반에 준 듣기·단어 배정 {links!.assignments}개가 사라집니다</li>
            ) : null}
          </>
        )}
        {/* 듣기 일정 배정을 지우면 그 일정의 하루 과제·풀이 기록도 DB에서 함께 지워진다(2026-11-28 점검) — 사실대로 */}
        {links && links.assignments > 0 ? (
          <li>
            학생 계정과 단어 학습 기록은 남지만, 이 반에 준 듣기 일정의 하루 과제·풀이 기록은 함께
            지워집니다. 기록을 남기려면 지우지 말고 보관해 주세요
          </li>
        ) : (
          <li>학생 계정과 학습 기록은 그대로 남습니다</li>
        )}
      </ul>
      <label className="mt-3 block text-sm text-rose-900">
        지우려면 반 이름을 그대로 적어 주세요
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={className}
          aria-label="반 이름 확인"
          className="ui-input mt-1 h-9 w-full py-1.5 sm:w-64"
        />
      </label>
      {error ? <p className="mt-2 text-xs font-semibold text-rose-700">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <Button
          variant="danger"
          onClick={run}
          disabled={busy || typed.trim() !== className.trim()}
        >
          {busy ? "지우는 중…" : "지웁니다"}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
          그만두기
        </Button>
      </div>
    </div>
  );
}
