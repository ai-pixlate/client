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
