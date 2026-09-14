import { test, expect } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';
import { MOCK_JOB_ID, MOCK_STRESS_JOB_ID, MOCK_STRESS_TALL_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N5 — 캔버스형 viewport interaction (9일차, Figma 544:3168 기준)
//
// Before/After 비교 슬라이더(8일차)를 폐기하고 도입한 zoom/pan/fit/mode
// 조작 기반을 검증한다. n5-canvas의 data-zoom/data-pan-x/data-pan-y는
// 화면에 보이지 않는 테스트 전용 hook이다(transform CSS 문자열을 파싱하지
// 않기 위함) — app/jobs/[jobId]/_components/n5/n5-viewport.tsx 참고.
// ─────────────────────────────────────────────────────────────────

async function readTransform(page: import('@playwright/test').Page) {
  const canvas = page.locator('[data-testid="n5-canvas"]');
  const [zoom, panX, panY] = await Promise.all([
    canvas.getAttribute('data-zoom'),
    canvas.getAttribute('data-pan-x'),
    canvas.getAttribute('data-pan-y'),
  ]);
  return { zoom: Number(zoom), panX: Number(panX), panY: Number(panY) };
}

/**
 * n5-viewport의 padding 제외 usable 크기(lib/n5/viewport.ts의
 * computeUsableViewportSize와 같은 계산)를 실제 DOM에서 읽는다 — 픽셀 값을
 * 하드코딩하지 않고, 매 실행 시점의 실제 레이아웃을 기준으로 기대값을
 * 계산하기 위함이다.
 */
async function readUsableSize(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="n5-viewport"]') as HTMLElement;
    const style = getComputedStyle(el);
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingRight = parseFloat(style.paddingRight) || 0;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;
    return {
      width: el.clientWidth - paddingLeft - paddingRight,
      height: el.clientHeight - paddingTop - paddingBottom,
    };
  });
}

/** canvas의 style.width/height("Npx" 문자열)를 숫자로 읽는다. */
async function readCanvasSizePx(page: import('@playwright/test').Page) {
  const canvas = page.locator('[data-testid="n5-canvas"]');
  const [widthPx, heightPx] = await Promise.all([
    canvas.evaluate((el) => (el as HTMLElement).style.width),
    canvas.evaluate((el) => (el as HTMLElement).style.height),
  ]);
  return { width: Number(widthPx.replace('px', '')), height: Number(heightPx.replace('px', '')) };
}

