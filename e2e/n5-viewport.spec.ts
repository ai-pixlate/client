import { test, expect, type Page } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';
import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N5 — v3.4.2 실제 계약(GET /jobs/{jobId}/blocks·preview, PATCH
// /jobs/{jobId}/blocks/{blockId}) + F-CFM-13(좌우 selection 연동) e2e.
//
// 5단계: 구 계약(문자열 sec_XX id, 단일 sourceImage를 backgroundPosition으로
// 자르는 구조) 기준이던 이전 스펙을 전면 재작성했다 — 그 계약의 mock
// endpoint(/api/jobs/:jobId/review·preview) 자체가 이번 단계에서 제거됐다.
//
// mock 데이터는 lib/mock-api/n5-fixtures.ts 기준(고정값, 직접 참조):
//   section 501~505 (id=sectionOrder*100+1 아님 — id와 sectionOrder는 별개
//   값이다. 501~505는 sectionOrder 1~5와 1:1 대응).
//     - 503: bucket=exclude, excludedStage='N5' (F-CFM-14 회귀 확인용)
//     - 504: renderedUrl=null (렌더 전 — 캔버스 "번역문 미리보기가 아직
//       생성되지 않았습니다" 안내 확인용. N5 3차 정렬 이후 이 상태는 toggle을
//       막지 않는다 — 번역문 mode가 기본값이고 toggle은 항상 활성화된다)
//   block 9101~9112 (role 6종·seller signal 6종 전부 최소 1건).
//     - 9101: 501/title, 9103: 502/price, 9104: 502/caution(charLimit=120,
//       초기 overflow=true+autoAdjust 있음), 9105: 502/product_label
//       (isExcluded=true), 9109: 505/title, 9110: 505/body.
//
// Fit Height(n5-fit-height)로 전체 canvas를 뷰포트 안에 넣은 뒤 캔버스 요소를
// 클릭한다 — 캔버스는 transform pan(고정폭 overflow:hidden)이라 네이티브
// scrollIntoView가 실제로 화면에 노출시켜 주지 않기 때문이다. 우측 패널은
// 실제 overflow-y-auto라 네이티브 스크롤/자동 대기가 그대로 동작한다.
// ─────────────────────────────────────────────────────────────────

async function readTransform(page: Page) {
  const canvas = page.locator('[data-testid="n5-canvas"]');
  const [zoom, panX, panY] = await Promise.all([
    canvas.getAttribute('data-zoom'),
    canvas.getAttribute('data-pan-x'),
    canvas.getAttribute('data-pan-y'),
  ]);
  return { zoom: Number(zoom), panX: Number(panX), panY: Number(panY) };
}

/**
 * 특정 testid 요소가 n5-viewport(overflow:hidden 클리핑 컨테이너)의 실제
 * 보이는 영역 안에 완전히 들어와 있는지를 DOM bounding rect로 직접 판정한다.
 * Playwright의 toBeInViewport()는 브라우저 뷰포트 기준이라(조상의 CSS
 * overflow:hidden 클리핑을 반영하지 않는다) 여기서는 쓰지 않는다 —
 * n5-viewport.tsx의 selectionAutoMove effect가 쓰는 것과 같은
 * "usable 영역 안에 완전히 들어오는지" 판정을 e2e에서도 동일하게 재현한다.
 */
async function isFullyWithinViewport(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((tid) => {
    const viewport = document.querySelector('[data-testid="n5-viewport"]');
    const el = document.querySelector(`[data-testid="${tid}"]`);
    if (!viewport || !el) return false;
    const v = viewport.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    const EPS = 1;
    return e.left >= v.left - EPS && e.top >= v.top - EPS && e.right <= v.right + EPS && e.bottom <= v.bottom + EPS;
  }, testId);
}

test.beforeEach(async ({ page }) => {
  await reachN5(page);
});

test.describe('N5 진입 — section별 preview 렌더', () => {
  test('section별 own 이미지가 렌더되고, 우측 block 목록도 함께 뜬다', async ({ page }) => {
    await expect(page.getByTestId('n5-canvas')).toBeVisible();
    // N5 3차 정렬 — 기본 mode가 'translated'로 바뀌면서 slice testid도
    // n5-slice-original-*이 아니라 n5-slice-translated-*로 렌더된다(요청 3).
    await expect(page.getByTestId('n5-slice-translated-501')).toBeVisible();
    await expect(page.getByTestId('n5-slice-translated-502')).toBeVisible();
    // 503은 N5에서 이미 제외된 상태(F-CFM-14) — 슬라이스 자체는 존재하고 회색
    // 오버레이가 그 위를 덮는다(걸러내지 않는다).
    await expect(page.getByTestId('n5-section-excluded-503')).toBeVisible();

    await expect(page.getByTestId('n5-panel-body')).toBeVisible();
    await expect(page.getByTestId('n5-block-row-9101')).toBeVisible();
    // "US (EN) · N개 텍스트 블록" 메타 줄은 N5 2차 정렬에서 의도적으로
    // 제거했다(검수에 필수가 아닌 디버깅성 정보, Figma에도 대응 요소 없음)
    // — 옛 UI 계약을 확인하던 이 assertion은 새 계약(그 줄 자체가 없음)에
    // 맞춰 제거한다. 문구를 UI에 다시 넣지 않는다.
  });

  test('renderedUrl===null(섹션 504)이어도 번역문 mode가 기본값이고 toggle은 항상 활성화된다', async ({
    page,
  }) => {
    // N5 3차 정렬 — "번역 렌더 이미지가 없다"(캔버스 전용 개념)와 "번역문
    // 텍스트 검수가 가능하다"(패널 전용 개념)를 분리했다(요청 1·2). 렌더
    // 이미지가 없는 section이 있어도 원문으로 강제 전환하거나 toggle을
    // disabled 처리하지 않는다 — 기본 mode는 항상 'translated'이고 toggle은
    // 항상 클릭 가능하다.
    //
    // N5 4차 정리 — 캔버스 전체를 덮던 상시 안내(n5-render-missing-notice)는
    // 제거했다. 일부 section만 렌더가 안 됐는데 캔버스 전체가 "미리보기
    // 없음"처럼 보이는 중복 표현이었다 — render 없는 section에는 원래도
    // 그 section 자신의 "렌더 대기 중" 오버레이가 있었으므로(변경 없음,
    // n5-viewport.tsx ImageLayer의 isPending), 그걸로 충분하다. 여기서는
    // 그 section-local 표시만 확인한다.
    await expect(page.getByTestId('n5-view-mode-translated')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('n5-view-mode-translated')).toBeEnabled();
    await expect(page.getByTestId('n5-view-mode-original')).toBeEnabled();
    await expect(page.getByTestId('n5-slice-translated-504').getByText('렌더 대기 중')).toBeVisible();
  });

  test('isExcluded 블록(9105, product_label)은 편집 input 자체를 렌더하지 않는다', async ({ page }) => {
    await page.getByTestId('n5-block-row-9105').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-testid="n5-block-editor-9105"]')).toHaveCount(0);
    await expect(page.getByTestId('n5-block-row-9105')).toContainText('읽기 전용');
  });
});

