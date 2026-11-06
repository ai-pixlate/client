import { delay, http, HttpResponse } from 'msw';

import type { ApiBrand, ApiBrandLogo, ApiBrandLogoFormat, ApiBrandUpdate } from '@/lib/api/brand-schema';
import { M2_MOCK_BRAND, M2_MOCK_BRAND_ID, M2_MOCK_LOGOS } from '@/lib/mock-api/m2-brand-fixtures';

// ─────────────────────────────────────────────────────────────────
// M2 Brand API Mock — 실제 계약(brandList/brandGet/brandUpdate/brandLogoList/brandLogoCreate/brandLogoDelete) 모양 그대로.
// 상태는 페이지 메모리에만 있다(새로고침하면 fixture 로 돌아간다).
// ?mockScenario=m2-<name> (요청 referrer 로 판별):
//   not-found · no-brand · multi-brand · save-fail · save-slow · logo-upload-fail · logo-delete-fail
// ─────────────────────────────────────────────────────────────────

type M2Scenario = 'not-found' | 'no-brand' | 'multi-brand' | 'save-fail' | 'save-slow' | 'logo-upload-fail' | 'logo-delete-fail';

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

const FORMAT_BY_EXTENSION: Record<string, ApiBrandLogoFormat> = { svg: 'svg', png: 'png', jpg: 'jpg', jpeg: 'jpg' };
const MIME_BY_FORMAT: Record<ApiBrandLogoFormat, string> = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg' };

function isOwnBrand(brandId: string | readonly string[] | undefined) {
  return Number(brandId) === M2_MOCK_BRAND_ID;
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
    if (scenario === 'no-brand') return HttpResponse.json([]);
    if (scenario === 'multi-brand') return HttpResponse.json([brand, { ...brand, id: M2_MOCK_BRAND_ID + 1, nameKo: '두 번째 브랜드', nameEn: 'Second' }]);
    return HttpResponse.json([brand]);
  }),

  http.get('/brands/:brandId', ({ request, params }) => {
    if (scenarioOf(request.referrer) === 'not-found' || !isOwnBrand(params.brandId)) return errorJson(404, 'NOT_FOUND', 'brand not found');
    return HttpResponse.json(brand);
  }),

  http.patch('/brands/:brandId', async ({ request, params }) => {
    if (!isOwnBrand(params.brandId)) return errorJson(404, 'NOT_FOUND', 'brand not found');
    const scenario = scenarioOf(request.referrer);
    if (scenario === 'save-slow') await delay(1500);
    if (scenario === 'save-fail') return errorJson(500, 'INTERNAL_ERROR', 'mock brand update failure', true);
    const body = (await request.json()) as ApiBrandUpdate;
    if ('nameEn' in body && (body.nameEn == null || body.nameEn.trim() === '')) return errorJson(400, 'VALIDATION_ERROR', 'nameEn is required');
    brand = { ...brand, ...body, updatedAt: new Date().toISOString() };
    return HttpResponse.json(brand);
  }),

  http.get('/brands/:brandId/logos', ({ request, params }) => {
    if (scenarioOf(request.referrer) === 'not-found' || !isOwnBrand(params.brandId)) return errorJson(404, 'NOT_FOUND', 'brand not found');
    return HttpResponse.json([...logos].sort((a, b) => (a.orderNo ?? 0) - (b.orderNo ?? 0)));
  }),

  http.post('/brands/:brandId/logos', async ({ request, params }) => {
    if (!isOwnBrand(params.brandId)) return errorJson(404, 'NOT_FOUND', 'brand not found');
    if (scenarioOf(request.referrer) === 'logo-upload-fail') return errorJson(415, 'UNSUPPORTED_MEDIA_TYPE', 'mock unsupported logo');
    const file = (await request.formData()).get('file');
    if (!(file instanceof File)) return errorJson(400, 'VALIDATION_ERROR', 'file is required');
    const format = FORMAT_BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''];
    if (!format) return errorJson(415, 'UNSUPPORTED_MEDIA_TYPE', 'svg/png/jpg only');
    nextLogoId += 1;
    const created: ApiBrandLogo = {
      id: nextLogoId,
      format,
      orderNo: Math.max(0, ...logos.map((logo) => logo.orderNo ?? 0)) + 1,
      logoUrl: await toDataUrl(file, format),
    };
    logos = [...logos, created];
    return HttpResponse.json(created, { status: 201 });
  }),

  http.delete('/brands/:brandId/logos/:logoId', ({ request, params }) => {
    if (!isOwnBrand(params.brandId)) return errorJson(404, 'NOT_FOUND', 'brand not found');
    if (scenarioOf(request.referrer) === 'logo-delete-fail') return errorJson(500, 'INTERNAL_ERROR', 'mock logo delete failure', true);
    const logoId = Number(params.logoId);
    if (!logos.some((logo) => logo.id === logoId)) return errorJson(404, 'NOT_FOUND', 'logo not found');
    logos = logos.filter((logo) => logo.id !== logoId);
    return new HttpResponse(null, { status: 204 });
  }),
];
