// ─────────────────────────────────────────────────────────────────
// N3 — 좌측 진행 단계 네비게이션 (표시 전용, 클릭 이동 불가)
// Figma 555:4792 기준. 페이지 레벨 STEP_META(N2~N6, page.tsx)와 별개로
// N3 화면 전용 6단계 라벨을 그대로 따른다 — 다른 단계 화면(N2/N4/N5/N6)의
// 상단 헤더 배지는 이 변경의 영향을 받지 않는다.
// ─────────────────────────────────────────────────────────────────

const STEPS = [
  { label: '정보 입력', status: 'done' as const },
  { label: '분석중', status: 'done' as const },
  { label: '섹션 확인', status: 'current' as const },
  { label: '번역 중', status: 'upcoming' as const },
  { label: '검수', status: 'upcoming' as const },
  { label: '저장', status: 'upcoming' as const },
];

export function N3StepNav() {
  return (
    <nav
      aria-label="작업 진행 단계"
      className="flex w-[44px] shrink-0 flex-col items-center justify-between gap-4 py-10"
    >
      {STEPS.map((step, i) => (
        <div key={step.label} className="flex flex-col items-center gap-3.5">
          <StepBadge index={i + 1} status={step.status} />
          <p
            className={`w-[44px] text-center text-[12px] tracking-[-0.04em] ${
              step.status === 'current' ? 'font-normal text-[#171717]' : 'font-light text-[#707070]'
            }`}
          >
            {step.label}
          </p>
        </div>
      ))}
    </nav>
  );
}

function StepBadge({ index, status }: { index: number; status: 'done' | 'current' | 'upcoming' }) {
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