test.describe('F-CFM-13 — 좌우 selection 연동 + 자동 스크롤', () => {
  test('좌측 block 클릭 → 우측 row 선택 + 좌측 selected 테두리, zoom/pan 불변', async ({ page }) => {
    await page.getByTestId('n5-fit-height').click();
    const before = await readTransform(page);

    await page.getByTestId('n5-block-overlay-9104').click({ force: true });

    await expect(page.getByTestId('n5-block-row-9104')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('n5-block-row-9104')).toBeInViewport();
    await expect(page.getByTestId('n5-block-overlay-9104')).toHaveAttribute('aria-pressed', 'true');

    expect(await readTransform(page)).toEqual(before);
  });

  test('우측 row 클릭 → 좌측 block overlay에 선택 테두리 표시, 이전 선택은 해제', async ({ page }) => {
    await page.getByTestId('n5-fit-height').click();

    await page.getByTestId('n5-block-row-9101').click();
    await expect(page.getByTestId('n5-block-overlay-9101')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('n5-block-row-9110').click();
    await expect(page.getByTestId('n5-block-overlay-9110')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('n5-block-overlay-9101')).toHaveAttribute('aria-pressed', 'false');
  });

  test('좌측 section 배경 클릭 → selectedSectionId 갱신, 우측 SectionN 헤더로 자동 스크롤', async ({
    page,
  }) => {
    await page.getByTestId('n5-fit-height').click();

    // N5 3차 정렬 — 기본 mode가 'translated'라 slice testid도 그에 맞춘다.
    const slice = page.getByTestId('n5-slice-translated-505');
    const box = await slice.boundingBox();
    if (!box) throw new Error('section 505 슬라이스를 찾지 못했습니다');

    // N5 3차 정렬로 하단 배치 편집 toolbar(n5-placement-toolbar)가 화면
    // 하단 중앙에 실제로 클릭 가능해졌다(요청 5·6, pointer-events-none로
    // 회피하지 않는다 — Figma가 보여주는 대로 toolbar가 캔버스 위에 항상
    // 떠 있는 고정 컨트롤이라 의도된 동작이다). fit-height 뒤에는 section
    // 하단부가 화면 하단·toolbar와 겹칠 수 있어, block bbox가 없는
    // section 배경이면서도 (a) 실제로 화면에 보이는 영역 안이고 (b)
    // toolbar 영역 밖인 지점을 계산해서 클릭한다 — 실제 사용자도 이
    // toolbar를 피해 클릭해야 하는 것과 같은 제약이다.
    const viewportBox = await page.getByTestId('n5-viewport').boundingBox();
    const toolbarBox = await page.getByTestId('n5-placement-toolbar-wrap').boundingBox();
    if (!viewportBox || !toolbarBox) throw new Error('viewport 또는 toolbar bounding box를 찾지 못했습니다');

    const clickX = box.x + box.width * 0.15; // toolbar는 가로 중앙에 있으므로 왼쪽으로 피한다
    // section 하단(90%)을 우선 시도하되, 실제로 화면에 보이는 범위(viewportBox)
    // 를 넘지 않게 clamp하고, 그래도 toolbar 세로 범위와 겹치면 toolbar
    // 바로 위까지 끌어올린다.
    let clickY = Math.min(box.y + box.height * 0.9, viewportBox.y + viewportBox.height - 8);
    if (clickY >= toolbarBox.y - 8) {
      clickY = toolbarBox.y - 8;
    }
    await page.mouse.click(clickX, clickY);

    await expect(page.getByTestId('n5-section-selected-tag')).toHaveText('Section5');
    await expect(page.getByTestId('n5-section-tag-5')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('n5-section-tag-5')).toBeInViewport();

    // 블록 자체는 선택되지 않는다 — section만 선택된 상태
    await expect(page.locator('[data-testid^="n5-block-row-"][aria-pressed="true"]')).toHaveCount(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// F-CFM-13 양방향 계약(PRD v3.4.2 수용기준 2·3) — 우→좌 자동 이동 명시 검증.
// 이전엔 우측 interaction이 selectedBlockId/selectedSectionId(공유 SSOT)를
// 정상적으로 갱신했지만, 좌측 N5Viewport가 그 변화를 highlight 표시에만
// 쓰고 pan을 옮기는 코드가 아예 없었다 — 위 "F-CFM-13 — 좌우 selection 연동"
// describe 블록은 좌→우(패널 자동 스크롤)와, 이미 fit-height로 화면 안에
// 들어온 block을 좌측에서 클릭하는 경우(pan 불변)만 다뤄 이 결손을 드러내지
// 않았다. 여기서는 의도적으로 fit-height를 적용하지 않고(초기 진입 상태
// 그대로) section 505(9109/9110, 캔버스 맨 아래)처럼 실제로 화면 밖에 있는
// block을 우측에서 선택해, 좌측이 실제로 이동하는지를 정면으로 검증한다.
// ─────────────────────────────────────────────────────────────────
test.describe('F-CFM-13 양방향 계약 — 우→좌 자동 이동', () => {
  test('A. 좌측 block 클릭 → 우측 card visible + highlight + editor 포커스 가능', async ({ page }) => {
    await page.getByTestId('n5-fit-height').click();
    await page.getByTestId('n5-block-overlay-9101').click({ force: true });

    await expect(page.getByTestId('n5-block-row-9101')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('n5-block-row-9101')).toBeInViewport();

    const editor = page.getByTestId('n5-block-editor-9101');
    await editor.click();
    await expect(editor).toBeFocused();
  });

  test('B. 우측 "직접 수정하기" editor 클릭(9110, 화면 밖) → selectedBlockId 변경 → 좌측이 그 block 위치로 이동 + pin highlight', async ({
    page,
  }) => {
    const before = await readTransform(page);
    // fit-height를 적용하지 않은 초기 진입 상태 — section 505(9110)는
    // 캔버스 맨 아래라 top-aligned 기본 pan으로는 실제로 화면 밖이다.
    expect(await isFullyWithinViewport(page, 'n5-block-overlay-9110')).toBe(false);

    await page.getByTestId('n5-block-editor-9110').click();

    await expect(page.getByTestId('n5-block-row-9110')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('n5-block-overlay-9110')).toHaveAttribute('aria-pressed', 'true');
    expect(await isFullyWithinViewport(page, 'n5-block-overlay-9110')).toBe(true);

    const after = await readTransform(page);
    expect(after).not.toEqual(before); // 실제로 pan이 이동했다
    expect(after.zoom).toBe(before.zoom); // zoom은 건드리지 않는다(pan만 이동)
  });

  test('C. 우측에서 다른 section의 block 선택 → 좌측이 그 section까지 이동', async ({ page }) => {
    await page.getByTestId('n5-block-row-9101').click(); // section 501(화면 상단 근처)
    const afterFirst = await readTransform(page);

    await page.getByTestId('n5-block-row-9110').click(); // section 505(캔버스 맨 아래)로 이동
    expect(await isFullyWithinViewport(page, 'n5-block-overlay-9110')).toBe(true);
    const afterSecond = await readTransform(page);
    expect(afterSecond.panY).not.toBe(afterFirst.panY); // 실제로 세로 이동이 있었다
  });

  test('D. textarea에 여러 글자 입력 → 첫 선택 시 한 번만 이동, keystroke마다 재이동하지 않는다', async ({
    page,
  }) => {
    await page.getByTestId('n5-block-row-9110').click(); // 최초 선택 — 이 시점에 1회 이동
    expect(await isFullyWithinViewport(page, 'n5-block-overlay-9110')).toBe(true);
    const afterSelect = await readTransform(page);

    await page.getByTestId('n5-block-editor-9110').pressSequentially('Hello world', { delay: 30 });

    const afterTyping = await readTransform(page);
    expect(afterTyping).toEqual(afterSelect); // 타이핑(같은 block) 중에는 pan이 전혀 바뀌지 않는다
  });

  test('E. PATCH 성공/재조회 후에도 동일 block selection과 pan 위치를 유지한다(초기 위치로 튀지 않음)', async ({
    page,
  }) => {
    const initial = await readTransform(page);

    await page.getByTestId('n5-block-row-9104').click();
    const afterSelect = await readTransform(page);

    const editor = page.getByTestId('n5-block-editor-9104');
    await editor.fill('Patch keeps selection.');
    await page.getByTestId('n5-block-save-9104').click();

    // 재렌더(mock 2 poll * 2s) 완료 대기 — blocks/preview가 invalidate되어
    // reference가 바뀌는 시점.
    await expect(page.getByText('재렌더링 중…')).toHaveCount(0, { timeout: 10_000 });

    await expect(page.getByTestId('n5-block-row-9104')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('n5-block-overlay-9104')).toHaveAttribute('aria-pressed', 'true');

    const afterRerender = await readTransform(page);
    expect(afterRerender).toEqual(afterSelect); // PATCH/재조회 전후로 pan이 전혀 바뀌지 않는다
    if (afterSelect.panX !== initial.panX || afterSelect.panY !== initial.panY) {
      // 선택 시 실제로 이동이 있었던 경우에만 의미 있는 회귀 체크 —
      // 재조회 때문에 그 이동분이 초기 위치(0,0)로 되돌아가지 않는다.
      expect(afterRerender).not.toEqual(initial);
    }
  });

  test('F. zoom 상태에서도 우→좌 이동 좌표가 정상이다', async ({ page }) => {
    await page.getByTestId('n5-zoom-value').fill('150');
    await page.getByTestId('n5-zoom-value').press('Enter');
    await expect(page.getByTestId('n5-zoom-value')).toHaveValue('150');

    await page.getByTestId('n5-block-row-9110').click();

    const transform = await readTransform(page);
    expect(transform.zoom).toBeCloseTo(1.5, 5);
    expect(await isFullyWithinViewport(page, 'n5-block-overlay-9110')).toBe(true);
  });

  test('G. 같은 block을 다시 클릭하면(selection 값은 그대로) 사용자가 수동 pan으로 화면 밖으로 보낸 뒤에도 다시 이동한다', async ({
    page,
  }) => {
    await page.getByTestId('n5-block-row-9110').click(); // 최초 선택 — 화면 안으로 이동
    expect(await isFullyWithinViewport(page, 'n5-block-overlay-9110')).toBe(true);

    // row 클릭이 Playwright 클릭 좌표(row 중심)상 내부 textarea를 그대로
    // focus시킨다 — 실제 사용자가 이후 canvas로 마우스를 옮겨 Space+drag를
    // 시작하기 전에 자연히 focus가 벗어나는 것과 같은 상태를 만들기 위해
    // 명시적으로 blur한다(그렇지 않으면 Space 키가 isTypingTarget 가드에
    // 막혀 textarea에 스페이스 문자만 입력되고 pan이 전혀 시작되지 않는다).
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());

    // 사용자가 Space+drag로 수동 pan해서 9110을 다시 화면 밖으로 보낸다 —
    // selectedBlockId는 여전히 9110이다(바뀌지 않았다). 9110은 canvas 맨
    // 아래쪽 section에 있어서, 방금 auto-reveal로 중앙 정렬된 뒤 pan.y는
    // 이미 clampPan의 최소값(캔버스 하단 경계) 근처다 — 위로 드래그(pan.y를
    // 더 감소)하면 clamp에 막혀 사실상 움직이지 않는다. 화면 밖으로 밀어내려면
    // 아래로 드래그(pan.y 증가)해서 block을 뷰포트 아래로 내려보내야 한다.
    const viewportBox = await page.getByTestId('n5-viewport').boundingBox();
    if (!viewportBox) throw new Error('viewport bounding box를 찾지 못했습니다');
    const cx = viewportBox.x + viewportBox.width / 2;
    const cy = viewportBox.y + viewportBox.height / 2;
    await page.keyboard.down('Space');
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy + 600, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Space');

    expect(await isFullyWithinViewport(page, 'n5-block-overlay-9110')).toBe(false); // 수동 pan으로 화면 밖으로 나갔다

    // 같은 block(9110) row를 다시 클릭한다 — selectedBlockId 값 자체는 바뀌지
    // 않지만(이미 9110이었다), 사용자가 다시 명시적으로 이 위치를 보여달라고
    // 요청한 것이므로 좌측이 다시 그 위치로 이동해야 한다(F-CFM-13).
    await page.getByTestId('n5-block-row-9110').click();

    expect(await isFullyWithinViewport(page, 'n5-block-overlay-9110')).toBe(true);
  });

  test('H. block A editor에 focus 후 여러 글자 입력해도 keystroke마다 재이동하지 않는다', async ({ page }) => {
    await page.getByTestId('n5-block-editor-9110').click(); // focus로 최초 선택+이동
    expect(await isFullyWithinViewport(page, 'n5-block-overlay-9110')).toBe(true);
    const afterFocus = await readTransform(page);

    await page.getByTestId('n5-block-editor-9110').pressSequentially('Another edit here', { delay: 30 });

    const afterTyping = await readTransform(page);
    expect(afterTyping).toEqual(afterFocus); // 같은 block에서 타이핑만 하는 동안은 pan이 바뀌지 않는다
  });

  test('I. 같은 block이 선택된 상태에서 PATCH/재조회가 발생해도 불필요한 재이동이 없다', async ({ page }) => {
    await page.getByTestId('n5-block-row-9104').click();
    const afterSelect = await readTransform(page);

    const editor = page.getByTestId('n5-block-editor-9104');
    await editor.fill('No spurious reveal after patch.');
    await page.getByTestId('n5-block-save-9104').click();
    await expect(page.getByText('재렌더링 중…')).toHaveCount(0, { timeout: 10_000 });

    // PATCH/재조회로 blocks reference가 바뀌어도(같은 block이 계속 선택된
    // 상태) revealRequestSeq는 그대로라 pan이 다시 계산되지 않는다.
    const afterRerender = await readTransform(page);
    expect(afterRerender).toEqual(afterSelect);
  });
});

test.describe('번역 수정 — PATCH + revision → rerender polling → blocks/preview 재조회', () => {
  test('trans1 저장 후 revision이 갱신되고, 재렌더 완료 후에만 overflow/autoAdjust가 바뀐다', async ({
    page,
  }) => {
    const patchRequests: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'PATCH' && req.url().includes('/blocks/9104')) {
        patchRequests.push(req.postData() ?? '');
      }
    });

    await page.getByTestId('n5-block-row-9104').click();
    const editor = page.getByTestId('n5-block-editor-9104');

    // 초기 상태: charLimit=120을 넘는 긴 번역문이라 overflow badge가 보인다.
    await expect(page.getByTestId('n5-block-row-9104').getByText('자동 글자 크기 조정')).toBeVisible();

    await editor.fill('Patch test recommended.'); // 120자 이내로 축약
    const saveBtn = page.getByTestId('n5-block-save-9104');
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // 저장 중 중복 클릭 방지 — 클릭 직후 버튼이 disabled로 전환된다.
    await expect(saveBtn).toBeDisabled();
    expect(patchRequests).toHaveLength(1);
    expect(JSON.parse(patchRequests[0])).toEqual({ trans1: 'Patch test recommended.', revision: 1 });

    // PATCH 직후(재렌더 완료 전)에는 overflow/autoAdjust가 여전히 이전 값이다 —
    // FE가 즉시 추측해서 갱신하지 않는다.
    await expect(page.getByTestId('n5-block-row-9104').getByText('자동 글자 크기 조정')).toBeVisible();

    // 재렌더(mock: 2 poll * 2s) 완료 대기 — done 이후 blocks 재조회로 실제 갱신된다.
    await expect(page.getByText('재렌더링 중…')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('n5-block-row-9104').getByText('자동 글자 크기 조정')).toHaveCount(0);
  });
});

test.describe('409 REVISION_CONFLICT', () => {
  test('충돌 시 사용자 초안과 서버 최신값을 함께 보여주고 자동으로 덮어쓰지 않는다', async ({ page }) => {
    await page.getByTestId('n5-block-row-9103').click();
    const editor = page.getByTestId('n5-block-editor-9103');
    const myDraft = '$99.99 (내 초안)';
    await editor.fill(myDraft);

    // 다른 클라이언트가 먼저 같은 block을 PATCH해서 서버 revision을 앞서 올린다
    // (React Query 캐시를 거치지 않는 직접 fetch — 화면이 들고 있는
    // block.revision을 의도적으로 낡게 만들기 위함).
    const conflictSetup = await page.evaluate(async (jobId) => {
      const res = await fetch(`/jobs/${jobId}/blocks/9103`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trans1: '$50.00 (다른 클라이언트)', revision: 1 }),
      });
      return res.status;
    }, MOCK_JOB_ID);
    expect(conflictSetup).toBe(200);

    await page.getByTestId('n5-block-save-9103').click();

    const conflictBox = page.getByTestId('n5-block-conflict-9103');
    await expect(conflictBox).toBeVisible();
    await expect(editor).toHaveValue(myDraft); // 내 초안이 자동으로 지워지지 않는다
    await expect(conflictBox).toContainText('다른 클라이언트'); // 서버 최신값도 함께 보인다

    await page.getByTestId('n5-block-conflict-load-9103').click();
    await expect(editor).toHaveValue('$50.00 (다른 클라이언트)');
    await expect(conflictBox).toHaveCount(0);

    // 최신 값을 불러온 뒤에는 재저장이 가능하다(revision이 캐시에 갱신됐다).
    await expect(page.getByTestId('n5-block-save-9103')).toBeDisabled(); // dirty 아님(방금 불러온 값 그대로)
  });
});

