import { test, expect, type Page } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';
import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N5 — 검수 확정(POST /jobs/{jobId}/confirm, API-CFM-04, N5→N6) e2e.
//
// mock 데이터는 lib/mock-api/n5-fixtures.ts 기준(6단계에서도 그대로 재사용):
// section 501/502/504/505는 bucket=include, 503만 exclude — 그래서 기본
// 상태에서 confirm은 항상 성공 조건(전 섹션 제외 아님)을 만족한다.
// block 9101~9112가 가진 signal 전부(width_overflow, prohibited_expression,
// logo_match_failed, translation_failed, empty_block,
// mandatory_term_unapplied)가 서버의 "현재 미해결 경고 집합"이다.
//
// 전체 section 제외(ALL_SECTIONS_EXCLUDED)는 이 mock job에서 실제 데이터로
// 재현할 수 없다 — F-CFM-14 제외/되돌리기가 의도적으로 로컬 전용이라(서버
// 왕복 없음, 6단계에서도 안 건드림) 서버가 아는 section bucket을 브라우저에서
// 바꿀 방법이 없다. 그래서 이 경로는 page.addInitScript로 window.fetch 자체를
// 감싸 confirm 응답만 가로채 재현한다 — FE의 error.code 분기 로직을 검증하는
// 것이 목적이다. page.route()/context.route()는 MSW가 Service Worker의
// fetch 이벤트 안에서 네트워크 왕복 없이 직접 Response를 만들어버려 CDP
// 네트워크 인터셉션 이전에 처리가 끝나므로 이 프로젝트에서는 동작하지
// 않는다(실측: 두 방식 모두 실제로는 MSW 응답이 그대로 나가 confirm이
// 성공해버렸다) — window.fetch를 페이지 스크립트 로드 전에 교체하면 SW로
// 넘어가기 전에 가로챌 수 있다. "서버가 실제로 그 규칙을 검사하는지"는
// lib/n5/adapter.ts의 areAllSectionsExcluded 단위 테스트
// (scripts/verify-n5-adapter.mjs)와 lib/msw/handlers.ts의 confirm handler
// 구현으로 별도 확인했다.
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

test.describe('정상 confirm', () => {
  test('저장하러 가기 클릭 → PATCH acknowledgedWarnings 정합 → N6로 이동한다', async ({ page }) => {
    const confirmRequests: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().endsWith('/confirm')) {
        confirmRequests.push(req.postData() ?? '');
      }
    });

    const button = page.getByTestId('n5-confirm-button');
    await expect(button).toBeEnabled();

    await button.click();

    // 클릭 직후 버튼이 disabled로 전환된다(중복 confirm 방지) — 이후 상태는
    // 성공하면 N6로 화면 자체가 바뀌어 이 버튼이 더 이상 존재하지 않는다.
    await expect(page.getByText('번역이 완료되었습니다.')).toBeVisible({ timeout: 10_000 });

    expect(confirmRequests).toHaveLength(1);
    const body = JSON.parse(confirmRequests[0]);
    expect(Array.isArray(body.acknowledgedWarnings)).toBe(true);
    // mock 블록들이 가진 signal 6종이 전부 담겨 있어야 한다(개수가 아니라
    // 식별자 목록 — ConfirmRequest.description).
    const codes = new Set(body.acknowledgedWarnings.map((w: { code: string }) => w.code));
    expect(codes).toEqual(
      new Set([
        'width_overflow',
        'prohibited_expression',
        'logo_match_failed',
        'translation_failed',
        'empty_block',
        'mandatory_term_unapplied',
      ]),
    );
    expect(body.acknowledgedWarnings.every((w: { blockId: unknown }) => typeof w.blockId === 'number')).toBe(
      true,
    );
  });
});

