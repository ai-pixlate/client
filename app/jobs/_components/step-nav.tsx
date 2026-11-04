'use client';

import { Fragment, useId } from 'react';

// ─────────────────────────────────────────────────────────────────
// 좌측 진행 단계 네비게이션 (PRD F-NAV-01) — MVP 는 단계 이동이 없다. 눌러도 이동하지 않고 툴팁으로 12월 기능임을 알린다.
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
// 라벨은 Figma(573:3077) 실측 폭 44px(w-11)로 고정한다 — 6개 라벨 모두
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

const STEP_MOVE_TOOLTIP = '단계 이동은 12월 구현 예정입니다.';

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
  const tooltipId = useId();
  return (
    <div className="relative flex flex-col items-center">
      <button
        type="button"
        aria-current={status === 'current' ? 'step' : undefined}
        aria-disabled="true"
        aria-describedby={tooltipId}
        data-step-status={status}
        // Safari 는 클릭해도 버튼에 포커스를 주지 않는다. 눌렀을 때 안내가 남도록 직접 옮긴다
        onClick={(event) => event.currentTarget.focus()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') event.currentTarget.blur();
        }}
        className="peer flex cursor-default flex-col items-center gap-3.5 rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]"
      >
        <StepBadge index={index} status={status} />
        <span
          className={`block w-11 text-center text-[12px] tracking-[-0.04em] ${
            status === 'current' ? 'font-normal text-[#171717]' : 'font-light text-[#707070]'
          }`}
        >
          {label}
        </span>
      </button>
      {/* N1 인증 마크·N3 진행 말풍선과 같은 모양. rail 이 왼쪽 끝이라 단계 오른쪽에 둔다 */}
      <div
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none invisible absolute top-3 left-full z-40 ml-[14px] -translate-y-1/2 rounded-[8px] border border-[#ff6a38] bg-white p-2.5 text-[12px] leading-[normal] font-light tracking-[-0.04em] whitespace-nowrap text-[#ff6a38] peer-hover:visible peer-focus:visible"
      >
        {STEP_MOVE_TOOLTIP}
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-0 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-l border-[#ff6a38] bg-white"
        />
      </div>
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
