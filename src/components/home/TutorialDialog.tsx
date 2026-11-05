"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

/*
 * 관리 홈 「잉코어 사용법」 — 처음 로그인하면 한 번 뜨고, 「다시 보지 않기」를 누르면 안 뜬다.
 * 언제든 홈 위 「? 사용법」으로 다시 연다. 그림은 public/tutorial (실제 화면 캡처, 학원·학생 이름 가림 —
 * 다시 찍기: scripts/tmp-rv/_tutorial-shots.mjs).
 */

type Slide = { img: string; title: string; body: string };
type Track = { key: string; label: string; slides: Slide[]; tryHref: string; tryLabel: string };

const TRACKS: Track[] = [
  {
    key: "materials",
    label: "📚 수업자료 만들기",
    tryHref: "/admin/lesson-materials/input",
    tryLabel: "지문 넣으러 가기",
    slides: [
      {
        img: "/tutorial/m1.webp",
        title: "수업자료 메뉴에서 「+ 새 자료 추가」",
        body: "왼쪽 메뉴 수업자료를 누르면 자료함이 열려요. 오른쪽 위 「+ 새 자료 추가」를 눌러 지문을 넣으러 가요.",
      },
      {
        img: "/tutorial/m2.webp",
        title: "지문을 붙여 넣어요",
        body: "한 줄에 지문 하나예요. 엑셀에서 여러 줄을 한꺼번에 붙여도 돼요. 모의고사 지문은 「모의고사 지문 불러오기」로 바로 가져와요. 다 넣으면 「다음 단계로 →」.",
      },
      {
        img: "/tutorial/m3.webp",
        title: "문장과 해석을 확인하고 저장",
        body: "지문이 문장별로 나뉘고 제목·해석·내용 흐름이 붙어요. 고칠 곳만 고치고 「자료 저장 완료 →」를 누르면 자료함에 들어가요.",
      },
      {
        img: "/tutorial/m4.webp",
        title: "지문을 고르고 만들 자료를 눌러요",
        body: "자료함에서 지문을 체크하면 아래에 보라색 막대가 떠요. 수업용 자료 · 지문 분석서 · 워크북 · 1장 요약직보자료 · 1장 테스트 · 문제 제작 · 최종통합자료 중 하나를 눌러요. 자료마다 생김새는 「🗂 자료 종류」 탭에서 볼 수 있어요.",
      },
      {
        img: "/tutorial/m5.webp",
        title: "만든 자료는 위쪽 탭에 모여요",
        body: "분석서 · 워크북 · 1장 테스트처럼 종류별 탭에 쌓여요. 눌러 열어서 「인쇄」나 「PDF로 저장」을 하면 돼요. 크레딧은 만들 때만 빠지고, 다시 열거나 인쇄할 때는 빠지지 않아요.",
      },
    ],
  },
  {
    key: "types",
    label: "🗂 자료 종류",
    tryHref: "/admin/lesson-materials",
    tryLabel: "자료함으로 가기",
    slides: [
      {
        img: "/tutorial/t1.webp",
        title: "수업용 자료 — 수업 시간에 바로 쓰는 묶음",
        body: "지문 전체 단어장, 지문마다 단어 정리·문장별 해석, 백지노트, 직독직해, 단어 시험지 중 필요한 것만 골라 한 파일로 뽑아요. 디자인도 네 가지 중에서 골라요.",
      },
      {
        img: "/tutorial/t2.webp",
        title: "지문 분석서 — 문장마다 구조와 해석",
        body: "문장마다 주어·동사 같은 구조 표시, 해석, 시험에 나올 어법·어휘 포인트가 붙어요. 수업 준비용으로도, 학생 배포용으로도 써요.",
      },
      {
        img: "/tutorial/t3.webp",
        title: "워크북 — 유형을 골라 만드는 연습지",
        body: "해석 적기 · 단어 시험 · 제목·주제 · 빈칸 · 어법 선택 · 순서 배열 등 유형을 골라 순서를 정해요. 문제지·정답지를 따로 PDF로 저장할 수 있어요.",
      },
      {
        img: "/tutorial/t4.webp",
        title: "1장 요약직보자료 — 지문 하나를 한 장에",
        body: "본문, 내용 흐름, 중요 포인트를 지문당 한 장으로 정리해요. 시험 직전 복습 자료로 좋아요.",
      },
      {
        img: "/tutorial/t5.webp",
        title: "1장 테스트 — 지문 한 장짜리 시험지",
        body: "어법·어휘 고르기, 지칭어 쓰기, 중요 표현 쓰기, 요약문 빈칸, T/F 같은 유형을 체크해서 지문당 한 장 테스트를 만들어요. 문제·정답을 따로 뽑을 수 있어요.",
      },
      {
        img: "/tutorial/t6.webp",
        title: "변형문제 — 내신·수능형 문제",
        body: "지문으로 어법·어휘·내용 일치·빈칸·순서 같은 객관식과 서술형 변형문제를 만들어요. 문제지와 해설지를 골라 인쇄해요. 자료함에서 「문제 제작」을 누르거나 왼쪽 메뉴 변형문제에서 시작해요.",
      },
      {
        img: "/tutorial/t7.webp",
        title: "최종통합자료 — 한 권짜리 시험 대비 교재",
        body: "표지와 학습 계획표부터 분석서·워크북·테스트까지 한 권으로 묶어요. 학교·시험 이름이 들어간 표지를 골라 바로 인쇄할 수 있어요.",
      },
    ],
  },
  {
    key: "study",
    label: "🎧 단어·듣기 배정",
    tryHref: "/admin/listening/assign",
    tryLabel: "듣기 배정하러 가기",
    slides: [
      {
        img: "/tutorial/v1.webp",
        title: "반을 만들고 학생을 등록해요",
        body: "반 관리에서 「+ 새 반」, 학생·수강에서 학생마다 아이디와 첫 비밀번호를 만들어 주세요. 학생은 휴대폰 인터넷 브라우저에서 그 아이디로 로그인해 공부해요. 앱은 깔지 않아도 돼요.",
      },
      {
        img: "/tutorial/v2.webp",
        title: "단어장을 골라 「배정」",
        body: "단어학습에서 학년에 맞는 단어장을 체크하고 아래 막대의 「배정」 → 반이나 학생을 골라 「배정하기」. 학생 화면에 바로 보여요.",
      },
      {
        img: "/tutorial/v3.webp",
        title: "듣기는 날마다 나눠서 나가요",
        body: "듣기학습 → 배정 → 「새로 배정하기」. 누구에게 · 어떤 세트를 · 요일(월~금 · 월수금 · 매일) · 하루 문항 수를 정하고 「배정」. 중1~고3 학년별 세트가 미리 들어 있어요.",
      },
      {
        img: "/tutorial/v4.webp",
        title: "현황에서 누가 했는지 봐요",
        body: "오늘 안 한 학생, 이번 달 수행률·정답률이 보여요. 학생 이름을 누르면 학부모께 알림을 보낼 수 있어요. 시험 기간에는 배정 카드에서 「일시정지」해 두세요.",
      },
      {
        img: "/tutorial/v5.webp",
        title: "요금은 학생 1명당 한 달 한 번",
        body: "단어·듣기는 학생이 그달 처음 공부할 때(또는 배정할 때) 한 번만 빠져요. 그달에 몇 번을 공부해도 더 빠지지 않아요. 기능별 가격은 크레딧 화면에서 볼 수 있어요.",
      },
    ],
  },
];

