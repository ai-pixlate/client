import { type Page, expect, test } from '@playwright/test';

import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';
import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// N5 /preview 렌더 입력·시도·결과(server PR #108) 연결.
// - 최신 renderInput 섹션(정상 입력 + 지문 A=B + isCurrent)은 background.url 위에 서버 style 8키로 HTML 조판한다(renderedUrl 과 겹치지 않는다)
// - 입력 상태와 렌더 상태를 따로 보인다(준비 중 · 입력 오류 · 대기 · 실패 · 이전 결과 · 결과 없음)
// - 넘침은 최신 결과의 overflow 만 쓴다. 박스·글자 배율은 서버로 보내지 않는다
// Mock 시나리오 ?mockScenario=n5-preview-<state> 는 섹션 502(화면 Section2) 하나만 덮는다.
// 서버 이미지(Pillow)와 HTML 조판의 픽셀 비교는 하지 않는다(자간 미적용 등 렌더러가 다르다).
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', '조판 검증은 Chromium 기준이다');
test.use({ viewport: { width: 1920, height: 1080 } });

const qaUrl = (scenario?: string) => `/jobs/${MOCK_JOB_ID}?qaTypeset=1${scenario ? `&mockScenario=n5-preview-${scenario}` : ''}`;
const slice = (page: Page, id: number) => page.getByTestId(`n5-slice-translated-${id}`);
const render = (page: Page, id: number) => page.locator(`[data-typeset-render="${id}"]`);
const status2 = 'n5-section-status-2';

async function open(page: Page, scenario?: string) {
  await page.goto(qaUrl(scenario));
  await expect(page.getByTestId('n5-qa-badge')).toBeVisible({ timeout: 20_000 });
}

function recordWrites(page: Page) {
  const writes: { path: string; body: unknown }[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && new URL(r.url()).pathname.startsWith('/jobs')) writes.push({ path: `${r.method()} ${new URL(r.url()).pathname}`, body: r.postDataJSON() });
  });
  return writes;
}

const overlayBox = (page: Page, id: number) =>
  page.getByTestId(`n5-block-overlay-${id}`).evaluate((el) => {
    const { left, top, width, height } = (el as HTMLElement).style;
    return { left: parseFloat(left), top: parseFloat(top), width: parseFloat(width), height: parseFloat(height) };
  });
const near = (a: number, b: number, label = '', tolerance = 0.6) => expect(Math.abs(a - b), `${label} ${a} ≈ ${b}`).toBeLessThanOrEqual(tolerance);

test('최신 renderInput — 배경 위 HTML 조판, 서버 style 8키·정렬 그대로, 이중 렌더 없음', async ({ page }) => {
  await open(page);
  for (const id of [501, 502, 505]) {
    await expect(slice(page, id)).toHaveAttribute('data-preview-display', 'local-typeset');
    await expect(slice(page, id)).toHaveCSS('background-image', new RegExp(`${id}-background`));
    await expect(slice(page, id)).not.toHaveCSS('background-image', /translated/);
  }
  // background.source 는 그대로 둔다(505 는 인페인트 생략으로 원본 위)
  await expect(slice(page, 501)).toHaveAttribute('data-background-source', 'inpaint');
  await expect(slice(page, 505)).toHaveAttribute('data-background-source', 'original');

  const css = (id: number) =>
    render(page, id).evaluate((el) => {
      const s = getComputedStyle(el);
      return { align: s.textAlign, size: s.fontSize, weight: s.fontWeight, color: s.color, spacing: (el as HTMLElement).style.letterSpacing, lineHeight: (el as HTMLElement).style.lineHeight, family: s.fontFamily };
    });
  const title = await css(9101);
  expect(title.align).toBe('center');
  near(parseFloat(title.size), (32 * 1000) / 375, 'title size', 0.01); // fontSizePx × fontScale(1) — 한 번만
  expect(title.weight).toBe('600');
  expect(title.color).toBe('rgb(34, 34, 34)');
  expect(title.spacing).toBe('-0.015em');
  expect(title.lineHeight).toBe('1.2');
  expect(title.family).toContain('Pretendard');
  expect((await css(9103)).align).toBe('right');
  expect((await css(9102)).align).toBe('left');
  // 렌더 대상만 그린다 — 502 의 라벨(9105)은 renderInput 에 없다. 501 은 렌더 대상 3개
  await expect(page.getByTestId('n5-text-layer-502').locator('[data-typeset-render="9105"]')).toHaveCount(0);
  await expect(page.getByTestId('n5-text-layer-501').locator('[data-typeset-render]')).toHaveCount(3);
  await page.screenshot({ path: test.info().outputPath('render-input-current.png') });

  // 입력 준비 중(504) — 결과 없음 → 원본 + 렌더 대기 중
  await expect(slice(page, 504)).toHaveAttribute('data-preview-display', 'original-image');
  await expect(page.getByTestId('n5-section-status-4-progress')).toHaveText('렌더 대기 중');
  // 제외(503)
  await expect(slice(page, 503)).toHaveAttribute('data-preview-display', 'excluded');
});

