import { test, expect, type Page } from '@playwright/test';

import { MOCK_BRAND_ID, MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N4 — "번역 중" 5단계 stage mapping 회귀 검증 (Figma 660:4221).
//
// N4의 backend coarse stage(inpaint→translate→verify→render, 4개)가 화면
// 고정 5단계에 어떻게 매핑되는지 실제로 polling을 관찰해 확인한다 —
// 특히 render 하나가 04(글자 수·줄바꿈 조정)/05(이미지 합성) 두 항목을
// "동시에" active로 표시하던 예전 버그(둘 다 active)가 재발하지 않는지가
// 핵심이다. mock(lib/msw/handlers.ts advanceN4Processing)이 4단계를
// 순서대로 최소 한 번씩 running→done으로 보내도록 고쳐져 있어야 이
// 테스트가 의미 있다.
// ─────────────────────────────────────────────────────────────────

async function selectFirstValidOption(page: Page, index: number) {
  const select = page.getByRole('combobox').nth(index);
  const firstRealOption = select.locator('option').nth(1);
  const value = await firstRealOption.getAttribute('value');
  if (!value) throw new Error(`combobox[${index}]에 선택 가능한 option이 없습니다`);
  await select.selectOption(value);
}

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

/** N1 진입부터 N4("번역 중") 화면 도달까지 이동한다. */
async function reachN4(page: Page): Promise<void> {
  await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
  await page.getByPlaceholder('상품 이름을 입력해주세요').fill('N4 stage mapping 검증');
  await selectFirstValidOption(page, 0);
  await selectFirstValidOption(page, 1);
  await page.getByRole('button', { name: '선택하기' }).click();
  await page.getByRole('dialog', { name: '카테고리 선택' }).getByRole('button', { name: '바디/헤어' }).click();
  await selectFirstValidOption(page, 2);
  await page.getByLabel('파일 선택').setInputFiles({
    name: 'n4-processing.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
  });
  await page.getByRole('button', { name: '다음' }).click();
  await page.waitForURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));
  await page.getByRole('button', { name: '번역 시작' }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByRole('button', { name: '번역 시작' }).click();
}

type StepStatusLabel = '완료' | '진행 중' | '대기';

interface StepSnapshot {
  no: string;
  label: string;
  status: StepStatusLabel;
}

/** 화면에 그려진 5단계(01~05) 행을 읽는다 — "01  라벨" + 캡션(완료/진행 중/대기) 구조. */
async function readSteps(page: Page): Promise<StepSnapshot[]> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('p')).filter((p) => /^\d\d\s/.test(p.textContent ?? ''));
    return rows.map((p) => {
      const text = p.textContent ?? '';
      const [no, ...rest] = text.trim().split(/\s+/);
      const caption = (p.nextElementSibling?.textContent ?? '').trim();
      return { no, label: rest.join(' '), status: caption as StepStatusLabel };
    });
  });
}

const RANK: Record<StepStatusLabel, number> = { 대기: 0, '진행 중': 1, 완료: 2 };

test('N4 — 5단계 stage mapping이 역행 없이 순서대로 진행되고, render는 04/05 중 하나만 active다', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await reachN4(page);

  // 1. "번역 중" 진입 확인.
  await expect(page.getByRole('heading', { name: '번역 중' })).toBeVisible({ timeout: 5_000 });

  const lastRank = new Map<string, number>();
  let saw04ActiveWith05Pending = false;
  let saw05Active = false;
  let saw04ActiveAt: number | null = null;
  let saw05ActiveAt: number | null = null;

  // mock은 2초 polling으로 9번(inpaint×2, translate×2, verify×2, render×3)
  // 만에 N5로 전환한다 — 여유 있게 15회까지 관찰한다.
  for (let tick = 0; tick < 15; tick += 1) {
    const stillOnN4 = await page
      .getByRole('heading', { name: '번역 중' })
      .isVisible()
      .catch(() => false);
    if (!stillOnN4) break;

    const steps = await readSteps(page);

    // 2. 5단계 모두 렌더된다.
    expect(steps, `tick ${tick}: 5단계가 전부 렌더돼야 한다`).toHaveLength(5);

    // 3. 각 단계 상태가 역행하지 않는다(대기→진행 중→완료 순서만 허용).
    for (const step of steps) {
      const rank = RANK[step.status];
      const prev = lastRank.get(step.no) ?? 0;
      expect(rank, `tick ${tick}: ${step.no} ${step.label}이(가) ${step.status}(rank ${rank})로 역행했다(이전 rank ${prev})`).toBeGreaterThanOrEqual(
        prev,
      );
      lastRank.set(step.no, rank);
    }

    // 4. 한 시점에 active(진행 중)는 정확히 1개만 존재한다 — render가
    // 04/05를 동시에 active로 만들던 예전 버그의 직접적인 회귀 검증.
    const activeSteps = steps.filter((s) => s.status === '진행 중');
    expect(activeSteps.length, `tick ${tick}: active step 개수는 항상 1개여야 한다(${JSON.stringify(steps)})`).toBe(
      1,
    );

    const step04 = steps.find((s) => s.no === '04');
    const step05 = steps.find((s) => s.no === '05');

    // 5. "04 진행 중 / 05 대기" 상태(Figma 660:4221 예시 그대로)가 실제로 한 번 존재.
    if (step04?.status === '진행 중' && step05?.status === '대기') {
      saw04ActiveWith05Pending = true;
      saw04ActiveAt ??= tick;
    }
    // 6. 이후 "05 진행 중"(04는 완료) 상태도 존재.
    if (step05?.status === '진행 중' && step04?.status === '완료') {
      saw05Active = true;
      saw05ActiveAt ??= tick;
    }
    // 04/05가 동시에 진행 중인 건 절대 없어야 한다(이번에 고친 버그).
    expect(
      step04?.status === '진행 중' && step05?.status === '진행 중',
      `tick ${tick}: 04와 05가 동시에 진행 중이면 안 된다`,
    ).toBe(false);

    await page.waitForTimeout(1900);
  }

  expect(saw04ActiveWith05Pending, '"04 진행 중 / 05 대기"(Figma 예시) 상태를 한 번도 관찰하지 못했다').toBe(true);
  expect(saw05Active, '"05 진행 중"(04 완료) 상태를 한 번도 관찰하지 못했다').toBe(true);
  if (saw04ActiveAt !== null && saw05ActiveAt !== null) {
    expect(saw05ActiveAt, '05 active는 04 active보다 나중이어야 한다').toBeGreaterThan(saw04ActiveAt);
  }

  // 7. 마지막에 N5로 이동한다.
  await expect(page.locator('[data-testid="n5-panel"]')).toBeVisible({ timeout: 10_000 });
});
