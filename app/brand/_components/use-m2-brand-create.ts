'use client';

import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { ApiBrand } from '@/lib/api/brand-schema';
import { ApiRequestError, getBrands } from '@/lib/api/pixlate';
import { findCreatedBrand, findDuplicateBrand, toM2BrandCreate, type BrandNameField } from '@/lib/brand/m2-adapter';
import type { M2BrandFormValue } from '@/lib/brand/m2-form';
import { pixlateKeys, useCreateBrandMutation } from '@/lib/queries/pixlate';

// ─────────────────────────────────────────────────────────────────
// M2 신규 브랜드 등록 — POST /brands 1회. 로고는 본문에 없어서 등록이 성공해 brandId 를 받은 뒤에만
// 같은 저장 흐름(use-m2-brand-save.ts)으로 POST /brands/{brandId}/logos 를 보낸다.
//
// 셀러 1:N(요구사항 v3.6.4 F-ACC-02 · PL-06): 브랜드가 이미 있어도 새로 등록한다. 서버(develop) POST /brands 도 개수 제한이 없다.
// - 한 사용자 동작에 POST /brands 는 최대 1회다. state 가 반영되기 전의 연속 클릭도 ref 로 막는다.
// - POST 직전 GET /brands 로 같은 이름(정규화 비교 — lib/brand/m2-adapter findDuplicateBrand, 수정과 같은 함수)이 있는지 확인한다(F-ACC-02a).
//   있으면 등록하지 않고 입력을 그대로 두며, 그 기존 브랜드로 가는 길을 보인다. 기존 브랜드에 덮어쓰거나 연결하지 않는다.
//   FE 사전 확인은 동시 탭·동시 요청을 막지 못한다 — 최종 보장은 서버 409 다(받으면 conflict 로 그대로 따른다).
// - 자동 재시도하지 않는다. 409 · 400 · 500 은 서버가 거절한 것이라 「등록 실패」로 보고, 입력을 그대로 두고 등록 화면에 남는다.
// - 네트워크 오류(응답 유실 포함)는 서버에서 실제로 실패했는지 알 수 없다 — POST 를 다시 보내지 않고 GET /brands 로 확인한다.
//   같은 이름의 새 브랜드가 보여도 이번 요청이 만든 것이라고 단정하지 않는다(다른 탭의 같은 이름 등록일 수 있고, 계약에 요청 식별이 없다).
//   그 브랜드에 로고·정보를 이어 저장하지 않고 「결과 미확인 + 후보 브랜드 확인하기」만 보인다. 후보가 없으면 다시 등록할 수 있다.
//   확인 조회도 실패하면 [다시 확인](목록 재조회만)을 보인다.
// ─────────────────────────────────────────────────────────────────

export type M2CreateErrorReason = 'conflict' | 'validation' | 'failed';

/** 안내에 쓰는 브랜드 — 이동 경로(/brand?brandId=)와 이름 */
export interface M2BrandRef {
  brandId: number;
  name: string;
}

export type M2CreateState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'error'; reason: M2CreateErrorReason }
  /** 등록 직전 확인에서 같은 이름의 브랜드가 있었다 — 등록하지 않았다(F-ACC-02a) */
  | { kind: 'duplicate'; existing: M2BrandRef; field: BrandNameField }
  /** 결과 불명(네트워크 오류·응답 유실) — 목록을 다시 확인하는 중 */
  | { kind: 'verifying' }
  /** 결과 불명 + 목록 확인도 실패 — [다시 확인]만 할 수 있다(POST 금지) */
  | { kind: 'verify-failed' }
  /** 결과 확인 조회는 성공했지만 같은 이름의 새 브랜드가 없다 — 사용자가 다시 등록을 고를 수 있다(자동 재시도 없음) */
  | { kind: 'verified-empty' }
  /**
   * 결과 확인 조회에 같은 이름의 새 브랜드가 있다 — 이번 요청이 만든 것인지 확인할 수 없다. 로고·정보를 이어 저장하지 않았다.
   * candidate=null 이면 후보가 여러 개다(브랜드 선택 화면으로 안내)
   */
  | { kind: 'unconfirmed'; candidate: M2BrandRef | null }
  /** POST 직전 목록 확인이 실패했다 — 등록하지 않았다 */
  | { kind: 'precheck-failed' };

