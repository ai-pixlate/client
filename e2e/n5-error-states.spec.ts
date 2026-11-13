import { expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';
import { useLocalLayoutEditing } from './helpers/layout-write';

// ─────────────────────────────────────────────────────────────────
// N5 오류 표시(Figma 388:3814) — lib/mock-api/n5-error-fixtures.ts 시나리오로 확인한다. 기본 fixture는 그대로다.
// 한 번의 N5 진입(약 30초) 안에서 상태별로 확인한다.
// ─────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1920, height: 1080 } });

// 박스·배율은 세션 local 편집만 본다 — Mock 에서도 layoutAdjust 쓰기를 끈다(실서버 쓰기 차단과 같은 동작). 저장 흐름은 n5-layout-adjust.spec.ts
test.beforeEach(async ({ page }) => {
  await useLocalLayoutEditing(page);
});

test('오류 종합 — section·signal·번역문 칸 실패가 함께 보이고 패널 구조가 유지된다', async ({ page }) => {
  await reachN5(page, { mockScenario: 'n5-errors' });
  const panel = page.getByTestId('n5-panel');

  // block signal — [라벨] 사유 한 행, tooltip 없이 바로 읽힌다
  const warning = page.getByTestId('n5-block-signal-9101-prohibited_expression').first();
  await expect(warning).toContainText('금지 표현');
  await expect(warning).toContainText('번역문의 표현이 금지 표현 목록에 있습니다');
  await expect(warning.locator('[title]')).toHaveCount(0);
  await expect(warning.locator('span').first()).toHaveCSS('background-color', 'rgb(255, 240, 235)');
  const neutral = page.getByTestId('n5-block-signal-9102-mandatory_term_unapplied');
  await expect(neutral).toContainText('번역문에 강제 용어가 적용되지 않았습니다');
  await expect(neutral.locator('span').first()).toHaveCSS('background-color', 'rgb(245, 245, 245)');

  // 번역 실패 칸
  const failed = page.getByTestId('n5-block-row-9111');
  await expect(failed.getByTestId('n5-cell-failure-translate')).toHaveText('번역하지 못했습니다');
  await expect(page.getByTestId('n5-block-editor-9111')).toHaveAttribute('placeholder', '번역문을 직접 입력하세요');
  await expect(failed).toContainText('번역문이 생성되지 않아 번역 근거가 없습니다.');
  await expect(failed.getByTestId('n5-cell-failure-verify')).toHaveText('검사하지 못했습니다');
  const retry = page.getByTestId('n5-block-translate-retry-9111');
  await expect(retry).toHaveText('다시 시도');
  expect((await retry.boundingBox())!.height).toBe(24);

  // 미리보기·넘침 칸
  const preview = page.getByTestId('n5-block-row-9103');
  await expect(preview.getByTestId('n5-cell-failure-preview')).toHaveText('미리보기를 갱신하지 못했습니다');
  await expect(preview.getByTestId('n5-cell-failure-overflow')).toHaveText('글자가 넘칩니다 — 짧은 표현이 필요합니다');
  await expect(preview.getByTestId('n5-block-preview-retry-9103')).toHaveText('미리보기 다시 시도');

  // section 상태 — block 목록 위, block signal과 분리
  const section = page.getByTestId('n5-section-status-1');
  await expect(section).toContainText('실행 실패');
  await expect(section).toContainText('렌더링');
  await expect(section).toContainText('인페인팅');
  await expect(section.getByTestId('n5-section-status-1-render-retry')).toHaveText('렌더링 다시 시도');
  await expect(section).toContainText('N3에서 되살린 섹션');
  for (const label of ['규제 위반', '채널 정책', '규제 표현', '조건부 규제', '현지 수정 필수', '현지 확인 필요']) {
    await expect(section.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(section).toContainText('품질 주의');
  // 패널 — Figma 1244:8444: 태그 y123, 상태 y167(높이 114), 목록 y309. 433 폭에서 배지가 줄을 바꾼다
  const panelBody = page.getByTestId('n5-panel-body');
  await panelBody.evaluate((el) => el.scrollTo(0, 0));
  const panelTag = (await page.getByTestId('n5-section-tag-1').boundingBox())!;
  const panelStatus = (await section.boundingBox())!;
  expect(Math.round(panelTag.y)).toBe(123);
  expect(Math.round(panelStatus.y)).toBe(167);
  expect(Math.round(panelStatus.height)).toBe(114);
  expect(Math.round((await page.getByTestId('n5-section-status-1-tags').boundingBox())!.height)).toBe(54);
  expect(Math.round((await page.getByTestId('n5-block-row-9101').boundingBox())!.y)).toBe(309);
  await page.screenshot({ path: test.info().outputPath('n5-errors-panel-top.png') });
  const sectionBottom = (await section.boundingBox())!;
  const firstRow = (await page.getByTestId('n5-block-row-9101').boundingBox())!;
  expect(firstRow.y).toBeGreaterThan(sectionBottom.y + sectionBottom.height);
  await expect(page.getByTestId('n5-section-status-2')).toContainText('정품 로고 매칭에 실패했습니다');

  await failed.scrollIntoViewIfNeeded();
  await page.getByTestId('n5-panel').screenshot({ path: test.info().outputPath('n5-errors-translate-cell.png') });
  await preview.scrollIntoViewIfNeeded();
  await page.getByTestId('n5-panel').screenshot({ path: test.info().outputPath('n5-errors-preview-cell.png') });

  // 패널 구조 — 헤더·저장 버튼은 제자리에 있고 목록만 스크롤한다
  const confirm = (await page.getByTestId('n5-confirm-button').boundingBox())!;
  expect([Math.round(confirm.y), Math.round(confirm.height)]).toEqual([955, 45]);
  const body = page.getByTestId('n5-panel-body');
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect(panel.getByRole('heading', { name: '번역 결과' })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('n5-errors-panel.png') });

  // canvas — Figma 1244:8444: 태그 y123, 상태 y167(650×86), 이미지 y257(태그부터 134)
  await page.getByTestId('n5-section-tag-1').click();
  await expect(page.getByTestId('n5-section-selected-tag')).toHaveText('Section1');
  const slice = (await page.getByTestId('n5-slice-translated-501').boundingBox())!;
  const tag = (await page.getByTestId('n5-section-selected-tag').boundingBox())!;
  const status = (await page.getByTestId('n5-section-header-1').getByTestId('n5-canvas-section-status').boundingBox())!;
  expect(Math.round(tag.y)).toBe(123);
  expect(Math.round(tag.height)).toBe(28);
  expect(tag.width).toBeLessThan(70); // Figma 60 — 내용 폭이다
  expect(Math.round(status.y)).toBe(167);
  expect(Math.round(status.width)).toBe(650);
  expect(Math.round(status.height)).toBe(86);
  expect(Math.round(slice.y)).toBe(257);
  expect(Math.round(slice.y - tag.y)).toBe(134);
  expect(Math.round(status.x)).toBe(Math.round(slice.x));
  expect(Math.round(tag.x)).toBe(Math.round(slice.x));
  const tagsRow = (await page.getByTestId('n5-section-header-1').getByTestId('n5-canvas-section-status-tags').boundingBox())!;
  expect(Math.round(tagsRow.height)).toBe(26); // 650 폭에서 한 줄
  // 선택 UI는 밀린 이미지를 따라간다
  await page.getByTestId('n5-block-row-9102').click();
  const overlay = (await page.getByTestId('n5-block-overlay-9102').boundingBox())!;
  expect(Math.round(overlay.y - slice.y)).toBe(80); // bbox.y 200 × scale 0.4
  const nw = (await page.getByTestId('n5-block-handle-nw').boundingBox())!;
  expect(Math.abs(nw.y + nw.height / 2 - overlay.y)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath('n5-errors-canvas.png') });

  // 재시도 — N5 호출 계약이 확인되기 전이라 버튼은 비활성이고 요청을 보내지 않는다
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && new URL(r.url()).pathname.startsWith('/jobs')) posts.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  for (const button of [retry, preview.getByTestId('n5-block-preview-retry-9103'), page.getByTestId('n5-section-status-1-render-retry')]) {
    await expect(button).toBeDisabled();
    await button.click({ force: true });
  }
  await expect(failed.getByTestId('n5-cell-failure-translate')).toBeVisible();
  expect(posts).toEqual([]);

  // 넘침 안내는 고치는 동안 이전 판정을 보이지 않는다
  await page.getByTestId('n5-block-editor-9103').fill('Short');
  await expect(preview.getByTestId('n5-cell-failure-overflow')).toHaveCount(0);
});

test('기본 화면 — signal 사유가 바로 읽히고 하단 중앙 도구가 없다', async ({ page }) => {
  await reachN5(page);
  await expect(page.getByTestId('n5-block-signal-9112-prohibited_expression')).toContainText('금지 표현');
  await expect(page.getByTestId('n5-placement-toolbar')).toHaveCount(0);
  await expect(page.getByTestId('n5-undo-redo')).toBeVisible();
  await expect(page.getByTestId('n5-block-failures-9104')).toContainText('글자가 넘칩니다');
  // 기본 fixture에는 실패 상태가 없고(렌더 대기·제외 문구만), 이미지도 정상 위치(y156)에서 시작한다
  await expect(page.locator('[data-testid$="-failed"]')).toHaveCount(0);
  await expect(page.getByTestId('n5-section-status-1')).toHaveCount(0);
  await expect(page.locator('[data-testid^="n5-section-header-"]')).toHaveCount(0);
  expect(Math.round((await page.getByTestId('n5-slice-translated-501').boundingBox())!.y)).toBe(156);
});
