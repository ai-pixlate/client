import type { components } from '@/lib/api/generated/openapi';

/** Mock 전용 — 이 비밀번호로 로그인하면 401 을 돌려준다. 실제 계정 정보가 아니다 */
export const MOCK_LOGIN_REJECTED_PASSWORD = 'wrong-password';

export const mockLoginResponse: components['schemas']['LoginResponse'] = {
  accessToken: 'mock-access-token',
  seller: { id: 1, email: 'seller@example.com', accountType: 'business', createdAt: '2026-09-01T00:00:00Z' },
};

export const mockLoginRejected = {
  error: { code: 'UNAUTHORIZED', message: '이메일 또는 비밀번호가 올바르지 않습니다.', retryable: false, traceId: 'mock-trace-login' },
};
