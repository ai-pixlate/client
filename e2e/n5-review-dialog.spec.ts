import { type Page, expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// N5 저장 전 확인창(Figma 1313:12384 · F-CFM-09) · 렌더 안 된 section 선택 · 겹침 진단(Mock 전용).
// ─────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1920, height: 1080 } });

const box = async (page: Page, id: string) => (await page.getByTestId(id).boundingBox())!;

const confirmPosts = (page: Page) => {
  const list: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/confirm')) list.push(r.url());
  });
  return list;
};

test('확인 항목이 없으면 확인창 없이 바로 확정한다', async ({ page }) => {
  await reachN5(page, { mockScenario: 'n5-clean' });
  const posts = confirmPosts(page);
  await page.getByTestId('n5-confirm-button').click();
  await expect(page.getByTestId('n5-review-dialog')).toHaveCount(0);
  await expect.poll(() => posts.length).toBe(1);
});

test('확인창 — Figma 구조·실제 데이터 집계, 돌아가기는 요청 없음, 확인하고 저장은 confirm 1회', async ({ page }) => {
  await reachN5(page, { mockScenario: 'n5-errors' });
  const posts = confirmPosts(page);
  const button = page.getByTestId('n5-confirm-button');
  await button.click();

  const dialog = page.getByTestId('n5-review-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog.getByRole('heading', { name: '확인할 항목이 있습니다' })).toBeVisible();
  await expect(dialog).toContainText('해결되지 않은 항목이 남아 있습니다.');
  await expect(dialog).toContainText('확인하고 저장하면 그대로 최종 렌더링 단계로 이동합니다.');

  // geometry — 이 fixture 는 10건(6건 이상)이다. 정책(a56dcca): 6건 이상이면 목록을 5번째 항목까지 보이는 높이로 제한하고
  // 목록만 스크롤한다. 모달 높이는 710 고정이 아니라 그 내용에 맞추고(최대 710), 화면 가운데에 둔다.
  await expect(dialog.locator('[data-review-issue]')).toHaveCount(10);
  const d = await box(page, 'n5-review-dialog');
  const viewport = page.viewportSize()!;
  expect(Math.round(d.width)).toBe(518);
  expect(Math.round(d.x)).toBe(Math.round((viewport.width - 518) / 2));
  expect(d.height).toBeLessThanOrEqual(710);
  expect(Math.abs(d.y + d.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(1);
  // 목록만 스크롤 — 모달 자체는 넘치지 않고, 6번째 항목부터 목록 아래로 가려진다
  const list = page.getByTestId('n5-review-list');
  const scroll = await list.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
  expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
  expect(await dialog.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
  const listBox = await box(page, 'n5-review-list');
  const issueBoxes = await dialog.locator('[data-review-issue]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().bottom));
  expect(issueBoxes[4]).toBeLessThanOrEqual(listBox.y + listBox.height);
  expect(issueBoxes[5]).toBeGreaterThan(listBox.y + listBox.height);
  // 제목·버튼은 밀리지 않고 화면 안에 있다
  await expect(dialog.getByRole('heading', { name: '확인할 항목이 있습니다' })).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId('n5-review-continue')).toBeInViewport({ ratio: 1 });
  const cancelBox = await box(page, 'n5-review-cancel');
  const continueBox = await box(page, 'n5-review-continue');
  expect(Math.round(cancelBox.height)).toBe(45);
  expect(Math.round(continueBox.x - (cancelBox.x + cancelBox.width))).toBe(12);
  expect(Math.round(cancelBox.width + continueBox.width + 12)).toBe(454);
  await page.screenshot({ path: test.info().outputPath('n5-review-dialog.png') });

  // 집계 — fixture: 금지 3(9101 둘 + 기본 9112), 검사 실패 2(9111·9103), 번역 실패 2(9111 + 기본 9107), 실행 실패 3(501 렌더·인페인팅, 505 렌더). 강제 용어(9102)는 세지 않는다
  await expect(page.getByTestId('n5-review-count-regulatory-warning')).toHaveText('3건');
  await expect(page.getByTestId('n5-review-count-verification-failed')).toHaveText('2건');
  await expect(page.getByTestId('n5-review-count-empty-translation')).toHaveText('2건');
  await expect(page.getByTestId('n5-review-count-execution-failed')).toHaveText('3건');
  await expect(page.getByTestId('n5-review-total')).toHaveText('10건');
  const regulatory = page.getByTestId('n5-review-group-regulatory-warning');
  await expect(regulatory).toContainText('섹션 1 -1');
  await expect(regulatory).toContainText('번역문의 표현이 금지 표현 목록에 있습니다');
  await expect(regulatory.locator('h3')).toHaveCSS('color', 'rgb(255, 106, 56)');
  await expect(page.getByTestId('n5-review-group-empty-translation')).toContainText('섹션 1 -3');
  await expect(page.getByTestId('n5-review-group-execution-failed')).toContainText('섹션 1 렌더링');
  await expect(page.getByTestId('n5-review-group-execution-failed')).toContainText('섹션 5 렌더링');
  // 위치 표기(Figma 1657:10490) — 실제 dialog DOM 의 모든 위치 줄이 「섹션 N -M」 또는 「섹션 N 단계」 형식이다
  const locations = await dialog.locator('[data-review-issue] p:first-child').allTextContents();
  expect(locations).toHaveLength(10);
  for (const text of locations) expect(text).toMatch(/^섹션 \d+ (-[1-9]\d*|렌더링|인페인팅)$/);
  expect(locations.join(' ')).not.toMatch(/Section|Block| -0/);

  // 돌아가기
  await page.getByTestId('n5-review-cancel').click();
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
  expect(posts).toEqual([]);

  // 확인하고 저장
  await button.click();
  await page.getByTestId('n5-review-continue').click();
  await expect.poll(() => posts.length).toBe(1);
  await expect(page.getByText('번역이 완료되었습니다.')).toBeVisible({ timeout: 10_000 });
});

// 이 spec 은 section 상태 표시만 본다. 왼쪽 section 배경 클릭 뒤 우측 패널이 움직이지 않는 것(PM 확정)은
// e2e/n5-selection-chrome-panel-scroll.spec.ts 가 맡는다 — 여기서 패널 이동·viewport 진입을 기대하지 않는다.
test('렌더 대기 section을 누르면 그 section이 선택되고, 우측 그 section의 상태가 렌더 대기다', async ({ page }) => {
  await reachN5(page);
  await page.getByTestId('n5-fit-height').click();
  const slice = await box(page, 'n5-slice-translated-504');
  await page.mouse.click(slice.x + slice.width * 0.8, slice.y + slice.height * 0.9);

  await expect(page.getByTestId('n5-section-selected-tag')).toHaveText('Section4');
  await expect(page.getByTestId('n5-section-tag-4')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid^="n5-block-row-"][aria-pressed="true"]')).toHaveCount(0);
  const progress = page.getByTestId('n5-section-status-4-progress');
  await expect(progress).toHaveText('렌더 대기 중');
  await expect(progress.locator('span')).toHaveCSS('color', 'rgb(23, 23, 23)'); // 오류 색이 아니다
  await expect(page.getByTestId('n5-section-status-4-failed')).toHaveCount(0);
});

test('렌더 진행·실패·제외 section도 우측에 각자 상태가 보이고, 실패는 원본을 보인다', async ({ page }) => {
  await reachN5(page, { mockScenario: 'n5-errors' });
  await page.getByTestId('n5-fit-height').click();

  const click = async (id: number) => {
    const s = await box(page, `n5-slice-translated-${id}`);
    await page.mouse.click(s.x + s.width * 0.8, s.y + s.height * 0.95);
  };

  // 상태 표시만 본다 — 패널 이동은 selection 전용 spec 이 맡는다
  await click(504);
  await expect(page.getByTestId('n5-section-tag-4')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('n5-section-status-4-progress')).toHaveText('렌더링 중');

  await click(505);
  await expect(page.getByTestId('n5-section-tag-5')).toHaveAttribute('aria-pressed', 'true');
  const failed = page.getByTestId('n5-section-status-5-failed');
  await expect(failed).toContainText('실행 실패');
  await expect(failed).toContainText('렌더링');
  await expect(page.getByTestId('n5-section-status-5-render-retry')).toBeDisabled();
  await expect(page.getByTestId('n5-slice-translated-505')).toHaveCSS('background-image', /505-original/);

  await click(503);
  await expect(page.getByTestId('n5-section-tag-3')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('n5-section-status-3-progress')).toHaveText('제외된 섹션');
});

test('겹침 진단 — 어떤 block이 어디서 겹치는지 보이고 실제 선택은 바뀌지 않는다', async ({ page }) => {
  await reachN5(page, { mockScenario: 'n5-overlap' });
  const hud = page.getByTestId('n5-overlap-hud');
  await expect(hud).toContainText('block을 선택하세요');

  await page.getByTestId('n5-block-pin-9102').click();
  const label = page.getByTestId('n5-overlap-label-9111');
  await expect(label).toContainText('Block 2 ↔ Block 3');
  // 겹침은 화면 박스(Auto Height 표시 포함) 기준이다 — 폭은 fixture 그대로 300, 높이는 아래 area 검증이 화면 박스로 확인한다
  await expect(label).toContainText(/겹침 300 × \d+(\.\d+)? px/);
  await expect(page.getByTestId('n5-overlap-block-9111')).toHaveCSS('border-top-style', 'dashed');
  await expect(page.getByTestId('n5-overlap-block-9111')).toHaveCSS('pointer-events', 'none');

  const area = await box(page, 'n5-overlap-area-9111');
  const selected = await box(page, 'n5-block-overlay-9102');
  const other = await box(page, 'n5-block-overlay-9111');
  expect(Math.round(area.x)).toBe(Math.round(Math.max(selected.x, other.x)));
  expect(Math.round(area.y)).toBe(Math.round(Math.max(selected.y, other.y)));
  expect(Math.round(area.width)).toBe(Math.round(other.width));
  expect(Math.abs(area.height - (Math.min(selected.y + selected.height, other.y + other.height) - other.y))).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath('n5-overlap.png') });

  // hit testing은 그대로 — 겹친 영역을 누르면 DOM 순서대로 위에 있는 block이 잡힌다
  await page.mouse.click(area.x + area.width / 2, area.y + area.height / 2);
  await expect(page.getByTestId('n5-block-row-9111')).toHaveAttribute('aria-pressed', 'true');
});

test('겹침 진단은 Mock 시나리오 없이는 보이지 않는다', async ({ page }) => {
  await reachN5(page);
  await page.getByTestId('n5-block-pin-9102').click();
  await expect(page.getByTestId('n5-overlap-hud')).toHaveCount(0);
});
