/**
 * 작업 상태 충돌(409) 알림 — 취소된 작업에 변경 요청을 보내면 서버가 409 를 준다(server PR #157 README 7.8 ④ · 현행 서버도 같음).
 *
 * 409 만으로 취소라고 판단하지 않는다. 이 모듈은 「상태를 다시 물어볼 이유가 생겼다」는 신호만 낸다. 받는 쪽
 * (lib/queries/pixlate.ts useJobCancellationRecheck)이 JOB-05 를 다시 조회해 `cancelled`·`archived` 일 때만 취소 안내로 바꾼다.
 * 각 화면의 기존 409 처리(REVISION_CONFLICT · ALL_SECTIONS_EXCLUDED · job_not_editable · acknowledgement_* 등)는 그대로 돈다 —
 * 이 신호는 오류를 가로채거나 바꾸지 않는다.
 *
 * 대상 코드(README 7.8 ④): `INVALID_STATE`(JOB-01 · ANL-01 · SEC-03 · SEC-04 · CFM-02 · CFM-04 · FIN-01 · FIN-06 · SRC-02~04 · FIN-04 ·
 * JOB-07) · `RETRY_NOT_ALLOWED`(JOB-06 · FIN-01). 그 밖의 409(REVISION_CONFLICT · ALL_SECTIONS_EXCLUDED · CONFLICT)는 신호를 내지 않는다.
 */

export const JOB_STATE_CONFLICT_CODES: readonly string[] = ['INVALID_STATE', 'RETRY_NOT_ALLOWED'];

/** 이 응답이 「작업 상태를 다시 확인할」 409 인가 */
export function isJobStateConflict(status: number, body: unknown): boolean {
  if (status !== 409 || !body || typeof body !== 'object') return false;
  const code = (body as { error?: { code?: unknown } }).error?.code;
  return typeof code === 'string' && JOB_STATE_CONFLICT_CODES.includes(code);
}

/**
 * 변경 요청 경로에서 작업 id 를 꺼낸다 — `/jobs/{jobId}/...` 아래의 GET 이 아닌 요청만. 작업 취소 자체(DELETE /jobs/{jobId})는 뺀다
 * (반복 취소는 200 이라 409 가 나지 않지만, 취소 요청을 상태 재확인 계기로 쓰지 않는다).
 */
export function jobIdFromMutationRequest(url: string, method: string | undefined): string | null {
  const upper = (method ?? 'GET').toUpperCase();
  if (upper === 'GET' || upper === 'HEAD') return null;
  const path = url.split('?')[0];
  const match = /^\/jobs\/([^/]+)(\/.*)?$/.exec(path);
  if (!match) return null;
  if (upper === 'DELETE' && !match[2]) return null;
  return decodeURIComponent(match[1]);
}

type Listener = (jobId: string) => void;
const listeners = new Set<Listener>();

export function subscribeJobStateConflict(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitJobStateConflict(jobId: string): void {
  for (const listener of [...listeners]) listener(jobId);
}

/**
 * 응답을 보고 해당하면 신호를 낸다. 본문은 clone 으로 따로 읽어 호출부의 오류 처리(본문 읽기)를 건드리지 않는다.
 * 결과를 기다리지 않는다 — 호출부 흐름에 끼어들지 않는다.
 */
export function reportJobStateConflict(url: string, method: string | undefined, res: Response): void {
  if (res.status !== 409) return;
  const jobId = jobIdFromMutationRequest(url, method);
  if (!jobId) return;
  void res
    .clone()
    .json()
    .then((body: unknown) => {
      if (isJobStateConflict(res.status, body)) emitJobStateConflict(jobId);
    })
    .catch(() => undefined);
}
