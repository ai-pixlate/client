import { expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// N5 오류 표시(Figma 388:3814) — lib/mock-api/n5-error-fixtures.ts 시나리오로 확인한다. 기본 fixture는 그대로다.
// 한 번의 N5 진입(약 30초) 안에서 상태별로 확인한다.
// ─────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1920, height: 1080 } });

// 박스·배율 조작은 N5 에서 local 초안만 바꾼다(PATCH 없음) — 이 spec 은 화면 계산만 본다. [저장하러 가기]의 저장 흐름은 n5-layout-adjust.spec.ts

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
  // 번역 실패 재시도는 이후 기능이라 칸에 [다시 시도]가 없다(Figma 1244:8238 도 실패 문구와 [확인]만)
  await expect(page.getByTestId('n5-block-translate-retry-9111')).toHaveCount(0);

  // 9103 — 서버 넘침은 셀 상태 「글자가 넘칩니다 — 수정이 필요합니다」(PRD v3.6.4 F-CFM-05 · Figma 1675:7501 — 이전 팀 QA 결정을 대체).
  // 검사 실패(block.check.state=failed)는 조판 상태보다 위에 보인다.
  // 블록 「미리보기를 갱신하지 못했습니다」는 이 화면에서 저장한 재렌더(섹션 render task)가 실패할 때만 칸에 보인다 —
  // 서버는 블록 단위 render task 를 만들지 않으므로 처음 열 때는 없다(그 흐름은 n5-task-retry.spec.ts)
  const preview = page.getByTestId('n5-block-row-9103');
  await expect(preview.getByTestId('n5-cell-failure-verify')).toHaveText('검사하지 못했습니다');
  await expect(preview.getByTestId('n5-cell-failure-preview')).toHaveCount(0);
  await expect(preview.getByTestId('n5-block-preview-retry-9103')).toHaveCount(0);
  await expect(preview.getByTestId('n5-cell-failure-overflow')).toHaveText('글자가 넘칩니다 — 수정이 필요합니다');
  const verifyBox = (await preview.getByTestId('n5-cell-failure-verify').boundingBox())!;
  const overflowBox = (await preview.getByTestId('n5-cell-failure-overflow').boundingBox())!;
  expect(verifyBox.y).toBeLessThan(overflowBox.y);
  // 넘침은 번역문 경고 칩(「영역 초과」)으로 다시 보이지 않는다
  await expect(preview).not.toContainText('영역 초과');

  // 9102 — 원문 쪽 신호(empty_block, 원문 글자 있음)는 번역문 경고와 섞지 않고 원문 카드 안 「원문 확인」(사유는 서버 값)
  const sourceCheck = page.getByTestId('n5-block-row-9102').getByTestId('n5-block-source-check');
  await expect(sourceCheck).toHaveText('원문 확인 — 원문을 잘못 읽었을 수 있습니다 — 이미지와 비교해 주세요');
  await expect(page.getByTestId('n5-block-signal-9102-empty_block')).toHaveCount(0);

  // section 배지 — 좌측 뷰어 섹션 위(Figma 1244:8444 · 1244:8641). 우측 패널에는 같은 행을 다시 두지 않는다(최신 Figma)
  const section = page.getByTestId('n5-section-header-1').getByTestId('n5-canvas-section-status');
  await expect(section).toContainText('실행 실패');
  await expect(section).toContainText('렌더링');
  await expect(section).toContainText('인페인팅'); // 인페인팅 「실행」 실패는 현재 범위
  await expect(page.getByTestId('n5-section-header-1').getByTestId('n5-canvas-section-status-render-retry')).toHaveText('렌더링 다시 시도');
  await expect(section).toContainText('N3에서 되살린 섹션');
  // 되살린 섹션의 제외 이유는 대표 하나(PRD v3.6.4 — 규제 > 채널 정책 > … > 현지, 수정 필수 > 확인 필요)
  await expect(section.getByText('규제 위반', { exact: true })).toBeVisible();
  for (const label of ['채널 정책', '규제 표현', '조건부 규제', '현지 수정 필수', '현지 확인 필요']) {
    await expect(section.getByText(label, { exact: true })).toHaveCount(0);
  }
  // 인페인팅 잔존율 배지(처리 실패 · 품질 주의)는 이후 범위 — 보이지 않는다
  await expect(page.getByTestId('n5-viewport')).not.toContainText('품질 주의');
  await expect(panel).not.toContainText('품질 주의');
  // 패널 — 좌측과 같은 섹션 행이 없다. 첫 Section 태그 y154, 아래 16 에 첫 번호(y198)
  await expect(page.getByTestId('n5-section-status-1')).toHaveCount(0);
  await expect(panel.getByText('N3에서 되살린 섹션')).toHaveCount(0);
  await expect(panel.getByText('실행 실패', { exact: true })).toHaveCount(0);
  const panelBody = page.getByTestId('n5-panel-body');
  await panelBody.evaluate((el) => el.scrollTo(0, 0));
  const panelTag = (await page.getByTestId('n5-section-tag-1').boundingBox())!;
  expect(Math.round(panelTag.y)).toBe(154);
  expect(Math.round((await page.getByTestId('n5-block-row-9101').boundingBox())!.y)).toBe(198);
  await page.screenshot({ path: test.info().outputPath('n5-errors-panel-top.png') });
  // 섹션 단위 신호(로고 인식 실패)는 좌측에 없는 정보라 패널에 남는다
  await expect(page.getByTestId('n5-section-status-2')).toContainText('정품 로고 매칭에 실패했습니다');

  await failed.scrollIntoViewIfNeeded();
  await page.getByTestId('n5-panel').screenshot({ path: test.info().outputPath('n5-errors-translate-cell.png') });
  await preview.scrollIntoViewIfNeeded();
  await page.getByTestId('n5-panel').screenshot({ path: test.info().outputPath('n5-errors-preview-cell.png') });

  // 패널 구조 — 헤더·저장 버튼은 제자리에 있고 목록만 스크롤한다
  const confirm = (await page.getByTestId('n5-confirm-button').boundingBox())!;
  // 최신 Figma 1244:8641 — [저장하러 가기] y975(아래 60)
  expect([Math.round(confirm.y), Math.round(confirm.height)]).toEqual([975, 45]);
  const body = page.getByTestId('n5-panel-body');
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect(panel.getByRole('heading', { name: '번역문 확인 및 수정' })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('n5-errors-panel.png') });

  // canvas — Figma 1244:8444: 태그 y123, 상태 y167(폭 650). 행은 실행 실패 · 되살림 두 줄(품질 주의 행 없음) → 높이 56, 이미지 y227(태그부터 104)
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
  expect(Math.round(status.height)).toBe(56);
  expect(Math.round(slice.y)).toBe(227);
  expect(Math.round(slice.y - tag.y)).toBe(104);
  expect(Math.round(status.x)).toBe(Math.round(slice.x));
  expect(Math.round(tag.x)).toBe(Math.round(slice.x));
  const tagsRow = (await page.getByTestId('n5-section-header-1').getByTestId('n5-canvas-section-status-tags').boundingBox())!;
  expect(Math.round(tagsRow.height)).toBe(26); // 650 폭에서 한 줄
  // 선택 UI는 밀린 이미지를 따라간다
  await page.getByTestId('n5-block-row-9102').click();
  const overlay = (await page.getByTestId('n5-block-overlay-9102').boundingBox())!;
  expect(Math.round(overlay.y - slice.y)).toBe(80); // bbox.y 200 × scale 0.4
  const nw = (await page.getByTestId('n5-block-handle-nw').boundingBox())!;
  // 선택 테두리·손잡이는 글자 밖 12px(Figma 544:3168)
  expect(Math.abs(nw.y + nw.height / 2 - (overlay.y - 12))).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath('n5-errors-canvas.png') });

  // 재시도 — 미리보기 갱신 실패·섹션 렌더 실패는 서버가 retryable=true 로 준 실패라 활성이다(누른 뒤 흐름은 e2e/n5-task-retry.spec.ts).
  // 번역 실패 칸에는 retryable=true 여도 [다시 시도]가 없다(이후 기능)
  await expect(page.getByTestId('n5-section-header-1').getByTestId('n5-canvas-section-status-render-retry')).toBeEnabled();
  await expect(page.getByTestId('n5-block-translate-retry-9111')).toHaveCount(0);
  await expect(failed.getByTestId('n5-cell-failure-translate')).toBeVisible();

  // 입력 중 — 검사 결과(검사 실패)와 자리 맞춤(넘침)은 직전 서버 결과를 유지한다([확인] 저장 뒤에만 갱신 — PRD v3.6.4 F-CFM-02)
  const editor = page.getByTestId('n5-block-editor-9103');
  const original = await editor.inputValue();
  await editor.fill('Short');
  await expect(preview.getByTestId('n5-cell-failure-verify')).toBeVisible();
  await expect(preview.getByTestId('n5-cell-failure-overflow')).toHaveText('글자가 넘칩니다 — 수정이 필요합니다');
  // 서버값과 달라지는 순간부터(입력 중에도) 「저장하지 않은 수정」 — 보이는 검사 결과는 마지막 저장값 기준임을 함께 알린다
  const unsaved = page.getByTestId('n5-block-unsaved-9103');
  await expect(editor).toBeFocused();
  await expect(unsaved).toHaveText('저장하지 않은 수정 · 검사 결과는 마지막 저장값 기준');
  // 칸을 벗어나도 그대로(초안 유지)
  await editor.blur();
  await expect(unsaved).toHaveText('저장하지 않은 수정 · 검사 결과는 마지막 저장값 기준');
  await expect(editor).toHaveValue('Short');
  // 서버값으로 되돌리면 dirty 가 풀려 사라진다
  await editor.fill(original);
  await editor.blur();
  await expect(page.getByTestId('n5-block-unsaved-9103')).toHaveCount(0);
});

