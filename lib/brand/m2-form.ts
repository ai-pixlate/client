/**
 * M2 브랜드 정보 화면 로직 — 저장 전 변경 판정(F-BRD-07)과 입력 검증(F-BRD-01).
 *
 * M2 API를 아직 연결하지 않아 화면이 쓰는 값만 ViewModel로 둔다. API 응답 타입을 추측하지 않는다.
 * React 없이 Node에서 검증할 수 있는 순수 함수만 둔다(scripts/verify-m2-form.mjs).
 */

export type M2BrandLogo = {
  /** 목록·삭제의 식별자. 파일 이름이나 배열 위치를 쓰지 않는다. */
  id: string;
  name: string;
  /** Mock 정적 경로 또는 사용자가 고른 파일의 blob: URL */
  src: string;
};

export type M2BrandFormValue = {
  nameKo: string;
  nameEn: string;
  overview: string;
  targetCustomer: string;
  logos: M2BrandLogo[];
};

export type M2Mode = 'view' | 'edit';
export type M2Status = 'view' | 'edit-clean' | 'edit-dirty';

/** 앞뒤 공백만 다른 값은 같은 값으로 본다 — 비교와 저장이 같은 기준을 쓴다. */
export function normalizeM2Form(value: M2BrandFormValue): M2BrandFormValue {
  return {
    ...value,
    nameKo: value.nameKo.trim(),
    nameEn: value.nameEn.trim(),
    overview: value.overview.trim(),
    targetCustomer: value.targetCustomer.trim(),
  };
}

/** 저장 시 사라지는 항목을 열거한다 — 변경하지 않은 항목은 넣지 않는다(F-BRD-07, 포괄 문구 금지). */
export function listM2Changes(baseline: M2BrandFormValue, draft: M2BrandFormValue): string[] {
  const before = normalizeM2Form(baseline);
  const after = normalizeM2Form(draft);
  const changes: string[] = [];
  if (before.nameKo !== after.nameKo) changes.push('한글 브랜드명');
  if (before.nameEn !== after.nameEn) changes.push('영문 브랜드명');
  if (before.overview !== after.overview) changes.push('브랜드 개요');
  if (before.targetCustomer !== after.targetCustomer) changes.push('핵심 고객층');

  const beforeIds = new Set(before.logos.map((logo) => logo.id));
  const afterIds = new Set(after.logos.map((logo) => logo.id));
  const added = after.logos.filter((logo) => !beforeIds.has(logo.id)).length;
  const removed = before.logos.filter((logo) => !afterIds.has(logo.id)).length;
  if (added > 0) changes.push(`로고 ${added}개 추가`);
  if (removed > 0) changes.push(`로고 ${removed}개 삭제`);
  return changes;
}

export function isM2Dirty(baseline: M2BrandFormValue, draft: M2BrandFormValue): boolean {
  return listM2Changes(baseline, draft).length > 0;
}

export function getM2Status(mode: M2Mode, dirty: boolean): M2Status {
  if (mode === 'view') return 'view';
  return dirty ? 'edit-dirty' : 'edit-clean';
}

export const M2_NAME_KO_ERROR = '한글 브랜드명을 입력해주세요.';
export const M2_NAME_EN_ERROR = '영문 브랜드명을 입력해주세요.';

/** 한글명·영문명은 둘 다 필수다(F-BRD-01). 개요·고객층은 비어도 저장할 수 있다(F-BRD-03·05, 중립 톤). */
export function getM2NameErrors(value: M2BrandFormValue): { nameKo: string | null; nameEn: string | null } {
  return {
    nameKo: value.nameKo.trim() === '' ? M2_NAME_KO_ERROR : null,
    nameEn: value.nameEn.trim() === '' ? M2_NAME_EN_ERROR : null,
  };
}

export function canSaveM2(baseline: M2BrandFormValue, draft: M2BrandFormValue): boolean {
  const errors = getM2NameErrors(draft);
  return !errors.nameKo && !errors.nameEn && isM2Dirty(baseline, draft);
}

/** 파일 선택 창의 필터. 실제 파일 검증(signature·SVG sanitize)은 서버 책임이다. */
export const M2_LOGO_ACCEPT = '.svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg';

const ALLOWED_MIME_BY_EXTENSION: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/** 확장자는 항상 보고, 브라우저가 알려 준 MIME이 있으면 확장자와 맞는지 함께 본다(MIME은 빈 값일 수 있다). */
export function isM2LogoFileAllowed(file: { name: string; type: string }): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!file.name.includes('.')) return false;
  const expectedMime = ALLOWED_MIME_BY_EXTENSION[extension];
  if (!expectedMime) return false;
  return file.type === '' || file.type === expectedMime;
}
