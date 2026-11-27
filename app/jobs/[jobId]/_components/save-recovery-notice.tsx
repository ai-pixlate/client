'use client';

import type { SaveRecoveryState } from '@/lib/queries/use-save-recovery';

/**
 * 결과를 알 수 없는 저장의 확인 상태 안내(N3 · N5 공용 — lib/queries/use-save-recovery.ts).
 * Figma 에 없는 상태라 기존 N5 오류 안내 톤(12px · #707070 / red-500 · 얇은 테두리 버튼)으로 최소 보완했다.
 * 확인될 때까지 저장 · 확정이 잠긴다는 것과 다시 확인 경로를 둔다. 시간이 지나도 스스로 사라지지 않는다.
 */
export function SaveRecoveryNotice({ state, onRetry, testIdPrefix }: { state: SaveRecoveryState; onRetry: () => void; testIdPrefix: string }) {
  if (!state) return null;
  return (
    <div role="status" data-testid={`${testIdPrefix}-uncertain-save-notice`} data-status={state.status} className="mb-2 flex flex-col gap-1 text-[12px] leading-[normal]">
      {state.status === 'checking' ? (
        <p className="text-[#707070]">저장 결과를 서버에서 확인하는 중입니다. 확인될 때까지 다른 저장을 할 수 없습니다.</p>
      ) : (
        <>
          <p className="text-red-500">저장 결과를 확인하지 못했습니다. 서버 상태를 확인할 때까지 저장·확정을 할 수 없습니다.</p>
          <button
            type="button"
            data-testid={`${testIdPrefix}-uncertain-save-retry`}
            onClick={onRetry}
            className="flex h-6 w-fit items-center rounded-[4px] border border-[#eaeaea] bg-white px-3 text-[12px] tracking-[-0.02em] text-[#171717] hover:bg-[#f5f5f5]"
          >
            서버 상태 다시 확인
          </button>
        </>
      )}
    </div>
  );
}
