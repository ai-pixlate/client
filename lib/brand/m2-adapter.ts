/**
 * M2 브랜드 정보 Adapter — API DTO(lib/api/brand-schema.ts) ↔ M2 ViewModel(lib/brand/m2-form.ts).
 * Mock 과 실제 서버가 같은 변환을 쓴다(분기 없음). React 없이 Node 에서 검증한다(scripts/verify-m2-form.mjs).
 */

import type { ApiBrand, ApiBrandCreate, ApiBrandLogo, ApiBrandUpdate } from '../api/brand-schema';
import { normalizeM2Form, type M2BrandFormValue, type M2BrandLogo } from './m2-form.ts';

/** 서버 로고 표시 이름 — 계약에 이름 필드가 없어 서버 순서(orderNo ASC) 번호로 부른다 */
export function m2ServerLogoName(index: number): string {
  return `브랜드 로고 ${index + 1}`;
}

/** 서버 응답 순서(order_no ASC)를 그대로 쓴다 — FE 가 다시 정렬하지 않는다. id·logoUrl 이 없는 항목은 계약 밖이라 뺀다 */
export function toM2Logos(logos: readonly ApiBrandLogo[]): M2BrandLogo[] {
  return logos
    .filter((logo): logo is ApiBrandLogo & { id: number; logoUrl: string } => typeof logo.id === 'number' && typeof logo.logoUrl === 'string')
    .map((logo, index) => ({ id: `logo-${logo.id}`, name: m2ServerLogoName(index), src: logo.logoUrl, serverId: logo.id }));
}

/** null 개요·고객층은 빈 칸으로 보인다(F-TRN-02b 중립 톤) */
export function toM2BrandFormValue(brand: ApiBrand, logos: readonly ApiBrandLogo[]): M2BrandFormValue {
  return {
    nameKo: brand.nameKo ?? '',
    nameEn: brand.nameEn ?? '',
    overview: brand.overview ?? '',
    targetCustomer: brand.targetCustomer ?? '',
    logos: toM2Logos(logos),
  };
}

/**
 * PATCH /brands/{brandId} 본문(BrandUpdate 부분 수정) — 바뀐 항목만. 바뀐 게 없으면 null(요청하지 않는다).
 * 비교·전송 모두 앞뒤 공백을 뺀 값이다. 빈 개요·고객층은 null 로 보낸다(읽을 때 null → 빈 칸과 대칭).
 * 이름 검증(빈 값 금지)은 canSaveM2 가 먼저 막는다.
 */
