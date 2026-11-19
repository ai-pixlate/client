import type { ApiBrand, ApiBrandLogo } from '../api/brand-schema';

/**
 * M2 브랜드 정보 Mock — 실제 Brand API 응답 모양(Brand · BrandLogo). 값은 Figma 743:6039 화면 값이고 서버 데이터가 아니다.
 * 화면은 Mock·실서버 모두 같은 API → Adapter(lib/brand/m2-adapter.ts)를 탄다.
 * 로고 이미지는 Figma에서 내려받아 public/brand/mock/에 둔 정적 파일이다(실서버는 presigned URL).
 */
export const M2_MOCK_BRAND_ID = 101;

export const M2_MOCK_BRAND: ApiBrand = {
  id: M2_MOCK_BRAND_ID,
  nameKo: '픽슬레이트',
  nameEn: 'Pixlate',
  overview:
    '자연 유래 성분을 중심으로 민감성 피부를 위한 스킨케어 제품을 만드는 브랜드입니다.\n성분과 효능을 과장하지 않고 명확하고 차분한 언어를 사용합니다.',
  targetCustomer: '20–30대 · 성분을 꼼꼼히 확인하고 저자극 제품을 선호하는 사용자',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};

/** order_no ASC */
export const M2_MOCK_LOGOS: ApiBrandLogo[] = [
  { id: 9001, format: 'png', orderNo: 1, logoUrl: '/brand/mock/wordmark.png' },
  { id: 9002, format: 'png', orderNo: 2, logoUrl: '/brand/mock/symbol.png' },
];
