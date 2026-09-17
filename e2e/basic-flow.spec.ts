import { test, expect, type Page, type Locator } from '@playwright/test';

import { MOCK_BRAND_ID, MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// N1 combobox 순서(Figma 525:3023 재정합 후): 국가 → 언어 → 규제 분류
// (카테고리는 더 이상 combobox가 아니다 — 검색 표시 필드 + "선택하기"
// 버튼→카테고리 선택 모달(381:6293)로 바뀌었다). 각 select의 첫 번째
// 유효한(placeholder 다음) option을 선택하므로 순서 자체는 영향 없다.
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

  await expect(page.getByText('이미지 입력')).toBeVisible();
  await expect(page.getByRole('combobox')).toHaveCount(3);
  await expect(page.getByLabel('파일 선택')).toBeAttached();
  await expect(page.getByRole('button', { name: '다음' })).toBeVisible();

  // ── N1: 필수값 입력 (실제 사용자 순서: 국가 → 언어 → 카테고리 → 규제 분류) ──
  await page.getByPlaceholder('상품 이름을 입력해주세요').fill('E2E 테스트 상품');
  await selectFirstValidOption(page, 0); // 국가
  await selectFirstValidOption(page, 1); // 언어

  // 카테고리 — "선택하기" → 모달(381:6293)에서 하위 데이터가 없는 최상위
  // 항목("바디/헤어")을 눌러 즉시 선택·닫힘 처리한다.
  await page.getByRole('button', { name: '선택하기' }).click();
  await page.getByRole('dialog', { name: '카테고리 선택' }).getByRole('button', { name: '바디/헤어' }).click();

  await selectFirstValidOption(page, 2); // 규제 분류(인덱스가 3→2로 당겨졌다)

  // ── N1: 이미지 업로드 ─────────────────────────────────────
  await page.getByLabel('파일 선택').setInputFiles({
    name: 'e2e-test.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
  });
  await expect(page.getByText('e2e-test.png')).toBeVisible();

  // ── N1: 제출 ──────────────────────────────────────────────
  await page.getByRole('button', { name: '다음' }).click();
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
  // N5는 9일차에 Before/After 비교 슬라이더를 폐기하고 캔버스형 viewport로
  // 교체됨 — 상세 interaction(zoom/pan/fit/mode) 검증은 e2e/n5-viewport.spec.ts.
  // 오늘 범위가 아닌 textbox 편집은 화면에 없다. "다른 번역 보기"는 10일차에
  // 번역 후보 계약이 폐기되어 더 이상 존재하지 않는다.
  await expect(page.locator('[data-testid="n5-panel"]')).toBeVisible({ timeout: 8_000 });

  // ── N5: 기본 검증 — 좌(viewport)/우(panel) workspace 골격 ────
  await expect(page.locator('[data-testid="n5-viewport"]')).toBeVisible();
  await expect(page.locator('[data-testid="n5-canvas"]')).toBeVisible();
  await expect(page.locator('[data-testid="n5-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="n5-panel-body"]')).toBeVisible();
  await expect(page.getByText('번역 결과')).toBeVisible();

  // ── N5: Before/After 비교 슬라이더는 더 이상 존재하지 않는다 (9일차 폐기) ──
  await expect(page.locator('[data-testid="n5-before-after-slider"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="n5-compare-stack"]')).toHaveCount(0);

  // ── 현재 flow 종료 조건: N5 확정 버튼 표시 확인 ────────────────
  // 6단계부터 「저장하러 가기」가 실제 confirm(N5→N6)에 연결됐다. 이 fixture
  // job은 항상 include section이 1개 이상이라 버튼은 기본적으로 활성 상태다
  // — 실제 confirm→N6 전환 자체는 e2e/n5-confirm.spec.ts에서 검증한다(이
  // 테스트의 범위는 이름 그대로 N1→N5까지).
  const finishButton = page.getByRole('button', { name: '저장하러 가기' });
  await expect(finishButton).toBeVisible();
  await expect(finishButton).toBeEnabled();

  expect(pageErrors).toEqual([]);
});
