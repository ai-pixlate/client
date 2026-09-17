/**
 * N6(저장/내보내기)에서 쓰는 OpenAPI generated 스키마만 골라 별칭을 붙인다.
 *
 * lib/api/n5-schema.ts와 같은 경계 원칙을 따른다 — N6 관련 코드는
 * lib/api/generated/openapi.d.ts를 직접 import하지 않고 이 파일의 별칭만
 * 참조한다.
 */

import type { components } from './generated/openapi';

/** POST /jobs/{jobId}/render 응답 (API-FIN-01) */
export type ApiRenderResponse = components['schemas']['RenderResponse'];

/** 화면에 표시할 결과 이미지 1건 (API-FIN-02, GET /jobs/{jobId}/deliverables) */
export type ApiDeliverable = components['schemas']['Deliverable'];

/** GET /jobs/{jobId}/deliverables 응답 */
export type ApiDeliverableList = components['schemas']['DeliverableList'];

/** DeliverableList.components[] 원소 — 산출물 구성요소(images/csv/html/psd) 상태 */
export type ApiDeliverableComponent = NonNullable<ApiDeliverableList['components']>[number];

/** GET /jobs/{jobId}/validation 응답 원소 (API-FIN-03) */
export type ApiValidationDetail = components['schemas']['ValidationDetail'];

/** POST /jobs/{jobId}/export 요청 (API-FIN-04) */
export type ApiExportRequest = components['schemas']['ExportRequest'];

/** POST /jobs/{jobId}/export 응답 */
export type ApiExportResponse = components['schemas']['ExportResponse'];

/** GET /jobs/{jobId}/exports/{artifactId}/download 응답 (API-FIN-05, presigned 5분) */
export type ApiDownloadResponse = components['schemas']['DownloadResponse'];

/** POST /jobs/{jobId}/save 요청 (API-FIN-06) */
export type ApiSaveRequest = components['schemas']['SaveRequest'];

/** POST /jobs/{jobId}/save 응답 — 보관함 카드 (job 투영, 테이블 아님) */
export type ApiLibraryCard = components['schemas']['LibraryCard'];