/** 등록 결과 — 이번 POST 응답으로 확정된 브랜드만 돌려준다. 그 밖(실패·중복·결과 미확인)은 null */
export type M2CreateOutcome = { source: 'created'; brandId: number; brand: ApiBrand } | null;

/** 결과를 확인할 수 없는 오류인지 — 서버가 응답한 오류(ApiRequestError)가 아닌 fetch 실패(네트워크·응답 유실) */
function isUnknownOutcome(error: unknown): boolean {
  return !(error instanceof ApiRequestError);
}

export function toBrandRef(brand: ApiBrand & { id: number }): M2BrandRef {
  return { brandId: brand.id, name: brand.nameKo?.trim() || brand.nameEn?.trim() || `브랜드 ${brand.id}` };
}

export function useM2BrandCreate() {
  const queryClient = useQueryClient();
  const { mutateAsync } = useCreateBrandMutation();
  const [state, setState] = useState<M2CreateState>({ kind: 'idle' });
  const inFlightRef = useRef(false);
  /** 결과 확인 기준 — 마지막으로 POST 한 입력과 그 직전 목록의 브랜드 id */
  const pendingRef = useRef<{ before: number[]; draft: Pick<M2BrandFormValue, 'nameKo' | 'nameEn'> } | null>(null);

  /** GET /brands 를 새로 받는다(캐시가 아니라 서버 값). 실패하면 바로 throw — 다시 확인은 사용자가 [다시 확인]으로 한다 */
  const readBrands = useCallback(
    () => queryClient.fetchQuery({ queryKey: pixlateKeys.brands(), queryFn: getBrands, staleTime: 0, retry: false }),
    [queryClient],
  );

  /** 결과 확인 목록 → 다음 상태. 어떤 경우에도 브랜드를 「이번 등록 결과」로 확정하지 않는다 */
  const settleFromList = useCallback((brands: ApiBrand[]) => {
    const pending = pendingRef.current;
    const found = pending ? findCreatedBrand(pending.before, brands, pending.draft) : ({ kind: 'none' } as const);
    if (found.kind === 'none') setState({ kind: 'verified-empty' });
    else setState({ kind: 'unconfirmed', candidate: found.kind === 'candidate' ? toBrandRef(found.brand) : null });
  }, []);

  /** 결과 확인 — 목록 재조회만 한다. 절대 POST 하지 않는다 */
  const verify = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setState({ kind: 'verifying' });
    try {
      settleFromList(await readBrands());
    } catch {
      setState({ kind: 'verify-failed' });
    } finally {
      inFlightRef.current = false;
    }
  }, [readBrands, settleFromList]);

  /** 등록 — POST 직전 목록 확인(중복) → POST /brands 1회 → 응답 유실이면 결과 확인 */
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
        const duplicate = findDuplicateBrand(current, draft);
        if (duplicate) {
          setState({ kind: 'duplicate', existing: toBrandRef(duplicate.brand), field: duplicate.field });
          return null;
        }
        pendingRef.current = {
          before: current.flatMap((brand) => (typeof brand.id === 'number' ? [brand.id] : [])),
          draft: { nameKo: draft.nameKo, nameEn: draft.nameEn },
        };

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
        // 결과 불명 — 다시 POST 하지 않고 목록으로 확인한다(어느 결과든 이어 저장하지 않는다)
        setState({ kind: 'verifying' });
        try {
          settleFromList(await readBrands());
        } catch {
          setState({ kind: 'verify-failed' });
        }
        return null;
      } finally {
        inFlightRef.current = false;
      }
    },
    [mutateAsync, readBrands, settleFromList],
  );

  const reset = useCallback(() => setState({ kind: 'idle' }), []);

  return { state, create, verify, reset };
}
