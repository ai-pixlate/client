import { delay, http, HttpResponse } from 'msw';

import type { ApiBrand, ApiBrandCreate, ApiBrandLogo, ApiBrandLogoFormat, ApiBrandUpdate } from '@/lib/api/brand-schema';
import { M2_MOCK_BRAND, M2_MOCK_BRAND_ID, M2_MOCK_LOGOS } from '@/lib/mock-api/m2-brand-fixtures';

// ─────────────────────────────────────────────────────────────────
// M2 Brand API Mock — 실제 계약(brandList/brandCreate/brandGet/brandUpdate/brandLogoList/brandLogoCreate/brandLogoDelete) 모양 그대로.
// 상태는 페이지 메모리에만 있다(새로고침하면 fixture 로 돌아간다).
// POST /brands 로 만든 브랜드는 이후 GET /brands · GET /brands/{id} · 로고 API 에 그대로 나타난다(no-brand 에서도 [] → [created]).
// ?mockScenario=m2-<name> (요청 referrer 로 판별):
//   not-found · no-brand · multi-brand · save-fail · save-slow · logo-upload-fail · logo-delete-fail
//   create-fail(500) · create-conflict(409) · create-slow · create-logo-fail-once(등록 뒤 첫 로고 POST 만 실패)
// ─────────────────────────────────────────────────────────────────

type M2Scenario =
  | 'not-found'
  | 'no-brand'
  | 'multi-brand'
  | 'save-fail'
  | 'save-slow'
  | 'logo-upload-fail'
  | 'logo-delete-fail'
  | 'create-fail'
  | 'create-conflict'
  | 'create-slow'
  | 'create-logo-fail-once';

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

export const m2BrandHandlers = [
  http.get('/brands', ({ request }) => {
    const scenario = scenarioOf(request.referrer);
    if (scenario === 'no-brand') return HttpResponse.json(createdBrands);
    if (scenario === 'multi-brand')
      return HttpResponse.json([brand, { ...brand, id: M2_MOCK_BRAND_ID + 1, nameKo: '두 번째 브랜드', nameEn: 'Second' }, ...createdBrands]);
    return HttpResponse.json([brand, ...createdBrands]);
  }),

  http.post('/brands', async ({ request }) => {
    const scenario = scenarioOf(request.referrer);
    if (scenario === 'create-slow') await delay(1500);
    if (scenario === 'create-fail') return errorJson(500, 'INTERNAL_ERROR', 'mock brand create failure', true);
    if (scenario === 'create-conflict') return errorJson(409, 'CONFLICT', 'brand already exists');
    const body = (await request.json().catch(() => null)) as Partial<ApiBrandCreate> | null;
    const nameKo = typeof body?.nameKo === 'string' ? body.nameKo.trim() : '';
    const nameEn = typeof body?.nameEn === 'string' ? body.nameEn.trim() : '';
    if (!nameKo) return errorJson(400, 'VALIDATION_ERROR', 'nameKo is required');
    if (!nameEn) return errorJson(400, 'VALIDATION_ERROR', 'nameEn is required');
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
    const body = (await request.json()) as ApiBrandUpdate;
    if ('nameEn' in body && (body.nameEn == null || body.nameEn.trim() === '')) return errorJson(400, 'VALIDATION_ERROR', 'nameEn is required');
    const id = Number(params.brandId);
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
