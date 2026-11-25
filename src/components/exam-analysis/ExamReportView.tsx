"use client";

import { ExamHitReport } from "@/components/exam-analysis/ExamHitReport";
import { ExamHitBookPanel } from "@/components/exam-analysis/ExamHitBookPanel";
import { hitBookOpenAction } from "@/app/actions/hit-book-action";
import type { HitReport } from "@/lib/exam-analysis/hit-report";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "@/components/layout/NavIcon";
import { ExamDeleteButton } from "@/components/exam-analysis/ExamDeleteButton";
import { readUploadedMaterial } from "@/lib/exam-analysis/read-upload-client";
import { readingBand } from "@/lib/exam-analysis/reading-level";
import {
  EXAM_CATEGORIES,
  EXAM_LEVELS,
  EXAM_TYPE_CHOICES,
  type ExamAnalysisRow,
  type ExamItemRow,
  type ExamLevel,
} from "@/lib/exam-analysis/types";
import { matchActionCompressed } from "@/app/actions/match-action";

/** 보고서 색: 크림 바탕 위 주황·남색 (승인된 A4 두 쪽 시안) */
const CREAM = "#fbf7ef";
const LINE = "#e8dcc5";
const SOFT = "#6b5f4b";
const NAVY = "#29335c";
const LV_BG: Record<ExamLevel, string> = { 하: "#f1e3c6", 중: "#f3a712", 상: "#e4572e" };
const LV_INK: Record<ExamLevel, string> = { 하: SOFT, 중: "#fff", 상: "#fff" };
/** 지문 출처 색 — 난이도 색과 겹치지 않게 골랐다 */
const SRC_BG: Record<string, string> = {
  교과서: "#29335c",
  부교재: "#7c3aed",
  모의고사: "#669bbc",
  수업자료: "#a8c686",
  외부지문: "#c9a227",
  "미분류": "#ded3bb",
};
const CAT_COLOR: Record<string, string> = {
  "대의 파악": "#e4572e",
  "세부 정보": "#29335c",
  "논리·추론": "#f3a712",
  "어법·어휘": "#669bbc",
  서술형: "#a8c686",
  기타: "#b8ad98",
};

const r1 = (x: number) => Math.round(x * 10) / 10;
const sum = (xs: (number | null)[]) => xs.reduce<number>((s, x) => s + (Number(x) || 0), 0);

function Donut({ parts, total }: { parts: { c: string; n: number }[]; total: number }) {
  const R = 98;
  const r = 60;
  let a = -Math.PI / 2;
  const n = sum(parts.map((p) => p.n)) || 1;
  const P = (ang: number, rad: number) => `${R + rad * Math.cos(ang)} ${R + rad * Math.sin(ang)}`;
  return (
    <svg viewBox="0 0 196 196" width="196" height="196" role="img" aria-label="영역별 문항 수">
      {parts.map((p) => {
        // 한 영역만 있으면 원 하나
        if (p.n === n) {
          return (
            <g key={p.c}>
              <circle cx={R} cy={R} r={(R + r) / 2} fill="none" stroke={CAT_COLOR[p.c]} strokeWidth={R - r} />
            </g>
          );
        }
        const a2 = a + (p.n / n) * Math.PI * 2;
        const big = a2 - a > Math.PI ? 1 : 0;
        const d = `M ${P(a, R)} A ${R} ${R} 0 ${big} 1 ${P(a2, R)} L ${P(a2, r)} A ${r} ${r} 0 ${big} 0 ${P(a, r)} Z`;
        a = a2;
        return <path key={p.c} d={d} fill={CAT_COLOR[p.c]} />;
      })}
      <text x={R} y={R} textAnchor="middle" fontSize="32" fontWeight="700" fill="#1f2937">
        {total}
      </text>
      <text x={R} y={R + 20} textAnchor="middle" fontSize="11" fill={SOFT}>
        문항
      </text>
    </svg>
  );
}

/** A4 한 쪽 (화면에서도 794×1123px, 인쇄는 210×297mm) */
/** 출처를 손으로 고를 때 쓰는 목록 — 교재/시험으로 묶고 그 안에 지문이 있다 */
type SourceGroup = { key: string; label: string; parts: { id: string; label: string }[] };
type SourceLists = { books: SourceGroup[]; mocks: SourceGroup[] };

/**
 * 출처를 손으로 다는 칸.
 *
 * 글자로 대조해 잡히는 것만 자동으로 달린다. 학교가 지문을 바꿔 쓰거나 부교재에서
 * 가져오면 잡히지 않으므로(현대고 11%, 동성고 29%) 선생님이 직접 채울 수 있게 한다.
 * 교재를 먼저 고르고 그 안에서 과·본문을 고른다 — 본문이 천칠백 개라 한 번에 늘어놓으면 못 찾는다.
 */
