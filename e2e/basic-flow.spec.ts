import { test, expect, type Page } from '@playwright/test';

import { MOCK_BRAND_ID, MOCK_JOB_ID } from '@/lib/mock-api/fixtures';
import { pickRegulatoryClass } from './helpers/n1-regulatory-class';

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

  // 카테고리 — "선택하기" → 모달(381:6293)에서
  // 소분류가 없는 중분류("선케어 > 선크림")를 고른 뒤 [확인]으로 확정한다.
  await page.getByRole('button', { name: '선택하기' }).click();
  await page.getByRole('dialog', { name: '카테고리 선택' }).getByRole('button', { name: '선케어' }).click();
  await page.getByRole('dialog', { name: '카테고리 선택' }).getByRole('button', { name: '선크림' }).click();
  await page.getByRole('dialog', { name: '카테고리 선택' }).getByRole('button', { name: '확인' }).click(); // PRD F-SRC-04 — [확인]으로 확정
  await page.getByRole('checkbox', { name: /외부 AI 서비스로 전송됨을 확인했습니다/ }).check(); // F-ACC-04 책임 동의

  await pickRegulatoryClass(page, '화장품'); // 규제 분류 — 드롭다운(native select 아님)

  // ── N1: 이미지 업로드 ─────────────────────────────────────
  await page.getByLabel('파일 선택').setInputFiles({
    name: 'e2e-test.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
  });
  // N1 재정합(925:2529) — 업로드 후 파일명 텍스트 대신 썸네일 그리드로
  // 표시된다. 업로드 성공 확인은 해당 파일의 썸네일 img(alt=파일명)로 한다.
  await expect(page.locator('img[alt="e2e-test.png"]')).toBeVisible();

  // ── N1: 제출 ──────────────────────────────────────────────
  await page.getByRole('button', { name: '다음' }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));

  // ── N2: 분석 진행 화면 ────────────────────────────────────
  await expect(page.getByRole('progressbar')).toBeVisible();

  // N3 고유 UI가 나타날 때까지 대기 (고정 sleep 대신 polling 완료를 기다림).
  // 기본 mock N2(analyze → finalize → judge, poll 6회)와 N3 전환 전 완료 표시(app/jobs/[jobId]/page.tsx)를
  // 감안해 여유를 둔 타임아웃을 쓴다.
  await expect(page.getByRole('button', { name: '이대로 진행' })).toBeVisible({
    timeout: 30_000,
  });

  // ── N3: 섹션 확인 (sectionOrder 단일 목록 + 카드 버튼) ─────────
  // fixture: 제외 3개(sec_02/sec_03/sec_05 — sec_02/05는 verdictType='regulatory'라
  // 기본 bucket이 exclude다), 포함 2개
  await expect(page.locator('[data-testid^="n3-section-card-"][data-bucket="exclude"]')).toHaveCount(3);
  await expect(page.locator('[data-testid^="n3-section-card-"][data-bucket="include"]')).toHaveCount(2);

  // ── N3: interaction — 포함 섹션 하나를 [제외하기]로 뺐다가 [번역하기]로 되살린다 ──
  const includeCard = page.locator('[data-testid^="n3-section-card-"][data-bucket="include"]').first();
  const movedSectionId = (await includeCard.getAttribute('data-testid'))!.replace('n3-section-card-', '');
  const movedCard = page.getByTestId(`n3-section-card-${movedSectionId}`);

  await page.getByTestId(`n3-section-action-${movedSectionId}`).click();
  await expect(movedCard).toHaveAttribute('data-bucket', 'exclude');
  await expect(page.locator('[data-testid^="n3-section-card-"][data-bucket="exclude"]')).toHaveCount(4);

  await page.getByTestId(`n3-section-action-${movedSectionId}`).click();
  await expect(movedCard).toHaveAttribute('data-bucket', 'include');
  await expect(page.locator('[data-testid^="n3-section-card-"][data-bucket="include"]')).toHaveCount(2);

  // ── N3 → N4 ───────────────────────────────────────────────
  // N4는 N2와 같은 ProcessingStageLayout을 공유하는 Figma(660:4221) 기준
  // 실제 화면이다(placeholder였던 "번역을 진행하고 있습니다" 문구는 폐기).
  await page.getByRole('button', { name: '이대로 진행' }).click();
  await expect(page.getByRole('heading', { name: '번역 중' })).toBeVisible();
  await expect(page.getByText('확정한 섹션을 번역하고 이미지에 적용하고 있습니다.')).toBeVisible();
  await expect(page.getByText('한글 지우고 배경 채우기')).toBeVisible();
  await expect(page.getByText('이미지 합성')).toBeVisible();
  await expect(page.getByRole('progressbar')).toBeVisible();

  // ── N4 → N5 ───────────────────────────────────────────────
  // N5는 9일차에 Before/After 비교 슬라이더를 폐기하고 캔버스형 viewport로
  // 교체됨 — 상세 interaction(zoom/pan/fit/mode) 검증은 e2e/n5-viewport.spec.ts.
  // 오늘 범위가 아닌 textbox 편집은 화면에 없다. "다른 번역 보기"는 10일차에
  // 번역 후보 계약이 폐기되어 더 이상 존재하지 않는다.
  //
  // N4 mock이 실제 계약(inpaint→translate→verify→render)을 4단계 모두
  // 순서대로 최소 한 번씩 지나가도록 바뀌면서(lib/msw/handlers.ts
  // advanceN4Processing, N4_POLL_SCHEDULE) 2초 polling 9회(~18초)가 걸린다
  // — 예전 8초 타임아웃(단일 stage 2-poll 기준)보다 넉넉히 잡는다.
  await expect(page.locator('[data-testid="n5-panel"]')).toBeVisible({ timeout: 25_000 });

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