test.describe('unresolved warning — acknowledgedWarnings 불일치', () => {
  test('서버의 현재 경고 집합과 다르면 409 INVALID_STATE, N5에 그대로 머무른다', async ({ page }) => {
    await page.getByTestId('n5-zoom-in').click();
    const zoomBefore = await readTransform(page);
    await page.getByTestId('n5-block-row-9101').click();

    // 실제 앱 코드를 우회해 "낡은"(경고 일부가 빠진) acknowledgedWarnings로
    // 직접 confirm을 호출한다 — 서버가 진짜로 집합 불일치를 검사하는지 확인.
    const result = await page.evaluate(async (jobId) => {
      const res = await fetch(`/jobs/${jobId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledgedWarnings: [{ blockId: 9111, code: 'logo_match_failed' }] }),
      });
      return { status: res.status, json: await res.json() };
    }, MOCK_JOB_ID);

    expect(result.status).toBe(409);
    expect(result.json.error.code).toBe('INVALID_STATE');
    expect(Array.isArray(result.json.error.details?.warnings)).toBe(true);
    expect(result.json.error.details.warnings.length).toBeGreaterThan(1);

    // N5 화면 그대로 유지 + 기존 선택/zoom 유지(이 요청은 UI를 거치지 않았지만,
    // "confirm 실패가 N5 상태를 건드리지 않는다"는 같은 사실을 확인한다).
    await expect(page.getByTestId('n5-panel')).toBeVisible();
    await expect(page.getByTestId('n5-block-row-9101')).toHaveAttribute('aria-pressed', 'true');
    expect(await readTransform(page)).toEqual(zoomBefore);
  });

  test('저장 버튼 클릭으로 만든 정상 요청은 항상 현재 경고 집합과 일치해 성공한다', async ({ page }) => {
    // 위 테스트가 "불일치하면 거절됨"을 확인했으니, 그 대칭으로 "실제 UI
    // 흐름이 만드는 요청은 일치해서 통과한다"를 별도로 재확인한다(정상
    // confirm 테스트와 같은 취지, INVALID_STATE 쪽 설명에 붙여 둔다).
    await page.getByTestId('n5-confirm-button').click();
    await expect(page.getByText('번역이 완료되었습니다.')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('전체 section 제외 — ALL_SECTIONS_EXCLUDED', () => {
  test('서버가 409 ALL_SECTIONS_EXCLUDED로 거절하면 메시지를 보여주고 N5에 머무른다', async ({ page }) => {
    await page.getByTestId('n5-zoom-in').click();
    const zoomBefore = await readTransform(page);
    await page.getByTestId('n5-block-row-9103').click();
    const viewModeBefore = await page.getByTestId('n5-view-mode-original').getAttribute('aria-pressed');

    // 이미 떠 있는 페이지의 window.fetch를 직접 교체한다 — MSW의 Service
    // Worker에 요청이 도달하기 전에 가로채는 것이므로 page.route()와 달리
    // 실제로 동작한다(위 파일 상단 설명 참고). addInitScript+reload는 mock
    // 상태를 쥐고 있는 Service Worker가 유휴 상태에서 재기동되며 mockJobState
    // 등 모듈 state를 초기화시켜(N3로 되돌아감) 여기선 쓸 수 없다 — reload
    // 없이 현재 페이지의 전역 fetch만 바꾼다.
    await page.evaluate(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (url.endsWith('/confirm')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                error: {
                  code: 'ALL_SECTIONS_EXCLUDED',
                  message: '모든 섹션이 제외되어 확정할 수 없습니다.',
                  retryable: false,
                  details: null,
                  traceId: 'test-trace-1',
                },
              }),
              { status: 409, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        return originalFetch(input, init);
      };
    });

    await page.getByTestId('n5-confirm-button').click();

    await expect(page.getByTestId('n5-confirm-error')).toHaveText('모든 섹션이 제외되어 확정할 수 없습니다.');
    // N6로 넘어가지 않는다 — 실패 전에 낙관적으로 이동하지 않는다.
    await expect(page.getByTestId('n5-panel')).toBeVisible();
    await expect(page.getByText('번역이 완료되었습니다.')).toHaveCount(0);

    // selection/zoom/pan/viewMode 모두 유지
    await expect(page.getByTestId('n5-block-row-9103')).toHaveAttribute('aria-pressed', 'true');
    expect(await readTransform(page)).toEqual(zoomBefore);
    await expect(page.getByTestId('n5-view-mode-original')).toHaveAttribute('aria-pressed', viewModeBefore!);

    // 버튼은 다시 클릭 가능한 상태로 돌아온다(재시도 가능)
    await expect(page.getByTestId('n5-confirm-button')).toBeEnabled();
  });
});

test.describe('중복 confirm 방지', () => {
  test('클릭 직후 버튼이 disabled로 전환돼 두 번째 클릭이 발생하지 않는다', async ({ page }) => {
    const confirmRequests: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().endsWith('/confirm')) confirmRequests.push('x');
    });

    const button = page.getByTestId('n5-confirm-button');
    await button.click();

    // 네이티브 disabled 버튼은 추가 클릭 이벤트를 아예 받지 않는다(4단계
    // PATCH 저장 버튼과 같은 이중 보호: 코드 가드 + disabled 속성).
    const disabledRightAfterClick = await button.isDisabled().catch(() => true);
    // 이미 N6로 전환됐을 수도 있다(성공이 매우 빠른 경우) — 그 경우 버튼
    // 자체가 사라진다. 어느 쪽이든 PATCH 요청이 1개만 나갔는지가 핵심이다.
    void disabledRightAfterClick;

    await expect(page.getByText('번역이 완료되었습니다.')).toBeVisible({ timeout: 10_000 });
    expect(confirmRequests).toHaveLength(1);
  });
});
