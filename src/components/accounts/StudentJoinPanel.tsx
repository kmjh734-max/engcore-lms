"use client";

import { useState } from "react";
import { Icon } from "@/components/layout/NavIcon";

export type PendingStudent = {
  id: string;
  name: string;
  username: string;
  school: string | null;
  schoolGrade: string | null;
  parentPhone: string | null;
  createdAt: string;
};

/** 학생 스스로 가입하는 길: 가입 코드·링크와 승인 대기 목록 */
export function StudentJoinPanel({
  joinCode,
  joinUrl,
  pending,
}: {
  joinCode: string;
  joinUrl: string;
  /** 링크로 들어온 최근 학생들 */
  pending: PendingStudent[];
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rows, setRows] = useState(pending);
  const [code, setCode] = useState(joinCode);
  const [copied, setCopied] = useState(false);

  const url = joinUrl.replace(/code=[^&]*/, `code=${code}`);

  async function act(id: string, action: "approve" | "reject") {
    setBusy(id);
    try {
      const res = await fetch("/api/admin/students/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: id, action }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (data.ok) setRows((prev) => prev.filter((r) => r.id !== id));
      else alert(data.message ?? "처리하지 못했어요. 다시 해 주세요.");
    } catch {
      alert("처리하지 못했어요. 인터넷 연결을 확인해 주세요.");
    } finally {
      setBusy(null);
    }
  }

  async function newCode() {
    setBusy("code");
    try {
      const res = await fetch("/api/admin/students/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "new-code" }),
      });
      const data = (await res.json()) as { ok?: boolean; code?: string };
      if (data.ok && data.code) setCode(data.code);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mb-4 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left"
      >
        <span>
          <b className="text-sm text-slate-900">학생 가입 링크</b>
          <span className="ml-2 text-sm text-slate-500">
            가입 코드 <b className="tracking-[0.15em] text-slate-800">{code}</b>
            {rows.length > 0 ? ` · 최근 가입 ${rows.length}명` : ""}
          </span>
        </span>
        <Icon name="chevron" size={16} className={open ? "rotate-90 text-slate-400" : "text-slate-400"} />
      </button>

      {open ? (
        <div className="border-t border-slate-100 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly value={url} className="ui-input h-9 flex-1 min-w-[260px] text-sm text-slate-600" />
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="h-9 rounded-lg bg-brand-600 px-3.5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              {copied ? "복사했어요" : "링크 복사"}
            </button>
            <button
              type="button"
              onClick={() => void newCode()}
              disabled={busy === "code"}
              className="h-9 rounded-lg border border-slate-200 px-3.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              코드 새로 만들기
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            이 링크를 학생·학부모에게 보내면 학생이 스스로 가입하고 바로 쓸 수 있어요. 휴대전화 번호가 아이디가 돼요.
            코드를 새로 만들면 예전 링크는 막히니, 다른 곳에 새면 새로 만드세요.
          </p>

          {rows.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-4 py-2.5">
                  <span className="min-w-0">
                    <b className="text-sm text-slate-900">{r.name}</b>
                    <span className="ml-2 text-xs text-slate-500">
                      {[r.username, r.school, r.schoolGrade].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={busy === r.id}
                      onClick={() => {
                        if (confirm(`${r.name} 학생을 내보낼까요? 계정이 지워져요.`)) void act(r.id, "reject");
                      }}
                      className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                    >
                      내보내기
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">아직 링크로 가입한 학생이 없어요.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
