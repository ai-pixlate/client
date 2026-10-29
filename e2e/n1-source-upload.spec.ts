import { type Page, expect, test } from '@playwright/test';

import { MOCK_BRAND_ID, MOCK_JOB_ID } from '@/lib/mock-api/fixtures';
import { MOCK_UPLOAD_FAIL_ONCE_MARKER } from '@/lib/msw/handlers';
import { mockMasterCategories } from '@/lib/mock-api/category-fixtures';
import { pickRegulatoryClass } from './helpers/n1-regulatory-class';

const SUNSCREEN_CATEGORY_ID = mockMasterCategories.find((c) => c.path === '선케어 > 선크림')!.id;

// ─────────────────────────────────────────────────────────────────
// N1 실제 원본 업로드 — draft-first 계약
// POST /jobs(brandId) → POST source-images(multipart files) → PATCH /jobs/{id}
// → (필요 시) source-images/reorder → analyze
//
// 앱이 fetch에 넘기는 실제 RequestInit(FormData 안의 File bytes 포함)을 기록하려고
// window.fetch를 감싼다. N1→/jobs/:id 이동이 dev에서 full page load가 될 수 있어
// 기록은 exposeFunction으로 Node 쪽에 즉시 넘긴다(문서가 바뀌어도 유지된다).
// ─────────────────────────────────────────────────────────────────

interface FormEntry {
  field: string;
  name?: string;
  type?: string;
  bytes?: string;
  value?: string;
}

interface ApiCall {
  uid: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string | null;
  form: FormEntry[] | null;
  status?: number;
  response?: unknown;
}

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

/** 파일마다 bytes가 달라지도록 PNG 뒤에 표식 byte를 붙인다(이미지 디코딩에는 영향 없음) */
function png(name: string, marker: number) {
  return { name, mimeType: 'image/png', buffer: Buffer.concat([TINY_PNG, Buffer.from([marker])]) };
}

async function recordApiCalls(page: Page): Promise<ApiCall[]> {
  const calls: ApiCall[] = [];
  await page.exposeFunction('__n1RecordRequest', (call: ApiCall) => {
    calls.push(call);
  });
  await page.exposeFunction('__n1RecordResponse', (uid: string, status: number, response: unknown) => {
    const call = calls.find((c) => c.uid === uid);
    if (call) Object.assign(call, { status, response });
  });
  await page.addInitScript(() => {
    const w = window as unknown as {
      __n1RecordRequest: (call: unknown) => Promise<void>;
      __n1RecordResponse: (uid: string, status: number, response: unknown) => Promise<void>;
    };
    const originalFetch = window.fetch.bind(window);
    let seq = 0;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      // 앱의 API 호출(프록시 식별 헤더가 붙은 요청)만 기록한다 — RSC/페이지 요청은 제외
      if (!headers.has('x-pixlate-api-proxy')) return originalFetch(input, init);
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const uid = `${Date.now()}-${seq++}`;
      let form: unknown[] | null = null;
      if (init?.body instanceof FormData) {
        form = [];
        for (const [field, value] of init.body.entries()) {
          if (value instanceof File) {
            const bytes = new Uint8Array(await value.arrayBuffer());
            form.push({ field, name: value.name, type: value.type, bytes: btoa(String.fromCharCode(...bytes)) });
          } else {
            form.push({ field, value });
          }
        }
      }
      await w.__n1RecordRequest({
        uid,
        method: (init?.method ?? 'GET').toUpperCase(),
        path: new URL(url, location.href).pathname,
        headers: Object.fromEntries(headers.entries()),
        body: typeof init?.body === 'string' ? init.body : null,
        form,
      });
      const res = await originalFetch(input, init);
      let response: unknown = null;
      try {
        response = await res.clone().json();
      } catch {
        // 204 등 본문 없음
      }
      await w.__n1RecordResponse(uid, res.status, response);
      return res;
    };
  });
  return calls;
}

const JOB_PATH = `/jobs/${MOCK_JOB_ID}`;
const UPLOAD_PATH = `${JOB_PATH}/source-images`;

/** N1 쓰기 호출만 — GET /master/categories·N2 진입 후의 GET tasks polling 등 조회는 제외한다 */
function writesOf(calls: ApiCall[]) {
  return calls.filter((c) => c.method !== 'GET');
}

function summarize(calls: ApiCall[]) {
  return writesOf(calls).map((c) => `${c.method} ${c.path}`);
}

