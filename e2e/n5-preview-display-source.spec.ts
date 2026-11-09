import { type Page, expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// N5 「번역 후」 뷰어 표시 소스(lib/n5/preview-state.ts resolvePreviewSectionDisplay)와 의미 상태(resolvePreviewSectionSemantic).
// 일반 N5(QA 진단 없음)에서 섹션 502 를 ?mockScenario=n5-preview-<state> 로 덮어 확인한다.
// - local-typeset: renderInput 배경 + HTML / previous-rendered-image: 이전 결과(새 번역문 HTML 없음) / original-image: 결과 없음 → 원본
// - 의미 상태는 data 속성으로만 확인한다(최종 문구·아이콘·위치는 디자인 대기)
// N6 최종 렌더(/render)와 무관하다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', '조판 검증은 Chromium 기준이다');
test.use({ viewport: { width: 1920, height: 1080 } });
// 일반 N5 는 N1 부터 지나야 도달한다(Mock 상태는 새로고침에 남지 않는다) — 각 시나리오마다 reachN5 로 들어간다

const slice = (page: Page, id: number) => page.getByTestId(`n5-slice-translated-${id}`);
const textLayer = (page: Page, id: number) => page.getByTestId(`n5-text-layer-${id}`);
const status2 = 'n5-section-status-2';
const overflow9104 = (page: Page) => page.getByTestId('n5-block-row-9104').getByTestId('n5-cell-failure-overflow');

async function open(page: Page, scenario?: string) {
  await reachN5(page, scenario ? { mockScenario: `n5-preview-${scenario}` } : {});
  // 다른 섹션은 그대로 최신 조판
  await expect(slice(page, 501)).toHaveAttribute('data-preview-display', 'local-typeset', { timeout: 20_000 });
  await expect(page.getByTestId('n5-qa-badge')).toHaveCount(0);
}

const CASES: {
  name: string;
  title: string;
  scenario?: string;
  display: string;
  background: RegExp;
  input: string;
  render: string;
  failedRow: boolean;
}[] = [
  { name: 'A', title: 'current → 배경 + HTML', display: 'local-typeset', background: /502-background/, input: 'ready', render: 'current', failedRow: false },
  { name: 'B', title: '최초 생성 실패(결과 없음) → 원본, HTML 없음', scenario: 'failed', display: 'original-image', background: /502-original/, input: 'ready', render: 'failed', failedRow: true },
  { name: 'C', title: '재렌더 진행 + 이전 결과 → 이전 renderedUrl, 새 HTML 없음', scenario: 'updating', display: 'previous-rendered-image', background: /502-translated/, input: 'ready', render: 'updating', failedRow: false },
  { name: 'D', title: '재렌더 실패 + 이전 결과 → 이전 renderedUrl, 새 HTML 없음, retry', scenario: 'update-failed', display: 'previous-rendered-image', background: /502-translated/, input: 'ready', render: 'update-failed', failedRow: true },
  { name: 'E', title: 'pending · 이전 결과 없음 → 원본', scenario: 'pending', display: 'original-image', background: /502-original/, input: 'ready', render: 'waiting', failedRow: false },
  { name: 'F', title: '입력 오류 → 렌더 실패와 별도', scenario: 'input-error', display: 'original-image', background: /502-original/, input: 'input-error', render: 'missing', failedRow: false },
  { name: 'G1', title: '결과 없음 + attempt null → missing', scenario: 'missing', display: 'original-image', background: /502-original/, input: 'ready', render: 'missing', failedRow: false },
  { name: 'G2', title: '결과 없음 + attempt done → missing', scenario: 'missing-done', display: 'original-image', background: /502-original/, input: 'ready', render: 'missing', failedRow: false },
  { name: 'H', title: '입력 준비 중 + 시도 실패 → 두 상태 유지', scenario: 'preparing-failed', display: 'original-image', background: /502-original/, input: 'preparing', render: 'failed', failedRow: true },
  { name: 'I', title: 'stale → 이전 결과, 넘침 없음', scenario: 'stale', display: 'previous-rendered-image', background: /502-translated/, input: 'ready', render: 'stale', failedRow: false },
];

for (const c of CASES) {
  test(`${c.name} ${c.title}`, async ({ page }) => {
    await open(page, c.scenario);
    const s = slice(page, 502);
    await expect(s).toHaveAttribute('data-preview-display', c.display);
    await expect(s).toHaveCSS('background-image', c.background);
    await expect(s).toHaveAttribute('data-preview-input-state', c.input);
    await expect(s).toHaveAttribute('data-preview-render-state', c.render);
    if (c.display === 'local-typeset') {
      await expect(textLayer(page, 502)).toBeVisible();
      await expect(s).not.toHaveCSS('background-image', /translated/);
    } else {
      // 서버 이미지·원본 위에 번역문 HTML 을 얹지 않는다
      await expect(textLayer(page, 502)).toHaveCount(0);
    }
    // 실패는 기존 「실행 실패」 행 하나 + 기존 다시 시도 버튼(입력 오류·결과 없음은 실패가 아니다)
    await expect(page.getByTestId(`${status2}-failed`)).toHaveCount(c.failedRow ? 1 : 0);
    await expect(page.getByTestId(`${status2}-render-retry`)).toHaveCount(c.failedRow ? 1 : 0);
    // 넘침은 최신 결과에서만(J) — 그 밖에는 내지 않는다(I 포함)
    if (c.render === 'current') await expect(overflow9104(page)).toBeVisible();
    else await expect(overflow9104(page)).toHaveCount(0);
  });
}
