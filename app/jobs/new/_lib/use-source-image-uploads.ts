'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { apiErrorCode } from '@/lib/api/pixlate';
import type { ApiSourceImageUploadResult } from '@/lib/api/job-schema';
import type { ApiSourceImage } from '@/lib/api/n3-schema';
import {
  useDeleteSourceImageMutation,
  useReorderSourceImagesMutation,
  useUploadSourceImagesMutation,
} from '@/lib/queries/pixlate';

// ─────────────────────────────────────────────────────────────────
// N1 원본 이미지 업로드 상태·로직 (API-SRC-02/03/04)
//
// 시각 표현은 _components/source-image-upload-status.tsx가 맡는다 — 업로드 실패
// 상태의 Figma가 확정되면 그 컴포넌트만 교체하면 된다. 여기는 화면을 그리지 않는다.
//
// PRD F-SRC-01(업로드 실패 시 개별 재시도): 한 draft jobId에 실패한 파일만 다시
// 올린다. 성공한 파일(sourceImageId 보유)은 다시 보내지 않는다.
// ─────────────────────────────────────────────────────────────────

export type SourceImageUpload =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'done'; sourceImageId: number }
  | { status: 'failed'; errorCode: string | null };

export interface LocalImage {
  localId: string;
  file: File;
  /** 썸네일 미리보기용 objectURL — 제거/언마운트 시 revoke한다(메모리 누수 방지). */
  previewUrl: string;
  upload: SourceImageUpload;
  /** 업로드 완료 파일의 서버 DELETE 진행 중 */
  deleting: boolean;
}

/**
 * 한 요청 안의 fileName이 서로 겹치지 않게 순서를 유지한 채 나눈다.
 *
 * SourceImageUploadResult.results[]가 요청 files 순서와 대응한다는 보장이 OpenAPI에
 * 없다 — index로 짝지을 수 없고, 같은 파일명이 한 요청에 둘 이상 있으면 fileName으로도
 * 구분할 수 없다. 그래서 같은 이름은 별도 요청으로 보낸다(파일명이 전역에서 유일하다고
 * 가정하지 않는다). 요청을 순서대로 보내므로 서버 업로드 순서도 화면 순서를 따른다.
 */