test('저장 성공 응답에서 해결된 금지 표현 signal 이 바로 사라지고, 재렌더 뒤 /blocks 재조회에도 다시 나오지 않는다', async ({ page }) => {
  await reachN5(page);
  const signal = page.getByTestId('n5-block-signal-9112-prohibited_expression');
  await expect(signal).toBeVisible();
  const editor = page.getByTestId('n5-block-editor-9112');
  await editor.fill('Visibly smoother skin');
  // 입력 중에는 마지막 서버 결과(금지 표현)를 그대로 둔다 — 초안으로 다시 계산하지 않는다
  await expect(signal).toBeVisible();
  await expect(page.getByTestId('n5-block-checks-basis-9112')).toBeVisible();

  const patchResponse = page.waitForResponse((res) => res.request().method() === 'PATCH' && /\/blocks\/9112$/.test(res.url()));
  await page.getByTestId('n5-block-save-9112').click();
  const body = (await (await patchResponse).json()) as { block: { signals: { code: string }[] } };
  expect(body.block.signals.map((s) => s.code)).not.toContain('prohibited_expression');
  // 1단계 — PATCH 성공 응답 직후(재렌더 완료 전) 사라진다
  await expect(signal).toHaveCount(0);
  await expect(page.getByTestId('n5-block-unsaved-9112')).toHaveCount(0);

  // 2단계 — 재렌더 완료 → /blocks 재조회 뒤에도 다시 나오지 않는다
  const blocksRefetch = page.waitForResponse((res) => res.request().method() === 'GET' && /\/blocks$/.test(new URL(res.url()).pathname), { timeout: 30_000 });
  await expect(page.getByTestId('n5-block-row-9112').getByText('재렌더링 중…')).toHaveCount(0, { timeout: 30_000 });
  const refetched = (await (await blocksRefetch).json()) as { id: number; signals: { code: string }[] }[];
  expect(refetched.find((b) => b.id === 9112)!.signals.map((s) => s.code)).not.toContain('prohibited_expression');
  await page.waitForTimeout(500);
  await expect(signal).toHaveCount(0);
});

