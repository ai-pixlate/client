/**
 * 멱등 키(Idempotency-Key) — 블록·섹션 PATCH(blockPatch·sectionPatch 「저장 공통」)가 쓴다. 기록·재전송 규칙은 lib/api/idempotent-patch.ts.
 * POST /jobs 는 같은 규칙의 함수를 app/jobs/new/page.tsx 에 따로 두고 있다(이번 변경 범위 밖이라 옮기지 않았다).
 *
 * - 사용자 조작 한 번 = 새 키(UUID v4 · 공백 없는 ASCII 1~128자). 다른 조작에 같은 키를 다시 쓰지 않는다.
 * - 통신 결과를 알 수 없어 같은 조작을 다시 보낼 때만 같은 키 + 완전히 같은 본문을 쓴다.
 * - crypto.randomUUID 는 secure context(HTTPS·localhost)에서만 있다. 일반 HTTP 호스트·LAN IP 에서는 같은 CSPRNG 인
 *   crypto.getRandomValues 로 UUID v4 를 만든다(secure context 가 아니어도 있다). 둘 다 없으면 null —
 *   보호가 필요한 저장은 키 없이 조용히 보내지 않는다(호출부가 저장을 시작하지 않고 실패로 알린다). Math.random 으로 대신 만들지 않는다.
 */
export function createIdempotencyKey(): string | null {
  if (typeof crypto === 'undefined') return null;
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  if (typeof crypto.getRandomValues !== 'function') return null;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
