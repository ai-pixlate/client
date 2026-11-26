import { type Page, expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// N5 일반 넘침 — 사용자에게 「글자가 넘칩니다 / 짧은 표현이 필요합니다」를 보이지 않는다(팀 QA 결정).
// 서버 넘침 데이터(/preview render.result.overflow · signals width_overflow)는 그대로 받고, 번역문 수정 → 재렌더 → 재조회 흐름도 그대로다.
// 다른 확인 신호(금지 표현 등)는 계속 보인다. (Mock 서버는 재렌더 완료 때 charLimit 으로 넘침을 정한다 — 서버 판정 흉내다.) Mock 이다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium 기준이다');

const BLOCK = 9102; // section 501 body, Mock charLimit 200

/** 서버 최신 결과의 넘침(block id → overflow). 최신이 아니면 null */
async function serverOverflow(page: Page, id: number): Promise<boolean | null> {
  return page.evaluate(async (blockId) => {
    const base = location.pathname.replace(/\/$/, '');
    const blocks = (await (await fetch(`${base}/blocks`)).json()) as { id: number; sectionId: number }[];
    const preview = (await (await fetch(`${base}/preview`)).json()) as {
      sections: { id: number; render?: { isCurrent?: boolean; result?: { overflow?: Record<string, boolean> | null } | null } | null }[];
    };
    const block = blocks.find((candidate) => candidate.id === blockId)!;
    const render = preview.sections.find((section) => section.id === block.sectionId)?.render;
    const map = render?.isCurrent ? render.result?.overflow ?? null : null;
    return map ? map[String(blockId)] === true : null;
  }, id);
}

// PRD v3.6.4 F-CFM-05 · Figma 1675:7501 — 서버 넘침은 셀 상태 「글자가 넘칩니다 — 수정이 필요합니다」로 보인다(이전 팀 QA 결정을 대체).
// 정본은 /preview render.result.overflow 이고, 표시는 마지막 서버 결과다(입력 중에는 바꾸지 않고 [확인] 저장 → 재렌더 뒤 갱신).
test('서버 overflow=true 면 셀 상태 「글자가 넘칩니다 — 수정이 필요합니다」, 수정 → 재렌더 뒤 서버 넘침 값으로 갱신되며 다른 신호는 보인다', async ({ page }) => {
  await reachN5(page);
  const panel = page.getByTestId('n5-panel');

  // 9104 — 서버 넘침(true) → 셀 상태. 「짧은 표현이 필요합니다」·「영역 초과」 칩은 없다
  expect(await serverOverflow(page, 9104)).toBe(true);
  await expect(page.getByTestId('n5-block-row-9104').getByTestId('n5-cell-failure-overflow')).toHaveText('글자가 넘칩니다 — 수정이 필요합니다');
  await expect(panel).not.toContainText('짧은 표현이 필요합니다');
  await expect(panel).not.toContainText('영역 초과');
  // 다른 확인 신호는 그대로 — 9112 금지 표현, 9110 필수 문구 누락
  await expect(page.getByTestId('n5-block-row-9112').getByText('금지 표현').first()).toBeVisible();
  await expect(page.getByTestId('n5-block-row-9110').getByText('필수 문구 누락').first()).toBeVisible();

  // 수정 → PATCH → 재렌더 완료 → 재조회: 서버 넘침 값은 바뀌어도 안내는 끝까지 없다
  const editor = page.getByTestId(`n5-block-editor-${BLOCK}`);
  await editor.scrollIntoViewIfNeeded();
  await editor.fill('Long '.repeat(50).trim()); // 249자 > charLimit 200
  await page.getByTestId(`n5-block-save-${BLOCK}`).click();
  await expect.poll(() => serverOverflow(page, BLOCK), { timeout: 20_000 }).toBe(true);
  await expect(page.getByTestId(`n5-block-row-${BLOCK}`).getByText('재렌더링 중…')).toHaveCount(0, { timeout: 20_000 });
  await expect(editor).toHaveValue('Long '.repeat(50).trim());
  await expect(page.getByTestId(`n5-block-row-${BLOCK}`).getByTestId('n5-cell-failure-overflow')).toHaveText('글자가 넘칩니다 — 수정이 필요합니다');
});
