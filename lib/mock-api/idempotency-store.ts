/**
 * Mock 전용 — 블록 · 섹션 PATCH 멱등 기록(OpenAPI 「저장 공통」 흉내). 실서버 동작을 보증하지 않는다.
 *
 * - 키 범위: (오퍼레이션, 작업, 키). 같은 요청 = 같은 대상 ID + 정규화한 본문(키 순서 무관)
 * - 같은 키 · 같은 요청 → 최초 2xx 응답 재생 / 같은 키 · 다른 요청 → 409 DUPLICATE
 * - 2xx 응답만 기록한다(4xx · 5xx 는 기록하지 않아 같은 키로 다시 보내면 그때 상태로 다시 판정)
 */

export interface MockIdempotentRecord {
  fingerprint: string;
  status: number;
  body: unknown;
}

export type MockIdempotencyLookup = { kind: 'miss' } | { kind: 'replay'; record: MockIdempotentRecord } | { kind: 'duplicate' };

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

export function mockRequestFingerprint(targetId: number, body: unknown): string {
  return `${targetId}:${canonical(body)}`;
}

export function createMockIdempotencyStore() {
  const records = new Map<string, MockIdempotentRecord>();
  const scope = (operation: string, jobId: string, key: string) => `${operation}\u0000${jobId}\u0000${key}`;
  return {
    lookup(operation: string, jobId: string, key: string, fingerprint: string): MockIdempotencyLookup {
      const record = records.get(scope(operation, jobId, key));
      if (!record) return { kind: 'miss' };
      return record.fingerprint === fingerprint ? { kind: 'replay', record } : { kind: 'duplicate' };
    },
    save(operation: string, jobId: string, key: string, record: MockIdempotentRecord) {
      if (record.status < 200 || record.status >= 300) return;
      records.set(scope(operation, jobId, key), record);
    },
    clear() {
      records.clear();
    },
  };
}