const DISMISS_KEY = "engcore_tutorial_dismissed_v1";

/** role 에 맞춰 「…하러 가기」 경로를 바꾼다 (/admin/… ↔ /teacher/…) */
export function TutorialDialog({ role = "admin" }: { role?: "admin" | "teacher" }) {
  const [open, setOpen] = useState(false);
  const [trackIdx, setTrackIdx] = useState(0);
  const [slideIdx, setSlideIdx] = useState(0);
  const [dontShow, setDontShow] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY) !== "1") setOpen(true);
    } catch {
      /* 저장소를 못 쓰면 자동으로 띄우지 않는다 */
    }
  }, []);

  const close = useCallback(() => {
    if (dontShow) {
      try {
        localStorage.setItem(DISMISS_KEY, "1");
      } catch {
        /* 무시 */
      }
    }
    setOpen(false);
  }, [dontShow]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") setSlideIdx((i) => Math.min(i + 1, TRACKS[trackIdx]!.slides.length - 1));
      if (e.key === "ArrowLeft") setSlideIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, trackIdx]);

  const track = TRACKS[trackIdx]!;
  const slide = track.slides[slideIdx]!;
  const last = slideIdx === track.slides.length - 1;

  return (
    <>
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() => {
            setSlideIdx(0);
            setOpen(true);
          }}
          className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700 hover:bg-brand-100"
        >
          ? 사용법
        </button>
      </div>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="잉코어 사용법"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between px-6 pt-5">
              <h2 className="text-lg font-bold text-slate-900">잉코어 사용법</h2>
              <button type="button" onClick={close} aria-label="닫기" className="text-2xl leading-none text-slate-400 hover:text-slate-700">
                ×
              </button>
            </div>

            <div className="mt-3 flex gap-2 border-b border-slate-200 px-6">
              {TRACKS.map((t, i) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setTrackIdx(i);
                    setSlideIdx(0);
                  }}
                  className={`-mb-px border-b-[3px] px-4 py-2.5 text-sm font-bold ${
                    i === trackIdx ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={slide.img}
                alt={slide.title}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 object-contain"
                style={{ aspectRatio: "1440 / 860" }}
              />
              <p className="mt-4 text-xs font-bold text-brand-700">
                {slideIdx + 1} / {track.slides.length}
              </p>
              <h3 className="mt-1 text-xl font-extrabold text-slate-900">{slide.title}</h3>
              <p className="mt-1.5 text-[15px] leading-7 text-slate-700">{slide.body}</p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-500">
                <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} className="h-4 w-4" />
                다시 보지 않기
              </label>
              <div className="flex items-center gap-1.5">
                {track.slides.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`${i + 1}번째 장`}
                    onClick={() => setSlideIdx(i)}
                    className={`h-2 rounded-full ${i === slideIdx ? "w-6 bg-brand-600" : "w-2 bg-slate-300"}`}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={slideIdx === 0}
                  onClick={() => setSlideIdx((i) => i - 1)}
                  className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-bold text-slate-600 disabled:opacity-40"
                >
                  이전
                </button>
                {last ? (
                  trackIdx < TRACKS.length - 1 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setTrackIdx(trackIdx + 1);
                        setSlideIdx(0);
                      }}
                      className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700"
                    >
                      다음: {TRACKS[trackIdx + 1]!.label.replace(/^\S+\s/, "")} →
                    </button>
                  ) : (
                    <Link
                      href={track.tryHref.replace(/^\/admin\//, `/${role}/`)}
                      onClick={close}
                      className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700"
                    >
                      {track.tryLabel} →
                    </Link>
                  )
                ) : (
                  <button
                    type="button"
                    onClick={() => setSlideIdx((i) => i + 1)}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700"
                  >
                    다음 →
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