test.describe('N5 캔버스형 viewport', () => {
  test.beforeEach(async ({ page }) => {
    await reachN5(page);
  });

  test('Before/After 슬라이더는 더 이상 존재하지 않는다', async ({ page }) => {
    await expect(page.locator('[data-testid="n5-before-after-slider"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="n5-compare-stack"]')).toHaveCount(0);
  });

  // 판정(verdicts) 0건 방어 — N5Panel(app/jobs/[jobId]/_components/n5/n5-panel.tsx)은
  // job.targetCountry/targetLanguage와 blockCount(텍스트 블록 총 개수)만
  // 표시할 뿐, verdicts나 "확인 필요" 신호는 아예 읽지 않는다(9/9 block table
  // 구현 전까지는 참조 자체가 없다). 그래서 판정/확인필요 신호가 0건이어도
  // 우측 영역이 깨질 수 없다는 것을 코드 구조로 이미 보장한다 — 이 테스트는
  // 그 사실을 실제 렌더 결과로 재확인한다. 새로운 판정/신호를 만들어 넣지 않는다.
  test('N5 우측 패널은 판정/확인필요 신호 데이터를 쓰지 않으므로 0건이어도 정상 렌더된다', async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await expect(page.getByTestId('n5-panel')).toBeVisible();
    await expect(page.getByTestId('n5-panel-body')).toBeVisible();
    await expect(page.getByRole('heading', { name: '번역 결과' })).toBeVisible();
    // 좌측 preview(canvas)와 번역 전/후 토글도 함께 정상이다.
    await expect(page.getByTestId('n5-canvas')).toBeVisible();
    await expect(page.getByTestId('n5-view-mode-translated')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('n5-view-mode-original').click();
    await expect(page.getByTestId('n5-view-mode-original')).toHaveAttribute('aria-pressed', 'true');

    expect(pageErrors).toEqual([]);
  });

  test('토글 라벨은 "번역 전"/"번역 후"이다 (v3.4.1, 원문/번역문 명칭 폐기)', async ({ page }) => {
    await expect(page.getByTestId('n5-view-mode-translated')).toHaveText('번역 후');
    await expect(page.getByTestId('n5-view-mode-original')).toHaveText('번역 전');
  });

  test('기본 view mode는 번역 후이고, 번역 전으로 전환 후 다시 복귀할 수 있다', async ({ page }) => {
    await expect(page.getByTestId('n5-view-mode-translated')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('n5-view-mode-original')).toHaveAttribute('aria-pressed', 'false');
    // 번역 후 layer만 실제로 렌더된다 (동일 viewport에서 image source만 교체하므로
    // 두 layer가 동시에 DOM에 있지 않다)
    await expect(page.locator('[data-testid^="n5-slice-translated-"]').first()).toBeVisible();
    await expect(page.locator('[data-testid^="n5-slice-original-"]')).toHaveCount(0);

    await page.getByTestId('n5-view-mode-original').click();
    await expect(page.getByTestId('n5-view-mode-original')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid^="n5-slice-original-"]').first()).toBeVisible();
    await expect(page.locator('[data-testid^="n5-slice-translated-"]')).toHaveCount(0);

    await page.getByTestId('n5-view-mode-translated').click();
    await expect(page.getByTestId('n5-view-mode-translated')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid^="n5-slice-translated-"]').first()).toBeVisible();
  });

  test('번역 전은 originalUrl, 번역 후는 renderedUrl 이미지를 그린다 (/preview 최종 계약)', async ({
    page,
  }) => {
    // 기본값(번역 후) — ReviewSourceImage.renderedUrl(mock: *-translated.png)을 그린다
    const translatedSlice = page.locator('[data-testid^="n5-slice-translated-"]').first();
    const translatedBg = await translatedSlice.evaluate(
      (el) => getComputedStyle(el).backgroundImage,
    );
    expect(translatedBg).toContain('-translated.png');

    // 번역 전으로 전환 — ReviewSourceImage.originalUrl(mock: *-original.png)을 그린다
    await page.getByTestId('n5-view-mode-original').click();
    const originalSlice = page.locator('[data-testid^="n5-slice-original-"]').first();
    const originalBg = await originalSlice.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(originalBg).toContain('-original.png');
  });

  test('토글 전후 canvas height가 바뀌지 않는다 (originalUrl/renderedUrl은 같은 preview 좌표계를 공유)', async ({
    page,
  }) => {
    const canvas = page.locator('[data-testid="n5-canvas"]');
    const heightBefore = await canvas.evaluate((el) => (el as HTMLElement).style.height);

    await page.getByTestId('n5-view-mode-original').click();
    const heightAfterOriginal = await canvas.evaluate((el) => (el as HTMLElement).style.height);
    expect(heightAfterOriginal).toBe(heightBefore);

    await page.getByTestId('n5-view-mode-translated').click();
    const heightAfterBack = await canvas.evaluate((el) => (el as HTMLElement).style.height);
    expect(heightAfterBack).toBe(heightBefore);
  });

  test('canvas width는 originalUrl 이미지의 naturalWidth와 같다 (scale 이중 적용 아님)', async ({
    page,
  }) => {
    // originalUrl/renderedUrl 자체가 이미 다운스케일된 preview 이미지이므로
    // (백엔드 최종 확정), 그 naturalWidth에는 scale을 다시 곱하면 안 된다 —
    // canvas width(=각 sourceImage 표시 폭의 최댓값)가 실제 이미지 파일의
    // naturalWidth와 정확히 같아야 한다(naturalWidth * scale이 되어서는 안 됨).
    const canvas = page.locator('[data-testid="n5-canvas"]');
    const canvasWidth = await canvas.evaluate((el) => parseFloat((el as HTMLElement).style.width));

    const maxNaturalWidth = await page.evaluate(async (jobId) => {
      const res = await fetch(`/api/jobs/${jobId}/preview`);
      const body = await res.json();
      const widths = await Promise.all(
        (body.sourceImages as { originalUrl: string }[]).map(
          (img) =>
            new Promise<number>((resolve, reject) => {
              const el = new Image();
              el.onload = () => resolve(el.naturalWidth);
              el.onerror = () => reject(new Error(`이미지 로드 실패: ${img.originalUrl}`));
              el.src = img.originalUrl;
            }),
        ),
      );
      return Math.max(...widths);
    }, MOCK_JOB_ID);

    expect(canvasWidth).toBe(maxNaturalWidth);
  });

  test('sourceImage별로 originalUrl과 renderedUrl 실제 이미지의 naturalHeight가 같다', async ({
    page,
  }) => {
    // canvas.style.height(레이아웃값) 비교만으로는 "실제 파일 두 개가 정말
    // 같은 높이의 이미지인지"를 확인할 수 없다 — 두 URL이 서로 다른
    // 높이의 파일을 가리켜도 계산식(section.height * scale)이 같으면
    // canvas height는 똑같이 나오기 때문이다. 여기서는 originalUrl/renderedUrl을
    // 실제로 로드해 naturalHeight를 직접 비교한다. renderedUrl===null인
    // sourceImage(렌더 미완료)는 비교 대상에서 제외한다.
    const comparisons = await page.evaluate(async (jobId) => {
      const res = await fetch(`/api/jobs/${jobId}/preview`);
      const body = await res.json();

      const loadNaturalHeight = (url: string) =>
        new Promise<number>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el.naturalHeight);
          el.onerror = () => reject(new Error(`이미지 로드 실패: ${url}`));
          el.src = url;
        });

      const sourceImages = body.sourceImages as {
        sourceImageId: string;
        originalUrl: string;
        renderedUrl: string | null;
      }[];

      const results: { sourceImageId: string; originalHeight: number; renderedHeight: number }[] = [];
      for (const image of sourceImages) {
        if (image.renderedUrl === null) continue; // 렌더 미완료 — 비교 대상 아님
        const [originalHeight, renderedHeight] = await Promise.all([
          loadNaturalHeight(image.originalUrl),
          loadNaturalHeight(image.renderedUrl),
        ]);
        results.push({ sourceImageId: image.sourceImageId, originalHeight, renderedHeight });
      }
      return results;
    }, MOCK_JOB_ID);

    // 이 mock에는 renderedUrl===null인 sourceImage가 없으므로, 비교 대상이
    // 실제로 존재하는지(제외 로직 때문에 조용히 빈 배열이 되지 않았는지)도 확인한다.
    expect(comparisons.length).toBeGreaterThan(0);
    for (const { sourceImageId, originalHeight, renderedHeight } of comparisons) {
      expect(renderedHeight, `sourceImageId=${sourceImageId}`).toBe(originalHeight);
    }
  });

  test.describe('F-CFM-14 — N5 제외 section 회색 오버레이 + 되돌리기', () => {
    // sec_07은 mock fixture(lib/mock-api/fixtures.ts)에서 이미
    // bucket: 'exclude', excludedStage: 'N5'로 세팅된 section이다 — N5Viewport가
    // 이 초기값을 로컬 state(excludedSectionIds)로 씨드한다.

    test('N5 제외 section도 slice로 남아 canvas 높이에 포함되고, 회색 오버레이가 보인다', async ({
      page,
    }) => {
      // slice 자체(배경 이미지)는 제거되지 않는다 — N3 제외와 달리 사라지지 않는다.
      await expect(page.getByTestId('n5-slice-translated-sec_07')).toBeVisible();
      // 그 위에 회색 오버레이 + 되돌리기 버튼이 덮인다.
      await expect(page.getByTestId('n5-section-excluded-sec_07')).toBeVisible();
      await expect(page.getByTestId('n5-section-restore-sec_07')).toHaveText('되돌리기');
    });

    test('되돌리기를 누르면 오버레이가 즉시 사라지고, canvas 높이는 바뀌지 않는다', async ({
      page,
    }) => {
      const canvas = page.locator('[data-testid="n5-canvas"]');
      const heightBefore = await canvas.evaluate((el) => (el as HTMLElement).style.height);

      await page.getByTestId('n5-section-restore-sec_07').click();

      // 오버레이는 사라지지만 slice(배경 이미지)는 그대로 남는다 — 서버 호출도,
      // 모달도 없이 로컬 state만 바뀐다.
      await expect(page.getByTestId('n5-section-excluded-sec_07')).toHaveCount(0);
      await expect(page.getByTestId('n5-slice-translated-sec_07')).toBeVisible();

      const heightAfter = await canvas.evaluate((el) => (el as HTMLElement).style.height);
      expect(heightAfter).toBe(heightBefore);
    });

    test('되돌리기 전후 다른 section의 위치가 움직이지 않는다', async ({ page }) => {
      // sec_07 바로 다음에 화면에 그려지는 section은 sec_04(SRC_B 첫 include) —
      // sec_03(N3 제외)은 애초에 렌더되지 않는다. 스택 재배치가 없다면 이
      // section의 위치는 되돌리기 전후로 완전히 같아야 한다.
      //
      // boundingBox()(뷰포트 기준 절대 좌표)는 쓰지 않는다 — 화면 밖에 있는
      // 되돌리기 버튼을 클릭할 때 Playwright가 페이지를 스크롤할 수 있고,
      // 그러면 스크롤량만큼 모든 요소의 뷰포트 기준 좌표가 같이 밀려서 실제
      // 레이아웃이 그대로여도 오탐이 난다. offsetTop/offsetLeft(레이아웃
      // 고유값, 스크롤과 무관)로 비교한다.
      const nextSlice = page.getByTestId('n5-slice-translated-sec_04');
      const readOffset = () =>
        nextSlice.evaluate((el) => ({
          top: (el as HTMLElement).offsetTop,
          left: (el as HTMLElement).offsetLeft,
        }));

      const offsetBefore = await readOffset();

      await page.getByTestId('n5-section-restore-sec_07').click();
      await expect(page.getByTestId('n5-section-excluded-sec_07')).toHaveCount(0);

      const offsetAfter = await readOffset();

      expect(offsetAfter.top).toBe(offsetBefore.top);
      expect(offsetAfter.left).toBe(offsetBefore.left);
    });

    test('번역 전/번역 후 전환 후에도 제외 오버레이가 유지된다', async ({ page }) => {
      await expect(page.getByTestId('n5-section-excluded-sec_07')).toBeVisible();

      await page.getByTestId('n5-view-mode-original').click();
      // 번역 전 slice(n5-slice-original-sec_07)로 image source만 바뀌었을 뿐,
      // 오버레이는 mode와 무관한 로컬 state라 그대로 남아 있어야 한다.
      await expect(page.getByTestId('n5-slice-original-sec_07')).toBeVisible();
      await expect(page.getByTestId('n5-section-excluded-sec_07')).toBeVisible();

      await page.getByTestId('n5-view-mode-translated').click();
      await expect(page.getByTestId('n5-section-excluded-sec_07')).toBeVisible();
    });

    // sec_01은 mock fixture에서 처음부터 bucket: 'include'인 section이다 —
    // 「제외하기」 액션(서버 왕복 없이 excludedSectionIds에 add)을 검증한다.
    test('포함 section에 [제외하기] 버튼이 보이고, 클릭 즉시 회색 오버레이가 뜬다', async ({
      page,
    }) => {
      await expect(page.getByTestId('n5-section-exclude-sec_01')).toHaveText('제외하기');
      await expect(page.getByTestId('n5-section-excluded-sec_01')).toHaveCount(0);

      await page.getByTestId('n5-section-exclude-sec_01').click();

      // [제외하기]는 사라지고 회색 오버레이 + [되돌리기]로 바뀐다. slice(배경
      // 이미지) 자체는 그대로 남는다 — 서버 호출도, 모달도 없다.
      await expect(page.getByTestId('n5-section-exclude-sec_01')).toHaveCount(0);
      await expect(page.getByTestId('n5-section-excluded-sec_01')).toBeVisible();
      await expect(page.getByTestId('n5-section-restore-sec_01')).toHaveText('되돌리기');
      await expect(page.getByTestId('n5-slice-translated-sec_01')).toBeVisible();
    });

    test('제외하기 전후 canvas 높이와 다른 section 위치가 그대로다', async ({ page }) => {
      const canvas = page.locator('[data-testid="n5-canvas"]');
      const heightBefore = await canvas.evaluate((el) => (el as HTMLElement).style.height);

      // sec_01 바로 다음 section인 sec_02의 레이아웃 위치(스크롤과 무관한
      // offsetTop/Left)를 기준으로 스택 재배치 여부를 확인한다.
      const nextSlice = page.getByTestId('n5-slice-translated-sec_02');
      const readOffset = () =>
        nextSlice.evaluate((el) => ({
          top: (el as HTMLElement).offsetTop,
          left: (el as HTMLElement).offsetLeft,
        }));
      const offsetBefore = await readOffset();

      await page.getByTestId('n5-section-exclude-sec_01').click();
      await expect(page.getByTestId('n5-section-excluded-sec_01')).toBeVisible();

      const heightAfter = await canvas.evaluate((el) => (el as HTMLElement).style.height);
      expect(heightAfter).toBe(heightBefore);

      const offsetAfter = await readOffset();
      expect(offsetAfter.top).toBe(offsetBefore.top);
      expect(offsetAfter.left).toBe(offsetBefore.left);
    });

    test('제외하기 후 번역 전/번역 후 전환해도 제외 상태가 유지된다', async ({ page }) => {
      await page.getByTestId('n5-section-exclude-sec_01').click();
      await expect(page.getByTestId('n5-section-excluded-sec_01')).toBeVisible();

      await page.getByTestId('n5-view-mode-original').click();
      await expect(page.getByTestId('n5-slice-original-sec_01')).toBeVisible();
      await expect(page.getByTestId('n5-section-excluded-sec_01')).toBeVisible();

      await page.getByTestId('n5-view-mode-translated').click();
      await expect(page.getByTestId('n5-section-excluded-sec_01')).toBeVisible();
    });

    test('제외 후 되돌리면 오버레이가 사라지고, 다시 제외할 수 있다', async ({ page }) => {
      await page.getByTestId('n5-section-exclude-sec_01').click();
      await expect(page.getByTestId('n5-section-excluded-sec_01')).toBeVisible();

      await page.getByTestId('n5-section-restore-sec_01').click();
      await expect(page.getByTestId('n5-section-excluded-sec_01')).toHaveCount(0);
      await expect(page.getByTestId('n5-section-exclude-sec_01')).toBeVisible();

      // 되돌린 뒤 다시 제외 가능한 상태인지 — 한 쌍으로 반복 동작해야 한다.
      await page.getByTestId('n5-section-exclude-sec_01').click();
      await expect(page.getByTestId('n5-section-excluded-sec_01')).toBeVisible();
      await expect(page.getByTestId('n5-section-exclude-sec_01')).toHaveCount(0);
    });
  });

  test('+/- 로 zoom이 바뀌고 표시값에 반영된다', async ({ page }) => {
    // 11일차부터 n5-zoom-value는 읽기 전용 span이 아니라 입력 가능한
    // input이다 — 표시값은 toHaveText가 아니라 toHaveValue로 확인한다.
    await expect(page.getByTestId('n5-zoom-value')).toHaveValue('100');

    await page.getByTestId('n5-zoom-in').click();
    await expect(page.getByTestId('n5-zoom-value')).toHaveValue('110');
    const afterIn = await readTransform(page);
    expect(afterIn.zoom).toBeCloseTo(1.1, 5);

    await page.getByTestId('n5-zoom-out').click();
    await page.getByTestId('n5-zoom-out').click();
    await expect(page.getByTestId('n5-zoom-value')).toHaveValue('90');
  });

  test('mode 전환 후에도 zoom과 pan(viewport 위치)이 유지된다', async ({ page }) => {
    // zoom을 바꿔둔다
    await page.getByTestId('n5-zoom-in').click();
    await page.getByTestId('n5-zoom-in').click();
    const beforeSwitch = await readTransform(page);
    expect(beforeSwitch.zoom).toBeCloseTo(1.2, 5);

    // Space+drag로 pan도 바꿔둔다
    const viewport = page.locator('[data-testid="n5-viewport"]');
    const box = await viewport.boundingBox();
    if (!box) throw new Error('n5-viewport 위치를 찾을 수 없습니다');
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    await page.keyboard.down('Space');
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX - 60, centerY - 40, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Space');

    const afterPan = await readTransform(page);
    expect(afterPan.panX).not.toBe(0);
    expect(afterPan.panY).not.toBe(0);
    expect(afterPan.zoom).toBeCloseTo(beforeSwitch.zoom, 5); // pan만 바뀌고 zoom은 그대로

    // ── mode 전환 — zoom/pan이 그대로인지 확인 ──
    await page.getByTestId('n5-view-mode-original').click();
    const afterSwitchToOriginal = await readTransform(page);
    expect(afterSwitchToOriginal.zoom).toBeCloseTo(afterPan.zoom, 5);
    expect(afterSwitchToOriginal.panX).toBeCloseTo(afterPan.panX, 5);
    expect(afterSwitchToOriginal.panY).toBeCloseTo(afterPan.panY, 5);

    await page.getByTestId('n5-view-mode-translated').click();
    const afterSwitchBack = await readTransform(page);
    expect(afterSwitchBack.zoom).toBeCloseTo(afterPan.zoom, 5);
    expect(afterSwitchBack.panX).toBeCloseTo(afterPan.panX, 5);
    expect(afterSwitchBack.panY).toBeCloseTo(afterPan.panY, 5);
  });

  test('일반 wheel/Shift+Wheel이 transform.pan을 움직인다 (native scroll 아님)', async ({ page }) => {
    const viewport = page.locator('[data-testid="n5-viewport"]');
    const box = await viewport.boundingBox();
    if (!box) throw new Error('n5-viewport 위치를 찾을 수 없습니다');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    const before = await readTransform(page);
    expect(before.panX).toBe(0);
    expect(before.panY).toBe(0);

    // 11일차 pan clamp 도입 후: 이 job의 canvas 너비가 usable viewport 너비보다
    // 작으면, 가로축은 "가운데 고정 + pan 금지" 대상이라 어떤 wheel/drag를
    // 해도 panX는 항상 같은 중앙값에 고정된다(spec 5). 실제 값을 하드코딩하지
        // 않고 매 실행 시점 레이아웃에서 계산한다.
    const usable = await readUsableSize(page);
    const { width: canvasWidthPx } = await readCanvasSizePx(page);
    const scaledWidth = canvasWidthPx * before.zoom;
    const xLocked = scaledWidth <= usable.width;
    const expectedLockedX = (usable.width - scaledWidth) / 2;

    // 일반 wheel 아래 방향(deltaY>0) — canvas가 위로 이동(pan.y가 음수로)해서
    // 아래쪽 내용이 보인다. native scrollTop은 만들지 않았으므로 이 element
    // 자체의 scrollTop은 항상 0이어야 한다.
    await page.mouse.wheel(0, 200);
    const afterDown = await readTransform(page);
    expect(afterDown.panY).toBeLessThan(before.panY);
    if (xLocked) {
      expect(afterDown.panX).toBeCloseTo(expectedLockedX, 0);
    } else {
      expect(afterDown.panX).toBe(0);
    }
    const scrollTop = await viewport.evaluate((el) => el.scrollTop);
    expect(scrollTop).toBe(0);

    // 일반 wheel 위 방향 — 반대로 이동
    await page.mouse.wheel(0, -50);
    const afterUp = await readTransform(page);
    expect(afterUp.panY).toBeGreaterThan(afterDown.panY);

    // Shift+Wheel — 세로 delta를 가로 이동으로 사용한다(pan.y는 그대로).
    // 단, 가로축이 잠겨 있으면(xLocked) Shift+Wheel도 panX를 움직이지 못한다.
    const beforeShift = afterUp;
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, 100);
    await page.keyboard.up('Shift');
    const afterShift = await readTransform(page);
    if (xLocked) {
      expect(afterShift.panX).toBeCloseTo(beforeShift.panX, 5);
    } else {
      expect(afterShift.panX).toBeLessThan(beforeShift.panX);
    }
    expect(afterShift.panY).toBeCloseTo(beforeShift.panY, 5);
  });

  test('wheel pan 후 이어서 Space+Drag가 자연스럽게 동작한다', async ({ page }) => {
    const viewport = page.locator('[data-testid="n5-viewport"]');
    const box = await viewport.boundingBox();
    if (!box) throw new Error('n5-viewport 위치를 찾을 수 없습니다');
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    await page.mouse.move(centerX, centerY);
    await page.mouse.wheel(0, 150);
    const afterWheel = await readTransform(page);

    // 11일차 pan clamp: 가로축이 usable viewport보다 좁은 canvas라면 그
    // 축은 "가운데 고정 + pan 금지" 대상이라 드래그해도 panX는 바뀌지 않는다
    // (spec 5) — 실제 값을 매 실행 시점 레이아웃에서 계산해 판단한다.
    const usable = await readUsableSize(page);
    const { width: canvasWidthPx } = await readCanvasSizePx(page);
    const xLocked = canvasWidthPx * afterWheel.zoom <= usable.width;

    await page.keyboard.down('Space');
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX - 40, centerY - 30, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Space');

    const afterDrag = await readTransform(page);
    // wheel pan 결과 위에서 이어서 움직여야 한다 (드래그가 wheel 이전 값으로
    // 리셋되지 않는다 — 같은 transform.pan을 공유한다는 증거)
    expect(afterDrag.panY).not.toBe(afterWheel.panY);
    if (xLocked) {
      expect(afterDrag.panX).toBeCloseTo(afterWheel.panX, 5);
    } else {
      expect(afterDrag.panX).not.toBe(afterWheel.panX);
    }
  });

  test('wheel pan 후 mode 전환 / zoom 조작을 해도 같은 좌표계를 유지한다', async ({ page }) => {
    const viewport = page.locator('[data-testid="n5-viewport"]');
    const box = await viewport.boundingBox();
    if (!box) throw new Error('n5-viewport 위치를 찾을 수 없습니다');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    await page.mouse.wheel(0, 300);
    const afterWheel = await readTransform(page);
    expect(afterWheel.panY).toBeLessThan(0);

    // mode 전환해도 pan/zoom 그대로
    await page.getByTestId('n5-view-mode-original').click();
    const afterMode = await readTransform(page);
    expect(afterMode.panY).toBeCloseTo(afterWheel.panY, 5);
    expect(afterMode.zoom).toBeCloseTo(afterWheel.zoom, 5);

    // +/- zoom은 zoom만 바꾸고, pan은 pointer-centered 재계산만 될 뿐
    // wheel로 만든 좌표계(같은 transform.pan 기준) 위에서 이어진다 — 0으로
    // 리셋되지 않는다.
    await page.getByTestId('n5-zoom-in').click();
    const afterZoom = await readTransform(page);
    expect(afterZoom.zoom).toBeGreaterThan(afterMode.zoom);
    expect(afterZoom.panY).not.toBe(0);
  });

  test('Ctrl+Wheel로 pointer 위치 중심 zoom이 되고, 페이지 자체 zoom은 막힌다', async ({ page }) => {
    const viewport = page.locator('[data-testid="n5-viewport"]');
    const box = await viewport.boundingBox();
    if (!box) throw new Error('n5-viewport 위치를 찾을 수 없습니다');

    const before = await readTransform(page);
    expect(before.zoom).toBeCloseTo(1, 5);

    // pointer를 viewport 중앙에 두고 Ctrl+Wheel(위로 굴림 = 확대)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');

    const after = await readTransform(page);
    expect(after.zoom).toBeGreaterThan(before.zoom);

    // 브라우저 기본 page zoom(visualViewport.scale)이 바뀌지 않았는지 — Ctrl+Wheel을
    // 우리 핸들러가 preventDefault로 가로챈 것을 방증한다.
    const pageZoom = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    expect(pageZoom).toBeCloseTo(1, 2);
  });

  test('Fit Width / Fit Height 계산 — 반복 실행해도 같은 값(오차 누적 없음)', async ({ page }) => {
    await page.getByTestId('n5-fit-width').click();
    const fitWidthOnce = await readTransform(page);
    expect(fitWidthOnce.zoom).not.toBeCloseTo(1, 2);

    await page.getByTestId('n5-fit-width').click();
    const fitWidthTwice = await readTransform(page);
    expect(fitWidthTwice.zoom).toBeCloseTo(fitWidthOnce.zoom, 5);

    await page.getByTestId('n5-fit-height').click();
    const fitHeight = await readTransform(page);
    expect(fitHeight.zoom).not.toBeCloseTo(fitWidthOnce.zoom, 5);

    await page.getByTestId('n5-fit-height').click();
    const fitHeightTwice = await readTransform(page);
    expect(fitHeightTwice.zoom).toBeCloseTo(fitHeight.zoom, 5);
  });

  test('SRC_A/SRC_B 여러 소스 이미지에 걸친 canvas에서도 조작이 동작하고 이미지 404가 없다', async ({
    page,
  }) => {
    const failedImages: string[] = [];
    page.on('response', (res) => {
      if (res.request().resourceType() === 'image' && res.status() >= 400) {
        failedImages.push(`${res.status()} ${res.url()}`);
      }
    });

    // 두 소스 이미지(SRC_A/SRC_B) slice가 모두 canvas에 존재한다
    const sliceCount = await page.locator('[data-testid^="n5-slice-translated-"]').count();
    expect(sliceCount).toBeGreaterThanOrEqual(2);

    // 전체를 한 화면에 담아 SRC_B 영역까지 내려간 상태에서 mode 전환 + zoom
    await page.getByTestId('n5-fit-height').click();
    await page.getByTestId('n5-view-mode-original').click();
    await page.getByTestId('n5-zoom-in').click();

    await expect(page.getByTestId('n5-view-mode-original')).toHaveAttribute('aria-pressed', 'true');
    expect(failedImages).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────
// N5 — 212x8000 극단 이미지 성능 방어 검증 (10일차, "실데이터 방어 검증")
//
// page.route로 정적 이미지 요청을 가로채려 했으나, MSW Service Worker가
// 페이지를 컨트롤하는 동안에는 /api/* JSON뿐 아니라 매치되는 handler가
// 없는 정적 파일 GET까지도 page.route가 전혀 가로채지 못한다는 것을 실측으로
// 확인했다. 이후 테스트 실행 중 /mock/n5/*.png 파일 바이트를 임시로
// 바꿔치기하는 방식을 써봤지만, 같은 파일을 병렬로 참조하는 다른 N5
// 테스트와 간섭할 수 있어 완전히 제거했다.
//
// 최종 방식: mockStressReviewResponse/mockStressPreviewResponse(둘 다
// lib/mock-api/fixtures.ts, 기본 job과 sourceImage/section이 전혀 겹치지
// 않는 별도 jobId=MOCK_STRESS_JOB_ID)를 MSW handler가 그대로 내려준다.
// 이 jobId는 status도 처음부터 currentStep:'N5' 고정 응답이라 N1~N4를 거치지
// 않고 바로 진입한다. 정적 fixture 파일(public/mock/**)은 테스트 중 어떤
// 시점에도 쓰기(write)되지 않는다 — 212x8000 실제 파일(scripts/make-n3-fixture-images.mjs로
// 생성, N3 방어 검증과 동일 파일)을 읽기 전용으로 가리킬 뿐이다. /preview·
// scale·F-CFM-14 계약과 기본 job(MOCK_JOB_ID) 데이터는 전혀 건드리지 않았다.
// ─────────────────────────────────────────────────────────────────

test.describe('N5 — 212x8000 극단 이미지 성능 방어 (stress job 전용, 파일 쓰기 없음)', () => {
  test('진입 실패/이미지 로드 실패/timeout 없이 canvas가 뜨고, zoom/pan/scroll 조작이 가능하다', async ({
    page,
  }) => {
    const failedImages: string[] = [];
    page.on('response', (res) => {
      if (res.request().resourceType() === 'image' && res.status() >= 400) {
        failedImages.push(`${res.status()} ${res.url()}`);
      }
    });
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    const start = Date.now();

    // stress job은 처음부터 currentStep:'N5'로 고정 응답하는 별도
    // jobId다 — N1~N4를 거치지 않고 바로 N5 화면으로 진입한다.
    await page.goto(`/jobs/${MOCK_STRESS_JOB_ID}`);

    // n5-canvas가 뜬다는 것 자체가 naturalWidth 측정(useNaturalWidths)과
    // slice 렌더가 212x8000 이미지에서도 끝까지 완료됐다는 뜻이다.
    await expect(page.locator('[data-testid="n5-canvas"]')).toBeVisible({ timeout: 20_000 });
    const elapsedMs = Date.now() - start;

    expect(pageErrors, `pageerror 발생: ${pageErrors.map((e) => e.message).join(', ')}`).toEqual([]);
    expect(failedImages, '이미지 404/5xx 발생').toEqual([]);
    // 여유 있게 20초 이내 — 심각한 브라우저 멈춤이 있었다면 이 자체가 timeout으로 드러난다.
    expect(elapsedMs).toBeLessThan(20_000);

    // stress 이미지가 실제로 212px 폭으로 측정됐는지 — 이중 스케일이나
    // 잘못된 fallback 없이 극단 이미지의 naturalWidth를 그대로 반영했는지.
    const naturalWidth = await page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img.naturalWidth);
          img.onerror = () => reject(new Error('stress 이미지 로드 실패'));
          img.src = '/mock/n3/section-212x8000.png';
        }),
    );
    expect(naturalWidth).toBe(212);

    // zoom 조작 가능
    await page.getByTestId('n5-zoom-in').click();
    await expect(page.getByTestId('n5-zoom-value')).toHaveValue('110');

    // scroll(wheel pan) 조작 가능
    const viewport = page.locator('[data-testid="n5-viewport"]');
    const box = await viewport.boundingBox();
    if (!box) throw new Error('n5-viewport 위치를 찾을 수 없습니다');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const canvas = page.locator('[data-testid="n5-canvas"]');
    const panYBefore = await canvas.getAttribute('data-pan-y');
    await page.mouse.wheel(0, 400);
    const panYAfter = await canvas.getAttribute('data-pan-y');
    expect(panYAfter).not.toBe(panYBefore);

    // Fit Height(극단적으로 긴 이미지를 한 화면에 맞추는 연산)도 멈추지 않는다
    await page.getByTestId('n5-fit-height').click();
    await expect(page.getByTestId('n5-canvas')).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────
// N5 — "초장축 원본 좌표계" stress 검증 (10~11일차, "실데이터 방어 검증" 후속)
//
// 원본 section 좌표계: width 1000 / height 37736, /preview scale: 0.5 —
// 실제 preview는 500 x 18868(= 1000*0.5 x 37736*0.5)이다. originalUrl/
// renderedUrl 자체가 이미 다운스케일된 preview 이미지라는 계약에 따라,
// 1000x37736 원본 이미지를 URL에 넣고 FE가 다시 scale을 곱하는 구조로
// 만들지 않는다 — scripts/make-n3-fixture-images.mjs가 만든 실제
// 500x18868 PNG 파일을 그대로 가리킨다.
//
// 위 212x8000 stress job과 마찬가지로 별도 jobId(MOCK_STRESS_TALL_JOB_ID,
// lib/mock-api/fixtures.ts)로 완전히 분리돼 있고, MSW handler가 고정
// 응답을 내려준다 — 테스트 중 어떤 정적 fixture 파일도 쓰기(write)하지
// 않는다.
//
// 11일차: Fit Height/Width 정중앙 배치, pan 경계(clamp), 배율 직접 입력을
// 이 stress job으로 검증한다 — 500x18868처럼 세로가 극단적으로 긴 이미지가
// 바로 이 기능들이 고치려는 문제(구 MIN_ZOOM=0.25 때문에 Fit Height가
// 잘리던 문제)의 실제 사례이기 때문이다.
// ─────────────────────────────────────────────────────────────────

test.describe('N5 — 초장축 원본 좌표계(1000x37736, scale 0.5) stress (별도 job, 파일 쓰기 없음)', () => {
  test.beforeEach(async ({ page }) => {
    // stress job은 처음부터 currentStep:'N5' 고정 응답 — N1~N4를 거치지 않는다.
    await page.goto(`/jobs/${MOCK_STRESS_TALL_JOB_ID}`);
    await expect(page.locator('[data-testid="n5-canvas"]')).toBeVisible({ timeout: 20_000 });
  });

  test('진입 실패/이미지 로드 실패/timeout 없이 500x18868 이미지가 이중 스케일 없이 렌더된다', async ({
    page,
  }) => {
    const failedImages: string[] = [];
    page.on('response', (res) => {
      if (res.request().resourceType() === 'image' && res.status() >= 400) {
        failedImages.push(`${res.status()} ${res.url()}`);
      }
    });
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    const start = Date.now();

    // 실제 fixture 파일의 naturalWidth/naturalHeight가 정확히 500x18868인지.
    const natural = await page.evaluate(
      () =>
        new Promise<{ width: number; height: number }>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
          img.onerror = () => reject(new Error('stress tall 이미지 로드 실패'));
          img.src = '/mock/n3/section-500x18868.png';
        }),
    );
    expect(natural.width).toBe(500);
    expect(natural.height).toBe(18868);

    // canvas 높이가 18868px 기준으로 구성되는지 — section.height(37736, 원본
    // 해상도) * scale(0.5)이지 naturalHeight(18868)에 scale을 또 곱한 37736이
    // 아니어야 한다(이중 스케일 없음).
    const { height: canvasHeightPx } = await readCanvasSizePx(page);
    expect(canvasHeightPx).toBe(18868);

    const elapsedMs = Date.now() - start;
    expect(pageErrors, `pageerror 발생: ${pageErrors.map((e) => e.message).join(', ')}`).toEqual([]);
    expect(failedImages, '이미지 404/5xx 발생').toEqual([]);
    // 성능 방어선 — 20초 이내. 문제가 없으므로 별도 최적화 코드는 추가하지 않는다.
    expect(elapsedMs).toBeLessThan(20_000);
  });

  test('Fit Height 후 전체 캔버스가 viewport 안에 들어오고 정중앙에 배치된다', async ({ page }) => {
    const canvas = page.locator('[data-testid="n5-canvas"]');

    await page.getByTestId('n5-fit-height').click();

    const zoom = Number(await canvas.getAttribute('data-zoom'));
    const panX = Number(await canvas.getAttribute('data-pan-x'));
    const panY = Number(await canvas.getAttribute('data-pan-y'));
    expect(Number.isFinite(zoom)).toBe(true);
    expect(zoom).toBeGreaterThan(0);
    // 구 MIN_ZOOM(0.25)이었다면 이 배율은 0.25로 clamp돼 전체가 안 들어왔을
    // 것이다 — 11일차부터 MIN_ZOOM=0.01이라 실제 fit 비율 그대로 계산된다.
    expect(zoom).toBeLessThan(0.25);

    const usable = await readUsableSize(page);
    const { width: canvasWidthPx, height: canvasHeightPx } = await readCanvasSizePx(page);
    const scaledHeight = canvasHeightPx * zoom;
    const scaledWidth = canvasWidthPx * zoom;

    // 전체 높이가 usable 안에 들어온다 — Fit Height는 세로를 정확히 맞추므로
    // scaledHeight ≈ usable.height(반올림 오차 1px 이내).
    expect(scaledHeight).toBeLessThanOrEqual(usable.height + 1);
    expect(Math.abs(scaledHeight - usable.height)).toBeLessThan(2);

    // 정중앙 배치 — computeCenteredPan과 같은 식으로 기대값을 구해 비교한다.
    const expectedPanY = (usable.height - scaledHeight) / 2;
    const expectedPanX = (usable.width - scaledWidth) / 2;
    expect(panY).toBeCloseTo(expectedPanY, 0);
    expect(panX).toBeCloseTo(expectedPanX, 0);

    await expect(canvas).toBeVisible();
  });

  test('Fit Width 후에도 정중앙에 배치된다', async ({ page }) => {
    const canvas = page.locator('[data-testid="n5-canvas"]');

    await page.getByTestId('n5-fit-width').click();

    const zoom = Number(await canvas.getAttribute('data-zoom'));
    const panX = Number(await canvas.getAttribute('data-pan-x'));
    const panY = Number(await canvas.getAttribute('data-pan-y'));
    expect(Number.isFinite(zoom)).toBe(true);
    expect(zoom).toBeGreaterThan(0);

    const usable = await readUsableSize(page);
    const { width: canvasWidthPx, height: canvasHeightPx } = await readCanvasSizePx(page);
    const scaledWidth = canvasWidthPx * zoom;
    const scaledHeight = canvasHeightPx * zoom;

    expect(scaledWidth).toBeLessThanOrEqual(usable.width + 1);
    expect(Math.abs(scaledWidth - usable.width)).toBeLessThan(2);

    const expectedPanX = (usable.width - scaledWidth) / 2;
    const expectedPanY = (usable.height - scaledHeight) / 2;
    expect(panX).toBeCloseTo(expectedPanX, 0);
    expect(panY).toBeCloseTo(expectedPanY, 0);
  });

  test('상하좌우 pan 경계를 넘어 과도한 빈 공간을 볼 수 없다', async ({ page }) => {
    const canvas = page.locator('[data-testid="n5-canvas"]');
    const viewport = page.locator('[data-testid="n5-viewport"]');
    const box = await viewport.boundingBox();
    if (!box) throw new Error('n5-viewport 위치를 찾을 수 없습니다');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    // 기본 100%에서는 canvas 너비(500px)가 usable viewport 너비보다 작아
    // 가로축이 "가운데 고정" 대상이 돼버려 가로 경계(clamp) 자체를 검증할
    // 수 없다 — 가로 방향도 실제로 pan-and-clamp되는 상황을 만들기 위해
    // 300%로 확대해 둔다(500*3=1500px, 어떤 뷰포트 너비보다도 넓다).
    const zoomInput = page.getByTestId('n5-zoom-value');
    await zoomInput.fill('300');
    await zoomInput.press('Enter');
    await expect(zoomInput).toHaveValue('300');

    const zoom = Number(await canvas.getAttribute('data-zoom'));
    expect(zoom).toBeCloseTo(3, 5);
    const usable = await readUsableSize(page);
    const { width: canvasWidthPx, height: canvasHeightPx } = await readCanvasSizePx(page);
    const scaledHeight = canvasHeightPx * zoom;

    // 아주 크게 아래로 스크롤 — 이미지 최하단이 viewport 세로 중앙보다
    // 위로 올라갈 수 없다: panY의 하한은 usable.height/2 - scaledHeight.
    await page.mouse.wheel(0, 999_999);
    const panYAfterDown = Number(await canvas.getAttribute('data-pan-y'));
    expect(panYAfterDown).toBeCloseTo(usable.height / 2 - scaledHeight, 0);

    // 아주 크게 위로 스크롤 — 이미지 최상단이 viewport 세로 중앙보다 아래로
    // 내려갈 수 없다: panY의 상한은 usable.height/2.
    await page.mouse.wheel(0, -1_999_999);
    const panYAfterUp = Number(await canvas.getAttribute('data-pan-y'));
    expect(panYAfterUp).toBeCloseTo(usable.height / 2, 0);

    // 가로도 같은 규칙 — Shift+Wheel로 좌우 이동.
    const scaledWidth = canvasWidthPx * zoom;
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, 999_999); // 오른쪽으로 끝까지
    await page.keyboard.up('Shift');
    const panXAfterRight = Number(await canvas.getAttribute('data-pan-x'));
    expect(panXAfterRight).toBeCloseTo(usable.width / 2 - scaledWidth, 0);

    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, -1_999_999); // 왼쪽으로 끝까지
    await page.keyboard.up('Shift');
    const panXAfterLeft = Number(await canvas.getAttribute('data-pan-x'));
    expect(panXAfterLeft).toBeCloseTo(usable.width / 2, 0);

    await expect(canvas).toBeVisible();
  });

  test('작은 배율(1%)에서는 캔버스가 viewport보다 작아 pan이 먹지 않는다(가운데 고정)', async ({
    page,
  }) => {
    const canvas = page.locator('[data-testid="n5-canvas"]');
    const zoomInput = page.getByTestId('n5-zoom-value');

    // 500x18868 * 1% = 5 x 188.68px — 어떤 viewport 크기에서도 확실히 더 작다.
    await zoomInput.fill('1');
    await zoomInput.press('Enter');
    await expect(zoomInput).toHaveValue('1');

    const panXBefore = await canvas.getAttribute('data-pan-x');
    const panYBefore = await canvas.getAttribute('data-pan-y');

    const viewport = page.locator('[data-testid="n5-viewport"]');
    const box = await viewport.boundingBox();
    if (!box) throw new Error('n5-viewport 위치를 찾을 수 없습니다');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    await page.mouse.wheel(500, 500);
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, 500);
    await page.keyboard.up('Shift');

    expect(await canvas.getAttribute('data-pan-x')).toBe(panXBefore);
    expect(await canvas.getAttribute('data-pan-y')).toBe(panYBefore);
  });

  test('배율을 직접 입력할 수 있다 (예: 4%)', async ({ page }) => {
    const zoomInput = page.getByTestId('n5-zoom-value');
    const canvas = page.locator('[data-testid="n5-canvas"]');

    await zoomInput.fill('4');
    await zoomInput.press('Enter');

    await expect(zoomInput).toHaveValue('4');
    const zoom = Number(await canvas.getAttribute('data-zoom'));
    expect(zoom).toBeCloseTo(0.04, 5);
  });

  test('0/-10/잘못된 문자열/빈 문자열을 입력하면 zoom을 바꾸지 않고 현재 값으로 되돌린다', async ({
    page,
  }) => {
    const zoomInput = page.getByTestId('n5-zoom-value');
    const canvas = page.locator('[data-testid="n5-canvas"]');

    // 먼저 임의의 유효한 zoom(10%)으로 맞춰둔다 — "현재 zoom 유지"가 실제로
    // MIN_ZOOM(1%)이 아닌 이 값으로 유지되는지 구분해서 검증하기 위함이다.
    await zoomInput.fill('10');
    await zoomInput.press('Enter');
    await expect(zoomInput).toHaveValue('10');

    for (const invalid of ['0', '-10', 'abc', '']) {
      await zoomInput.fill(invalid);
      await zoomInput.press('Enter');
      // 입력창 표시도 현재 유효 zoom(10%)으로 복원돼야 한다.
      await expect(zoomInput).toHaveValue('10');
      const zoom = Number(await canvas.getAttribute('data-zoom'));
      expect(zoom).toBeCloseTo(0.1, 5);
    }
  });

  test('0.5%처럼 양수지만 최소값 미만인 입력은 1%(MIN_ZOOM)로 clamp된다', async ({ page }) => {
    const zoomInput = page.getByTestId('n5-zoom-value');
    const canvas = page.locator('[data-testid="n5-canvas"]');

    await zoomInput.fill('0.5');
    await zoomInput.press('Enter');

    await expect(zoomInput).toHaveValue('1');
    const zoom = Number(await canvas.getAttribute('data-zoom'));
    expect(zoom).toBeCloseTo(0.01, 5);
  });

  test('하단으로 스크롤한 뒤 번역 후 ↔ 번역 전 전환해도 zoom/pan/canvas 높이가 유지된다', async ({
    page,
  }) => {
    const canvas = page.locator('[data-testid="n5-canvas"]');
    const viewport = page.locator('[data-testid="n5-viewport"]');
    const box = await viewport.boundingBox();
    if (!box) throw new Error('n5-viewport 위치를 찾을 수 없습니다');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    await page.mouse.wheel(0, 17_000); // 18868 중 대부분을 한 번에 내려간다
    const panYAfterScroll = Number(await canvas.getAttribute('data-pan-y'));
    expect(panYAfterScroll).toBeLessThan(-15_000); // 충분히 아래로 이동했는지
    await expect(canvas).toBeVisible();

    // 토글은 이제 우측 패널(N5Panel) 상단에 있다 — testid는 그대로다.
    const zoomBefore = await canvas.getAttribute('data-zoom');
    const panXBefore = await canvas.getAttribute('data-pan-x');
    const panYBefore = await canvas.getAttribute('data-pan-y');
    const heightBeforeToggle = (await readCanvasSizePx(page)).height;

    await page.getByTestId('n5-view-mode-original').click();
    await expect(page.getByTestId('n5-view-mode-original')).toHaveAttribute('aria-pressed', 'true');
    expect(await canvas.getAttribute('data-zoom')).toBe(zoomBefore);
    expect(await canvas.getAttribute('data-pan-x')).toBe(panXBefore);
    expect(await canvas.getAttribute('data-pan-y')).toBe(panYBefore);
    expect((await readCanvasSizePx(page)).height).toBe(heightBeforeToggle);

    await page.getByTestId('n5-view-mode-translated').click();
    await expect(page.getByTestId('n5-view-mode-translated')).toHaveAttribute('aria-pressed', 'true');
    expect(await canvas.getAttribute('data-zoom')).toBe(zoomBefore);
    expect(await canvas.getAttribute('data-pan-x')).toBe(panXBefore);
    expect(await canvas.getAttribute('data-pan-y')).toBe(panYBefore);
    expect((await readCanvasSizePx(page)).height).toBe(heightBeforeToggle);
  });
});
