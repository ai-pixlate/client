/**
 * 인증 계층 타입. 서버 Seller(OpenAPI)는 id 가 선택 필드로 생성돼 있어, 계정 비교에 쓰는 id 를 필수로 좁힌 FE 모델을 둔다.
 * email 은 소셜 계정에서 null 일 수 있다(OpenAPI Seller.email — FE 11-09 회신).
 */
export interface AuthSeller {
  id: number;
  email: string | null;
  accountType?: 'individual' | 'business';
  createdAt?: string;
}

/** 인증 API 실패 정보. reason 은 Error.details.reason(없으면 null). status 0 = 네트워크 실패 */
export interface AuthErrorInfo {
  status: number;
  code: string | null;
  reason: string | null;
}

export type AuthApiResult<T> = { ok: true; data: T } | { ok: false; error: AuthErrorInfo };
