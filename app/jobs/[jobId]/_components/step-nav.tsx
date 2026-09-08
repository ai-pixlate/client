// ─────────────────────────────────────────────────────────────────
// 좌측 진행 단계 네비게이션 (표시 전용, 클릭 이동 불가)
// N3(Figma 555:4792)와 N5(Figma 585:3283)가 동일한 6단계 구조를 공유한다 —
// currentStep 이전은 done, 해당 단계는 current, 이후는 upcoming으로 파생한다.
// N4/N6도 이 컴포넌트를 그대로 재사용할 수 있다.
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
    <nav
      aria-label="작업 진행 단계"
      className="flex w-[44px] shrink-0 flex-col items-center justify-between gap-4 py-10"
    >
      {STEPS.map((step, i) => {
        const status: StepStatus = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'upcoming';
        return (
          <div key={step.id} className="flex flex-col items-center gap-3.5">
            <StepBadge index={i + 1} status={status} />
            <p
              className={`w-[44px] text-center text-[12px] tracking-[-0.04em] ${
                status === 'current' ? 'font-normal text-[#171717]' : 'font-light text-[#707070]'
              }`}
            >
              {step.label}
            </p>
          </div>
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
