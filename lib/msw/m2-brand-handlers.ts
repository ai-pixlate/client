import { delay, http, HttpResponse } from 'msw';

import type { ApiBrand, ApiBrandCreate, ApiBrandLogo, ApiBrandLogoFormat, ApiBrandUpdate } from '@/lib/api/brand-schema';
import { normalizeBrandName } from '@/lib/brand/m2-adapter';
import { M2_MOCK_BRAND, M2_MOCK_BRAND_ID, M2_MOCK_LOGOS } from '@/lib/mock-api/m2-brand-fixtures';

// ─────────────────────────────────────────────────────────────────
// M2 Brand API Mock — 실제 계약(brandList/brandCreate/brandGet/brandUpdate/brandLogoList/brandLogoCreate/brandLogoDelete) 모양 그대로.
// 상태는 페이지 메모리에만 있다(새로고침하면 fixture 로 돌아간다).
// POST /brands 로 만든 브랜드는 이후 GET /brands · GET /brands/{id} · 로고 API 에 그대로 나타난다(no-brand 에서도 [] → [created]).
// ?mockScenario=m2-<name> (요청 referrer 로 판별):
//   not-found · no-brand · multi-brand · save-fail · save-slow · logo-upload-fail · logo-delete-fail
//   create-fail(500) · create-conflict(409) · create-slow · create-logo-fail-once(등록 뒤 첫 로고 POST 만 실패)
//   create-response-lost(서버는 만들었지만 응답 유실) · create-lost-not-created(서버에 닿기 전 유실 — 만들지 않음)
//   create-lost-list-fail(응답 유실 + 그 뒤 첫 목록 조회 실패) · create-other-tab(입력하는 사이 다른 탭이 등록) · list-fail(목록 조회 500)
//   create-* 는 브랜드 0개 계정에서 시작한다(신규 등록 흐름).
// ─────────────────────────────────────────────────────────────────

type M2Scenario =
  | 'not-found'
  | 'no-brand'
  | 'multi-brand'
  | 'save-fail'
  | 'save-conflict'
  | 'save-slow'
  | 'logo-upload-fail'
  | 'logo-delete-fail'
  | 'create-fail'
  | 'create-conflict'
  | 'create-slow'
  | 'create-logo-fail-once'
  | 'create-response-lost'
  | 'create-lost-not-created'
  | 'create-lost-list-fail'
  | 'create-other-tab'
  | 'list-fail';

function scenarioOf(referrer: string): M2Scenario | null {
  try {
    const value = new URL(referrer).searchParams.get('mockScenario') ?? '';
    return value.startsWith('m2-') ? (value.slice(3) as M2Scenario) : null;
  } catch {
    return null;
  }
}

function errorJson(status: number, code: string, message: string, retryable = false) {
  return HttpResponse.json({ error: { code, message, retryable, details: null, traceId: `mock-trace-${Date.now()}` } }, { status });
}

let brand: ApiBrand = { ...M2_MOCK_BRAND };
let logos: ApiBrandLogo[] = M2_MOCK_LOGOS.map((logo) => ({ ...logo }));
let nextLogoId = 9100;
/** POST /brands 로 만든 브랜드와 그 로고(브랜드별) */
let createdBrands: ApiBrand[] = [];
const createdLogos = new Map<number, ApiBrandLogo[]>();
let nextBrandId = 200;
let createLogoFailUsed = false;
/** GET /brands 호출 수(create-other-tab · create-lost-list-fail 의 시점 구분용) */
let brandListCalls = 0;
/** create-lost-list-fail: 응답 유실 뒤 첫 목록 조회만 실패시킨다 */
let failNextBrandList = false;
/**
 * 브랜드 0개 계정 — no-brand·create-* 시나리오로 한 번 들어온 페이지는 그 뒤 시나리오가 URL 에 없는 화면(M1→M2 이동 등)에서도
 * 기본 fixture 브랜드(101)를 보이지 않는다. 실서버에서 계정의 브랜드 목록이 화면 이동으로 바뀌지 않는 것과 같은 의미다.
 */
let noBaseBrandAccount = false;

const FORMAT_BY_EXTENSION: Record<string, ApiBrandLogoFormat> = { svg: 'svg', png: 'png', jpg: 'jpg', jpeg: 'jpg' };
const MIME_BY_FORMAT: Record<ApiBrandLogoFormat, string> = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg' };

function isOwnBrand(brandId: string | readonly string[] | undefined) {
  return Number(brandId) === M2_MOCK_BRAND_ID || createdBrands.some((b) => b.id === Number(brandId));
}

function findBrand(brandId: number): ApiBrand | undefined {
  return brandId === M2_MOCK_BRAND_ID ? brand : createdBrands.find((b) => b.id === brandId);
}

