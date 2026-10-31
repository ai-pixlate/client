/**
 * N1 [다음] 진행 조건 — 화면 필수값을 한 곳에서 판단한다.
 *
 * 서버 계약: JobCreate는 brandId만 필수이고, analyze(ANL-01) 게이트는 product_name NULL만 400으로 막는다.
 * 나머지는 PRD v3.5.10 N1 기준 화면 필수값이다 — 국가·도착어·규제 분류(F-LNG), 카테고리 leaf(F-SRC-04 ①),
 * OTC 의약품·복합의 OTC 종류(F-LNG-03 ⑦ — 화면 게이트일 뿐 서버로 보내지 않는다), 책임 동의(F-ACC-04),
 * 원본 이미지 1장 이상. 결과물 규격은 원본(specType 'original') 고정이라 항상 충족한다.
 * 상품코드·핵심 키워드는 선택값이라 여기서 보지 않는다. 규제 분류 'unknown'(잘모름)도 유효한 선택이다.
 *
 * React를 쓰지 않는 순수 함수라 scripts/verify-n1-category-tree.mjs가 그대로 import한다.
 */

import type { ApiRegulatoryClass } from '@/lib/api/job-schema';

export interface N1ReadinessInput {
  brandId: string;
  productName: string;
  targetCountry: string;
  targetLanguage: string;
  regulatoryClass: ApiRegulatoryClass | '';
  otcType: string | null;
  /** leaf로 확정한 category_master id. 트리 창이 leaf만 확정하게 한다 */
  categoryId: number | null;
  hasAcceptedResponsibility: boolean;
  imageCount: number;
}

export function requiresOtcType(regulatoryClass: ApiRegulatoryClass | ''): boolean {
  return regulatoryClass === 'otc' || regulatoryClass === 'combination';
}

export function isN1Ready(input: N1ReadinessInput): boolean {
  return (
    !!input.brandId &&
    input.productName.trim() !== '' &&
    !!input.targetCountry &&
    !!input.targetLanguage &&
    !!input.regulatoryClass &&
    (!requiresOtcType(input.regulatoryClass) || !!input.otcType) &&
    input.categoryId !== null &&
    input.hasAcceptedResponsibility &&
    input.imageCount > 0
  );
}
