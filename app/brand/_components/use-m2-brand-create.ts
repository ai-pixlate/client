'use client';

import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { ApiBrand } from '@/lib/api/brand-schema';
import { ApiRequestError, getBrands } from '@/lib/api/pixlate';
import { toM2BrandCreate } from '@/lib/brand/m2-adapter';
import type { M2BrandFormValue } from '@/lib/brand/m2-form';
import { pixlateKeys, useCreateBrandMutation } from '@/lib/queries/pixlate';

// ─────────────────────────────────────────────────────────────────
// M2 신규 브랜드 등록 — POST /brands 1회. 로고는 본문에 없어서 등록이 성공해 brandId 를 받은 뒤에만
// 같은 저장 흐름(use-m2-brand-save.ts)으로 POST /brands/{brandId}/logos 를 보낸다.
// - 한 사용자 동작에 POST /brands 는 최대 1회다. state 가 반영되기 전의 연속 클릭도 ref 로 막는다.
// - 자동 재시도하지 않는다. 409 · 400 · 500 은 서버가 거절한 것이라 「등록 실패」로 보고, 입력을 그대로 두고 등록 화면에 남는다.
// - 네트워크 오류(응답 유실 포함)는 서버에서 실제로 실패했는지 알 수 없다 — 「결과 확인 필요」로 두고 POST 를 다시 보내지 않는다.
//   GET /brands 로 결과를 확인한다: 1개면 그 브랜드로 정상 흐름, 0개면 사용자가 명시적으로 다시 등록할 수 있고, 2개 이상이면 고르지 않는다.
//   확인 조회도 실패하면 [다시 확인](목록 재조회만)을 보인다.
// - POST 직전 GET /brands 재확인: 같은 탭의 오래된 화면 상태로 중복 등록할 위험을 줄일 뿐이다. 동시 탭·동시 요청은 FE 만으로 막지 못하며
//   최종 보장은 서버 계약 영역이다.
// - 판매자당 브랜드 개수 같은 업무 규칙은 FE 가 만들지 않는다 — 409 는 서버 응답을 그대로 따른다.
// ─────────────────────────────────────────────────────────────────

export type M2CreateErrorReason = 'conflict' | 'validation' | 'failed';

export type M2CreateState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'error'; reason: M2CreateErrorReason }
  /** 결과 불명(네트워크 오류·응답 유실) — 목록을 다시 확인하는 중 */
  | { kind: 'verifying' }
  /** 결과 불명 + 목록 확인도 실패 — [다시 확인]만 할 수 있다(POST 금지) */
  | { kind: 'verify-failed' }
  /** 결과 확인 조회는 성공했지만 브랜드가 없다 — 사용자가 다시 등록을 고를 수 있다(자동 재시도 없음) */
  | { kind: 'verified-empty' }
  /** 등록 전·결과 확인 중 목록에 브랜드가 여러 개다 — 고르지 않는다 */
  | { kind: 'multiple' }
  /** POST 직전 목록 확인이 실패했다 — 등록하지 않았다 */
  | { kind: 'precheck-failed' };

/**
 * 등록 결과 — null 이면 진행할 브랜드가 없다.
 * - created: 이번 POST 응답
 * - recovered: 응답 유실 뒤 목록에서 확인한 브랜드 1개 — 이번 등록이 만든 것으로 보고 이어서 로고를 저장한다
 * - existing: POST 직전 확인에서 이미 있던 브랜드 1개 — POST 하지 않았다. 이 입력을 그 브랜드에 덮어쓰지 않고 연결만 한다
 */
export type M2CreateOutcome = { source: 'created' | 'recovered' | 'existing'; brandId: number; brand: ApiBrand } | null;

/** 결과를 확인할 수 없는 오류인지 — 서버가 응답한 오류(ApiRequestError)가 아닌 fetch 실패(네트워크·응답 유실) */
function isUnknownOutcome(error: unknown): boolean {
  return !(error instanceof ApiRequestError);
}

export function useM2BrandCreate() {
  const queryClient = useQueryClient();
  const { mutateAsync } = useCreateBrandMutation();
  const [state, setState] = useState<M2CreateState>({ kind: 'idle' });
  const inFlightRef = useRef(false);

  /** GET /brands 를 새로 받는다(캐시가 아니라 서버 값). 실패하면 바로 throw — 다시 확인은 사용자가 [다시 확인]으로 한다 */
  const readBrands = useCallback(
    () => queryClient.fetchQuery({ queryKey: pixlateKeys.brands(), queryFn: getBrands, staleTime: 0, retry: false }),
    [queryClient],
  );

  /** 목록 결과 → 다음 상태. 1개면 그 브랜드로 진행한다 */
  const settleFromList = useCallback((brands: ApiBrand[], emptyState: M2CreateState, source: 'recovered' | 'existing'): M2CreateOutcome => {
    const ids = brands.filter((brand): brand is ApiBrand & { id: number } => typeof brand.id === 'number');
    if (ids.length === 1) {
      setState({ kind: 'idle' });
      return { source, brandId: ids[0].id, brand: ids[0] };
    }
    setState(ids.length === 0 ? emptyState : { kind: 'multiple' });
    return null;
  }, []);

  /** 결과 확인 — 목록 재조회만 한다. 절대 POST 하지 않는다 */
  const verify = useCallback(async (): Promise<M2CreateOutcome> => {
    if (inFlightRef.current) return null;
    inFlightRef.current = true;
    setState({ kind: 'verifying' });
    try {
      return settleFromList(await readBrands(), { kind: 'verified-empty' }, 'recovered');
    } catch {
      setState({ kind: 'verify-failed' });
      return null;
    } finally {
      inFlightRef.current = false;
    }
  }, [readBrands, settleFromList]);

  /** 등록 — POST 직전 목록 재확인 → POST /brands 1회 → 응답 유실이면 결과 확인 */
  const create = useCallback(
    async (draft: M2BrandFormValue): Promise<M2CreateOutcome> => {
      if (inFlightRef.current) return null;
      inFlightRef.current = true;
      setState({ kind: 'creating' });
      try {
        let current: ApiBrand[];
        try {
          current = await readBrands();
        } catch {
          setState({ kind: 'precheck-failed' });
          return null;
        }
        if (current.length > 0) return settleFromList(current, { kind: 'idle' }, 'existing');

        try {
          const created = await mutateAsync(toM2BrandCreate(draft));
          setState({ kind: 'idle' });
          return { source: 'created', brandId: created.id, brand: created };
        } catch (error) {
          if (!isUnknownOutcome(error)) {
            const status = (error as ApiRequestError).status;
            setState({ kind: 'error', reason: status === 409 ? 'conflict' : status === 400 ? 'validation' : 'failed' });
            return null;
          }
        }
        // 결과 불명 — 다시 POST 하지 않고 목록으로 확인한다
        setState({ kind: 'verifying' });
        try {
          return settleFromList(await readBrands(), { kind: 'verified-empty' }, 'recovered');
        } catch {
          setState({ kind: 'verify-failed' });
          return null;
        }
      } finally {
        inFlightRef.current = false;
      }
    },
    [mutateAsync, readBrands, settleFromList],
  );

  const reset = useCallback(() => setState({ kind: 'idle' }), []);

  return { state, create, verify, reset };
}