test('정렬 기준점 — left·center·right 가 [+] 에서 각각 왼쪽·가운데·오른쪽을 지키고, 글자 크기는 fontSizePx × 절대 배율이다', async ({ page }) => {
  const writes = recordWrites(page);
  await open(page);
  for (const [id, anchor] of [
    // 9102 는 폭 900 이라 [+] 가 섹션 경계에서 밀린다 — 경계와 무관한 폭 300 블록으로 본다
    [9111, 'left'],
    [9101, 'center'],
    [9103, 'right'],
  ] as const) {
    await page.getByTestId(`n5-block-pin-${id}`).click();
    const before = await overlayBox(page, id);
    const sizeBefore = parseFloat(await render(page, id).evaluate((el) => getComputedStyle(el).fontSize));
    // 9101 은 폭 900 이라 두 번이면 섹션 경계에 닿는다 — 한 번만 누른다
    const presses = id === 9101 ? 1 : 2;
    await page.getByTestId('n5-font-scale-handle').click();
    for (let i = 0; i < presses; i += 1) await page.getByTestId('n5-font-scale-increase').click();
    const after = await overlayBox(page, id);
    expect(after.width).toBeGreaterThan(before.width);
    if (anchor === 'left') near(after.left, before.left, `${id} left`);
    if (anchor === 'center') near(after.left + after.width / 2, before.left + before.width / 2, `${id} center`);
    if (anchor === 'right') near(after.left + after.width, before.left + before.width, `${id} right`);
    near(after.top, before.top, `${id} top`);
    // 두 번 눌러도 기준 크기 × 1.1(절대 배율) — 직전 크기에 다시 곱하지 않는다
    const sizeAfter = parseFloat(await render(page, id).evaluate((el) => getComputedStyle(el).fontSize));
    near(sizeAfter, sizeBefore * (1 + 0.05 * presses), `${id} size`, 0.05);
    // Auto Height — 표시와 같은 style 로 잰 높이
    const textHeight = await render(page, id).evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect().height;
    });
    near(after.height, textHeight, `${id} auto height`, 1);
    await page.screenshot({ path: test.info().outputPath(`align-${anchor}.png`) });
  }
  // 박스·글자 배율은 세션 local — 서버로 보내지 않는다
  expect(writes).toEqual([]);
});

test('번역 저장 — 글만 PATCH 하고, 재렌더 동안은 이전 결과(최신 아님)·넘침 없음, 끝나면 다시 최신 조판이다', async ({ page }) => {
  const writes = recordWrites(page);
  await open(page);
  // 최신 결과의 넘침만 정본 — 9104 는 넘침
  await expect(page.getByTestId('n5-block-row-9104').getByTestId('n5-cell-failure-overflow')).toBeVisible();
  const editor = page.getByTestId('n5-block-editor-9112');
  await editor.fill('Visible effect');
  // 저장 전 초안이 바로 조판에 보인다
  await expect(render(page, 9112)).toHaveText('Visible effect');
  await page.getByTestId('n5-block-save-9112').click();
  await expect(slice(page, 502)).toHaveAttribute('data-preview-display', 'previous-rendered-image');
  await expect(page.getByTestId(`${status2}-notice`)).toHaveText('최신 미리보기 아님');
  // 최신이 아닌 동안 넘침을 내지 않는다
  await expect(page.getByTestId('n5-block-row-9104').getByTestId('n5-cell-failure-overflow')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('save-rerendering.png') });
  await expect(slice(page, 502)).toHaveAttribute('data-preview-display', 'local-typeset', { timeout: 15_000 });
  await expect(page.getByTestId(`${status2}-notice`)).toHaveCount(0);
  await expect(render(page, 9112)).toHaveText('Visible effect');
  await expect(page.getByTestId('n5-block-row-9104').getByTestId('n5-cell-failure-overflow')).toBeVisible();
  expect(writes.map((w) => w.path)).toEqual([`PATCH /jobs/${MOCK_JOB_ID}/blocks/9112`]);
  expect(Object.keys(writes[0].body as object).sort()).toEqual(['revision', 'trans1']);
});

const SCENARIOS: {
  name: string;
  display: string;
  progress: string | null;
  notice: string | null;
  failed: boolean;
}[] = [
  { name: 'preparing-previous', display: 'previous-rendered-image', progress: null, notice: '최신 미리보기 아님', failed: false },
  { name: 'preparing-failed', display: 'original-image', progress: null, notice: null, failed: true },
  { name: 'input-error', display: 'original-image', progress: null, notice: '미리보기 입력 오류', failed: false },
  { name: 'pending', display: 'original-image', progress: '렌더 대기 중', notice: null, failed: false },
  { name: 'failed', display: 'original-image', progress: null, notice: null, failed: true },
  { name: 'stale', display: 'previous-rendered-image', progress: null, notice: '최신 미리보기 아님', failed: false },
  { name: 'missing', display: 'original-image', progress: null, notice: '미리보기 없음', failed: false },
];

