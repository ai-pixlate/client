'use client';

import { Fragment } from 'react';

// ─────────────────────────────────────────────────────────────────
// 좌측 진행 단계 네비게이션 (PRD F-NAV-01) — 단계 이동이 없다. PRD v3.6.4 수용 ③(12월 · PM 11/10): 단계에 마우스를 올려도
// 툴팁 · 손가락 커서 · 강조가 나오지 않는다(눌러도 아무 일이 없는 단계가 고장처럼 보이지 않게). 눌러도 URL·단계·서버 상태가
// 바뀌지 않는다. 완료·현재·미도달 구분(수용 ①)은 그대로다.
// F-NAV-02(이전 단계 이동)가 오기 전까지 단계 상태에 따라 이동 가능 여부를 나누지 않는다.
// Figma 진행단계(298:2872)의 6개 variant 를 하나로 그린다 — currentStep 이전은 done,
// 해당 단계는 current, 이후는 upcoming으로 파생한다. 화면에서는 S0Rail 을 거쳐 쓴다.
//
// 세로 line은 원(배지) 사이의 "빈 구간"에만 존재하는 실제 형제 엘리먼트다
// (flex-1인 1px div) — absolute 오버레이 + z-index로 라벨 뒤에 깔던 이전
// 방식은 라벨 텍스트(공백/글자 사이 투명 픽셀)로 line이 그대로 비쳐 보여
// "겹침"으로 보였다(z-index는 페인트 순서만 바꿀 뿐 텍스트의 빈 픽셀을
// 막지 못한다). line을 배지-배지 사이 갭에만 존재하는 실제 레이아웃
// 흐름으로 옮기면 라벨의 세로 범위(y)를 애초에 지나가지 않는다.
// 라벨은 Figma(573:3077) 실측 폭 44px(w-11) · 높이 14px(leading-[14px], item 24+14+14=52)로 고정한다 — 6개 라벨 모두
// 44px 폭에서 줄바꿈 없이 들어간다(실측 최대 폭 42.5px, "정보 입력"/
// "섹션 확인").
// ─────────────────────────────────────────────────────────────────

export type StepNavStep = 'N1' | 'N2' | 'N3' | 'N4' | 'N5' | 'N6';

const STEPS: { id: StepNavStep; label: string }[] = [
  { id: 'N1', label: '정보 입력' },
  { id: 'N2', label: '분석중' },
  { id: 'N3', label: '섹션 확인' },
  { id: 'N4', label: '번역 중' },
  { id: 'N5', label: '검수' },
  { id: 'N6', label: '저장' },
];

type StepStatus = 'done' | 'current' | 'upcoming';

export function StepNav({ currentStep }: { currentStep: StepNavStep }) {
  const currentIndex = STEPS.findIndex((s) => s.id === currentStep);

  return (
    <nav aria-label="작업 진행 단계" className="flex h-full w-[44px] shrink-0 flex-col items-center">
      {STEPS.map((step, i) => {
        const status: StepStatus = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'upcoming';
        return (
          <Fragment key={step.id}>
            {i > 0 && (
              <div
                aria-hidden="true"
                className={`w-px flex-1 ${i <= currentIndex ? 'bg-[#ff6a38]' : 'bg-[#eaeaea]'}`}
              />
            )}
            <StepItem label={step.label} index={i + 1} status={status} />
          </Fragment>
        );
      })}
    </nav>
  );
}

function StepItem({ label, index, status }: { label: string; index: number; status: StepStatus }) {
  return (
    <div className="relative flex flex-col items-center">
      <button
        type="button"
        aria-current={status === 'current' ? 'step' : undefined}
        aria-disabled="true"
        data-step-status={status}
        className="flex cursor-default flex-col items-center gap-3.5 rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]"
      >
        <StepBadge index={index} status={status} />
        <span
          className={`block w-11 text-center text-[12px] leading-[14px] tracking-[-0.04em] ${
            status === 'current' ? 'font-normal text-[#171717]' : 'font-light text-[#707070]'
          }`}
        >
          {label}
        </span>
      </button>
    </div>
  );
}

function StepBadge({ index, status }: { index: number; status: StepStatus }) {
  if (status === 'done') {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-xl bg-[#171717]">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path
            d="M2.5 6.2 5 8.7 9.5 3.5"
            stroke="white"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }

  if (status === 'current') {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-xl bg-[#ff6a38] text-[12px] font-medium text-white">
        {index}
      </span>
    );
  }

  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-xl border border-[#eaeaea] bg-white text-[12px] font-light text-[#707070]">
      {index}
    </span>
  );
}
