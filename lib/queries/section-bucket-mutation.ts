import type { MutationOptions, QueryClient, QueryKey } from '@tanstack/query-core';

import type { ApiSection, ApiSectionBucket, ApiSectionList, ApiSectionPatch } from '../api/n3-schema.ts';
import type { ApiReviewPreview } from '../api/n5-schema.ts';
import { IDEMPOTENT_PATCH_TIMEOUT_MS, type IdempotentPatchRequest } from '../api/idempotent-patch.ts';
import { AuthSessionChangedError } from '../auth/authorized-request.ts';
import { getAuthEpoch } from '../auth/session-store.ts';

/** 섹션 PATCH 본문 — { action, revision }. Idempotency-Key 를 보내므로 revision 은 필수다(sectionPatch 1. 형식) */
export type SectionPatchBody = ApiSectionPatch & { revision: number };

/**
 * 섹션 저장 한 번 = 요청 기록 하나(lib/api/idempotent-patch.ts createIdempotentPatchRequest — 대상 · 키 · 본문 · revision · 시작 시각).
 * 결과 불명 뒤 재전송은 같은 기록을 다시 넘긴다(새 키 · 새 revision 을 만들지 않는다).
 */
export interface SectionBucketVariables {
  request: IdempotentPatchRequest<SectionPatchBody>;
}

export interface SectionPatchResult {
  data: ApiSection;
  /** Idempotent-Replayed: true — 최초 요청의 응답 재생. 본문이 그때 값일 수 있어 캐시에 쓰지 않고 재조회로 맞춘다 */
  replayed: boolean;
}

/** action → 옮겨 갈 bucket(restore = include, exclude = exclude) */
export function bucketOfSectionAction(action: ApiSectionPatch['action']): ApiSectionBucket {
  return action === 'restore' ? 'include' : 'exclude';
}

/** bucket → action. 섹션 저장 본문을 만드는 곳(N3 · N5)이 같이 쓴다 */
export function sectionActionOf(bucket: ApiSectionBucket): ApiSectionPatch['action'] {
  return bucket === 'include' ? 'restore' : 'exclude';
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
  update: (sectionId: number, payload: SectionPatchBody, options: { idempotencyKey: string; timeoutMs: number }) => Promise<SectionPatchResult>;
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
}: SectionBucketMutationDeps): MutationOptions<SectionPatchResult, Error, SectionBucketVariables, SectionBucketContext> {
  return {
    // 기록의 대상 · 키 · 본문을 그대로 보낸다 — 재전송도 같은 값이다
    mutationFn: ({ request }) => update(request.targetId, request.body, { idempotencyKey: request.key, timeoutMs: IDEMPOTENT_PATCH_TIMEOUT_MS }),
    onMutate: async ({ request }) => {
      const sectionId = request.targetId;
      const bucket = bucketOfSectionAction(request.body.action);
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
    onSuccess: ({ data: saved, replayed }, _vars, context) => {
      if (!isSameAuthSession(context)) return;
      // 재생 응답은 최초 요청 때 값이다 — 프리뷰에 쓰지 않는다(onSettled 재조회가 현재 상태를 가져온다)
      if (replayed) return;
      // N3 목록도 서버가 준 revision 으로 — 재조회가 끝나기 전에 다음 섹션 저장을 시작해도 오래된 revision 을 보내지 않는다
      if (saved.revision != null) {
        const withRevision = (list: ApiSection[] | undefined) => list?.map((s) => (s.id === saved.id ? { ...s, revision: saved.revision } : s));
        queryClient.setQueryData<ApiSectionList>(sectionsKey, (prev) =>
          prev ? { ...prev, include: withRevision(prev.include), exclude: withRevision(prev.exclude) } : prev,
        );
      }
      queryClient.setQueryData<ApiReviewPreview>(previewKey, (prev) =>
        prev?.sections
          ? {
              ...prev,
              sections: prev.sections.map((s) =>
                s.id === saved.id
                  ? // 다음 섹션 저장(되돌리기 등)이 재조회 전에도 서버가 준 revision 을 쓰게 함께 반영한다
                    { ...s, bucket: saved.bucket ?? s.bucket, excludedStage: saved.excludedStage ?? null, revision: saved.revision ?? s.revision }
                  : s,
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
