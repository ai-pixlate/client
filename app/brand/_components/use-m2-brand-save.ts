'use client';

import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { ApiBrand, ApiBrandLogo } from '@/lib/api/brand-schema';
import { ApiRequestError, deleteBrandLogo, getBrandLogos, updateBrand, uploadBrandLogo } from '@/lib/api/pixlate';
import { planM2LogoChanges, reconcileM2AfterSave, toM2BrandFormValue, toM2BrandUpdate } from '@/lib/brand/m2-adapter';
import type { M2BrandFormValue } from '@/lib/brand/m2-form';
import { pixlateKeys } from '@/lib/queries/pixlate';

// ─────────────────────────────────────────────────────────────────
// M2 저장 — PATCH /brands/{brandId}(바뀐 항목만) → 로고 DELETE → 로고 POST → 로고 목록 다시 받기.
// 화면 정본은 서버 응답이다(PATCH 응답 Brand + 다시 받은 로고 목록). 저장 성공을 가정해 draft 로 덮지 않는다.
// - 브랜드 PATCH 가 실패하면 로고는 건드리지 않고 멈춘다 — draft 는 그대로 남는다.
// - 로고는 하나씩 보내고, 실패한 것만 draft 에 남긴다(실패한 삭제는 계속 빠진 채, 실패한 추가는 저장 전 로고로).
// - 저장 중에는 다시 저장하지 않는다(중복 요청 금지).
// ─────────────────────────────────────────────────────────────────

export type M2SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'success' }
  | { kind: 'error'; brandFailed: boolean; failedDeletes: number; failedUploads: number };

export interface M2SaveOutcome {
  complete: boolean;
  draft: M2BrandFormValue;
}

export function useM2BrandSave(brandId: number, brand: ApiBrand) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<M2SaveState>({ kind: 'idle' });
  const savingRef = useRef(false);

  const save = useCallback(
    async (baseline: M2BrandFormValue, draft: M2BrandFormValue): Promise<M2SaveOutcome | null> => {
      if (savingRef.current) return null;
      savingRef.current = true;
      setState({ kind: 'saving' });
      try {
        const patch = toM2BrandUpdate(baseline, draft);
        let savedBrand = brand;
        if (patch) {
          try {
            savedBrand = await updateBrand(brandId, patch);
          } catch {
            setState({ kind: 'error', brandFailed: true, failedDeletes: 0, failedUploads: 0 });
            return { complete: false, draft };
          }
          queryClient.setQueryData(pixlateKeys.brand(brandId), savedBrand);
        }

        const plan = planM2LogoChanges(baseline, draft);
        const failedDeletes: number[] = [];
        const deleted = new Set<number>();
        for (const logoId of plan.deletes) {
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
          try {
            created.push(await uploadBrandLogo(brandId, upload.file));
          } catch {
            failedUploadIds.push(upload.localId);
          }
        }

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
        return { complete: result.complete, draft: result.draft };
      } finally {
        savingRef.current = false;
      }
    },
    [brandId, brand, queryClient],
  );

  const reset = useCallback(() => setState({ kind: 'idle' }), []);

  return { state, save, reset };
}
