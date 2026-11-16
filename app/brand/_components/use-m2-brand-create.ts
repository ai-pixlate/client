'use client';

import { useCallback, useRef, useState } from 'react';

import type { ApiBrand } from '@/lib/api/brand-schema';
import { ApiRequestError } from '@/lib/api/pixlate';
import { toM2BrandCreate } from '@/lib/brand/m2-adapter';
import type { M2BrandFormValue } from '@/lib/brand/m2-form';
import { useCreateBrandMutation } from '@/lib/queries/pixlate';

// ─────────────────────────────────────────────────────────────────
// M2 신규 브랜드 등록 — POST /brands 1회. 로고는 본문에 없어서 등록이 성공해 brandId 를 받은 뒤에만
// 같은 저장 흐름(use-m2-brand-save.ts)으로 POST /brands/{brandId}/logos 를 보낸다.
// - 한 사용자 동작에 POST /brands 는 정확히 1회다. state 가 반영되기 전의 연속 클릭도 ref 로 막는다.
// - 자동 재시도하지 않는다. 409 · 400 · 500 · 네트워크 오류 모두 입력을 그대로 두고 등록 화면에 남는다.
// - 판매자당 브랜드 개수 같은 업무 규칙은 FE 가 만들지 않는다 — 409 는 서버 응답을 그대로 따른다.
// ─────────────────────────────────────────────────────────────────

export type M2CreateErrorReason = 'conflict' | 'validation' | 'failed';

export type M2CreateState = { kind: 'idle' } | { kind: 'creating' } | { kind: 'error'; reason: M2CreateErrorReason };

export function useM2BrandCreate() {
  const { mutateAsync } = useCreateBrandMutation();
  const [state, setState] = useState<M2CreateState>({ kind: 'idle' });
  const inFlightRef = useRef(false);

  /** 성공하면 등록된 브랜드(서버 응답 — id 가 정본), 실패·중복 호출이면 null */
  const create = useCallback(
    async (draft: M2BrandFormValue): Promise<{ brandId: number; brand: ApiBrand } | null> => {
      if (inFlightRef.current) return null;
      inFlightRef.current = true;
      setState({ kind: 'creating' });
      try {
        const created = await mutateAsync(toM2BrandCreate(draft));
        setState({ kind: 'idle' });
        return { brandId: created.id, brand: created };
      } catch (error) {
        const status = error instanceof ApiRequestError ? error.status : null;
        setState({ kind: 'error', reason: status === 409 ? 'conflict' : status === 400 ? 'validation' : 'failed' });
        return null;
      } finally {
        inFlightRef.current = false;
      }
    },
    [mutateAsync],
  );

  const reset = useCallback(() => setState({ kind: 'idle' }), []);

  return { state, create, reset };
}