function SourcePicker({
  item,
  lists,
  onPick,
}: {
  item: {
    matched_textbook_id: string | null;
    matched_mock_id: string | null;
    source_kind: string | null;
    source_label?: string | null;
    source_edited: boolean;
  };
  lists: SourceLists | null;
  onPick: (source: { kind: "auto" | "textbook" | "mock" | "outside" | "sub_material"; passageId?: string; label?: string }) => void;
}) {
  const currentKind: "auto" | "textbook" | "mock" | "outside" | "sub_material" =
    item.source_kind === "sub_material"
      ? "sub_material"
      : item.source_kind === "outside"
        ? "outside"
        : item.source_kind === "mock"
          ? "mock"
          : item.source_kind === "textbook"
            ? "textbook"
            : item.matched_mock_id
              ? "mock"
              : item.matched_textbook_id
                ? "textbook"
                : "auto";

  const [kind, setKind] = useState<"auto" | "textbook" | "mock" | "outside" | "sub_material">(currentKind);
  const [customLabel, setCustomLabel] = useState(item.source_label ?? "");

  const groups = kind === "mock" ? lists?.mocks : kind === "textbook" ? lists?.books : null;
  const pickedId = kind === "mock" ? item.matched_mock_id : item.matched_textbook_id;
  const groupOf = (pid: string | null) =>
    pid ? (groups ?? []).find((g) => g.parts.some((x) => x.id === pid))?.key ?? "" : "";
  const [groupKey, setGroupKey] = useState(() => groupOf(pickedId));

  useEffect(() => {
    setKind(currentKind);
    setCustomLabel(item.source_label ?? "");
    if (!groupKey) setGroupKey(groupOf(pickedId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, lists, currentKind, pickedId]);

  const group = (groups ?? []).find((g) => g.key === groupKey) ?? null;
  const cls = "ui-input h-7 py-0 text-[11px]";
  const what = kind === "mock" ? "시험" : "교재";

  return (
    <span className="mt-1 flex flex-wrap items-center gap-1">
      <select
        aria-label="출처 갈래"
        className={`${cls} w-[92px] font-medium`}
        value={kind}
        onChange={(e) => {
          const v = e.target.value as "auto" | "textbook" | "mock" | "outside" | "sub_material";
          setKind(v);
          setGroupKey("");
          if (v === "auto") {
            onPick({ kind: "auto" });
          } else if (v === "sub_material") {
            onPick({ kind: "sub_material", label: customLabel || "부교재" });
          } else if (v === "outside") {
            onPick({ kind: "outside", label: customLabel || "외부지문" });
          } else if (v === "textbook") {
            onPick({ kind: "textbook", passageId: pickedId ?? undefined, label: customLabel || undefined });
          } else if (v === "mock") {
            onPick({ kind: "mock", passageId: pickedId ?? undefined, label: customLabel || undefined });
          }
        }}
      >
        <option value="auto">자동 대조</option>
        <option value="textbook">교과서</option>
        <option value="sub_material">부교재</option>
        <option value="mock">모의고사</option>
        <option value="outside">외부지문</option>
      </select>

      {kind === "textbook" || kind === "mock" ? (
        <>
          <select
            aria-label={what}
            className={`${cls} max-w-[130px]`}
            value={groupKey}
            onChange={(e) => setGroupKey(e.target.value)}
            disabled={!groups}
          >
            <option value="">{groups ? `${what} 선택` : "읽는 중…"}</option>
            {(groups ?? []).map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
          <select
            aria-label="지문"
            className={`${cls} max-w-[120px]`}
            value={pickedId ?? ""}
            onChange={(e) => {
              if (e.target.value) onPick({ kind, passageId: e.target.value, label: customLabel || undefined });
            }}
            disabled={!group}
          >
            <option value="">{group ? "지문 선택" : `${what} 먼저`}</option>
            {(group?.parts ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </>
      ) : null}

      {kind !== "auto" ? (
        <input
          aria-label="출처 직접 입력"
          placeholder={
            kind === "sub_material"
              ? "부교재명 (예: 올림포스 12강)"
              : kind === "outside"
                ? "상세 출처 (예: 외부지문)"
                : "직접 입력 (선택)"
          }
          className={`${cls} w-[140px]`}
          value={customLabel}
          onChange={(e) => setCustomLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onPick({ kind, passageId: pickedId ?? undefined, label: customLabel });
            }
          }}
          onBlur={() => {
            if (customLabel !== (item.source_label ?? "")) {
              onPick({ kind, passageId: pickedId ?? undefined, label: customLabel });
            }
          }}
        />
      ) : null}
    </span>
  );
}

function A4Page({ children, footer }: { children: ReactNode; footer: string }) {
  return (
    <section
      className="exam-a4 relative flex min-h-[1123px] w-[794px] shrink-0 flex-col px-[50px] pb-[52px] pt-[48px] text-[12.5px] leading-normal text-[#1f2937] shadow-[0_8px_26px_rgb(15_25_40/0.16)]"
      style={{ background: CREAM }}
    >
      {/* 인쇄할 때 넘치면 이 틀만 줄여 A4 안에 넣는다(--exam-fit, 아래 맞춤 효과가 잰다) */}
      <div className="exam-a4-body flex flex-1 flex-col gap-[18px]">{children}</div>
      <div
        className="absolute bottom-[22px] left-[50px] right-[50px] flex justify-between border-t pt-1.5 text-[10px]"
        style={{ borderColor: LINE, color: SOFT }}
      >
        <span>{footer}</span>
      </div>
    </section>
  );
}

export function ExamReportView({
  analysis,
  items: initialItems,
  academyName,
  listHref,
  mocks = [],
  generationsHref,
  hitReport = null,
  hitReportAt = null,
  materialMatchOn = false,
}: {
  analysis: ExamAnalysisRow;
  items: ExamItemRow[];
  academyName: string;
  listHref: string;
  /** 수업자료 대조(켜기·끄기, 자료 올리기, 적중표)가 이 학원에 열려 있는지 — 정수학원만 */
  materialMatchOn?: boolean;
  /** 내가 만든 자료와 대조한 적중표 (선생님 지시 2026-10-01). 눌러서 돌린 결과를 담아 둔다 */
  hitReport?: HitReport | null;
  /** 언제 대조했는가 */
  hitReportAt?: string | null;
  /** 이 시험으로 만든 동형모의고사 */
  mocks?: { id: string; title: string; created_at: string; status: string }[];
  generationsHref: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  // 수업자료 대조를 켜고 끄면 서버가 적중 칸을 다시 채운다 → 새 문항표로 바꾼다
  useEffect(() => setItems(initialItems), [initialItems]);
  const [matchOn, setMatchOn] = useState(materialMatchOn && analysis.match_materials);
  const [matchBusy, setMatchBusy] = useState(false);
  /*
   * 적중 자료집을 연 학원(정수학원 먼저)은 옛 대조 — 수업자료 대조 단추·자료 올리기·적중표·적중 쪽 — 을 끄고
   * 「적중 자료집」 상자 하나로 바꾼다(선생님 지시 2026-10-15 「대조하기랑 적중자료집 보기가 따로 논다」).
   */
  const [bookOn, setBookOn] = useState(false);
  useEffect(() => {
    void hitBookOpenAction()
      .then(setBookOn)
      .catch(() => setBookOn(false));
  }, []);
  const [editing, setEditing] = useState(false);
  const [editMeta, setEditMeta] = useState(false);
  const [meta, setMeta] = useState({
    schoolName: analysis.school_name ?? "",
    grade: analysis.grade ?? "",
    subject: analysis.subject ?? "",
    examLabel: analysis.exam_label ?? "",
  });
  const [saving, setSaving] = useState(false);

  // 출제 특징 & 대비 전략 & 점수 갈린 문항 상태
  const [features, setFeatures] = useState<string[]>(analysis.features ?? []);
  const [strategy, setStrategy] = useState<string[]>(analysis.strategy ?? []);
  const [decisiveItemIds, setDecisiveItemIds] = useState<string[]>(analysis.decisive_item_ids ?? []);
  const [featuresSaving, setFeaturesSaving] = useState(false);
  const [strategySaving, setStrategySaving] = useState(false);

  const [matchFiles, setMatchFiles] = useState<File[]>([]);
  const [matchStep, setMatchStep] = useState<string | null>(null);

  async function saveFeatures(newFeatures: string[]) {
    setFeatures(newFeatures);
    setFeaturesSaving(true);
    await fetch(`/api/exam-analysis/${analysis.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ features: newFeatures }),
    });
    setFeaturesSaving(false);
  }

  async function saveStrategy(newStrategy: string[]) {
    setStrategy(newStrategy);
    setStrategySaving(true);
    await fetch(`/api/exam-analysis/${analysis.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strategy: newStrategy }),
    });
    setStrategySaving(false);
  }

  async function saveDecisiveIds(newIds: string[]) {
    setDecisiveItemIds(newIds);
    await fetch(`/api/exam-analysis/${analysis.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisiveItemIds: newIds }),
    });
  }

  const s = useMemo(() => {
    const total = r1(sum(items.map((i) => i.points)));
    const subj = items.filter((i) => i.is_subjective);
    const hard = items.filter((i) => i.level === "상");
    const matched = items.filter((i) => i.matched_item_id);
    const cats = EXAM_CATEGORIES.map((c) => {
      const list = items.filter((i) => i.category === c);
      return { c, n: list.length, pts: r1(sum(list.map((i) => i.points))) };
    }).filter((x) => x.n > 0);
    const levels = EXAM_LEVELS.map((l) => {
      const list = items.filter((i) => i.level === l);
      return { l, n: list.length, pts: r1(sum(list.map((i) => i.points))) };
    });
    /*
     * 지문 출처별 갈래 — 이득희 선생님 요청(2026-09-29).
     * 교과서, 부교재(올림포스·EBS 등), 모의고사, 수업자료, 외부지문으로 세분화.
     */
    const hasPassage = items.filter((i) => String(i.passage_excerpt ?? "").trim() || i.source_kind || i.source_label);
    const fromSubMaterial = hasPassage.filter((i) => i.source_kind === "sub_material");
    const fromTextbook = hasPassage.filter(
      (i) => i.source_kind !== "sub_material" && (Boolean(i.matched_textbook_id) || i.source_kind === "textbook")
    );
    const fromMock = hasPassage.filter(
      (i) =>
        i.source_kind !== "sub_material" &&
        !fromTextbook.includes(i) &&
        (Boolean(i.matched_mock_id) || i.source_kind === "mock")
    );
    const fromMaterial = hasPassage.filter(
      (i) =>
        !fromSubMaterial.includes(i) &&
        !fromTextbook.includes(i) &&
        !fromMock.includes(i) &&
        Boolean(i.matched_item_id)
    );
    const fromOutside = hasPassage.filter(
      (i) =>
        !fromSubMaterial.includes(i) &&
        !fromTextbook.includes(i) &&
        !fromMock.includes(i) &&
        !fromMaterial.includes(i) &&
        i.source_kind === "outside"
    );
    const fromUnknown = hasPassage.filter(
      (i) =>
        !fromSubMaterial.includes(i) &&
        !fromTextbook.includes(i) &&
        !fromMock.includes(i) &&
        !fromMaterial.includes(i) &&
        !fromOutside.includes(i)
    );
    const sources = [
      { key: "교과서", list: fromTextbook },
      { key: "부교재", list: fromSubMaterial },
      { key: "모의고사", list: fromMock },
      { key: "수업자료", list: fromMaterial },
      { key: "외부지문", list: fromOutside },
      { key: "미분류", list: fromUnknown },
    ]
      .map((x) => ({
        key: x.key,
        n: x.list.length,
        pts: r1(sum(x.list.map((i) => i.points))),
        subjPts: r1(sum(x.list.filter((i) => i.is_subjective).map((i) => i.points))),
      }))
      .filter((x) => x.n > 0);
    const passagePts = r1(sum(hasPassage.map((i) => i.points)));

    const bookCount = new Map<string, number>();
    for (const i of fromTextbook) {
      const book = String(i.matched_textbook_label ?? i.source_label ?? "").split(" ").slice(0, 2).join(" ");
      if (book) bookCount.set(book, (bookCount.get(book) ?? 0) + 1);
    }
    const books = [...bookCount.entries()].sort((a, b) => b[1] - a[1]);

    const avg = items.length ? r1(sum(items.map((i) => i.difficulty)) / items.length) : 0;
    const subjPts = r1(sum(subj.map((i) => i.points)));

    // 점수가 갈린 문항: 1) 명시된 ID 목록 우선 2) is_decisive 플래그 3) 기본 난이도 상 배점순
    let decisive: ExamItemRow[] = [];
    if (decisiveItemIds.length > 0) {
      const itemMap = new Map(items.map((it) => [it.id, it]));
      decisive = decisiveItemIds.map((id) => itemMap.get(id)).filter(Boolean) as ExamItemRow[];
    }
    if (decisive.length === 0) {
      const flagged = items.filter((it) => it.is_decisive);
      if (flagged.length > 0) {
        decisive = flagged;
      } else {
        decisive = hard
          .slice()
          .sort((x, y) => (y.points ?? 0) - (x.points ?? 0) || y.difficulty - x.difficulty)
          .slice(0, 4);
      }
    }

    return { total, subj, subjPts, hard, matched, cats, levels, avg, decisive, sources, hasPassage, passagePts, books };
  }, [items, decisiveItemIds]);
  const pct = (x: number) => (s.total ? Math.round((x / s.total) * 100) : 0);

  /*
   * 출처를 손으로 달 때 고를 교과서 본문. 처음 「고쳐 쓰기」를 켤 때 한 번만 읽는다.
   */
  const [lists, setLists] = useState<SourceLists | null>(null);
  useEffect(() => {
    if (!editing || lists) return;
    let alive = true;
    fetch(`/api/exam-analysis/${analysis.id}/textbooks`)
      .then((r) => r.json())
      .then((d) => {
        if (alive && d?.ok) setLists({ books: d.books ?? [], mocks: d.mocks ?? [] });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [editing, lists, analysis.id]);

  async function saveItem(
    id: string,
    patch: {
      typeName?: string;
      level?: ExamLevel;
      points?: number | null;
      difficultyReason?: string | null;
      isDecisive?: boolean;
      source?: { kind: "auto" | "textbook" | "mock" | "outside" | "sub_material"; passageId?: string; label?: string };
    }
  ) {
    const before = items;
    const labelOf = (groups: SourceGroup[] | undefined, pid: string) => {
      for (const g of groups ?? []) {
        const part = g.parts.find((x) => x.id === pid);
        if (part) return `${g.label} ${part.label}`;
      }
      return null;
    };
    setItems((prev) =>
      prev.map((it) =>
        it.id === id
          ? {
              ...it,
              ...(patch.typeName ? { type_name: patch.typeName } : {}),
              ...(patch.level ? { level: patch.level, difficulty: patch.level === "상" ? 4 : patch.level === "하" ? 2 : 3 } : {}),
              ...("points" in patch ? { points: patch.points ?? null } : {}),
              ...("difficultyReason" in patch ? { difficulty_reason: patch.difficultyReason ?? null } : {}),
              ...("isDecisive" in patch ? { is_decisive: patch.isDecisive ?? false } : {}),
              ...(patch.source?.kind === "textbook"
                ? {
                    source_edited: true,
                    source_kind: "textbook",
                    matched_textbook_id: patch.source.passageId ?? null,
                    matched_textbook_label: patch.source.label || (patch.source.passageId ? labelOf(lists?.books, patch.source.passageId) : null) || "교과서",
                    source_label: patch.source.label || (patch.source.passageId ? labelOf(lists?.books, patch.source.passageId) : null) || "교과서",
                    matched_mock_id: null,
                    matched_mock_label: null,
                  }
                : {}),
              ...(patch.source?.kind === "mock"
                ? {
                    source_edited: true,
                    source_kind: "mock",
                    matched_mock_id: patch.source.passageId ?? null,
                    matched_mock_label: patch.source.label || (patch.source.passageId ? labelOf(lists?.mocks, patch.source.passageId) : null) || "모의고사",
                    source_label: patch.source.label || (patch.source.passageId ? labelOf(lists?.mocks, patch.source.passageId) : null) || "모의고사",
                    matched_textbook_id: null,
                    matched_textbook_label: null,
                  }
                : {}),
              ...(patch.source?.kind === "sub_material"
                ? {
                    source_edited: true,
                    source_kind: "sub_material",
                    source_label: patch.source.label || "부교재",
                    matched_textbook_id: null,
                    matched_textbook_label: null,
                    matched_mock_id: null,
                    matched_mock_label: null,
                  }
                : {}),
              ...(patch.source?.kind === "outside"
                ? {
                    source_edited: true,
                    source_kind: "outside",
                    source_label: patch.source.label || "외부지문",
                    matched_textbook_id: null,
                    matched_textbook_label: null,
                    matched_mock_id: null,
                    matched_mock_label: null,
                    matched_item_id: null,
                    matched_label: null,
                  }
                : {}),
              ...(patch.source?.kind === "auto"
                ? {
                    source_edited: false,
                    source_kind: null,
                    source_label: null,
                  }
                : {}),
              edited: true,
            }
          : it
      )
    );
    const res = await fetch(`/api/exam-analysis/${analysis.id}/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) setItems(before);
    else if (patch.typeName) router.refresh();
  }

  async function saveMeta() {
    setSaving(true);
    await fetch(`/api/exam-analysis/${analysis.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(meta),
    });
    setSaving(false);
    setEditMeta(false);
    router.refresh();
  }

  async function toggleMatch() {
    setMatchBusy(true);
    const next = !matchOn;
    const uploads: Array<{ name: string; text: string }> = [];
    
    if (next && matchFiles.length > 0) {
      for (const [i, f] of matchFiles.entries()) {
        setMatchStep(`올리신 자료 읽는 중 (${i + 1}/${matchFiles.length}) — ${f.name}`);
        try {
          const read = await readUploadedMaterial(f, analysis.id);
          if (read.text.trim().length > 40) uploads.push({ name: read.name, text: read.text });
        } catch (e) {
          console.error("Failed to read", f.name, e);
        }
      }
      setMatchStep("대조하는 중…");
    }

    let ok = false;
    try {
      const fd = new FormData();
      fd.append("id", analysis.id);
      fd.append("enabled", String(next));

      if (next && uploads.length > 0) {
        setMatchStep("업로드 데이터 압축 중…");
        const jsonString = JSON.stringify(uploads);
        const stream = new Blob([jsonString]).stream().pipeThrough(new CompressionStream("gzip"));
        const response = new Response(stream);
        const blob = await response.blob();
        fd.append("uploads", blob, "uploads.gz");
      }

      await matchActionCompressed(fd);
      ok = true;
    } catch (e) {
      console.error(e);
      alert("대조 중 오류가 발생했습니다. (사유: " + (e instanceof Error ? e.message : "알 수 없음") + ")");
    }
    
    setMatchBusy(false);
    setMatchStep(null);
    if (ok) {
      setMatchOn(next);
      router.refresh();
    }
  }

  /*
   * 배점이 덜 읽혔으면 알린다.
   */
  const noPoints = items.filter((i) => i.points == null || i.points === 0).length;
  const pointsOff = items.length > 0 && (noPoints > 0 || Math.abs(s.total - 100) > 0.5);

  const title = [meta.schoolName || "학교 미입력", meta.grade ? `${meta.grade}학년` : "", meta.subject].filter(Boolean).join(" ");
  const examLine = [meta.examLabel, `선택형 ${items.length - s.subj.length} · 서술형 ${s.subj.length}문항`, `${s.total}점`]
    .filter(Boolean)
    .join(" · ");
  const pointsNote = pointsOff
    ? noPoints > 0
      ? `배점이 빈 문항이 ${noPoints}개 있어 합이 ${s.total}점이에요. 문항표에서 채워 주세요.`
      : `배점 합이 ${s.total}점이에요. 100점이 아니면 문항표에서 고쳐 주세요.`
    : "";
  const footer = `${academyName} · 내신 시험 분석 · ${title}`;
  const showMatched = matchOn && !bookOn && s.matched.length > 0;

  /*
   * 선생님 지적(2026-10-08): 보고서를 인쇄하면 A4 아래가 잘렸다. 문항 줄 높이를 글자 수로
   * 어림해 쪽을 나눴는데, 실제로 더 길게 그려지면 화면에선 쪽이 늘어나 보여도 인쇄는 297mm에서
   * 자른다. 그려진 줄 높이를 재서 다시 나누고, 그래도 넘치는 쪽은 인쇄 때 줄여 맞춘다.
   */
  /*
   * 진짜 원인: 용지가 정해지지 않아 브라우저 기본 용지(레터 216x279mm)로 인쇄됐다. A4(297mm)
   * 한 쪽이 279mm에 안 들어가 아래가 다음 장으로 밀리며 잘렸다. 이름 붙은 @page(app-print-a4)는
   * 절대 위치 틀에서는 먹지 않으므로, 다른 A4 화면처럼 기본 용지를 A4로 정하는 규칙을 문서 맨
   * 끝에 넣어 둔다(화면을 떠나면 뺀다).
   */
  useEffect(() => {
    const el = document.createElement("style");
    el.id = "exam-report-print-page";
    el.textContent = "@media print { @page { size: 210mm 297mm; margin: 0; } }";
    document.body.appendChild(el);
    return () => el.remove();
  }, []);

  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    const root = document.getElementById("exam-report-print-root");
    if (!root) return;
    const next: Record<string, number> = {};
    root.querySelectorAll<HTMLElement>("tr[data-row-id]").forEach((tr) => {
      next[tr.dataset.rowId!] = Math.ceil(tr.getBoundingClientRect().height);
    });
    setRowHeights((prev) => {
      const keys = Object.keys(next);
      const same = keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k]);
      return same ? prev : next;
    });
  });
  useLayoutEffect(() => {
    const root = document.getElementById("exam-report-print-root");
    if (!root) return;
    const ROOM_PX = 1123 - 48 - 52; // 위아래 여백을 뺀 자리(쪽 번호 줄은 아래 여백 안)
    root.querySelectorAll<HTMLElement>(".exam-a4-body").forEach((body) => {
      // 틀 자체는 쪽 높이만큼 늘어나 있으니, 마지막 내용의 아래 끝까지를 잰다
      const last = body.lastElementChild as HTMLElement | null;
      const h = last ? last.getBoundingClientRect().bottom - body.getBoundingClientRect().top : 0;
      body.style.setProperty("--exam-fit", h > ROOM_PX ? (ROOM_PX / h).toFixed(4) : "1");
    });
  });

  const itemPages = useMemo(() => {
    const ROOM = 900;
    const ROW = 27;
    const LINE = 14;
    const PER_LINE = 88;
    const heightOf = (i: (typeof items)[number]) => {
      if (rowHeights[i.id]) return rowHeights[i.id]!;
      const notes = [
        i.conditions && `조건: ${i.conditions}`,
        i.grammar_point && `문법: ${i.grammar_point}`,
        i.difficulty_reason,
        i.source_kind === "sub_material" && `부교재: ${i.source_label || "부교재"}`,
        i.matched_textbook_label && `교과서: ${i.matched_textbook_label}`,
        i.matched_label && `수업자료: ${i.matched_label}`,
        i.matched_mock_label && `출처: ${i.matched_mock_label}`,
      ].filter(Boolean) as string[];
      const lines = notes.reduce((n, t) => n + Math.max(1, Math.ceil(t.length / PER_LINE)), 0);
      return ROW + lines * LINE;
    };

    const strategyRoom =
      strategy.length === 0
        ? 0
        : 30 +
          strategy.reduce((n, t) => n + Math.max(1, Math.ceil(t.length / 82)) * 18, 0);

    const heights = items.map(heightOf);
    const total = heights.reduce((a2, b2) => a2 + b2, 0);
    const pages = Math.max(1, Math.ceil((total + strategyRoom) / ROOM));
    const perPage = (total + strategyRoom) / pages;

    const out: (typeof items)[] = [];
    let cur: typeof items = [];
    let used = 0;
    items.forEach((it, idx) => {
      const h = heights[idx]!;
      const limit = out.length === pages - 1 ? ROOM - strategyRoom : Math.min(ROOM, perPage + 60);
      if (cur.length && used + h > limit) {
        out.push(cur);
        cur = [];
        used = 0;
      }
      cur.push(it);
      used += h;
    });
    if (cur.length) out.push(cur);
    return out.length ? out : [[]];
  }, [items, strategy, rowHeights]);

  const pageTotal = 1 + itemPages.length + (showMatched ? 1 : 0);
  const h3 = "mb-[7px] text-[13.5px] font-bold";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={listHref} className="inline-flex items-center gap-1 text-[13px] font-medium text-slate-500 hover:text-slate-900">
          <Icon name="left" size={16} />
          시험 분석 목록
        </Link>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`${listHref}/${analysis.id}/mock`}
            className="inline-flex h-9 items-center rounded-lg bg-brand-600 px-3.5 text-sm font-semibold text-white hover:bg-brand-700"
          >
            동형모의고사 만들기
          </Link>
          <button
            type="button"
            onClick={() => setEditMeta((v) => !v)}
            className="h-9 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            시험 정보 고치기
          </button>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className={`h-9 rounded-lg border px-3.5 text-sm font-semibold transition-colors ${editing ? "border-brand-600 bg-brand-600 text-white shadow-sm" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
          >
            {editing ? "✓ 편집 완료" : "보고서 내용 고치기"}
          </button>
          {materialMatchOn && !bookOn ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleMatch}
              disabled={matchBusy}
              title="시험 지문이 우리 학원 수업자료 지문과 같은지 대조해요"
              className={`h-9 rounded-lg border px-3.5 text-sm font-semibold disabled:opacity-50 ${matchOn ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              {matchBusy ? (matchStep || "대조 중…") : matchOn ? "수업자료 대조 켜짐" : "수업자료 대조 끄기"}
            </button>
            <label title="직접 만든 자료를 여러 개 올려서 같이 대조해요" className="cursor-pointer h-9 inline-flex items-center rounded-lg border border-brand-200 bg-brand-50 px-3.5 text-sm font-semibold text-brand-700 hover:bg-brand-100 transition-colors">
              <Icon name="upload" size={16} className="mr-1.5" />
              직접 만든 자료(PDF) 추가하기
              <input
                type="file"
                multiple
                accept=".pdf,.txt,.md,.csv,image/*"
                className="hidden"
                onChange={(e) => setMatchFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])])}
              />
            </label>
          </div>
          ) : null}
          <ExamDeleteButton id={analysis.id} label={title} redirectTo={listHref} variant="button" />
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <Icon name="print" size={15} /> 인쇄 / PDF
          </button>
        </div>
        
        {materialMatchOn && !bookOn && matchFiles.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5 rounded-xl border border-brand-100 bg-white p-3 shadow-sm w-full max-w-2xl">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[13px] font-bold text-slate-700 flex items-center gap-1.5">
                <Icon name="upload" size={14} className="text-brand-600" />
                대조할 선생님 자체 제작 자료 목록 ({matchFiles.length}개)
              </span>
              <button type="button" onClick={() => setMatchFiles([])} className="text-[12px] font-medium text-slate-400 hover:text-red-500 underline underline-offset-2">
                전체 지우기
              </button>
            </div>
            <div className="text-[12px] text-slate-500">
              한글(HWP)·워드에서 바로 내보낸 PDF처럼 글자가 든 파일은 읽기 값 없이 바로 대조합니다.
              스캔·사진은 지문이 보이는 쪽만 골라 읽되, 쪽마다 읽기 값이 들고 시간이 더 걸립니다.
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {matchFiles.map((f, i) => (
                <div key={i} className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 text-[13px] group hover:border-brand-300 transition-colors">
                  <div className="flex items-center gap-2 truncate text-slate-700">
                    <Icon name="file" size={14} className="text-slate-400 group-hover:text-brand-500 shrink-0" />
                    <span className="truncate font-medium">{f.name}</span>
                    <span className="text-[11px] text-slate-400 shrink-0">({Math.round(f.size / 1024)}KB)</span>
                  </div>
                  <button type="button" onClick={() => setMatchFiles(fs => fs.filter((_, idx) => idx !== i))} className="shrink-0 p-1 text-slate-400 hover:text-red-500 transition-colors bg-white rounded-md border border-slate-200 ml-2 shadow-sm">
                    <Icon name="x" size={12} />
                  </button>
                </div>
              ))}
            </div>
            {!matchOn && (
              <div className="mt-1 flex items-center gap-2 text-[12.5px] text-brand-600 font-medium bg-brand-50 p-2 rounded-lg border border-brand-100">
                <Icon name="info" size={14} />
                파일을 올린 후 위의 <b className="text-brand-700">&apos;수업자료 대조 끄기&apos;</b> 버튼을 눌러 대조를 다시 켜주셔야 분석지에 반영됩니다.
              </div>
            )}
          </div>
        )}
      </div>

      {bookOn ? (
        <ExamHitBookPanel
          analysisId={analysis.id}
          excerpts={items.map((i) => String(i.passage_excerpt ?? "")).filter((t) => t.trim().length > 40)}
        />
      ) : materialMatchOn ? (
        <ExamHitReport
          analysisId={analysis.id}
          report={hitReport}
          savedAt={hitReportAt}
          files={matchFiles}
          excerpts={items.map((i) => String(i.passage_excerpt ?? "")).filter((t) => t.trim().length > 40)}
        />
      ) : null}

      {mocks.length ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm print:hidden">
          <span className="font-semibold text-slate-700">만든 동형모의고사</span>
          {mocks.map((m) => (
            <Link key={m.id} href={`${generationsHref}/${m.id}`} className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100">
              {new Date(m.created_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              {m.status !== "completed" ? " · 만드는 중" : ""}
            </Link>
          ))}
        </div>
      ) : null}

      {editMeta ? (
        <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto] print:hidden">
          {(["schoolName", "grade", "subject", "examLabel"] as const).map((k) => (
            <input
              key={k}
              id={`meta-${k}`}
              className="ui-input h-9 text-sm"
              value={meta[k]}
              placeholder={{ schoolName: "학교", grade: "학년 (예: 1)", subject: "과목", examLabel: "시험 (예: 2026 1학기 중간)" }[k]}
              onChange={(e) => setMeta({ ...meta, [k]: e.target.value })}
            />
          ))}
          <button type="button" onClick={saveMeta} disabled={saving} className="h-9 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
            저장
          </button>
        </div>
      ) : null}

      {analysis.missing ? (
        <p className="rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-800 print:hidden">
          올라온 시험지에 빠진 부분이 있어요: {analysis.missing}. 빠진 문항은 보고서에 넣지 않았어요.
        </p>
      ) : null}

      <div className="overflow-x-auto print:overflow-visible">
        <div id="exam-report-print-root" className="mx-auto flex w-[794px] flex-col gap-5">
          {/* 1쪽: 요약 */}
          <A4Page footer={`${footer} · 1 / ${pageTotal}`}>
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <span className="inline-block rounded-[3px] bg-[#1f2937] px-[9px] py-1 text-[10.5px] font-bold tracking-[0.1em]" style={{ color: CREAM }}>
                  EXAM REPORT
                </span>
                <h1 className="mb-0.5 mt-2 text-[27px] font-bold leading-tight tracking-tight">{title}</h1>
                <p style={{ color: SOFT }}>{examLine}</p>
                {pointsNote ? (
                  <p className="mt-1 text-[12px] font-semibold text-amber-700">{pointsNote}</p>
                ) : null}
              </div>
              <div className="shrink-0 text-right text-[11px]" style={{ color: SOFT }}>
                <b className="block text-[14px] text-[#1f2937]">{academyName}</b>
                분석일 {new Date(analysis.created_at).toLocaleDateString("ko-KR")}
              </div>
            </div>

            <div className={`grid gap-[9px] ${showMatched ? "grid-cols-5" : "grid-cols-4"}`}>
              {[
                { v: `${items.length}`, l: "전체 문항" },
                { v: `${s.subjPts}`, l: `서술형 배점 · ${pct(s.subjPts)}%` },
                { v: `${s.avg}`, l: "평균 난이도 / 5" },
                { v: `${s.hard.length}`, l: `고난도 문항 · ${r1(sum(s.hard.map((i) => i.points)))}점` },
                ...(showMatched ? [{ v: `${s.matched.length}`, l: `수업자료 적중 · ${Math.round((s.matched.length / items.length) * 100)}%` }] : []),
              ].map((k) => (
                <div key={k.l} className="rounded-[14px] bg-white px-[13px] py-[11px]">
                  <b className="block text-[29px] leading-[1.1] tabular-nums">{k.v}</b>
                  <span className="text-[11.5px]" style={{ color: SOFT }}>
                    {k.l}
                  </span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-[196px_1fr_1fr] items-center gap-5">
              <Donut parts={s.cats} total={items.length} />
              <div>
                <h3 className={h3} style={{ color: NAVY }}>
                  영역별
                </h3>
                {s.cats.map((c) => (
                  <div key={c.c} className="flex justify-between border-b border-dashed py-1" style={{ borderColor: LINE }}>
                    <span>
                      <i className="mr-1.5 inline-block h-[9px] w-[9px] rounded-full align-[-1px]" style={{ background: CAT_COLOR[c.c] }} />
                      {c.c}
                    </span>
                    <b className="tabular-nums">
                      {c.n}문항 · {c.pts}점
                    </b>
                  </div>
                ))}
              </div>
              <div>
                <h3 className={h3} style={{ color: NAVY }}>
                  난이도별
                </h3>
                {s.levels.map((l) => (
                  <div key={l.l} className="border-b border-dashed py-1" style={{ borderColor: LINE }}>
                    <div className="flex justify-between">
                      <span>
                        <i className="mr-1.5 inline-block h-[9px] w-[9px] rounded-full align-[-1px]" style={{ background: LV_BG[l.l] }} />
                        {l.l}
                      </span>
                      <b className="tabular-nums">
                        {l.n}문항 · {l.pts}점 ({pct(l.pts)}%)
                      </b>
                    </div>
                    <span className="mt-[3px] block h-[5px] overflow-hidden rounded-full bg-white">
                      <span className="block h-full rounded-full" style={{ width: `${pct(l.pts)}%`, background: LV_BG[l.l] }} />
                    </span>
                  </div>
                ))}
                {/*
                  Jayden 선생님 물음(2026-09-29): "상중하 분류로 나뉘는 건 기준이 있나요?"
                  기준은 있었는데 화면에 없어서 상담에서 답할 근거가 보이지 않았다.
                  문항마다 근거 한 문장도 따로 적어 두니 함께 보이게 한다.
                */}
                <p className="mt-[7px] text-[10.5px] leading-[1.5]" style={{ color: SOFT }}>
                  해당 학년 학생을 기준으로 <b>지문 길이 · 어휘 수준 · 유형 자체의 난도 ·
                  선택지의 매력도 · 서술형 조건 수</b> 다섯 가지를 보고 1~5점을 매겨 상·중·하로
                  나눕니다.
                </p>
              </div>
            </div>

            {s.sources.length ? (
              <div>
                <h3 className={h3} style={{ color: NAVY }}>
                  지문 출처별
                  {s.books.length ? (
                    <span className="ml-1.5 text-[11px] font-normal" style={{ color: SOFT }}>
                      쓰는 교재{" "}
                      <b style={{ color: NAVY }}>
                        {s.books.map(([b, n]) => `${b}(${n}문항)`).join(", ")}
                      </b>
                    </span>
                  ) : null}
                </h3>
                <div className="mb-[5px] flex h-[7px] overflow-hidden rounded-full bg-white">
                  {s.sources.map((x) => (
                    <span
                      key={x.key}
                      title={`${x.key} ${x.n}문항`}
                      style={{
                        width: `${s.passagePts ? (x.pts / s.passagePts) * 100 : 0}%`,
                        background: SRC_BG[x.key] ?? SOFT,
                      }}
                    />
                  ))}
                </div>
                <div className="grid gap-[9px]" style={{ gridTemplateColumns: `repeat(${Math.min(5, s.sources.length)}, minmax(0,1fr))` }}>
                  {s.sources.map((x) => (
                    <div key={x.key} className="rounded-[12px] bg-white px-[11px] py-[6px]">
                      <span className="flex items-center gap-1.5 text-[11.5px]" style={{ color: SOFT }}>
                        <i
                          className="inline-block h-[9px] w-[9px] rounded-full"
                          style={{ background: SRC_BG[x.key] ?? SOFT }}
                        />
                        {x.key}
                      </span>
                      <b className="block text-[19px] leading-[1.15] tabular-nums">
                        {s.passagePts ? Math.round((x.pts / s.passagePts) * 100) : 0}%
                      </b>
                      <span className="text-[11px] tabular-nums" style={{ color: SOFT }}>
                        {x.n}문항 · {x.pts}점
                        {x.subjPts ? ` (서술형 ${x.subjPts}점)` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div>
              <h3 className={h3} style={{ color: NAVY }}>
                문항 번호별 난이도
              </h3>
              <div className="flex flex-wrap gap-[5px]">
                {items.map((i) => (
                  <span
                    key={i.id}
                    title={`${i.item_no} ${i.type_name} · ${i.level}`}
                    className="flex h-[37px] w-[37px] items-center justify-center rounded-full text-[11px] font-bold tabular-nums"
                    style={{
                      background: LV_BG[i.level],
                      color: LV_INK[i.level],
                      boxShadow: i.is_subjective ? `0 0 0 2px ${CREAM}, 0 0 0 4px ${NAVY}` : undefined,
                    }}
                  >
                    {i.item_no.replace("서술 ", "서")}
                  </span>
                ))}
              </div>
              <p className="mt-[5px] text-[10.5px]" style={{ color: SOFT }}>
                연한색 하 · 노랑 중 · 주황 상 · 테두리 = 서술형
              </p>
            </div>

            {analysis.sentence_words || analysis.lexile || analysis.vocab_level ? (
              <div>
                <h3 className={h3} style={{ color: NAVY }}>
                  지문·보기 수준
                </h3>
                <div className="flex flex-wrap gap-x-4 gap-y-[3px]">
                  {analysis.sentence_words ? (
                    <span>평균 문장 길이 <b>{analysis.sentence_words}낱말</b></span>
                  ) : null}
                  {analysis.choice_words ? (
                    <span>영어 보기 평균 <b>{analysis.choice_words}낱말</b></span>
                  ) : null}
                  {analysis.vocab_level ? (
                    <span>어휘 수준 <b>{analysis.vocab_level}</b></span>
                  ) : null}
                  {readingBand(analysis.lexile) ? (
                    <span>읽기 수준 <b>{readingBand(analysis.lexile)} 정도</b></span>
                  ) : null}
                </div>
                {analysis.level_summary ? (
                  <p className="mt-[3px]">{analysis.level_summary}</p>
                ) : null}
                <p className="mt-[5px] text-[10.5px]" style={{ color: SOFT }}>
                  문장 길이와 보기 길이는 시험지 글자를 세어 잰 값입니다. 읽기 수준은 문장 길이와
                  낱말 난도로 어림한 것이라 참고용입니다. 동형모의고사를 만들 때 이 수준에 맞춥니다.
                </p>
              </div>
            ) : null}

            <div>
              <div className="flex items-center justify-between">
                <h3 className={h3} style={{ color: NAVY }}>
                  출제 특징
                </h3>
                {editing ? (
                  <span className="text-[10.5px] font-semibold text-brand-600 print:hidden">
                    {featuresSaving ? "저장 중…" : "수정 내용이 자동 저장됩니다"}
                  </span>
                ) : null}
              </div>
              {editing ? (
                <div className="space-y-1.5 print:hidden">
                  {features.map((f, idx) => (
                    <div key={idx} className="flex items-center gap-1.5">
                      <span className="text-[11px] font-bold text-slate-400">•</span>
                      <input
                        className="ui-input h-7 flex-1 text-[11.5px]"
                        value={f}
                        onChange={(e) => {
                          const updated = [...features];
                          updated[idx] = e.target.value;
                          setFeatures(updated);
                        }}
                        onBlur={() => saveFeatures(features)}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const updated = features.filter((_, i) => i !== idx);
                          saveFeatures(updated);
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded bg-slate-100 text-[11px] font-bold text-slate-500 hover:bg-red-50 hover:text-red-600"
                        title="항목 삭제"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      const updated = [...features, ""];
                      setFeatures(updated);
                    }}
                    className="inline-flex h-6 items-center gap-1 rounded bg-slate-100 px-2 text-[10.5px] font-medium text-slate-600 hover:bg-slate-200"
                  >
                    + 특징 항목 추가
                  </button>
                </div>
              ) : null}
              <ul className={`list-disc space-y-[3px] pl-4 ${editing ? "hidden print:block" : ""}`}>
                {features.map((f, idx) => (
                  <li key={idx}>{f}</li>
                ))}
              </ul>
            </div>

            {s.decisive.length || editing ? (
              <div>
                <div className="flex items-center justify-between">
                  <h3 className={h3} style={{ color: NAVY }}>
                    점수가 갈린 문항{" "}
                    <span className="text-[11px] font-semibold" style={{ color: SOFT }}>
                      {decisiveItemIds.length > 0 || items.some((it) => it.is_decisive)
                        ? "선생님 지정 문항"
                        : "난이도 상 · 배점 큰 순"}
                    </span>
                  </h3>
                  {editing ? (
                    <div className="flex items-center gap-1 print:hidden">
                      <select
                        aria-label="점수 갈린 문항 추가"
                        className="ui-input h-6 py-0 text-[10.5px]"
                        value=""
                        onChange={(e) => {
                          const pickedId = e.target.value;
                          if (!pickedId) return;
                          const currentIds = s.decisive.map((d) => d.id);
                          if (!currentIds.includes(pickedId)) {
                            const updated = [...currentIds, pickedId];
                            saveDecisiveIds(updated);
                            saveItem(pickedId, { isDecisive: true });
                          }
                        }}
                      >
                        <option value="">+ 문항 추가</option>
                        {items
                          .filter((it) => !s.decisive.some((d) => d.id === it.id))
                          .map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.item_no} ({it.type_name}, {it.points ?? "–"}점)
                            </option>
                          ))}
                      </select>
                    </div>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {s.decisive.map((i) => (
                    <div key={i.id} className="relative rounded-[11px] bg-white px-[11px] py-2">
                      <div className="flex justify-between font-bold">
                        <span>
                          {i.item_no} · {i.type_name}
                        </span>
                        <div className="flex items-center gap-1">
                          <span>{i.points ?? "–"}점</span>
                          {editing ? (
                            <button
                              type="button"
                              onClick={() => {
                                const currentIds = s.decisive.map((d) => d.id).filter((id) => id !== i.id);
                                saveDecisiveIds(currentIds);
                                saveItem(i.id, { isDecisive: false });
                              }}
                              className="ml-1 text-[11px] text-slate-400 hover:text-red-500 print:hidden"
                              title="점수 갈린 문항에서 제외"
                            >
                              ✕
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {editing ? (
                        <div className="mt-1 print:hidden">
                          <input
                            className="ui-input h-6 w-full text-[10.5px]"
                            defaultValue={i.difficulty_reason ?? ""}
                            placeholder="점수가 갈린 까닭 입력..."
                            onBlur={(e) => {
                              if (e.target.value !== (i.difficulty_reason ?? "")) {
                                saveItem(i.id, { difficultyReason: e.target.value });
                              }
                            }}
                          />
                        </div>
                      ) : null}
                      <p className={`mt-px text-[11px] ${editing ? "hidden print:block" : ""}`} style={{ color: SOFT }}>
                        {(i.difficulty_reason ?? "").slice(0, 70)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </A4Page>

          {/* 2쪽부터: 문항정보표 (길면 여러 장) + 첫 장 오른쪽에 서술형·대비 전략 */}
          {itemPages.map((pageItems, pi) => (
          <A4Page key={`items-${pi}`} footer={`${footer} · ${pi + 2} / ${pageTotal}`}>
            <div className="flex items-baseline justify-between border-b-2 border-[#1f2937] pb-1.5">
              <b className="text-[15px]">
                {title} · 문항정보표
                {itemPages.length > 1 ? (
                  <span className="ml-1.5 text-[11px] font-semibold" style={{ color: SOFT }}>
                    ({pi + 1}/{itemPages.length})
                  </span>
                ) : null}
              </b>
              <span className="text-[11px]" style={{ color: SOFT }}>
                {meta.examLabel}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-[14px]">
              <div className="self-start rounded-xl bg-white px-3 py-2">
                <table className="w-full border-collapse text-[11.5px]">
                  <thead>
                    <tr className="text-left text-[10.5px]" style={{ color: SOFT }}>
                      <th className="px-1 py-1 font-semibold">번호</th>
                      <th className="px-1 py-1 font-semibold">유형</th>
                      <th className="px-1 py-1 font-semibold">난이도</th>
                      <th className="px-1 py-1 text-right font-semibold">배점</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((i) => (
                      <tr key={i.id} data-row-id={i.id} className="border-t align-middle" style={{ borderColor: "#f1ead9" }}>
                        <td className="whitespace-nowrap px-1 py-[3.5px] font-bold">
                          <div className="flex items-center gap-1">
                            <span>{i.item_no}</span>
                            {editing ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const isCurrentlyDecisive = s.decisive.some((d) => d.id === i.id);
                                  const nextDecisive = !isCurrentlyDecisive;
                                  const currentIds = s.decisive.map((d) => d.id);
                                  const updatedIds = nextDecisive
                                    ? [...currentIds, i.id]
                                    : currentIds.filter((id) => id !== i.id);
                                  saveDecisiveIds(updatedIds);
                                  saveItem(i.id, { isDecisive: nextDecisive });
                                }}
                                className={`rounded px-1 py-0.5 text-[9.5px] font-bold transition-colors ${
                                  s.decisive.some((d) => d.id === i.id)
                                    ? "bg-red-500 text-white"
                                    : "bg-slate-100 text-slate-400 hover:text-slate-600"
                                }`}
                                title="점수가 갈린 문항(킬러)으로 지정/해제"
                              >
                                {s.decisive.some((d) => d.id === i.id) ? "★킬러" : "☆킬러"}
                              </button>
                            ) : s.decisive.some((d) => d.id === i.id) ? (
                              <span className="rounded bg-red-100 px-1 py-0.2 text-[9px] font-bold text-red-700">★킬러</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-1 py-[3.5px]">
                          {editing ? (
                            <>
                              <div className="flex flex-wrap items-center gap-1">
                                <select
                                  id={`type-${i.id}`}
                                  className="ui-input h-7 max-w-[170px] py-0 text-[11.5px]"
                                  value={i.type_name}
                                  onChange={(e) => saveItem(i.id, { typeName: e.target.value })}
                                >
                                  {!EXAM_TYPE_CHOICES.some((g) => g.names.includes(i.type_name)) ? (
                                    <option value={i.type_name}>{i.type_name}</option>
                                  ) : null}
                                  {EXAM_TYPE_CHOICES.map((g) => (
                                    <optgroup key={g.category} label={g.category}>
                                      {g.names.map((n) => (
                                        <option key={n} value={n}>
                                          {n}
                                        </option>
                                      ))}
                                    </optgroup>
                                  ))}
                                </select>
                              </div>
                              <SourcePicker
                                item={i}
                                lists={lists}
                                onPick={(source) => saveItem(i.id, { source })}
                              />
                              <input
                                placeholder="난이도 근거 / 점수 갈린 까닭 입력..."
                                className="ui-input mt-1 h-6 w-full text-[10.5px]"
                                defaultValue={i.difficulty_reason ?? ""}
                                onBlur={(e) => {
                                  if (e.target.value !== (i.difficulty_reason ?? "")) {
                                    saveItem(i.id, { difficultyReason: e.target.value });
                                  }
                                }}
                              />
                            </>
                          ) : (
                            <>
                              {i.type_name}
                              {i.matched_label ? (
                                <span className="block text-[10px]" style={{ color: SOFT }}>
                                  수업자료: {i.matched_label}
                                </span>
                              ) : null}
                              {i.conditions ? (
                                <span className="block text-[10px]" style={{ color: SOFT }}>
                                  조건: {i.conditions}
                                </span>
                              ) : null}
                              {i.grammar_point ? (
                                <span className="block text-[10px]" style={{ color: NAVY }}>
                                  문법: {i.grammar_point}
                                </span>
                              ) : null}
                              {i.difficulty_reason ? (
                                <span className="block text-[10px]" style={{ color: SOFT }}>
                                  난이도 근거: {i.difficulty_reason}
                                </span>
                              ) : null}
                              {/* 문항을 어떻게 냈는지(2026-11-25) — 동형모의고사가 이대로 따라 만든다 */}
                              {i.answer_style ? (
                                <span className="block text-[10px]" style={{ color: NAVY }}>
                                  정답 꼴:{" "}
                                  {i.answer_style === "verbatim" ? "본문 표현 그대로" : i.answer_style === "paraphrase" ? "바꿔 말하기(패러프레이징)" : "일부만 본문 표현"}
                                </span>
                              ) : null}
                              {i.passage_change ? (
                                <span className="block text-[10px]" style={{ color: SOFT }}>
                                  지문 변형:{" "}
                                  {i.passage_change.startsWith("none")
                                    ? "원문 그대로"
                                    : i.passage_change.startsWith("heavy")
                                      ? `바꿔 씀 — ${i.passage_change.replace(/^heavy:?\s*/, "")}`
                                      : `조금 바꿈 — ${i.passage_change.replace(/^light:?\s*/, "")}`}
                                </span>
                              ) : null}
                              {i.choice_avg_words || i.vocab_level || i.level_reason ? (
                                <span className="block text-[10px]" style={{ color: SOFT }}>
                                  보기:{" "}
                                  {[
                                    i.choice_avg_words ? `평균 ${i.choice_avg_words}낱말` : "",
                                    i.vocab_level ?? "",
                                    i.level_reason ?? "",
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                              ) : null}
                              {i.distractor_method ? (
                                <span className="block text-[10px]" style={{ color: SOFT }}>
                                  오답: {i.distractor_method}
                                </span>
                              ) : null}
                              {i.source_kind === "sub_material" ? (
                                <span className="block text-[10px] font-semibold text-purple-700">
                                  부교재: {i.source_label || "부교재"}
                                </span>
                              ) : null}
                              {i.source_kind === "outside" ? (
                                <span className="block text-[10px]" style={{ color: SOFT }}>
                                  외부지문 {i.source_label && i.source_label !== "외부지문" ? `(${i.source_label})` : "(선생님이 표시)"}
                                </span>
                              ) : null}
                              {i.matched_textbook_label ? (
                                <span className="block text-[10px]" style={{ color: SOFT }}>
                                  교과서: {i.matched_textbook_label}
                                </span>
                              ) : i.source_kind === "textbook" && i.source_label ? (
                                <span className="block text-[10px]" style={{ color: SOFT }}>
                                  교과서: {i.source_label}
                                </span>
                              ) : null}
                              {i.matched_mock_label ? (
                                <span className="block text-[10px]" style={{ color: SOFT }}>
                                  모의고사: {i.matched_mock_label}
                                </span>
                              ) : i.source_kind === "mock" && i.source_label ? (
                                <span className="block text-[10px]" style={{ color: SOFT }}>
                                  모의고사: {i.source_label}
                                </span>
                              ) : null}
                            </>
                          )}
                        </td>
                        <td className="px-1 py-[3.5px]">
                          {editing ? (
                            <select
                              id={`level-${i.id}`}
                              className="ui-input h-7 py-0 text-[11.5px]"
                              value={i.level}
                              onChange={(e) => saveItem(i.id, { level: e.target.value as ExamLevel })}
                            >
                              {EXAM_LEVELS.map((l) => (
                                <option key={l} value={l}>
                                  {l}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="inline-block w-[22px] rounded-[3px] text-center text-[10.5px] font-bold" style={{ background: LV_BG[i.level], color: LV_INK[i.level] }}>
                              {i.level}
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-1 py-[3.5px] text-right tabular-nums">
                          {editing ? (
                            <input
                              id={`points-${i.id}`}
                              type="number"
                              step="0.1"
                              min="0"
                              className="ui-input h-7 w-14 py-0 text-right text-[11.5px]"
                              defaultValue={i.points ?? ""}
                              onBlur={(e) => {
                                const v = e.target.value === "" ? null : Number(e.target.value);
                                if (v !== i.points) saveItem(i.id, { points: v });
                              }}
                            />
                          ) : (
                            (i.points ?? "–")
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t" style={{ borderColor: "#f1ead9" }}>
                      <td className="px-1 py-[3.5px] font-bold">
                        {pi === itemPages.length - 1 ? "계" : "이어짐"}
                      </td>
                      <td className="px-1 py-[3.5px]">
                        {pi === itemPages.length - 1 ? `${items.length}문항` : `${pageItems.length}문항`}
                      </td>
                      <td />
                      <td className="px-1 py-[3.5px] text-right font-bold tabular-nums">
                        {pi === itemPages.length - 1 ? s.total : ""}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {pi === itemPages.length - 1 ? (
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className={h3} style={{ color: NAVY }}>
                      다음 시험 대비 전략
                    </h3>
                    {editing ? (
                      <span className="text-[10.5px] font-semibold text-brand-600 print:hidden">
                        {strategySaving ? "저장 중…" : "수정 내용이 자동 저장됩니다"}
                      </span>
                    ) : null}
                  </div>
                  {editing ? (
                    <div className="space-y-1.5 print:hidden">
                      {strategy.map((st, idx) => (
                        <div key={idx} className="flex items-center gap-1.5">
                          <span className="text-[11px] font-bold text-slate-400">•</span>
                          <input
                            className="ui-input h-7 flex-1 text-[11.5px]"
                            value={st}
                            onChange={(e) => {
                              const updated = [...strategy];
                              updated[idx] = e.target.value;
                              setStrategy(updated);
                            }}
                            onBlur={() => saveStrategy(strategy)}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const updated = strategy.filter((_, i) => i !== idx);
                              saveStrategy(updated);
                            }}
                            className="flex h-7 w-7 items-center justify-center rounded bg-slate-100 text-[11px] font-bold text-slate-500 hover:bg-red-50 hover:text-red-600"
                            title="전략 삭제"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          const updated = [...strategy, ""];
                          setStrategy(updated);
                        }}
                        className="inline-flex h-6 items-center gap-1 rounded bg-slate-100 px-2 text-[10.5px] font-medium text-slate-600 hover:bg-slate-200"
                      >
                        + 대비 전략 항목 추가
                      </button>
                    </div>
                  ) : null}
                  <ul className={`list-disc space-y-[3px] pl-4 ${editing ? "hidden print:block" : ""}`}>
                    {strategy.map((f, idx) => (
                      <li key={idx}>{f}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </A4Page>
          ))}

          {/* 3쪽: 수업자료 적중 문항 (대조를 켰고 맞은 문항이 있을 때만) */}
          {showMatched ? (
            <A4Page footer={`${footer} · ${pageTotal} / ${pageTotal}`}>
              <div className="flex items-baseline justify-between border-b-2 border-[#1f2937] pb-1.5">
                <b className="text-[15px]">{title} · 수업자료 적중 문항</b>
                <span className="text-[11px]" style={{ color: SOFT }}>
                  {meta.examLabel}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-[9px]">
                {[
                  { v: `${s.matched.length}`, l: `적중 문항 / 전체 ${items.length}` },
                  { v: `${r1(sum(s.matched.map((i) => i.points)))}`, l: `적중 배점 · 총점의 ${pct(sum(s.matched.map((i) => i.points)))}%` },
                  { v: `${new Set(s.matched.map((i) => i.matched_item_id)).size}`, l: "맞은 수업자료 지문 수" },
                ].map((k) => (
                  <div key={k.l} className="rounded-[14px] bg-white px-[13px] py-[11px]">
                    <b className="block text-[29px] leading-[1.1] tabular-nums">{k.v}</b>
                    <span className="text-[11.5px]" style={{ color: SOFT }}>
                      {k.l}
                    </span>
                  </div>
                ))}
              </div>
              <div className="rounded-xl bg-white px-3 py-2">
                <table className="w-full border-collapse text-[11.5px]">
                  <thead>
                    <tr className="whitespace-nowrap text-left text-[10.5px]" style={{ color: SOFT }}>
                      <th className="px-1 py-1 font-semibold">번호</th>
                      <th className="px-1 py-1 font-semibold">유형</th>
                      <th className="px-1 py-1 font-semibold">난이도</th>
                      <th className="px-1 py-1 text-right font-semibold">배점</th>
                      <th className="px-1 py-1 font-semibold">수업자료</th>
                      <th className="px-1 py-1 font-semibold">시험지 지문 첫 부분</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.matched.map((i) => (
                      <tr key={i.id} className="border-t align-top" style={{ borderColor: "#f1ead9" }}>
                        <td className="whitespace-nowrap px-1 py-1 font-bold">{i.item_no}</td>
                        <td className="whitespace-nowrap px-1 py-1">{i.type_name}</td>
                        <td className="px-1 py-1">
                          <span className="inline-block w-[22px] rounded-[3px] text-center text-[10.5px] font-bold" style={{ background: LV_BG[i.level], color: LV_INK[i.level] }}>
                            {i.level}
                          </span>
                        </td>
                        <td className="px-1 py-1 text-right tabular-nums">{i.points ?? "–"}</td>
                        <td className="px-1 py-1 font-semibold" style={{ color: NAVY }}>
                          {i.matched_label}
                        </td>
                        <td className="px-1 py-1 text-[11px] italic" style={{ color: SOFT }}>
                          {(i.passage_excerpt ?? "").split(/\s+/).slice(0, 14).join(" ")}…
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px]" style={{ color: SOFT }}>
                시험 지문 앞부분이 학원 수업자료에 넣어 둔 지문과 같은 문항입니다. 지문을 조금 바꿔 낸 문항도 포함됩니다.
              </p>
            </A4Page>
          ) : null}
        </div>
      </div>

    </div>
  );
}