test.describe('F-CFM-14 회귀 — N5 제외 오버레이', () => {
  test('제외하기/되돌리기가 정상 동작하고 canvas 크기가 바뀌지 않는다', async ({ page }) => {
    const canvas = page.getByTestId('n5-canvas');
    const sizeBefore = await canvas.evaluate((el) => ({
      w: (el as HTMLElement).style.width,
      h: (el as HTMLElement).style.height,
    }));

    await page.getByTestId('n5-section-exclude-501').click();
    await expect(page.getByTestId('n5-section-excluded-501')).toBeVisible();
    expect(await canvas.evaluate((el) => ({ w: (el as HTMLElement).style.width, h: (el as HTMLElement).style.height }))).toEqual(
      sizeBefore,
    );

    // 다른 section(502) 선택은 501의 제외 오버레이에 영향을 주지 않는다
    await page.getByTestId('n5-block-row-9103').click();
    await expect(page.getByTestId('n5-section-excluded-501')).toBeVisible();

    await page.getByTestId('n5-section-restore-501').click();
    await expect(page.getByTestId('n5-section-excluded-501')).toHaveCount(0);
    expect(await canvas.evaluate((el) => ({ w: (el as HTMLElement).style.width, h: (el as HTMLElement).style.height }))).toEqual(
      sizeBefore,
    );
  });
});
