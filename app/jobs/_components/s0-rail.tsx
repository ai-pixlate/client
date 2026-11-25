'use client';

import { StepNav, type StepNavStep } from './step-nav';

// ─────────────────────────────────────────────────────────────────
// S0 전역 프로세스 바(PRD F-NAV-01) — N1~N6 좌측 고정 rail. 화면마다 만들지 않고 이것만 쓴다.
//
// Figma 1920×1080: 진행단계(525:3023 화면의 instance 608:1440) x48 y96 44×924.
// 진행단계는 rail root(x36) 기준 left 12 · top 96 · bottom 60 으로 실제 bbox 를 만든다. rail 폭·본문 시작은 그대로 둔다.
// 단계 위치는 하드코딩하지 않는다 — 높이 924 안에서 item 52×6 과 flex-1 연결선 5개(각 122.4)로 Figma y 가 나온다.
// 낮은 창에서는 최소 높이·breakpoint 없이 진행단계 높이만 줄어든다.
//
// 12월(PRD v3.6.4 F-NAV-01 · F-JOB-07)에는 ✕ 가 없다 — 작업 나가기는 브라우저 뒤로 가기와 상단 메뉴이고, 같은 확인은
// useJobExitGuard 가 맡는다. N2·N4 의 [중단](F-JOB-08)은 작업을 남기는 다른 동작이라 여기서 다루지 않는다.
// ─────────────────────────────────────────────────────────────────

export function S0Rail({
  currentStep,
  overlay = false,
}: {
  /** 서버가 알려 준 현재 단계. 모르면(상태 조회 중·실패) 진행단계를 그리지 않는다. 추측하지 않는다 */
  currentStep: StepNavStep | null;
  /** 본문을 밀지 않고 왼쪽 위에 겹쳐 놓는다. 가장 가까운 positioned 조상이 화면 전체여야 한다 */
  overlay?: boolean;
}) {
  return (
    <div
      data-testid="s0-rail"
      className={overlay ? 'absolute top-0 bottom-0 left-0 z-20 ml-9 w-[44px]' : 'relative ml-9 h-full w-[44px] shrink-0'}
    >
      {currentStep && (
        <div data-testid="s0-steps" className="absolute top-[96px] bottom-[60px] left-3 w-[44px]">
          <StepNav currentStep={currentStep} />
        </div>
      )}
    </div>
  );
}
