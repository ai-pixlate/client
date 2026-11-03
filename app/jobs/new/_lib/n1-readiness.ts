/**
 * N1 [다음] 진행 조건 — 화면 필수값을 한 곳에서 판단한다.
 *
 * 서버 계약: JobCreate는 brandId만 필수이고, analyze(ANL-01) 게이트는 product_name NULL만 400으로 막는다.
 * 나머지는 PRD v3.5.10 N1 기준 화면 필수값이다 — 국가·도착어·규제 분류(F-LNG), 카테고리 leaf(F-SRC-04 ①),
 * OTC 의약품·복합의 OTC 종류(F-LNG-03 ⑦ — 화면 게이트일 뿐 서버로 보내지 않는다), 책임 동의(F-ACC-04),
 * 원본 이미지 1장 이상. 서버가 specType 'original'만 받으므로 사이즈 선택이 원본 유지일 때만 진행한다
 * (사이즈 변경을 고른 채 몰래 original로 보내지 않는다).
 * 상품코드·핵심 키워드는 선택값이라 여기서 보지 않는다. 규제 분류 'unknown'(잘모름)도 유효한 선택이다.
 *
 * React를 쓰지 않는 순수 함수라 scripts/verify-n1-category-tree.mjs가 그대로 import한다.
 */

import type { ApiRegulatoryClass } from '@/lib/api/job-schema';
import type { SizeTab } from './size-selection';

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
  sizeTab: SizeTab;
}

export const N1_SIZE_CHANGE_BLOCK_LINES = [
  '사이즈 변경 기능은 아직 작업에 반영할 수 없습니다.',
  '원본 유지를 선택해 주세요.',
];

export function requiresOtcType(regulatoryClass: ApiRegulatoryClass | ''): boolean {
  return regulatoryClass === 'otc' || regulatoryClass === 'combination';
}

/**
 * POST /jobs에 쓸 brandId. URL 쿼리가 정본이고, mockBrandId는 Mock 환경에서만 호출부가 넘긴다.
 * 실서버(mockBrandId null)에서 쿼리가 없으면 빈 값을 돌려준다 — 임의 값을 만들지 않는다.
 */
export function resolveN1BrandId(queryBrandId: string | null, mockBrandId: string | null): string {
  return queryBrandId?.trim() || mockBrandId || '';
}

/** 아직 채우지 않은 필수 항목 이름(화면 표기). 비어 있으면 진행할 수 있다 */
export function getN1MissingFields(input: N1ReadinessInput): string[] {
  const missing: string[] = [];
  if (!input.brandId) missing.push('브랜드 정보');
  if (!input.targetCountry) missing.push('국가');
  if (!input.targetLanguage) missing.push('언어');
  if (input.imageCount <= 0) missing.push('이미지');
  if (input.productName.trim() === '') missing.push('상품명');
  if (input.categoryId === null) missing.push('카테고리');
  if (!input.regulatoryClass) missing.push('규제 분류');
  if (requiresOtcType(input.regulatoryClass) && !input.otcType) missing.push('OTC 종류');
  if (!input.hasAcceptedResponsibility) missing.push('책임 동의');
  return missing;
}

/**
 * [다음]을 지금 누를 수 없는 이유를 화면 문구로 돌려준다. 비어 있으면 제출할 수 있다.
 * 버튼 상태와 안내를 같은 값에서 만들어, 막혔는데 이유가 없는 상태를 없앤다.
 */
export function getN1SubmitBlockMessages(input: N1ReadinessInput & { isSubmitting: boolean; isUploadBusy: boolean }): string[] {
  const messages: string[] = [];
  if (input.isSubmitting) messages.push('작업을 만들고 있습니다. 잠시만 기다려 주세요.');
  else if (input.isUploadBusy) messages.push('이미지를 처리하고 있습니다. 끝나면 다시 눌러 주세요.');
  const missing = getN1MissingFields(input);
  if (missing.length > 0) messages.push(`입력이 필요해요: ${missing.join(', ')}`);
  if (input.sizeTab !== 'original') messages.push(N1_SIZE_CHANGE_BLOCK_LINES.join(' '));
  return messages;
}

export function isN1Ready(input: N1ReadinessInput): boolean {
  return getN1MissingFields(input).length === 0 && input.sizeTab === 'original';
}
