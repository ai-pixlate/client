import type { M2BrandFormValue } from '../brand/m2-form';

/**
 * M2 브랜드 정보 화면 확인용 Mock(Figma 743:6039의 값). 서버 데이터가 아니다.
 * M2 API를 연결할 수 있게 되면 이 값 대신 "API DTO → mapper → M2BrandFormValue"로 초기값을 채운다.
 * 로고 이미지는 Figma에서 내려받아 public/brand/mock/에 둔 정적 파일이다.
 */
export const M2_BRAND_MOCK: M2BrandFormValue = {
  nameKo: '픽슬레이트',
  nameEn: 'Pixlate',
  overview:
    '자연 유래 성분을 중심으로 민감성 피부를 위한 스킨케어 제품을 만드는 브랜드입니다.\n성분과 효능을 과장하지 않고 명확하고 차분한 언어를 사용합니다.',
  targetCustomer: '20–30대 · 성분을 꼼꼼히 확인하고 저자극 제품을 선호하는 사용자',
  logos: [
    { id: 'mock-logo-wordmark', name: '워드마크 로고', src: '/brand/mock/wordmark.png' },
    { id: 'mock-logo-symbol', name: '심볼 로고', src: '/brand/mock/symbol.png' },
  ],
};
