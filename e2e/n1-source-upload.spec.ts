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

// ─────────────────────────────────────────────────────────────────
// Job 생성 시점 (PM 전제) — N1 진입·입력·파일 선택·동의까지는 서버 Job도 서버 원본도 없다.
// [다음]을 눌러야 POST /jobs(createdAt) → 업로드 → PATCH → (reorder) → analyze 순서로 진행한다.
// ─────────────────────────────────────────────────────────────────

const countOf = (calls: ApiCall[], method: string, path: string) =>
  calls.filter((c) => c.method === method && c.path === path).length;
const nextButton = (page: Page) => page.getByRole('button', { name: '다음', exact: true });
const exitButton = (page: Page) => page.getByRole('button', { name: '보관함으로 나가기' });
const exitDialog = (page: Page) => page.getByTestId('n1-exit-dialog');

/** 화면의 모든 입력 상호작용을 거쳐도 [다음] 전에는 쓰기 요청이 하나도 없다 */
async function expectNoServerWrites(calls: ApiCall[]) {
  expect(countOf(calls, 'POST', '/jobs')).toBe(0);
  expect(calls.filter((c) => c.path.endsWith('/source-images') || c.path.includes('/source-images/'))).toEqual([]);
  expect(summarize(calls)).toEqual([]);
}

/** OS 파일 drag & drop — 클릭 업로드와 같은 addFiles 경로로 들어간다 */
async function dropFile(page: Page, file: ReturnType<typeof png>) {
  const dataTransfer = await page.evaluateHandle(
    ({ name, mimeType, b64 }) => {
      const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name, { type: mimeType }));
      return dt;
    },
    { name: file.name, mimeType: file.mimeType, b64: file.buffer.toString('base64') },
  );
  await page.dispatchEvent('[data-testid="n1-image-dropzone"]', 'drop', { dataTransfer });
  await expect(page.locator(`img[alt="${file.name}"]`)).toBeVisible();
}

