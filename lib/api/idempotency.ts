/**
 * 멱등 키(Idempotency-Key) — N5 블록 PATCH(blockPatch 「저장 공통」, 구현 완료·서버 배포 대기)의 배치 저장이 쓴다.
 * POST /jobs 는 같은 규칙의 함수를 app/jobs/new/page.tsx 에 따로 두고 있다(이번 변경 범위 밖이라 옮기지 않았다).
 *
 * - 사용자 조작 한 번 = 새 키(UUID v4 권장 · 공백 없는 ASCII 1~128자). 다른 조작에 같은 키를 다시 쓰지 않는다.
 * - 통신 결과를 알 수 없어 같은 조작을 다시 보낼 때만 같은 키 + 완전히 같은 본문을 쓴다(지금 N5 에는 자동 재전송이 없다).
 * - 선택 헤더라 만들 수 없으면 키 없이 보낸다. crypto.randomUUID 는 secure context(HTTPS·localhost)에서만 있다 —
 *   일반 HTTP 호스트·LAN IP 에서 그대로 부르면 저장 자체가 막힌다.
 */
export function createIdempotencyKey(): string | null {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : null;
}
