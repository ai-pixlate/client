/**
 * N1 사이즈 선택 화면 상태 — Figma 「사이즈선택」(1093:10288).
 *
 * OpenAPI JobPatch.specType은 1.0.0에서 original만 사용하므로 이 상태는 화면 안에서만 쓴다.
 * 서버로 보내지 않고, 사이즈 변경 탭이면 [다음]을 막는다(n1-readiness.ts). 탭을 저절로 되돌리지 않는다.
 * React를 쓰지 않는 순수 함수라 scripts/verify-n1-category-tree.mjs가 그대로 import한다.
 */

export type SizeTab = 'original' | 'change';
export type SizeChangeMode = 'site' | 'custom';

/** Figma 판매처 맞춤(1093:10289) 표기 그대로다. 채널 규격 API에 연결되기 전까지의 화면 표시값이다 */
export const SITE_OPTIONS = [{ value: 'amazon', label: '아마존' }] as const;
export const SITE_SPEC_GUIDE = '베이직(기본 등록) : 최소 500px(짧은 변 기준) ~ 최대 10,000px(긴 변 기준)';
export const SITE_SPEC_OPTIONS = [
  { value: 'premium-a-plus', label: 'Premium A+', size: '(1464 x 600)' },
  { value: 'basic-a-plus', label: 'Basic A+', size: '(970 x 300)' },
  { value: 'basic', label: 'Basic', size: null },
] as const;
export type SiteSpec = (typeof SITE_SPEC_OPTIONS)[number]['value'];

export interface SizeSelectionState {
  tab: SizeTab;
  mode: SizeChangeMode;
  siteSpec: SiteSpec;
  customWidth: string;
  customHeight: string;
}

export type SizeSelectionAction =
  | { type: 'selectTab'; tab: SizeTab }
  | { type: 'selectMode'; mode: SizeChangeMode }
  | { type: 'selectSiteSpec'; siteSpec: SiteSpec }
  | { type: 'setCustomWidth'; value: string }
  | { type: 'setCustomHeight'; value: string };

/** 판매처 Basic A+와 커스텀 80×80은 Figma variant의 초기 표시값이다 */
export const INITIAL_SIZE_SELECTION: SizeSelectionState = {
  tab: 'original',
  mode: 'site',
  siteSpec: 'basic-a-plus',
  customWidth: '80',
  customHeight: '80',
};

const MAX_SIZE_DIGITS = 5;

/** 숫자만 남긴다(10,000px 범위까지 입력할 수 있게 5자리로 자른다) */
export function sanitizeSizeInput(value: string): string {
  return value.replace(/\D/g, '').slice(0, MAX_SIZE_DIGITS);
}

export function sizeSelectionReducer(state: SizeSelectionState, action: SizeSelectionAction): SizeSelectionState {
  switch (action.type) {
    case 'selectTab':
      return { ...state, tab: action.tab };
    case 'selectMode':
      return { ...state, mode: action.mode };
    case 'selectSiteSpec':
      return { ...state, siteSpec: action.siteSpec };
    case 'setCustomWidth':
      return { ...state, customWidth: sanitizeSizeInput(action.value) };
    case 'setCustomHeight':
      return { ...state, customHeight: sanitizeSizeInput(action.value) };
  }
}
