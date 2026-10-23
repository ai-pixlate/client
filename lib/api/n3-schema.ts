/**
 * N3(섹션 확인)에서 쓰는 OpenAPI generated 스키마 별칭.
 *
 * lib/api/job-schema.ts / n5-schema.ts와 같은 경계 원칙 — N3도 이제 손작성
 * DTO 대신 이 파일의 generated 별칭을 실제 API 계약 기준으로 삼는다.
 *
 * lib/api/types.ts의 기존 Section/SectionVerdict/SectionsResponse/
 * UpdateSectionBucketRequest는 아직 지우지 않았다 — N3 UI(n3-view.tsx 등)와
 * section-card.tsx(perf harness 전용, n3-harness-view.tsx가 사용)가 여전히
 * 그 손작성 shape을 참조한다. 이번 단계는 API 계약 정합화만이 목적이라
 * lib/n3/adapter.ts가 이 파일의 실제 타입과 그 손작성 legacy shape 사이를
 * 임시로 이어준다 — UI가 실제 계약을 직접 쓰도록 옮겨가면 legacy 타입과
 * adapter를 함께 제거한다.
 */
import type { components } from './generated/openapi';

export type ApiBbox = components['schemas']['Bbox'];
export type ApiSectionBucket = components['schemas']['SectionBucket'];
export type ApiExclusionReason = components['schemas']['ExclusionReason'];
export type ApiExcludedStage = components['schemas']['ExcludedStage'];
export type ApiInpaintStatus = components['schemas']['InpaintStatus'];
export type ApiWarningBadge = components['schemas']['WarningBadge'];
export type ApiVerdictStatus = components['schemas']['VerdictStatus'];
export type ApiVerdictType = components['schemas']['VerdictType'];
export type ApiReviewSignal = components['schemas']['ReviewSignal'];
export type ApiSectionVerdict = components['schemas']['SectionVerdict'];
export type ApiSection = components['schemas']['Section'];
export type ApiSectionList = components['schemas']['SectionList'];
export type ApiSectionPatch = components['schemas']['SectionPatch'];
export type ApiInpaintResult = components['schemas']['InpaintResult'];
export type ApiSourceImage = components['schemas']['SourceImage'];
export type ApiSourceImageType = components['schemas']['SourceImageType'];
