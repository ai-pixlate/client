/**
 * N5(검수)에서 쓰는 OpenAPI generated 스키마만 골라 별칭을 붙인다.
 *
 * lib/api/generated/openapi.d.ts(`npm run generate:openapi-types`로 생성, 직접 수정 금지)를
 * 직접 import하는 곳을 이 파일 하나로 좁힌다 — lib/api/types.ts(수기 타입) 전체를 한 번에
 * 갈아엎지 않고, N5가 실제로 쓰는 스키마부터 generated 계약으로 옮기기 위한 경계다.
 *
 * lib/n5/adapter.ts를 포함해 N5 관련 코드는 lib/api/generated/openapi.d.ts를 직접
 * import하지 않고 이 파일의 별칭만 참조한다.
 */

import type { components } from './generated/openapi';

export type ApiTextBlock = components['schemas']['TextBlock'];
export type ApiBbox = components['schemas']['Bbox'];
export type ApiAutoAdjust = components['schemas']['AutoAdjust'];
export type ApiBlockRole = components['schemas']['BlockRole'];
export type ApiBlockStatus = components['schemas']['BlockStatus'];
export type ApiSectionBucket = components['schemas']['SectionBucket'];
export type ApiExcludedStage = components['schemas']['ExcludedStage'];

export type ApiSignalCode = components['schemas']['SignalCode'];
export type ApiReviewSignal = components['schemas']['ReviewSignal'];

export type ApiReviewPreview = components['schemas']['ReviewPreview'];
/** ReviewPreview.sections는 스펙에서 별도 이름 없는 inline object라 인덱스 접근으로 뽑아낸다 */
export type ApiPreviewSection = NonNullable<ApiReviewPreview['sections']>[number];

export type ApiBlockPatch = components['schemas']['BlockPatch'];
export type ApiBlockPatchResponse = components['schemas']['BlockPatchResponse'];

export type ApiJobTaskStatus = components['schemas']['JobTaskStatus'];
export type ApiJobAsyncTaskItem = components['schemas']['JobAsyncTaskItem'];

/** GET /jobs/{jobId} 응답 — N5 헤더의 targetCountry/targetLanguage 출처 */
export type ApiJob = components['schemas']['Job'];

/** POST /jobs/{jobId}/confirm request body (API-CFM-04, N5→N6) */
export type ApiConfirmRequest = components['schemas']['ConfirmRequest'];

/** 전역 내장 Error 타입과 이름이 겹치므로 ApiErrorBody로 별칭한다 */
export type ApiErrorBody = components['schemas']['Error'];