for (const s of SCENARIOS) {
  test(`상태 ${s.name} — 표시 ${s.display}${s.progress ? ` · ${s.progress}` : ''}${s.notice ? ` · ${s.notice}` : ''}${s.failed ? ' · 실행 실패' : ''}`, async ({ page }) => {
    await open(page, s.name);
    await expect(slice(page, 502)).toHaveAttribute('data-preview-display', s.display);
    // 서버 renderInput 조판은 최신 결과에서만 — QA 는 그 밖의 섹션을 역할 기본값으로 진단 표시한다
    await expect(slice(page, 502)).toHaveAttribute('data-qa-typeset', 'role-default');
    const progress = page.getByTestId(`${status2}-progress`);
    if (s.progress) await expect(progress).toHaveText(s.progress);
    else await expect(progress).toHaveCount(0);
    const notice = page.getByTestId(`${status2}-notice`);
    if (s.notice) await expect(notice).toHaveText(s.notice);
    else await expect(notice).toHaveCount(0);
    // 실패는 「실행 실패」 행 하나(같은 경고를 두 번 내지 않는다)
    await expect(page.getByTestId(`${status2}-failed`)).toHaveCount(s.failed ? 1 : 0);
    // 최신이 아니면 넘침을 내지 않는다
    await expect(page.getByTestId('n5-block-row-9104').getByTestId('n5-cell-failure-overflow')).toHaveCount(0);
    // 다른 섹션은 그대로 최신
    await expect(slice(page, 501)).toHaveAttribute('data-preview-display', 'local-typeset');
    await page.screenshot({ path: test.info().outputPath(`scenario-${s.name}.png`) });
  });
}

test('입력 오류 — 원래 코드는 data 속성으로만 확인하고 다시 시도 버튼이 없다', async ({ page }) => {
  await open(page, 'input-error');
  await expect(page.getByTestId(`${status2}-notice`)).toHaveAttribute('data-input-error-code', 'STYLE_RESULT_INVALID');
  await expect(page.getByTestId(`${status2}-render-retry`)).toHaveCount(0);
});

test('지문 A≠B — 한 번만 다시 불러오고, 계속 다르면 표와 뷰어를 잇지 않은 채 둔다', async ({ page }) => {
  const reads: string[] = [];
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (r.method() === 'GET' && (path.endsWith('/preview') || path.endsWith('/blocks'))) reads.push(path);
  });
  await open(page, 'ab-mismatch');
  await expect(page.getByTestId(`${status2}-notice`)).toHaveText('최신 내용을 불러오는 중');
  // 조판하지 않고 최신 서버 이미지로 둔다
  await expect(slice(page, 502)).toHaveAttribute('data-preview-display', 'current-rendered-image');
  await expect(slice(page, 502)).toHaveAttribute('data-preview-syncing', 'true');
  await page.waitForTimeout(6_000);
  const previewReads = reads.filter((p) => p.endsWith('/preview')).length;
  const blockReads = reads.filter((p) => p.endsWith('/blocks')).length;
  // 첫 조회 + 한 번 재조회. 무한 재조회 없음
  expect(previewReads).toBeLessThanOrEqual(2);
  expect(blockReads).toBeLessThanOrEqual(2);
  // 연결하지 않은 섹션은 서버 align(9103 right)을 쓰지 않는다 — QA 진단의 역할 기본값(left)으로 그린다
  await expect(slice(page, 502)).toHaveAttribute('data-qa-typeset', 'role-default');
  expect(await render(page, 9103).evaluate((el) => getComputedStyle(el).textAlign)).toBe('left');
});

test('일반 N5 — 이전 결과 섹션은 renderedUrl, 최신 섹션은 배경 위 HTML 이다', async ({ page }) => {
  await reachN5(page, { mockScenario: 'n5-preview-stale' });
  await expect(page.getByTestId('n5-qa-badge')).toHaveCount(0);
  await expect(slice(page, 502)).toHaveAttribute('data-preview-display', 'previous-rendered-image');
  await expect(slice(page, 502)).toHaveCSS('background-image', /502-translated/);
  await expect(page.getByTestId('n5-text-layer-502')).toHaveCount(0);
  await expect(page.getByTestId(`${status2}-notice`)).toHaveText('최신 미리보기 아님');
  await expect(slice(page, 501)).toHaveAttribute('data-preview-display', 'local-typeset');
  await expect(slice(page, 501)).toHaveCSS('background-image', /501-background/);
  await expect(render(page, 9102)).toContainText('high-concentration');
  // 결과 없는 입력 준비 중 섹션은 원본
  await expect(slice(page, 504)).toHaveCSS('background-image', /504-original/);
  await page.screenshot({ path: test.info().outputPath('normal-stale.png'), fullPage: false });
});