test.describe('Job 생성 시점 — [다음] 전에는 Job·서버 원본이 없다', () => {
  test('N1 진입만으로는 POST /jobs·source-images 요청이 없다', async ({ page }) => {
    const calls = await recordApiCalls(page);
    await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
    await expect(nextButton(page)).toBeDisabled();
    // 카테고리 목록 조회(GET /master/categories)까지 끝난 뒤에도 쓰기 요청은 없다
    await expect.poll(() => calls.some((c) => c.path === '/master/categories')).toBe(true);
    await expectNoServerWrites(calls);
  });

  test('파일 선택·drop·순서 변경·삭제와 모든 입력·동의를 거쳐도 [다음] 전에는 서버 요청이 없다', async ({ page }) => {
    const calls = await recordApiCalls(page);
    await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);

    await addFiles(page, [png('a.png', 1), png('b.png', 2)]);
    await expect(page.getByText('이미지 2개')).toBeVisible();
    await expectNoServerWrites(calls);

    await dropFile(page, png('c.png', 3));
    await expect(page.getByText('이미지 3개')).toBeVisible();

    // 썸네일 드래그 재정렬 — 로컬 순서만 바뀐다
    const card = (name: string) => page.locator(`img[alt="${name}"]`).locator('..');
    await card('c.png').dragTo(card('a.png'));
    await expect.poll(() => screenOrder(page)).toEqual(['c.png', 'a.png', 'b.png']);

    // 업로드 전 파일 삭제는 로컬에서만 지운다(DELETE 없음)
    await page.getByRole('button', { name: 'b.png 삭제' }).click();
    await expect(page.locator('img[alt="b.png"]')).toHaveCount(0);

    await fillRequired(page); // 상품명·국가·언어·규제 분류·카테고리·동의
    const keyword = page.getByPlaceholder('키워드를 입력해주세요.');
    await keyword.fill('보습');
    await keyword.press('Enter');
    await expect(nextButton(page)).toBeEnabled();

    await expectNoServerWrites(calls);
    expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
  });

  test('[다음]은 POST /jobs 1회 → 응답 jobId로 업로드 → PATCH → reorder → analyze 순서다', async ({ page }) => {
    const calls = await recordApiCalls(page);
    await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
    // 가운데 파일 업로드 실패 1회 → 재시도로 서버 순서(a,c,b)가 화면(a,b,c)과 달라져 reorder까지 지나가는 경로
    const failName = `b${MOCK_UPLOAD_FAIL_ONCE_MARKER}.png`;
    await addFiles(page, [png('a.png', 1), png(failName, 2), png('c.png', 3)]);
    await fillRequired(page);
    await expectNoServerWrites(calls);

    await nextButton(page).click();
    await page.getByRole('button', { name: `${failName} 다시 시도` }).click();
    await nextButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));
    await expect.poll(() => summarize(calls).includes(`POST ${JOB_PATH}/analyze`)).toBe(true);

    expect(countOf(calls, 'POST', '/jobs')).toBe(1);
    const index = (method: string, path: string) => calls.findIndex((c) => c.method === method && c.path === path);
    const lastIndex = (method: string, path: string) =>
      calls.length - 1 - [...calls].reverse().findIndex((c) => c.method === method && c.path === path);
    const create = index('POST', '/jobs');
    const firstUpload = calls.findIndex((c) => c.path.startsWith('/jobs/') && c.path.includes('/source-images'));
    // 서버 원본 요청은 Job 생성보다 먼저 나가지 않고, 생성 응답의 id로 만든 경로만 쓴다
    expect(create).toBeGreaterThanOrEqual(0);
    expect(firstUpload).toBeGreaterThan(create);
    expect(String((calls[create].response as { id: number }).id)).toBe(MOCK_JOB_ID);
    for (const c of calls.filter((c) => c.path.includes('/source-images'))) expect(c.path.startsWith(`${JOB_PATH}/`)).toBe(true);
    expect(lastIndex('POST', UPLOAD_PATH)).toBeLessThan(index('PATCH', JOB_PATH));
    expect(index('PATCH', JOB_PATH)).toBeLessThan(index('PATCH', `${UPLOAD_PATH}/reorder`));
    expect(index('PATCH', `${UPLOAD_PATH}/reorder`)).toBeLessThan(index('POST', `${JOB_PATH}/analyze`));
  });

  test('응답이 느린 동안 [다음]을 여러 번 눌러도 POST /jobs는 1회이고, 처리 중에는 ✕가 막힌다', async ({ page }) => {
    // POST /jobs 응답을 늦춘다(기록기보다 먼저 등록해 기록기가 이 지연된 fetch를 감싼다)
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (init?.method === 'POST' && new URL(url, location.href).pathname === '/jobs') {
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        return originalFetch(input, init);
      };
    });
    const calls = await recordApiCalls(page);
    await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
    await addFiles(page, [png('a.png', 1)]);
    await fillRequired(page);

    // 리렌더 전 같은 task 안의 연속 클릭 + 처리 중 추가 클릭
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '다음')!;
      button.click();
      button.click();
      button.click();
    });
    await expect(page.getByRole('button', { name: '생성 중...' })).toBeDisabled();
    await expect(exitButton(page)).toBeDisabled();
    await page.getByRole('button', { name: '생성 중...' }).click({ force: true });

    await expect(page).toHaveURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`), { timeout: 15_000 });
    expect(countOf(calls, 'POST', '/jobs')).toBe(1);
    expect(countOf(calls, 'POST', `${JOB_PATH}/analyze`)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────
// N1 ✕ — draft job 유무로 동작이 다르다(PRD F-JOB-07).
// 작업 없음: 저장되지 않는다는 안내 후 보관함 이동(서버 요청 없음).
// 작업 있음: 작업 취소 확인 → DELETE /jobs/{jobId}(API-JOB-04) → 성공 시 보관함 이동, 실패 시 N1 유지.
// ─────────────────────────────────────────────────────────────────

test.describe('N1 ✕ — 작업 유무에 따른 이탈', () => {
  test('작업이 없으면 저장되지 않는다는 안내 후 보관함으로 가고, 취소 API를 부르지 않는다', async ({ page }) => {
    const calls = await recordApiCalls(page);
    await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
    await addFiles(page, [png('a.png', 1)]);
    await page.getByRole('checkbox', { name: /외부 AI 서비스로 전송됨을 확인했습니다/ }).check();

    await exitButton(page).click();
    const dialog = exitDialog(page);
    await expect(dialog).toHaveAccessibleName('작성을 그만두고 나갈까요?');
    await expect(dialog).toContainText('입력한 정보와 선택한 이미지는 저장되지 않습니다.');
    // [계속 작성]·Esc는 닫기만 하고 입력은 그대로다
    await dialog.getByRole('button', { name: '계속 작성' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(exitButton(page)).toBeFocused();
    await exitButton(page).click();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('img[alt="a.png"]')).toBeVisible();

    await exitButton(page).click();
    await dialog.getByRole('button', { name: '나가기' }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
    expect(countOf(calls, 'POST', '/jobs')).toBe(0);
  });

  /** [다음]으로 작업을 만든 뒤 업로드 실패로 N1에 남은 상태 */
  async function leaveDraftOnN1(page: Page) {
    const failName = `a${MOCK_UPLOAD_FAIL_ONCE_MARKER}.png`;
    await addFiles(page, [png(failName, 1)]);
    await fillRequired(page);
    await nextButton(page).click();
    await expect(page.getByRole('button', { name: `${failName} 다시 시도` })).toBeVisible();
    await expect(page).toHaveURL(/\/jobs\/new/);
    return failName;
  }

  test('작업이 생긴 뒤에는 작업 취소 확인 → DELETE /jobs/{jobId} 성공 후 보관함으로 간다', async ({ page }) => {
    const calls = await recordApiCalls(page);
    await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
    await leaveDraftOnN1(page);
    expect(summarize(calls)).toEqual(['POST /jobs', `POST ${UPLOAD_PATH}`]);

    await exitButton(page).click();
    const dialog = exitDialog(page);
    await expect(dialog).toHaveAccessibleName('작업을 취소할까요?');
    await expect(dialog).toContainText('이미 만든 작업과 올린 이미지가 삭제되고 보관함으로 이동합니다.');
    await expect(dialog).not.toContainText('저장되지 않습니다');
    await dialog.getByRole('button', { name: '작업 취소' }).click();

    await expect(page).toHaveURL(/\/$/);
    const cancel = calls.filter((c) => c.method === 'DELETE');
    expect(cancel.map((c) => c.path)).toEqual([JOB_PATH]);
    expect(cancel[0].body).toBeNull();
    expect(cancel[0].status).toBe(204);
  });

  test('작업 취소가 실패하면 N1과 작업을 그대로 두고 실패를 알린다', async ({ page }) => {
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (init?.method === 'DELETE' && /^\/jobs\/[^/]+$/.test(new URL(url, location.href).pathname)) {
          return new Response(
            JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'fail', retryable: true, traceId: 't' } }),
            { status: 500, headers: { 'content-type': 'application/json' } },
          );
        }
        return originalFetch(input, init);
      };
    });
    const calls = await recordApiCalls(page);
    await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
    const failName = await leaveDraftOnN1(page);

    await exitButton(page).click();
    const dialog = exitDialog(page);
    await dialog.getByRole('button', { name: '작업 취소' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('작업을 취소하지 못했습니다. 다시 시도해 주세요.');
    await expect(page).toHaveURL(/\/jobs\/new/);
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.status)).toEqual([500]);

    // 닫고 다시 열어도 작업이 있는 상태 그대로다(실패 문구는 지워진다)
    await dialog.getByRole('button', { name: '계속 작성' }).click();
    await expect(page.getByRole('button', { name: `${failName} 다시 시도` })).toBeVisible();
    await exitButton(page).click();
    await expect(dialog).toHaveAccessibleName('작업을 취소할까요?');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    expect(countOf(calls, 'POST', '/jobs')).toBe(1);
  });
});