test('기본 화면 — signal 사유가 바로 읽히고 하단 중앙 도구가 없다', async ({ page }) => {
  await reachN5(page);
  await expect(page.getByTestId('n5-block-signal-9112-prohibited_expression')).toContainText('금지 표현');
  await expect(page.getByTestId('n5-placement-toolbar')).toHaveCount(0);
  await expect(page.getByTestId('n5-undo-redo')).toBeVisible();
  // 9104 는 서버 넘침 — 셀 상태 「글자가 넘칩니다 — 수정이 필요합니다」(PRD v3.6.4 · Figma 1675:7501)
  await expect(page.getByTestId('n5-block-row-9104').getByTestId('n5-cell-failure-overflow')).toHaveText('글자가 넘칩니다 — 수정이 필요합니다');
  // 기본 fixture에는 실패 상태가 없고(렌더 대기·제외 문구만), 이미지도 정상 위치(y156)에서 시작한다
  await expect(page.locator('[data-testid$="-failed"]')).toHaveCount(0);
  await expect(page.getByTestId('n5-section-status-1')).toHaveCount(0);
  await expect(page.locator('[data-testid^="n5-section-header-"]')).toHaveCount(0);
  expect(Math.round((await page.getByTestId('n5-slice-translated-501').boundingBox())!.y)).toBe(156);
});