export function toM2BrandUpdate(baseline: M2BrandFormValue, draft: M2BrandFormValue): ApiBrandUpdate | null {
  const before = normalizeM2Form(baseline);
  const after = normalizeM2Form(draft);
  const patch: ApiBrandUpdate = {};
  if (before.nameKo !== after.nameKo) patch.nameKo = after.nameKo;
  if (before.nameEn !== after.nameEn) patch.nameEn = after.nameEn;
  if (before.overview !== after.overview) patch.overview = after.overview === '' ? null : after.overview;
  if (before.targetCustomer !== after.targetCustomer) patch.targetCustomer = after.targetCustomer === '' ? null : after.targetCustomer;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** 신규 등록 화면의 빈 초기값 */
export const M2_EMPTY_FORM: M2BrandFormValue = { nameKo: '', nameEn: '', overview: '', targetCustomer: '', logos: [] };

/**
 * POST /brands 본문(BrandCreate) — 앞뒤 공백을 뺀 값. 빈 개요·고객층은 null.
 * 이름 검증(빈 값 금지)은 getM2NameErrors 가 먼저 막는다. 로고는 본문에 없다(등록 뒤 brandId 로 따로 올린다).
 */
export function toM2BrandCreate(draft: M2BrandFormValue): ApiBrandCreate {
  const value = normalizeM2Form(draft);
  return {
    nameKo: value.nameKo,
    nameEn: value.nameEn,
    overview: value.overview === '' ? null : value.overview,
    targetCustomer: value.targetCustomer === '' ? null : value.targetCustomer,
  };
}

export interface M2LogoPlan {
  /** 저장 전 로고 — draft 순서대로 POST */
  uploads: { localId: string; file: File }[];
  /** baseline 에 있던 서버 로고 중 draft 에서 빠진 것 — DELETE */
  deletes: number[];
}

export function planM2LogoChanges(baseline: M2BrandFormValue, draft: M2BrandFormValue): M2LogoPlan {
  const kept = new Set(draft.logos.flatMap((logo) => (logo.serverId != null ? [logo.serverId] : [])));
  return {
    uploads: draft.logos.flatMap((logo) => (logo.serverId == null && logo.file ? [{ localId: logo.id, file: logo.file }] : [])),
    deletes: baseline.logos.flatMap((logo) => (logo.serverId != null && !kept.has(logo.serverId) ? [logo.serverId] : [])),
  };
}

/**
 * 저장 뒤 화면 값 — 새 baseline 은 서버 응답(브랜드 + 다시 받은 로고 목록)이다.
 * 일부가 실패하면 draft 에 그 의도를 남긴다: 실패한 삭제는 계속 빠진 채로, 실패한 추가는 저장 전 로고로 남는다.
 * 브랜드 PATCH 가 실패했으면 입력한 글을 그대로 둔다.
 */
export function reconcileM2AfterSave(options: {
  server: M2BrandFormValue;
  draft: M2BrandFormValue;
  brandSaved: boolean;
  failedDeletes: readonly number[];
  failedUploadIds: readonly string[];
}): { baseline: M2BrandFormValue; draft: M2BrandFormValue; complete: boolean } {
  const { server, draft, brandSaved, failedDeletes, failedUploadIds } = options;
  const complete = brandSaved && failedDeletes.length === 0 && failedUploadIds.length === 0;
  if (complete) return { baseline: server, draft: server, complete };
  const failedDeleteSet = new Set(failedDeletes);
  const failedUploadSet = new Set(failedUploadIds);
  const text = brandSaved
    ? { nameKo: server.nameKo, nameEn: server.nameEn, overview: server.overview, targetCustomer: server.targetCustomer }
    : { nameKo: draft.nameKo, nameEn: draft.nameEn, overview: draft.overview, targetCustomer: draft.targetCustomer };
  return {
    baseline: server,
    draft: {
      ...text,
      logos: [
        ...server.logos.filter((logo) => logo.serverId == null || !failedDeleteSet.has(logo.serverId)),
        ...draft.logos.filter((logo) => failedUploadSet.has(logo.id)),
      ],
    },
    complete,
  };
}

/**
 * 어느 브랜드를 보일지 — 계약에 셀러 → 대표 브랜드 정본이 없다(/auth/me Seller 에 brandId 없음).
 * ?brandId= 가 있으면 그것, 없으면 GET /brands 가 하나일 때만 그 브랜드. 없거나 여러 개면 고르지 않는다 — 여러 개면 M0(브랜드 선택)로 보낸다.
 */
export type M2BrandTarget = { kind: 'id'; brandId: number } | { kind: 'none' } | { kind: 'ambiguous'; count: number } | { kind: 'invalid-query' };

/**
 * 전체 보관함(M1 '/')의 「이미지 추가 생성」이 갈 곳 — GET /brands 결과로만 정한다(임의 brandId 금지).
 * - 0개: 브랜드 등록(/brand?mode=create&next=n1) → 등록 응답 id 로 N1
 * - 1개: /jobs/new?brandId={id} — 브랜드가 하나뿐이라 귀속이 분명하다
 * - 2개 이상: 이 화면에는 브랜드 맥락이 없다. 최종 요구사항은 「브랜드별 M1 새 작업 → 그 브랜드 N1」인데 브랜드별 보관함 계약이 없어
 *   FE 가 브랜드를 고르면 잘못 귀속될 수 있다 — 링크 없이 이유만 보인다(href=null)
 */
export type NewJobEntry = { kind: 'create' | 'n1'; href: string } | { kind: 'needs-brand-scope'; href: null };

export function resolveNewJobEntry(brands: readonly ApiBrand[]): NewJobEntry {
  const target = resolveM2BrandTarget(null, brands);
  if (target?.kind === 'id') return { kind: 'n1', href: `/jobs/new?brandId=${target.brandId}` };
  if (target?.kind === 'ambiguous') return { kind: 'needs-brand-scope', href: null };
  return { kind: 'create', href: '/brand?mode=create&next=n1' };
}

/**
 * 브랜드명 비교용 정규화(F-ACC-02a — 공백·대소문자·특수문자 정규화 후 비교).
 * ★ 임시 기준: 문자 처리 방식은 BE 확정 전이다. 지금은 NFKC(전각·호환 문자 통일) → 소문자 → 문자(\p{L})·숫자(\p{N}) 외 모두 제거.
 *   예) " Pix-late! " · "ＰＩＸＬＡＴＥ" · "pix late" → "pixlate". BE 기준이 정해지면 이 함수만 바꾼다.
 */
export function normalizeBrandName(name: string | null | undefined): string {
  return (name ?? '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export type BrandNameField = 'nameKo' | 'nameEn';
export interface BrandDuplicate {
  brand: ApiBrand & { id: number };
  /** 겹친 항목 — 한글명끼리 또는 영문명끼리 비교한다 */
  field: BrandNameField;
}

/**
 * 같은 셀러 안 중복 브랜드(F-ACC-02a) — 등록·수정이 같은 함수를 쓴다. GET /brands 는 로그인한 셀러의 브랜드만 주므로
 * 다른 셀러의 같은 이름은 비교 대상에 들어오지 않는다(허용). 수정은 excludeBrandId 로 자기 자신을 뺀다.
 * 정규화 뒤 빈 이름(특수문자만 등)은 비교하지 않는다 — 필수값 검증(getM2NameErrors)이 따로 막는다.
 * FE 사전 확인일 뿐이다: 동시 등록·수정은 막지 못하며 최종 판정은 서버(409)다.
 */
export function findDuplicateBrand(
  brands: readonly ApiBrand[],
  draft: Pick<M2BrandFormValue, 'nameKo' | 'nameEn'>,
  options: { excludeBrandId?: number | null } = {},
): BrandDuplicate | null {
  const wanted: [BrandNameField, string][] = [
    ['nameKo', normalizeBrandName(draft.nameKo)],
    ['nameEn', normalizeBrandName(draft.nameEn)],
  ];
  for (const brand of brands) {
    if (typeof brand.id !== 'number' || brand.id === options.excludeBrandId) continue;
    for (const [field, value] of wanted) {
      if (value !== '' && normalizeBrandName(brand[field]) === value) return { brand: brand as ApiBrand & { id: number }, field };
    }
  }
  return null;
}

/**
 * 응답 유실 뒤 결과 확인 — 등록 전 목록에 없던 브랜드 중 입력한 이름(정규화 비교)과 같은 「후보」를 찾는다.
 * 후보가 있어도 이번 요청이 만든 것이라고 단정하지 않는다: 다른 탭·다른 기기의 같은 이름 등록일 수 있고, 계약에 요청 식별(멱등 키)이 없다.
 * 호출부는 후보에 로고·정보를 이어 저장하지 않고 사용자에게 확인을 맡긴다(use-m2-brand-create.ts).
 */
export function findCreatedBrand(
  before: readonly number[],
  after: readonly ApiBrand[],
  draft: Pick<M2BrandFormValue, 'nameKo' | 'nameEn'>,
): { kind: 'candidate'; brand: ApiBrand & { id: number } } | { kind: 'none' } | { kind: 'ambiguous' } {
  const known = new Set(before);
  const ko = normalizeBrandName(draft.nameKo);
  const en = normalizeBrandName(draft.nameEn);
  const matches = after.filter(
    (brand): brand is ApiBrand & { id: number } =>
      typeof brand.id === 'number' && !known.has(brand.id) && normalizeBrandName(brand.nameKo) === ko && normalizeBrandName(brand.nameEn) === en,
  );
  if (matches.length === 1) return { kind: 'candidate', brand: matches[0] };
  return matches.length === 0 ? { kind: 'none' } : { kind: 'ambiguous' };
}

export function resolveM2BrandTarget(queryBrandId: string | null, brands: readonly ApiBrand[] | null): M2BrandTarget | null {
  if (queryBrandId != null && queryBrandId !== '') {
    const id = Number(queryBrandId);
    return Number.isSafeInteger(id) && id > 0 ? { kind: 'id', brandId: id } : { kind: 'invalid-query' };
  }
  if (brands == null) return null; // 목록을 아직 받지 않았다
  const ids = brands.flatMap((brand) => (typeof brand.id === 'number' ? [brand.id] : []));
  if (ids.length === 0) return { kind: 'none' };
  if (ids.length > 1) return { kind: 'ambiguous', count: ids.length };
  return { kind: 'id', brandId: ids[0] };
}
