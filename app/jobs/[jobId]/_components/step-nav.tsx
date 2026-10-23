import { Fragment } from 'react';

// ─────────────────────────────────────────────────────────────────
// 좌측 진행 단계 네비게이션 (표시 전용, 클릭 이동 불가)
// N1(Figma 525:3023) / N3(555:4792) / N5(585:3283)가 동일한 6단계 구조를
// 공유한다 — currentStep 이전은 done, 해당 단계는 current, 이후는 upcoming으로
// 파생한다. N4/N6도 이 컴포넌트를 그대로 재사용할 수 있다.
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
            <div className="flex flex-col items-center gap-3.5">
              <StepBadge index={i + 1} status={status} />
              <p
                className={`w-11 text-center text-[12px] tracking-[-0.04em] ${
                  status === 'current' ? 'font-normal text-[#171717]' : 'font-light text-[#707070]'
                }`}
              >
                {step.label}
              </p>
            </div>
          </Fragment>
        );
      })}
    </nav>
  );
}

function StepBadge({ index, status }: { index: number; status: StepStatus }) {
  if (status === 'done') {
    return (
      <div className="flex size-6 shrink-0 items-center justify-center rounded-xl bg-[#171717]">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path
            d="M2.5 6.2 5 8.7 9.5 3.5"
            stroke="white"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    );
  }

  if (status === 'current') {
    return (
      <div className="flex size-6 shrink-0 items-center justify-center rounded-xl bg-[#ff6a38] text-[12px] font-medium text-white">
        {index}
      </div>
    );
  }

  return (
    <div className="flex size-6 shrink-0 items-center justify-center rounded-xl border border-[#eaeaea] bg-white text-[12px] font-light text-[#707070]">
      {index}
    </div>
  );
}