async function fillRequired(page: Page, regulatoryClass = '화장품') {
  await page.getByPlaceholder('상품 이름을 입력해주세요').fill('업로드 계약 상품');
  await page.getByRole('combobox').nth(0).selectOption('US');
  await page.getByRole('combobox').nth(1).selectOption('en');
  await pickRegulatoryClass(page, regulatoryClass);
  // 카테고리(F-SRC-04 필수 — [확인]으로 확정)와 책임 동의(F-ACC-04)
  await page.getByRole('button', { name: '선택하기' }).click();
  const categoryModal = page.getByRole('dialog', { name: '카테고리 선택' });
  await categoryModal.getByRole('button', { name: '선케어' }).click();
  await categoryModal.getByRole('button', { name: '선크림' }).click();
  await categoryModal.getByRole('button', { name: '확인' }).click();
  await page.getByRole('checkbox', { name: /외부 AI 서비스로 전송됨을 확인했습니다/ }).check();
}

async function addFiles(page: Page, files: ReturnType<typeof png>[]) {
  await page.locator('#image-upload').setInputFiles(files);
  for (const f of files) await expect(page.locator(`img[alt="${f.name}"]`).first()).toBeVisible();
}

/** 화면(썸네일 DOM) 순서의 파일명 */
async function screenOrder(page: Page): Promise<string[]> {
  return page.locator('[data-testid="n1-image-dropzone"] img').evaluateAll((imgs) => imgs.map((img) => img.getAttribute('alt') ?? ''));
}

/** 업로드 응답 results[]로 sourceImageId → fileName 표를 만든다 */
function idToName(calls: ApiCall[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const call of calls) {
    if (call.method !== 'POST' || call.path !== UPLOAD_PATH) continue;
    const results = (call.response as { results?: { fileName: string; ok: boolean; sourceImageId: number | null }[] })?.results ?? [];
    for (const r of results) if (r.ok && r.sourceImageId != null) map.set(r.sourceImageId, r.fileName);
  }
  return map;
}

/** 서버가 마지막으로 알려준 원본 순서(fileName) — reorder 응답, 없으면 마지막 업로드 응답 sourceImages */
function lastServerOrder(calls: ApiCall[]): string[] {
  const names = idToName(calls);
  const last = [...calls]
    .reverse()
    .find((c) => (c.method === 'PATCH' && c.path === `${UPLOAD_PATH}/reorder`) || (c.method === 'POST' && c.path === UPLOAD_PATH));
  const list = Array.isArray(last?.response)
    ? (last!.response as { id: number; uploadOrder: number }[])
    : ((last?.response as { sourceImages?: { id: number; uploadOrder: number }[] })?.sourceImages ?? []);
  return [...list].sort((a, b) => a.uploadOrder - b.uploadOrder).map((img) => names.get(img.id) ?? `?${img.id}`);
}

