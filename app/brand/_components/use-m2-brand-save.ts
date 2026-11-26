'use client';

import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { ApiBrand, ApiBrandLogo } from '@/lib/api/brand-schema';
import { ApiRequestError, deleteBrandLogo, getBrandLogos, getBrands, updateBrand, uploadBrandLogo } from '@/lib/api/pixlate';
import { getAuthEpoch } from '@/lib/auth/session-store';
import { findDuplicateBrand, planM2LogoChanges, reconcileM2AfterSave, toM2BrandFormValue, toM2BrandUpdate } from '@/lib/brand/m2-adapter';
import type { M2BrandFormValue } from '@/lib/brand/m2-form';
import { pixlateKeys } from '@/lib/queries/pixlate';

import { toBrandRef, type M2BrandRef } from './use-m2-brand-create';

// ─────────────────────────────────────────────────────────────────
// M2 저장 — PATCH /brands/{brandId}(바뀐 항목만) → 로고 DELETE → 로고 POST → 로고 목록 다시 받기.
// 화면 정본은 서버 응답이다(PATCH 응답 Brand + 다시 받은 로고 목록). 저장 성공을 가정해 draft 로 덮지 않는다.
// - 브랜드 PATCH 가 실패하면 로고는 건드리지 않고 멈춘다 — draft 는 그대로 남는다.
// - 이름(한글명·영문명)을 바꾸면 PATCH 전에 GET /brands 로 같은 셀러 안 중복을 확인한다(F-ACC-02a — 등록과 같은 findDuplicateBrand,
//   자기 자신은 제외). 중복이면 PATCH·로고 저장을 하지 않고 그 기존 브랜드로 가는 길을 보인다. 목록을 받지 못하면 이름을 확인할 수 없어 저장하지 않는다.
//   FE 사전 확인은 동시 수정을 막지 못한다 — 서버 409 를 받으면 duplicate 와 같은 「겹침」으로 안내한다.
// - 로고는 하나씩 보내고, 실패한 것만 draft 에 남긴다(실패한 삭제는 계속 빠진 채, 실패한 추가는 저장 전 로고로).
// - 저장 중에는 다시 저장하지 않는다(중복 요청 금지).
// - 신규 등록(use-m2-brand-create.ts)은 POST /brands 성공 뒤 같은 save 를 등록된 brandId 로 불러 로고만 올린다.
// - 저장 도중 계정·세션이 바뀌면(다른 탭 로그인·로그아웃) 그 자리에서 멈춘다 — 이전 계정 응답을 cache 에 쓰지 않고, 다음 요청을
//   새 세션으로 보내지 않고, 실패 안내도 띄우지 않는다(null). TanStack mutation 이 아니라 lib/auth/mutation-epoch.ts 를 타지 않는다.
// ─────────────────────────────────────────────────────────────────

/** 브랜드 정보 저장이 멈춘 이유 — duplicate: FE 사전 확인 · conflict: 서버 409 · precheck-failed: 중복 확인용 목록 조회 실패 · failed: 그 밖 */
export type M2BrandFailReason = 'duplicate' | 'conflict' | 'precheck-failed' | 'failed';

export type M2SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'success' }
  | {
      kind: 'error';
      brandFailed: boolean;
      failedDeletes: number;
      failedUploads: number;
      reason?: M2BrandFailReason;
      /** duplicate 일 때 겹친 기존 브랜드 */
      existing?: M2BrandRef;
    };

export interface M2SaveOutcome {
  complete: boolean;
  draft: M2BrandFormValue;
  /** 저장 뒤 서버 값(브랜드 + 로고 목록) — 다음 저장의 비교 기준 */
  baseline: M2BrandFormValue;
}

/** 저장 대상 브랜드. 신규 등록 직후처럼 hook 을 만들 때 아직 없던 브랜드는 save 호출 때 넘긴다 */
export interface M2SaveTarget {
  brandId: number;
  brand: ApiBrand;
}

