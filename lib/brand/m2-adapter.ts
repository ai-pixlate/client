/**
 * M2 브랜드 정보 Adapter — API DTO(lib/api/brand-schema.ts) ↔ M2 ViewModel(lib/brand/m2-form.ts).
 * Mock 과 실제 서버가 같은 변환을 쓴다(분기 없음). React 없이 Node 에서 검증한다(scripts/verify-m2-form.mjs).
 */

import type { ApiBrand, ApiBrandLogo, ApiBrandUpdate } from '../api/brand-schema';
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
 * ?brandId= 가 있으면 그것, 없으면 GET /brands 가 하나일 때만 그 브랜드. 없거나 여러 개면 고르지 않는다(M0 다중 브랜드는 별도 범위).
 */
export type M2BrandTarget = { kind: 'id'; brandId: number } | { kind: 'none' } | { kind: 'ambiguous'; count: number } | { kind: 'invalid-query' };

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