test.describe('N1 실제 원본 업로드 — draft-first', () => {
  test('정상: 실제 File 2개를 multipart files로 보내고 POST /jobs → upload → PATCH → analyze 순서로 N2 진입', async ({ page }) => {
    const calls = await recordApiCalls(page);
    await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
    await fillRequired(page);
    const a = png('a.png', 1);
    const b = png('b.png', 2);
    await addFiles(page, [a, b]);

    await page.getByRole('button', { name: '다음' }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));
    await expect.poll(() => summarize(calls).includes(`POST ${JOB_PATH}/analyze`)).toBe(true);

    // 호출 순서 — 화면 순서 = 서버 순서이므로 reorder는 필요 없다
    expect(summarize(calls)).toEqual([
      'POST /jobs',
      `POST ${UPLOAD_PATH}`,
      `PATCH ${JOB_PATH}`,
      `POST ${JOB_PATH}/analyze`,
    ]);

    // POST /jobs — draft 계약: brandId만, Idempotency-Key 포함, 응답 Job.id(number)
    const create = writesOf(calls)[0];
    expect(JSON.parse(create.body!)).toEqual({ brandId: MOCK_BRAND_ID });
    expect(create.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(create.status).toBe(201);
    expect((create.response as { id: unknown }).id).toBe(1);
    expect(create.response).not.toHaveProperty('jobId');

    // multipart — field 'files', 2개, 화면 순서, 실제 bytes. Content-Type은 직접 넣지 않는다.
    const upload = writesOf(calls)[1];
    expect(upload.headers['content-type']).toBeUndefined();
    expect(upload.form).toEqual([
      { field: 'files', name: 'a.png', type: 'image/png', bytes: a.buffer.toString('base64') },
      { field: 'files', name: 'b.png', type: 'image/png', bytes: b.buffer.toString('base64') },
    ]);

    // PATCH — JobPatch 확정값만. categoryId는 GET /master/categories의 leaf id(선케어 > 선크림)다.
    // 동의(consentId)·채널 규격은 보내지 않는다.
    expect(JSON.parse(writesOf(calls)[2].body!)).toEqual({
      productName: '업로드 계약 상품',
      productCode: null,
      targetCountry: 'US',
      targetLanguage: 'en',
      regulatoryClass: 'cosmetic',
      specType: 'original',
      imageType: 'multi_section',
      categoryId: SUNSCREEN_CATEGORY_ID,
      keywords: [],
    });

    expect(lastServerOrder(calls)).toEqual(['a.png', 'b.png']);
    expect(JSON.stringify(calls)).not.toContain('mock_file_');
  });

  test('crypto.randomUUID가 없는 환경(일반 HTTP·LAN IP 등 non-secure context)에서도 Idempotency-Key 없이 작업 생성이 진행된다', async ({ page }) => {
    await page.addInitScript(() => {
      // secure context가 아닌 브라우저처럼 randomUUID를 없앤다
      Object.defineProperty(Crypto.prototype, 'randomUUID', { value: undefined, configurable: true });
    });
    const calls = await recordApiCalls(page);
    await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');
    await fillRequired(page);
    await addFiles(page, [png('a.png', 1)]);

    await page.getByRole('button', { name: '다음' }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));
    await expect.poll(() => summarize(calls).includes(`POST ${JOB_PATH}/analyze`)).toBe(true);
    expect(summarize(calls)).toEqual(['POST /jobs', `POST ${UPLOAD_PATH}`, `PATCH ${JOB_PATH}`, `POST ${JOB_PATH}/analyze`]);
    expect(writesOf(calls)[0].headers).not.toHaveProperty('idempotency-key');
    expect(JSON.parse(writesOf(calls)[0].body!)).toEqual({ brandId: MOCK_BRAND_ID });
  });

  test('일부 실패: analyze 없이 N1 유지 → 실패 파일만 같은 draft에 재시도 → 순서 맞춘 뒤 analyze', async ({ page }) => {
    const calls = await recordApiCalls(page);
    await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
    await fillRequired(page);
    const failName = `b${MOCK_UPLOAD_FAIL_ONCE_MARKER}.png`;
    await addFiles(page, [png('a.png', 1), png(failName, 2), png('c.png', 3)]);

    await page.getByRole('button', { name: '다음' }).click();
    const failedCard = page.getByTestId('n1-source-upload-failed');
    await expect(failedCard).toHaveCount(1);
    await expect(failedCard).toContainText('업로드 실패');
    await expect(page.getByText('업로드에 실패한 파일이 있습니다.')).toBeVisible();

    // 실패 파일에만 「다시 시도」, PATCH/analyze 미호출, N1 유지
    await expect(page.getByRole('button', { name: /다시 시도$/ })).toHaveCount(1);
    await expect(page.getByRole('button', { name: `${failName} 다시 시도` })).toBeVisible();
    expect(summarize(calls)).toEqual(['POST /jobs', `POST ${UPLOAD_PATH}`]);
    expect(writesOf(calls)[1].form!.map((f) => f.name)).toEqual(['a.png', failName, 'c.png']);
    await expect(page).toHaveURL(/\/jobs\/new/);

    // 개별 재시도 — 같은 draft, 실패 파일 하나만
    await page.getByRole('button', { name: `${failName} 다시 시도` }).click();
    await expect(failedCard).toHaveCount(0);
    expect(summarize(calls)).toEqual(['POST /jobs', `POST ${UPLOAD_PATH}`, `POST ${UPLOAD_PATH}`]);
    expect(writesOf(calls)[2].form!.map((f) => f.name)).toEqual([failName]);

    // 다음 — 성공 파일은 다시 올리지 않고, 서버 순서(a,c,b)를 화면 순서(a,b,c)로 맞춘 뒤 analyze
    await page.getByRole('button', { name: '다음' }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));
    await expect.poll(() => summarize(calls).includes(`POST ${JOB_PATH}/analyze`)).toBe(true);
    expect(summarize(calls)).toEqual([
      'POST /jobs',
      `POST ${UPLOAD_PATH}`,
      `POST ${UPLOAD_PATH}`,
      `PATCH ${JOB_PATH}`,
      `PATCH ${UPLOAD_PATH}/reorder`,
      `POST ${JOB_PATH}/analyze`,
    ]);
    const names = idToName(calls);
    const reorderBody = JSON.parse(writesOf(calls)[4].body!) as { order: number[] };
    expect(reorderBody.order.map((id) => names.get(id))).toEqual(['a.png', failName, 'c.png']);
    expect(lastServerOrder(calls)).toEqual(['a.png', failName, 'c.png']);
  });

  test('업로드 완료 파일 삭제 → DELETE 후 카드 제거, 최종 서버 순서 = 화면 순서', async ({ page }) => {
    const calls = await recordApiCalls(page);
    await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
    await fillRequired(page);
    const failName = `b${MOCK_UPLOAD_FAIL_ONCE_MARKER}.png`;
    await addFiles(page, [png('a.png', 1), png(failName, 2), png('c.png', 3)]);
    await page.getByRole('button', { name: '다음' }).click();
    await expect(page.getByTestId('n1-source-upload-failed')).toHaveCount(1);

    // a.png는 서버 업로드 완료 — 삭제하면 DELETE /source-images/{id}
    const aId = [...idToName(calls)].find(([, name]) => name === 'a.png')![0];
    await page.getByRole('button', { name: 'a.png 삭제' }).click();
    await expect(page.locator('img[alt="a.png"]')).toHaveCount(0);
    const del = calls.find((c) => c.method === 'DELETE');
    expect(del?.path).toBe(`${UPLOAD_PATH}/${aId}`);
    expect(del?.status).toBe(204);

    await page.getByRole('button', { name: `${failName} 다시 시도` }).click();
    await expect(page.getByTestId('n1-source-upload-failed')).toHaveCount(0);
    const order = await screenOrder(page);
    expect(order).toEqual([failName, 'c.png']);

    await page.getByRole('button', { name: '다음' }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));
    await expect.poll(() => summarize(calls).includes(`POST ${JOB_PATH}/analyze`)).toBe(true);
    expect(summarize(calls).filter((c) => c === 'POST /jobs')).toHaveLength(1);
    expect(lastServerOrder(calls)).toEqual(order);
  });

  test('업로드 실패 파일(서버 거절 형식)은 로컬에서만 삭제 — DELETE 없음, 다른 파일로 진행 가능', async ({ page }) => {
    const calls = await recordApiCalls(page);
    await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
    await fillRequired(page);
    // input accept(image/*)는 그대로 두고, 서버가 JPG·PNG 외 형식을 파일별로 거절하는 계약을 따른다
    await page.locator('#image-upload').setInputFiles([
      png('ok.png', 1),
      { name: 'reject.webp', mimeType: 'image/webp', buffer: Buffer.from('RIFF') },
    ]);
    await page.getByRole('button', { name: '다음' }).click();
    await expect(page.getByTestId('n1-source-upload-failed')).toContainText('지원하지 않는 형식');

    await page.getByRole('button', { name: 'reject.webp 삭제' }).click();
    await expect(page.getByTestId('n1-source-upload-failed')).toHaveCount(0);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);

    await page.getByRole('button', { name: '다음' }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));
    await expect.poll(() => summarize(calls).includes(`POST ${JOB_PATH}/analyze`)).toBe(true);
    expect(summarize(calls).filter((c) => c === `POST ${UPLOAD_PATH}`)).toHaveLength(1);
  });

  test('같은 파일명 2개는 결과를 fileName으로 구분할 수 없어 요청을 나눠 보낸다(순서 유지)', async ({ page }) => {
    const calls = await recordApiCalls(page);
    await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
    await fillRequired(page);
    const first = png('same.png', 1);
    const second = png('same.png', 2);
    await page.locator('#image-upload').setInputFiles([first]);
    await page.locator('#image-upload').setInputFiles([second]);
    await expect(page.locator('img[alt="same.png"]')).toHaveCount(2);

    await page.getByRole('button', { name: '다음' }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));
    await expect.poll(() => summarize(calls).includes(`POST ${JOB_PATH}/analyze`)).toBe(true);
    const uploads = calls.filter((c) => c.method === 'POST' && c.path === UPLOAD_PATH);
    expect(uploads.map((u) => u.form!.map((f) => f.bytes))).toEqual([[first.buffer.toString('base64')], [second.buffer.toString('base64')]]);
  });
});