export function useM2BrandSave(initialTarget: M2SaveTarget | null) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<M2SaveState>({ kind: 'idle' });
  const savingRef = useRef(false);

  const save = useCallback(
    async (baseline: M2BrandFormValue, draft: M2BrandFormValue, targetOverride?: M2SaveTarget): Promise<M2SaveOutcome | null> => {
      const target = targetOverride ?? initialTarget;
      if (!target || savingRef.current) return null;
      const { brandId, brand } = target;
      savingRef.current = true;
      setState({ kind: 'saving' });
      const epoch = getAuthEpoch();
      const sessionChanged = () => getAuthEpoch() !== epoch;
      try {
        const patch = toM2BrandUpdate(baseline, draft);
        let savedBrand = brand;
        const stopBrand = (reason: M2BrandFailReason, existing?: M2BrandRef) => {
          setState({ kind: 'error', brandFailed: true, failedDeletes: 0, failedUploads: 0, reason, existing });
          return { complete: false, draft, baseline };
        };
        if (patch && ('nameKo' in patch || 'nameEn' in patch)) {
          let current: ApiBrand[];
          try {
            current = await queryClient.fetchQuery({ queryKey: pixlateKeys.brands(), queryFn: getBrands, staleTime: 0, retry: false });
          } catch {
            if (sessionChanged()) return null;
            return stopBrand('precheck-failed');
          }
          if (sessionChanged()) return null;
          const duplicate = findDuplicateBrand(current, draft, { excludeBrandId: brandId });
          if (duplicate) return stopBrand('duplicate', toBrandRef(duplicate.brand));
        }
        if (patch) {
          try {
            savedBrand = await updateBrand(brandId, patch);
          } catch (error) {
            if (sessionChanged()) return null;
            return stopBrand(error instanceof ApiRequestError && error.status === 409 ? 'conflict' : 'failed');
          }
          if (sessionChanged()) return null;
          queryClient.setQueryData(pixlateKeys.brand(brandId), savedBrand);
        }

        const plan = planM2LogoChanges(baseline, draft);
        const failedDeletes: number[] = [];
        const deleted = new Set<number>();
        for (const logoId of plan.deletes) {
          if (sessionChanged()) return null;
          try {
            await deleteBrandLogo(brandId, logoId);
            deleted.add(logoId);
          } catch (error) {
            // 이미 없는 로고(404)는 지우려던 결과와 같다
            if (error instanceof ApiRequestError && error.status === 404) deleted.add(logoId);
            else failedDeletes.push(logoId);
          }
        }
        const failedUploadIds: string[] = [];
        const created: ApiBrandLogo[] = [];
        for (const upload of plan.uploads) {
          if (sessionChanged()) return null;
          try {
            created.push(await uploadBrandLogo(brandId, upload.file));
          } catch {
            failedUploadIds.push(upload.localId);
          }
        }

        if (sessionChanged()) return null;
        let logos: ApiBrandLogo[];
        const logoChanged = deleted.size > 0 || created.length > 0;
        const cachedLogos = queryClient.getQueryData<ApiBrandLogo[]>(pixlateKeys.brandLogos(brandId)) ?? [];
        if (!logoChanged) {
          logos = cachedLogos;
        } else {
          try {
            logos = await getBrandLogos(brandId);
          } catch {
            // 다시 받기만 실패했다 — 받은 응답(삭제 성공·생성 응답)으로 맞추고, 순서·URL 은 다음 조회에서 서버 값으로 바뀐다
            logos = [...cachedLogos.filter((logo) => logo.id == null || !deleted.has(logo.id)), ...created];
            void queryClient.invalidateQueries({ queryKey: pixlateKeys.brandLogos(brandId) });
          }
          if (sessionChanged()) return null;
          queryClient.setQueryData(pixlateKeys.brandLogos(brandId), logos);
        }

        const result = reconcileM2AfterSave({
          server: toM2BrandFormValue(savedBrand, logos),
          draft,
          brandSaved: true,
          failedDeletes,
          failedUploadIds,
        });
        setState(
          result.complete
            ? { kind: 'success' }
            : { kind: 'error', brandFailed: false, failedDeletes: failedDeletes.length, failedUploads: failedUploadIds.length },
        );
        return { complete: result.complete, draft: result.draft, baseline: result.baseline };
      } finally {
        savingRef.current = false;
      }
    },
    [initialTarget, queryClient],
  );

  const reset = useCallback(() => setState({ kind: 'idle' }), []);

  return { state, save, reset };
}
