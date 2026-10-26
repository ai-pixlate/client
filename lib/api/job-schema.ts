/**
 * job 생애주기(N1~N6 공용)에서 쓰는 OpenAPI generated 스키마 별칭.
 *
 * N5(검수) 전용 스키마는 lib/api/n5-schema.ts를 그대로 쓴다 — 이 파일은
 * N2/N4(비동기 처리 polling)와 N3→N4(sections/proceed), N1→N2(analyze) 전환처럼
 * job 전체를 가로지르는 계약만 담는다. ApiJob/ApiJobTaskStatus/ApiJobAsyncTaskItem은
 * n5-schema.ts가 이미 별칭을 갖고 있어 중복 선언하지 않고 그대로 재노출한다
 * (같은 generated 타입을 가리키는 별칭이 두 파일에 따로 생기면 나중에 갈라질
 * 위험이 있다).
 */

import type { components } from './generated/openapi';

export type { ApiJob, ApiJobTaskStatus, ApiJobAsyncTaskItem } from './n5-schema';

/** N1~N6 화면 단계 (GET /jobs/{jobId}, GET /jobs/{jobId}/tasks 공용) */
export type ApiJobStep = components['schemas']['JobStep'];

/** 사용자 노출 상태 영문 8종 — 한글 매핑은 FE에서 한다(오늘 작업 범위 밖) */
export type ApiUserFacingStatus = components['schemas']['UserFacingStatus'];

/** DB job.status 6종 */
export type ApiJobStatus = components['schemas']['JobStatus'];

/** 비동기 트리거(analyze/sections proceed 등) 202 공용 응답 */
export type ApiAcceptedTask = components['schemas']['AcceptedTask'];

/** N1 입력값 세팅/수정 (PATCH /jobs/{jobId}, draft-first) */
export type ApiJobPatch = components['schemas']['JobPatch'];

/** N1 셀러 선택 규제 분류 (job.regulatory_class) */
export type ApiRegulatoryClass = components['schemas']['RegulatoryClass'];

/** 원본 업로드 결과 — 파일별 성공/실패 + 현재 원본 목록 (POST /jobs/{jobId}/source-images) */
export type ApiSourceImageUploadResult = components['schemas']['SourceImageUploadResult'];

/**
 * N2 분석 세부 진행 (JobTaskStatus.analysisProgress, 선택 속성). 정본은 server commit 315816e 의
 * docs/openapi.yaml 이다 — 게시된 Swagger 에 아직 없을 수 있어, generated 타입도 그 고정본에서
 * 만들었다(게시본으로 재생성하면 이 타입이 빠질 수 있으니 반영 여부를 먼저 확인한다).
 * 속성이 없으면 기존 progress·stages·items 로 표시한다. 퍼센트는 제공하지 않는다.
 */
export type ApiAnalysisProgress = components['schemas']['AnalysisProgress'];
