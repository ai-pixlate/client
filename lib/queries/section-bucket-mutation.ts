import type { MutationOptions, QueryClient, QueryKey } from '@tanstack/query-core';

import type { ApiSection, ApiSectionBucket, ApiSectionList, ApiSectionPatch } from '../api/n3-schema.ts';
import type { ApiReviewPreview } from '../api/n5-schema.ts';
import { AuthSessionChangedError } from '../auth/authorized-request.ts';
import { getAuthEpoch } from '../auth/session-store.ts';

export interface SectionBucketVariables {
  sectionId: number;
  bucket: ApiSectionBucket;
}

export interface SectionBucketContext {
  previous: ApiSectionList | undefined;
  /** 저장을 시작한 계정·세션 세대(lib/auth/session-store.ts epoch) */
  epoch: number;
}

export interface SectionBucketMutationDeps {
  queryClient: QueryClient;
  sectionsKey: QueryKey;
  previewKey: QueryKey;
  update: (sectionId: number, payload: ApiSectionPatch) => Promise<ApiSection>;
}

/**
 * 저장을 시작한 계정·세션이 지금도 그대로인가. 계정 전환·로그아웃·세션 종료 뒤에는 이전 계정 캐시가 이미 비워졌다
 * (lib/auth/runtime.ts clearClientData). 그 뒤 늦게 끝난 이전 계정 mutation 의 callback 이 캐시를 쓰면 이전 계정 데이터를
 * 되살리거나 새 계정 캐시를 덮고, 다시 들어왔을 때 서버 정본보다 이전 local 추측이 먼저 보인다.
 */
function isSameAuthSession(context: SectionBucketContext | undefined): context is SectionBucketContext {
  return context != null && context.epoch === getAuthEpoch();
}

/**
 * useUpdateSectionBucketMutation 의 옵션(lib/queries/pixlate.ts 설명 참고). React 없이 검증할 수 있게 분리했다.
 * 계정·세션이 바뀐 뒤에는 optimistic rollback·프리뷰 반영·invalidate 를 하지 않는다 — 요청 자체의 응답 폐기와
 * 새 토큰 재전송 금지는 공통 fetchWithSessionRecovery 가 맡는다(그 정책은 바꾸지 않는다).
 */
export function sectionBucketMutationOptions({
  queryClient,
  sectionsKey,
  previewKey,
  update,
}: SectionBucketMutationDeps): MutationOptions<ApiSection, Error, SectionBucketVariables, SectionBucketContext> {
  return {
    mutationFn: ({ sectionId, bucket }) => {
      const action: ApiSectionPatch['action'] = bucket === 'include' ? 'restore' : 'exclude';
      return update(sectionId, { action });
    },
    onMutate: async ({ sectionId, bucket }) => {
      const epoch = getAuthEpoch();
      await queryClient.cancelQueries({ queryKey: sectionsKey });
      // 기다리는 사이 계정·세션이 바뀌었으면 이전 계정 저장을 새 세션으로 보내지 않는다(onMutate 오류 → mutationFn 미실행)
      if (epoch !== getAuthEpoch()) throw new AuthSessionChangedError();
      const previous = queryClient.getQueryData<ApiSectionList>(sectionsKey);

      if (previous) {
        const exclude = previous.exclude ?? [];
        const include = previous.include ?? [];
        const moving = exclude.find((s) => s.id === sectionId) ?? include.find((s) => s.id === sectionId);

        if (moving) {
          const moved: ApiSection = { ...moving, bucket };
          const withoutMoving = { exclude: exclude.filter((s) => s.id !== sectionId), include: include.filter((s) => s.id !== sectionId) };
          queryClient.setQueryData<ApiSectionList>(
            sectionsKey,
            bucket === 'include'
              ? { exclude: withoutMoving.exclude, include: [...withoutMoving.include, moved] }
              : { exclude: [...withoutMoving.exclude, moved], include: withoutMoving.include },
          );
        }
      }

      return { previous, epoch };
    },
    onSuccess: (saved, _vars, context) => {
      if (!isSameAuthSession(context)) return;
      queryClient.setQueryData<ApiReviewPreview>(previewKey, (prev) =>
        prev?.sections
          ? {
              ...prev,
              sections: prev.sections.map((s) =>
                s.id === saved.id ? { ...s, bucket: saved.bucket ?? s.bucket, excludedStage: saved.excludedStage ?? null } : s,
              ),
            }
          : prev,
      );
    },
    onError: (_err, _vars, context) => {
      if (!isSameAuthSession(context)) return;
      if (context.previous) {
        queryClient.setQueryData(sectionsKey, context.previous);
      }
    },
    onSettled: (_data, _err, _vars, context) => {
      if (!isSameAuthSession(context)) return;
      queryClient.invalidateQueries({ queryKey: sectionsKey });
      queryClient.invalidateQueries({ queryKey: previewKey });
    },
  };
}
