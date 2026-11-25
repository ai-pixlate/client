/**
 * 작업 상태 호환 계층 — 배포된 서버(OpenAPI 3.5.10)와 server PR #157(README 7.8 · 미배포) 응답을 함께 받는다.
 *
 * generated 타입(lib/api/generated/openapi.d.ts)은 배포본 그대로 둔다. PR #157 은 아직 배포되지 않았고 그 명세로 다시 만들면
 * 이 작업과 무관한 차이가 함께 들어오므로, 새 값은 여기서만 넓혀 받는다(배포 뒤 generated 를 다시 만들면 이 별칭을 줄인다).
 *
 * 필드 3개는 서로 다른 값이다(README 7.8 ①).
 * - status(Job) · jobStatus(JOB-05): `draft · processing · review · done · failed` + 취소(`archived` 구 서버 · `cancelled` 새 서버).
 *   `processing` 은 이 필드의 값이다.
 * - currentStep: N1~N6 — 화면 선택은 이 값만 본다(이 파일은 화면을 고르지 않는다).
 * - userFacingStatus: 구 서버 8종 + 새 값 `rendering`(최종 렌더 중) · `awaiting_save`(저장 대기) · `cancelled`.
 *   `rendering` 은 이 필드의 값이다. 구 서버는 N6 렌더 중 · 저장 대기를 모두 `reviewing` 으로 준다.
 */

import type { ApiJobStatus, ApiUserFacingStatus } from './job-schema';

/** status · jobStatus — 배포본 6종에 새 서버의 `cancelled` 를 더한다 */
export type JobStatusCompat = ApiJobStatus | 'cancelled';

/** userFacingStatus — 배포본 8종에 새 서버 값 3종을 더한다 */
export type UserFacingStatusCompat = ApiUserFacingStatus | 'rendering' | 'awaiting_save' | 'cancelled';

/** 취소된 작업 — 구 서버 `archived` · 새 서버 `cancelled` 둘 다 같은 뜻이다(이름만 바뀜) */
const CANCELLED_VALUES: readonly string[] = ['archived', 'cancelled'];

/** 상태를 실은 응답 — JOB-05(/tasks)는 jobStatus, JOB-03(/jobs/{id})은 status 를 쓴다 */
type JobStatusCarrier = { jobStatus?: string | null; status?: string | null; userFacingStatus?: string | null } | null | undefined;

export function isCancelledStatusValue(value: string | null | undefined): boolean {
  return value != null && CANCELLED_VALUES.includes(value);
}

/**
 * 서버 응답이 취소된 작업을 말하는가. jobStatus/status 와 userFacingStatus 중 어느 하나라도 취소 값이면 취소다
 * (서버는 둘을 함께 바꾼다 — 한쪽만 와도 취소를 놓치지 않는다). 응답이 없으면 false — 취소로 추정하지 않는다.
 */
export function isCancelledJob(data: JobStatusCarrier): boolean {
  if (!data) return false;
  return isCancelledStatusValue(data.jobStatus) || isCancelledStatusValue(data.status) || isCancelledStatusValue(data.userFacingStatus);
}

/** status · jobStatus 를 넓힌 타입으로 읽는다(새 값 비교를 타입 오류 없이 하기 위함) */
export function jobStatusOf(data: { jobStatus?: string | null } | null | undefined): JobStatusCompat | undefined {
  return (data?.jobStatus ?? undefined) as JobStatusCompat | undefined;
}

export function userFacingStatusOf(data: { userFacingStatus?: string | null } | null | undefined): UserFacingStatusCompat | undefined {
  return (data?.userFacingStatus ?? undefined) as UserFacingStatusCompat | undefined;
}
