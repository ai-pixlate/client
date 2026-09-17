// ─────────────────────────────────────────────────────────────────
// 좌측 진행 단계 네비게이션 (표시 전용, 클릭 이동 불가)
// N1(Figma 525:3023) / N3(555:4792) / N5(585:3283)가 동일한 6단계 구조를
// 공유한다 — currentStep 이전은 done, 해당 단계는 current, 이후는 upcoming으로
// 파생한다. N4/N6도 이 컴포넌트를 그대로 재사용할 수 있다.
//
// N1 Figma 재정합(4단계) — 원 사이를 잇는 세로 line이 빠져 있던 것을 복구한다.
// Figma(525:3023, node 573:3072/3073)는 이 line을 두 구간(현재 단계까지 =
// orange #ff6a38, 그 이후 = gray #eaeaea)으로 나눠 그린다 — 실측 asset이 각각
// stroke="#FF6A38"/stroke="#EAEAEA"였다. 원 중심(size-6=24px의 절반, top/bottom
// 12px)을 잇도록 top-3/bottom-3로 배치하고, line은 z-0으로 깔고 원+라벨
// 묶음은 relative z-10으로 그 위에 얹어 "원 뒤로 지나가게" 한다. 컨테이너
// 자체엔 Figma가 별도 padding/gap을 주지 않는다(inset-0 + justify-between만
// 있음) — 이전에 있던 py-10/gap-4는 근거 없는 임의값이라 제거했다.
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
      className="relative flex w-[44px] shrink-0 flex-col items-center justify-between"
    >
      {/* 원 중심을 잇는 세로 line — 원/라벨 뒤로 지나간다(z-0 vs z-10) */}
      <div
        aria-hidden="true"
        className="absolute top-3 bottom-3 left-1/2 z-0 flex w-px -translate-x-1/2 flex-col"
      >
        {STEPS.slice(0, -1).map((step, i) => (
          <div key={step.id} className={`w-px flex-1 ${i <= currentIndex ? 'bg-[#ff6a38]' : 'bg-[#eaeaea]'}`} />
        ))}
      </div>

      {STEPS.map((step, i) => {
        const status: StepStatus = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'upcoming';
        return (
          <div key={step.id} className="relative z-10 flex flex-col items-center gap-3.5">
            <StepBadge index={i + 1} status={status} />
            {/* Figma(573:3077)는 라벨을 w-[min-content]로 그린다 — 44px 폭에
                강제로 줄바꿈시키지 않는다. "정보 입력"처럼 44px보다 넓은
                라벨은 그대로 한 줄로 삐져나가게 둔다(옆에 다른 요소가 없는
                rail 최외곽이라 충돌하지 않는다). */}
            <p
              className={`whitespace-nowrap text-center text-[12px] tracking-[-0.04em] ${
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