export function splitUploadBatches<T extends { file: File }>(items: T[]): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let names = new Set<string>();
  for (const item of items) {
    if (names.has(item.file.name)) {
      batches.push(current);
      current = [];
      names = new Set();
    }
    current.push(item);
    names.add(item.file.name);
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

type UploadResultItem = NonNullable<ApiSourceImageUploadResult['results']>[number];

function toUploadState(result: UploadResultItem | undefined): SourceImageUpload {
  if (result?.ok && result.sourceImageId != null) return { status: 'done', sourceImageId: result.sourceImageId };
  return { status: 'failed', errorCode: result?.errorCode ?? null };
}

/**
 * results[] → 요청 파일 매핑. 파일 1개 요청은 결과도 1개라 그대로 짝짓는다. 여러 파일
 * 요청은 splitUploadBatches가 이름을 유일하게 만들어 두었으므로 fileName이 정확히 하나
 * 일치할 때만 짝짓고, 짝을 못 찾은 파일은 실패로 둔다(추측해서 다른 결과를 붙이지 않는다).
 */
export function matchUploadResults<T extends { localId: string; file: File }>(
  batch: T[],
  results: UploadResultItem[],
): Map<string, SourceImageUpload> {
  const matched = new Map<string, SourceImageUpload>();
  if (batch.length === 1 && results.length === 1) {
    matched.set(batch[0].localId, toUploadState(results[0]));
    return matched;
  }
  for (const item of batch) {
    const candidates = results.filter((r) => r.fileName === item.file.name);
    matched.set(item.localId, candidates.length === 1 ? toUploadState(candidates[0]) : { status: 'failed', errorCode: null });
  }
  return matched;
}

function serverOrderOf(sourceImages: ApiSourceImage[] | undefined): number[] | null {
  if (!sourceImages) return null;
  const ids = [...sourceImages]
    .sort((a, b) => (a.uploadOrder ?? 0) - (b.uploadOrder ?? 0))
    .map((img) => img.id);
  return ids.every((id): id is number => id != null) ? ids : null;
}

function sameOrder(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export function useSourceImageUploads() {
  const uploadMutation = useUploadSourceImagesMutation();
  const deleteMutation = useDeleteSourceImageMutation();
  const reorderMutation = useReorderSourceImagesMutation();

  const [images, setImagesState] = useState<LocalImage[]>([]);
  // 비동기 업로드 결과가 최신 목록(그 사이 추가·정렬·삭제 반영)에 적용되도록 ref를 정본으로
  // 두고 state는 렌더용 사본으로만 쓴다. ref는 이벤트·비동기 콜백에서만 쓴다(render 중 금지).
  const imagesRef = useRef<LocalImage[]>([]);
  const commit = useCallback((update: (prev: LocalImage[]) => LocalImage[]) => {
    imagesRef.current = update(imagesRef.current);
    setImagesState(imagesRef.current);
  }, []);

  // 서버가 마지막으로 알려준 원본 순서(sourceImageId). null이면 알 수 없음 — 최종 진행 전 reorder로 맞춘다.
  const serverOrderRef = useRef<number[] | null>([]);

  /** 업로드와 무관한 서버 요청 실패(삭제 등) 안내 */
  const [notice, setNotice] = useState<string | null>(null);

  const setUpload = useCallback(
    (localIds: string[], upload: SourceImageUpload) => {
      const ids = new Set(localIds);
      commit((prev) => prev.map((img) => (ids.has(img.localId) ? { ...img, upload } : img)));
    },
    [commit],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const stamp = Date.now();
      const newItems: LocalImage[] = files.map((file, i) => ({
        localId: `local_${stamp}_${i}`,
        file,
        previewUrl: URL.createObjectURL(file),
        upload: { status: 'idle' },
        deleting: false,
      }));
      commit((prev) => [...prev, ...newItems]);
    },
    [commit],
  );

  const reorderImages = useCallback(
    (fromLocalId: string, toLocalId: string) => {
      if (fromLocalId === toLocalId) return;
      commit((prev) => {
        const fromIdx = prev.findIndex((img) => img.localId === fromLocalId);
        const toIdx = prev.findIndex((img) => img.localId === toLocalId);
        if (fromIdx < 0 || toIdx < 0) return prev;
        const next = [...prev];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        return next;
      });
    },
    [commit],
  );

  const dropLocal = useCallback(
    (localId: string) => {
      commit((prev) => {
        const removed = prev.find((img) => img.localId === localId);
        if (removed) URL.revokeObjectURL(removed.previewUrl);
        return prev.filter((img) => img.localId !== localId);
      });
    },
    [commit],
  );

  /**
   * 삭제. 업로드 완료 파일은 서버 DELETE가 성공한 뒤에만 카드를 지운다(서버에 원본을
   * 남긴 채 로컬에서만 지우지 않는다). idle/failed는 서버 id가 없어 로컬에서만 지운다.
   * 업로드 중 파일은 삭제하지 않는다(호출부도 버튼을 비활성화한다).
   */
  const removeImage = useCallback(
    async (jobId: string | null, localId: string) => {
      const target = imagesRef.current.find((img) => img.localId === localId);
      if (!target || target.deleting || target.upload.status === 'uploading') return;
      if (target.upload.status !== 'done') {
        dropLocal(localId);
        return;
      }
      if (!jobId) return;
      const { sourceImageId } = target.upload;
      setNotice(null);
      commit((prev) => prev.map((img) => (img.localId === localId ? { ...img, deleting: true } : img)));
      try {
        await deleteMutation.mutateAsync({ jobId, sourceImageId });
        if (serverOrderRef.current) serverOrderRef.current = serverOrderRef.current.filter((id) => id !== sourceImageId);
        dropLocal(localId);
      } catch {
        commit((prev) => prev.map((img) => (img.localId === localId ? { ...img, deleting: false } : img)));
        setNotice(`${target.file.name} 파일을 삭제하지 못했습니다. 다시 시도해 주세요.`);
      }
    },
    [commit, deleteMutation, dropLocal],
  );

  const uploadItems = useCallback(
    async (jobId: string, items: LocalImage[]) => {
      for (const batch of splitUploadBatches(items)) {
        const localIds = batch.map((img) => img.localId);
        setUpload(localIds, { status: 'uploading' });
        try {
          const result = await uploadMutation.mutateAsync({ jobId, files: batch.map((img) => img.file) });
          const matched = matchUploadResults(batch, result.results ?? []);
          commit((prev) => prev.map((img) => (matched.has(img.localId) ? { ...img, upload: matched.get(img.localId)! } : img)));
          serverOrderRef.current = serverOrderOf(result.sourceImages);
        } catch (error) {
          // 요청 자체 실패(413/415/네트워크 등) — 이 요청에 실은 파일만 실패로 둔다.
          setUpload(localIds, { status: 'failed', errorCode: apiErrorCode(error) });
        }
      }
    },
    [commit, setUpload, uploadMutation],
  );

  /** 아직 올리지 않은(idle) 파일만 올린다. 반환값: 현재 모든 파일이 업로드 완료인지 */
  const uploadPending = useCallback(
    async (jobId: string): Promise<boolean> => {
      const pending = imagesRef.current.filter((img) => img.upload.status === 'idle');
      if (pending.length > 0) await uploadItems(jobId, pending);
      return imagesRef.current.length > 0 && imagesRef.current.every((img) => img.upload.status === 'done');
    },
    [uploadItems],
  );

  /** 실패 파일 하나만 같은 draft에 다시 올린다 */
  const retryImage = useCallback(
    async (jobId: string, localId: string) => {
      const target = imagesRef.current.find((img) => img.localId === localId);
      if (!target || target.upload.status !== 'failed') return;
      await uploadItems(jobId, [target]);
    },
    [uploadItems],
  );

  /** 최종 진행 직전 — 서버 순서가 화면 순서와 다르거나 알 수 없으면 reorder로 맞춘다 */
  const syncServerOrder = useCallback(
    async (jobId: string) => {
      const desired = imagesRef.current.flatMap((img) => (img.upload.status === 'done' ? [img.upload.sourceImageId] : []));
      if (serverOrderRef.current && sameOrder(serverOrderRef.current, desired)) return;
      const reordered = await reorderMutation.mutateAsync({ jobId, order: desired });
      serverOrderRef.current = serverOrderOf(reordered);
    },
    [reorderMutation],
  );

  // 언마운트 시 남은 미리보기 objectURL을 모두 해제한다.
  useEffect(() => {
    return () => {
      imagesRef.current.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    };
  }, []);

  const isBusy = images.some((img) => img.upload.status === 'uploading' || img.deleting);
  const hasFailed = images.some((img) => img.upload.status === 'failed');

  return {
    images,
    notice,
    isBusy,
    hasFailed,
    addFiles,
    reorderImages,
    removeImage,
    uploadPending,
    retryImage,
    syncServerOrder,
  };
}
