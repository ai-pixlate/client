import { test, expect, type Page, type Locator } from '@playwright/test';

import { MOCK_BRAND_ID, MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// N1 combobox 순서: 국가 → 언어 → 규제 분류 → 카테고리
// 현재 label이 select에 htmlFor/id로 연결돼 있지 않아 getByLabel을 쓸 수 없다.
// 각 select의 첫 번째 유효한(placeholder 다음) option을 선택한다.
async function selectFirstValidOption(page: Page, index: number) {
  const select = page.getByRole('combobox').nth(index);
  const firstRealOption = select.locator('option').nth(1);
  const value = await firstRealOption.getAttribute('value');
  if (!value) throw new Error(`combobox[${index}]에 선택 가능한 option이 없습니다`);
  await select.selectOption(value);
}

// 1x1 투명 PNG — repository에 binary fixture를 추가하지 않기 위해 메모리에서 생성한다.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// N3 — 썸네일/가운데 상세 보기를 다른 bucket 영역(BG)으로 drag & drop한다.
// 개별 썸네일이 아니라 영역 경계선 기준으로 drop이 판단되므로
// source 중심 → target 영역 중심으로만 이동하면 된다.
async function dragBetweenZones(page: Page, source: Locator, targetZone: Locator) {
  const sourceBox = await source.boundingBox();
  const targetBox = await targetZone.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error('drag source 또는 target 영역의 위치를 찾을 수 없습니다');
  }

  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // 활성화 거리(4px)를 넘기고 중간 지점을 거쳐 target 영역까지 이동 — 실제 pointer 이벤트로 처리되어야 하므로 step을 나눈다.
  await page.mouse.move(startX + (endX - startX) / 2, startY + (endY - startY) / 2, { steps: 8 });
  await page.mouse.move(endX, endY, { steps: 8 });
  await page.mouse.up();
}

test('N1에서 N5 검수 화면까지 기본 작업 흐름을 완료한다', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  // ── N1: 진입 ──────────────────────────────────────────────
  await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);

  await expect(page.getByText('신규 작업')).toBeVisible();
  await expect(page.getByRole('combobox')).toHaveCount(4);
  await expect(page.getByLabel('이미지 추가')).toBeAttached();
  await expect(page.getByRole('button', { name: '다음 →' })).toBeVisible();

  // ── N1: 필수값 입력 (실제 사용자 순서: 국가 → 언어 → 규제 분류 → 카테고리) ──
  await selectFirstValidOption(page, 0); // 국가
  await selectFirstValidOption(page, 1); // 언어
  await selectFirstValidOption(page, 2); // 규제 분류
  await selectFirstValidOption(page, 3); // 카테고리

  // ── N1: 이미지 업로드 ─────────────────────────────────────
  await page.getByLabel('이미지 추가').setInputFiles({
    name: 'e2e-test.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
  });
  await expect(page.getByText('e2e-test.png')).toBeVisible();

  // ── N1: 제출 ──────────────────────────────────────────────
  await page.getByRole('button', { name: '다음 →' }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));

  // ── N2: 분석 진행 화면 ────────────────────────────────────
  await expect(page.getByRole('progressbar')).toBeVisible();

  // N3 고유 UI가 나타날 때까지 대기 (고정 sleep 대신 polling 완료를 기다림)
  await expect(page.getByRole('button', { name: '번역 시작' })).toBeVisible({
    timeout: 8_000,
  });

  // ── N3: 섹션 확인 (2버킷 drag & drop) ───────────────────────
  // fixture: 삭제 후보(exclude) 1개(sec_03), 번역 대상(include) 4개
  await expect(page.locator('[data-testid^="n3-thumb-exclude-"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="n3-thumb-include-"]')).toHaveCount(4);

  const excludeZone = page.locator('[data-testid="n3-exclude-zone"]');
  const includeZone = page.locator('[data-testid="n3-include-zone"]');

  // ── N3: interaction — 번역 섹션 하나를 삭제 영역으로 이동했다가 복원 ──
  const includeThumb = page.locator('[data-testid^="n3-thumb-include-"]').first();
  const movedSectionId = (await includeThumb.getAttribute('data-testid'))!.replace(
    'n3-thumb-include-',
    '',
  );

  await dragBetweenZones(page, includeThumb, excludeZone);
  await expect(page.locator(`[data-testid="n3-thumb-exclude-${movedSectionId}"]`)).toBeVisible();
  await expect(page.locator('[data-testid^="n3-thumb-exclude-"]')).toHaveCount(2);
  await expect(page.locator('[data-testid^="n3-thumb-include-"]')).toHaveCount(3);

  // 방금 이동한 섹션이 가운데 상세 보기에 activeSection으로 표시된다 — 그 상태에서 다시 번역 영역으로 되돌린다.
  const detailImage = page.locator(`[data-testid="n3-detail-image-${movedSectionId}"]`);
  await dragBetweenZones(page, detailImage, includeZone);
  await expect(page.locator(`[data-testid="n3-thumb-include-${movedSectionId}"]`)).toBeVisible();
  await expect(page.locator('[data-testid^="n3-thumb-exclude-"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="n3-thumb-include-"]')).toHaveCount(4);

  // ── N3 → N4 ───────────────────────────────────────────────
  await page.getByRole('button', { name: '번역 시작' }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.getByRole('heading', { name: '번역을 진행하고 있습니다' })).toBeVisible();

  // ── N4 → N5 ───────────────────────────────────────────────
  // N5는 7일차 마지막 작업에서 Figma 544:3168 기준 좌/우 workspace shell로 교체됨.
  // 오늘 범위가 아닌 원문/번역문 toggle·textbox 편집·"다른 번역 보기"는 화면에 없다.
  await expect(page.locator('[data-testid="n5-panel"]')).toBeVisible({ timeout: 8_000 });

  // ── N5: 기본 검증 — 좌(viewer)/우(panel) workspace 골격 ────
  await expect(page.locator('[data-testid="n5-viewer"]')).toBeVisible();
  await expect(page.locator('[data-testid="n5-viewer-scroll"]')).toBeVisible();
  await expect(page.locator('[data-testid="n5-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="n5-panel-body"]')).toBeVisible();
  await expect(page.getByText('번역 결과')).toBeVisible();

  // ── 현재 flow 종료 조건: N5 → N6 미구현 확인 ────────────────
  const finishButton = page.getByRole('button', { name: '저장하러 가기' });
  await expect(finishButton).toBeVisible();
  await expect(finishButton).toBeDisabled();
  await expect(finishButton).toHaveAttribute('title', 'N6 저장 화면은 아직 구현되지 않았습니다.');

  expect(pageErrors).toEqual([]);
});