function logosOf(brandId: number): ApiBrandLogo[] {
  return brandId === M2_MOCK_BRAND_ID ? logos : (createdLogos.get(brandId) ?? []);
}

function setLogosOf(brandId: number, next: ApiBrandLogo[]) {
  if (brandId === M2_MOCK_BRAND_ID) logos = next;
  else createdLogos.set(brandId, next);
}

async function toDataUrl(file: File, format: ApiBrandLogoFormat): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${MIME_BY_FORMAT[format]};base64,${btoa(binary)}`;
}

/** 이 계정이 GET /brands 로 보는 목록(시나리오 반영) */
function listedBrands(scenario: M2Scenario | null): ApiBrand[] {
  if (scenario === 'no-brand' || scenario?.startsWith('create-') || (scenario == null && noBaseBrandAccount)) return createdBrands;
  if (scenario === 'multi-brand') return [brand, { ...brand, id: M2_MOCK_BRAND_ID + 1, nameKo: '두 번째 브랜드', nameEn: 'Second' }, ...createdBrands];
  return [brand, ...createdBrands];
}

function hasNameConflict(list: ApiBrand[], names: { nameKo?: string | null; nameEn?: string | null }): boolean {
  const ko = normalizeBrandName(names.nameKo);
  const en = normalizeBrandName(names.nameEn);
  return list.some((b) => (ko !== '' && normalizeBrandName(b.nameKo) === ko) || (en !== '' && normalizeBrandName(b.nameEn) === en));
}

export const m2BrandHandlers = [
  http.get('/brands', ({ request }) => {
    const scenario = scenarioOf(request.referrer);
    if (scenario === 'no-brand' || scenario?.startsWith('create-')) noBaseBrandAccount = true;
    brandListCalls += 1;
    if (scenario === 'list-fail') return errorJson(500, 'INTERNAL_ERROR', 'mock brand list failure', true);
    if (failNextBrandList) {
      failNextBrandList = false;
      return errorJson(503, 'SERVICE_UNAVAILABLE', 'mock brand list unavailable', true);
    }
    // 다른 탭이 등록한 상황 — 첫 조회(화면 진입) 뒤에 브랜드가 하나 생긴다
    if (scenario === 'create-other-tab' && brandListCalls > 1 && createdBrands.length === 0) {
      nextBrandId += 1;
      const now = new Date().toISOString();
      createdBrands = [{ id: nextBrandId, nameKo: '다른 탭 브랜드', nameEn: 'Other Tab', overview: null, targetCustomer: null, createdAt: now, updatedAt: now }];
      createdLogos.set(nextBrandId, []);
    }
    if (scenario === 'no-brand' || scenario?.startsWith('create-') || (scenario == null && noBaseBrandAccount)) return HttpResponse.json(createdBrands);
    if (scenario === 'multi-brand')
      return HttpResponse.json([brand, { ...brand, id: M2_MOCK_BRAND_ID + 1, nameKo: '두 번째 브랜드', nameEn: 'Second' }, ...createdBrands]);
    return HttpResponse.json([brand, ...createdBrands]);
  }),

  http.post('/brands', async ({ request }) => {
    const scenario = scenarioOf(request.referrer);
    if (scenario === 'create-slow') await delay(1500);
    if (scenario === 'create-fail') return errorJson(500, 'INTERNAL_ERROR', 'mock brand create failure', true);
    if (scenario === 'create-conflict') return errorJson(409, 'CONFLICT', 'brand already exists');
    // 서버에 닿기 전 유실 — 아무것도 만들지 않고 네트워크 오류
    if (scenario === 'create-lost-not-created') return HttpResponse.error();
    const body = (await request.json().catch(() => null)) as Partial<ApiBrandCreate> | null;
    const nameKo = typeof body?.nameKo === 'string' ? body.nameKo.trim() : '';
    const nameEn = typeof body?.nameEn === 'string' ? body.nameEn.trim() : '';
    if (!nameKo) return errorJson(400, 'VALIDATION_ERROR', 'nameKo is required');
    if (!nameEn) return errorJson(400, 'VALIDATION_ERROR', 'nameEn is required');
    // 계약 「동일 셀러 중복 시 409」(OpenAPI brandCreate) — FE 와 같은 임시 정규화 기준. 실제 서버(develop)는 아직 409 를 돌려주지 않는다
    if (hasNameConflict(listedBrands(scenario), { nameKo, nameEn })) return errorJson(409, 'CONFLICT', 'brand already exists');
    nextBrandId += 1;
    const now = new Date().toISOString();
    const created: ApiBrand = {
      id: nextBrandId,
      nameKo,
      nameEn,
      overview: body?.overview ?? null,
      targetCustomer: body?.targetCustomer ?? null,
      createdAt: now,
      updatedAt: now,
    };
    createdBrands = [...createdBrands, created];
    createdLogos.set(created.id!, []);
    // 서버는 만들었지만 응답이 FE 에 닿지 않는다(네트워크 오류로 보인다)
    if (scenario === 'create-response-lost') return HttpResponse.error();
    if (scenario === 'create-lost-list-fail') {
      failNextBrandList = true;
      return HttpResponse.error();
    }
    return HttpResponse.json(created, { status: 201 });
  }),

  http.get('/brands/:brandId', ({ request, params }) => {
    if (scenarioOf(request.referrer) === 'not-found' || !isOwnBrand(params.brandId)) return errorJson(404, 'NOT_FOUND', 'brand not found');
    return HttpResponse.json(findBrand(Number(params.brandId)));
  }),

  http.patch('/brands/:brandId', async ({ request, params }) => {
    if (!isOwnBrand(params.brandId)) return errorJson(404, 'NOT_FOUND', 'brand not found');
    const scenario = scenarioOf(request.referrer);
    if (scenario === 'save-slow') await delay(1500);
    if (scenario === 'save-fail') return errorJson(500, 'INTERNAL_ERROR', 'mock brand update failure', true);
    // FE 사전 확인을 지난 동시 수정 — 서버만 아는 겹침(409)을 흉내 낸다
    if (scenario === 'save-conflict') return errorJson(409, 'CONFLICT', 'brand name already exists');
    const body = (await request.json()) as ApiBrandUpdate;
    if ('nameEn' in body && (body.nameEn == null || body.nameEn.trim() === '')) return errorJson(400, 'VALIDATION_ERROR', 'nameEn is required');
    const id = Number(params.brandId);
    // 계약 「동일 셀러 중복 시 409」 — 자기 자신은 빼고 비교한다
    if (hasNameConflict(listedBrands(scenario).filter((b) => b.id !== id), { nameKo: body.nameKo, nameEn: body.nameEn })) {
      return errorJson(409, 'CONFLICT', 'brand name already exists');
    }
    const updated = { ...findBrand(id), ...body, updatedAt: new Date().toISOString() };
    if (id === M2_MOCK_BRAND_ID) brand = updated;
    else createdBrands = createdBrands.map((b) => (b.id === id ? updated : b));
    return HttpResponse.json(updated);
  }),

  http.get('/brands/:brandId/logos', ({ request, params }) => {
    if (scenarioOf(request.referrer) === 'not-found' || !isOwnBrand(params.brandId)) return errorJson(404, 'NOT_FOUND', 'brand not found');
    return HttpResponse.json([...logosOf(Number(params.brandId))].sort((a, b) => (a.orderNo ?? 0) - (b.orderNo ?? 0)));
  }),

  http.post('/brands/:brandId/logos', async ({ request, params }) => {
    if (!isOwnBrand(params.brandId)) return errorJson(404, 'NOT_FOUND', 'brand not found');
    const scenario = scenarioOf(request.referrer);
    if (scenario === 'logo-upload-fail') return errorJson(415, 'UNSUPPORTED_MEDIA_TYPE', 'mock unsupported logo');
    if (scenario === 'create-logo-fail-once' && !createLogoFailUsed) {
      createLogoFailUsed = true;
      return errorJson(500, 'INTERNAL_ERROR', 'mock logo upload failure', true);
    }
    const id = Number(params.brandId);
    const current = logosOf(id);
    const file = (await request.formData()).get('file');
    if (!(file instanceof File)) return errorJson(400, 'VALIDATION_ERROR', 'file is required');
    const format = FORMAT_BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''];
    if (!format) return errorJson(415, 'UNSUPPORTED_MEDIA_TYPE', 'svg/png/jpg only');
    nextLogoId += 1;
    const created: ApiBrandLogo = {
      id: nextLogoId,
      format,
      orderNo: Math.max(0, ...current.map((logo) => logo.orderNo ?? 0)) + 1,
      logoUrl: await toDataUrl(file, format),
    };
    setLogosOf(id, [...current, created]);
    return HttpResponse.json(created, { status: 201 });
  }),

  http.delete('/brands/:brandId/logos/:logoId', ({ request, params }) => {
    if (!isOwnBrand(params.brandId)) return errorJson(404, 'NOT_FOUND', 'brand not found');
    if (scenarioOf(request.referrer) === 'logo-delete-fail') return errorJson(500, 'INTERNAL_ERROR', 'mock logo delete failure', true);
    const logoId = Number(params.logoId);
    const id = Number(params.brandId);
    const current = logosOf(id);
    if (!current.some((logo) => logo.id === logoId)) return errorJson(404, 'NOT_FOUND', 'logo not found');
    setLogosOf(id, current.filter((logo) => logo.id !== logoId));
    return new HttpResponse(null, { status: 204 });
  }),
];
