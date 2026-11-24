import { type Page, expect, test } from '@playwright/test';

import type { InternalRenderResult } from '@/app/internal/typeset-render/_components/render-host';
import type { ApiPreviewRenderBlock } from '@/lib/api/n5-schema';
import type { TypesetMeasureInput, TypesetMeasureSuccess } from '@/lib/n5/typeset-measurement';
import type { TypesetServerStyle } from '@/lib/n5/typeset-rules';

// ─────────────────────────────────────────────────────────────────
// N6 공통 조판용 내부 렌더 경로(/internal/typeset-render) 검증 — Chromium.
//
// 1) 접근: 서버가 PIXLATE_INTERNAL_RENDER_TOKEN 을 갖고 떠 있어야 한다(없으면 이 spec 전체를 건너뛴다).
//    env 자체가 없는 서버의 404 는 scripts/verify-internal-render-route.mjs 가 production 빌드로 확인한다.
// 2) 조판 동일성: 같은 text·box·style·font 를 N5 측정 경로(dev harness /spike/typeset-measure 의 openTypesetMeasurer —
//    e2e/n5-typeset-measurement.spec.ts 와 같은 경로)와 내부 renderer 에 넣어 줄 수·줄 글자·fontPx·overflow·글 높이를 비교한다.
//    특정 줄 수를 고정하지 않는다 — 두 경로가 같은 결과인지가 기준이다. Pillow 동작을 재현하려는 테스트가 아니다.
// 3) 촬영 대상 DOM([data-render-section])의 실제 줄바꿈이 측정 결과와 같은지 이 spec 의 별도 Range 측정으로 확인한다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', '내부 렌더러는 BE headless Chromium 기준이다');

const TOKEN = process.env.PIXLATE_INTERNAL_RENDER_TOKEN ?? '';
const EXPECTED_REVISION = process.env.NEXT_PUBLIC_PIXLATE_FE_REVISION ?? '';
const ROUTE = '/internal/typeset-render';
const TOKEN_HEADER = 'x-pixlate-internal-render';

test.skip(!TOKEN, 'PIXLATE_INTERNAL_RENDER_TOKEN 을 넣고 띄운 서버에서만 실행한다');
test.use({ viewport: { width: 1280, height: 900 } });

// 1×1 흰색 PNG — 배경 decode 경로를 실제로 탄다
const WHITE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';

const BODY_STYLE: TypesetServerStyle = {
  fontFamily: 'Pretendard',
  fontWeight: 400,
  fontSizePx: 16,
  fontScale: 1,
  fontColor: '#222222',
  align: 'left',
  letterSpacingEm: -0.03,
  lineHeightRatio: 1.2,
};
const TITLE_STYLE: TypesetServerStyle = { ...BODY_STYLE, fontWeight: 600, fontSizePx: 30, fontScale: 1.1, align: 'center', letterSpacingEm: -0.015 };

const EN = 'Premium cotton blend fabric keeps you comfortable all day while the reinforced stitching holds its shape wash after wash.';
const KO_NO_SPACE = '공백없이길게이어지는한국어상품설명문장은브라우저가정한위치에서줄을바꿔야합니다';
const JA_KANA = 'ブラウザがつくったかいぎょうをそのままつかいますのでおなじけっかになります';

type Case = { name: string; text: string; width: number; height: number; style: TypesetServerStyle };

const CASES: Case[] = [
  ...[200, 320, 480].map((width) => ({ name: `영어 body ${width}px`, text: EN, width, height: 120, style: BODY_STYLE })),
  ...[200, 320, 480].map((width) => ({ name: `영어 title 600 ${width}px`, text: EN, width, height: 160, style: TITLE_STYLE })),
  { name: '한국어 공백 없음 200px', text: KO_NO_SPACE, width: 200, height: 120, style: BODY_STYLE },
  { name: '한국어 공백 없음 320px', text: KO_NO_SPACE, width: 320, height: 120, style: { ...BODY_STYLE, align: 'right' } },
  { name: '일본어 가나 공백 없음 240px', text: JA_KANA, width: 240, height: 120, style: BODY_STYLE },
  { name: '명시적 개행', text: 'first line\nsecond line', width: 480, height: 60, style: BODY_STYLE },
];

const SECTION = { sectionId: 9001, width: 600, height: 400 };
const BOX = (c: Case) => ({ x: 24, y: 32, w: c.width, h: c.height });

function renderBlock(c: Case, blockId = 1): ApiPreviewRenderBlock {
  return { blockId, revision: 3, text: c.text, box: BOX(c), style: c.style } as ApiPreviewRenderBlock;
}

async function openRenderer(page: Page) {
  await page.setExtraHTTPHeaders({ [TOKEN_HEADER]: TOKEN });
  const response = await page.goto(ROUTE);
  expect(response?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('data-internal-render', 'ready');
}

async function render(page: Page, input: unknown): Promise<InternalRenderResult> {
  return page.evaluate((i) => window.__pixlateRender!.render(i), input);
}

/** 촬영 대상 DOM 의 줄 수·줄 글자 — 측정기와 별개로 이 spec 에서 Range 로 센다 */
async function domLines(page: Page, blockId: number): Promise<string[]> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-render-section] [data-typeset-render="${id}"]`)!;
    const node = el.firstChild as Text;
    const range = document.createRange();
    const lines: { bottom: number; text: string }[] = [];
    for (const { index, segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(node.data)) {
      range.setStart(node, index);
      range.setEnd(node, index + segment.length);
      const r = Array.from(range.getClientRects()).find((rect) => rect.width > 0);
      if (!r) continue;
      const last = lines[lines.length - 1];
      if (last && (r.top + r.bottom) / 2 < last.bottom) last.text += segment;
      else lines.push({ bottom: r.bottom, text: segment });
    }
    return lines.map((l) => l.text);
  }, blockId);
}

test.describe('접근', () => {
  test('정상 토큰 → 200, 없음·틀림·ALB 경유 → 404', async ({ request }) => {
    expect((await request.get(ROUTE, { headers: { [TOKEN_HEADER]: TOKEN } })).status()).toBe(200);
    expect((await request.get(ROUTE)).status()).toBe(404);
    expect((await request.get(ROUTE, { headers: { [TOKEN_HEADER]: `${TOKEN}x` } })).status()).toBe(404);
    expect((await request.get(ROUTE, { headers: { [TOKEN_HEADER]: TOKEN, 'X-Amzn-Trace-Id': 'Root=1-test' } })).status()).toBe(404);
  });

  test('페이지 준비 표시와 FE revision 을 html 에 노출하고 토큰은 문서에 없다', async ({ page }) => {
    await openRenderer(page);
    const html = page.locator('html');
    if (EXPECTED_REVISION) await expect(html).toHaveAttribute('data-fe-revision', EXPECTED_REVISION);
    else await expect(html).not.toHaveAttribute('data-fe-revision', /.+/);
    expect(await page.content()).not.toContain(TOKEN);
    await expect(page.locator('[data-render-section]')).toHaveCount(0);
  });
});

test.describe('render 계약', () => {
  test('성공 시 [data-render-section] 을 그리고 measure·textHeightPx 를 돌려준다', async ({ page }) => {
    await openRenderer(page);
    const c = CASES[1];
    const result = await render(page, { ...SECTION, backgroundUrl: WHITE_PNG, blocks: [renderBlock(c, 11), renderBlock({ ...c, text: 'second' }, 12)] });
    if (!result.ok) throw new Error(`${result.reason}: ${result.detail}`);
    expect(result.fonts).toEqual([{ ok: true, family: 'Pretendard', weights: [400] }]);
    expect(result.blocks.map((b) => b.blockId)).toEqual([11, 12]);
    const first = result.blocks[0];
    expect(first.measure.fontPx).toBe(16);
    expect(first.measure.lines.length).toBeGreaterThan(1);
    expect(first.measure.overflow.any).toBe(false);
    expect(first.measure.blockRect).toEqual({ left: 24, top: 32, right: 24 + c.width, bottom: 32 + c.height });
    expect(first.textHeightPx).toBeCloseTo(first.measure.lines.length * 16 * 1.2, 1);
    const section = page.locator('[data-render-section]');
    await expect(section).toHaveAttribute('data-render-section', String(SECTION.sectionId));
    await expect(section).toHaveAttribute('data-render-state', 'ready');
    expect(await section.boundingBox()).toMatchObject({ width: SECTION.width, height: SECTION.height });
    await expect(section.locator('img')).toHaveJSProperty('complete', true);
  });

  test('실패 이유를 계약대로 돌려주고 이전 섹션을 남기지 않는다', async ({ page }) => {
    await openRenderer(page);
    const c = CASES[0];
    const ok = await render(page, { ...SECTION, backgroundUrl: WHITE_PNG, blocks: [renderBlock(c)] });
    expect(ok.ok).toBe(true);

    expect(await render(page, { ...SECTION, width: 0, backgroundUrl: WHITE_PNG, blocks: [] })).toMatchObject({ ok: false, reason: 'invalid-input' });
    await expect(page.locator('[data-render-section]')).toHaveCount(0);
    expect(await render(page, { ...SECTION, backgroundUrl: WHITE_PNG, blocks: [{ ...renderBlock(c), box: { x: 0, y: 0, w: 10 } }] })).toMatchObject({
      ok: false,
      reason: 'invalid-input',
    });
    expect(
      await render(page, { ...SECTION, backgroundUrl: WHITE_PNG, blocks: [{ ...renderBlock(c), style: { ...BODY_STYLE, fontColor: '#abc' } }] }),
    ).toMatchObject({ ok: false, reason: 'style-invalid' });
    expect(
      await render(page, { ...SECTION, backgroundUrl: WHITE_PNG, blocks: [{ ...renderBlock(c), style: { ...BODY_STYLE, fontFamily: 'PixlateNoSuchFont' } }] }),
    ).toMatchObject({ ok: false, reason: 'font-not-ready' });
    expect(await render(page, { ...SECTION, backgroundUrl: '/__no_such_background__.png', blocks: [renderBlock(c)] })).toMatchObject({
      ok: false,
      reason: 'background-failed',
    });
    await expect(page.locator('[data-render-section]')).toHaveCount(0);
    // Pretendard 에 없는 한자는 대체 폰트로 측정하지 않는다
    expect(await render(page, { ...SECTION, backgroundUrl: WHITE_PNG, blocks: [renderBlock({ ...c, text: '実際の改行' })] })).toMatchObject({
      ok: false,
      reason: 'measurer-failed',
    });
    await expect(page.locator('[data-render-section]')).toHaveCount(0);
  });

  test('동시에 들어온 요청은 busy 로 돌려주고 먼저 온 섹션만 그린다', async ({ page }) => {
    await openRenderer(page);
    const results = await page.evaluate(
      ([a, b]) => Promise.all([window.__pixlateRender!.render(a), window.__pixlateRender!.render(b)]),
      [
        { ...SECTION, sectionId: 1, backgroundUrl: WHITE_PNG, blocks: [renderBlock(CASES[0])] },
        { ...SECTION, sectionId: 2, backgroundUrl: WHITE_PNG, blocks: [renderBlock(CASES[2])] },
      ],
    );
    expect(results[0].ok).toBe(true);
    expect(results[1]).toMatchObject({ ok: false, reason: 'busy' });
    await expect(page.locator('[data-render-section]')).toHaveAttribute('data-render-section', '1');
  });
});

test('N5 측정 경로와 내부 renderer 의 조판 결과가 같다(영어 경계 폭·CJK 공백 없음)', async ({ page, context }) => {
  // N5 측정 경로 — dev harness 의 openTypesetMeasurer(e2e/n5-typeset-measurement.spec.ts 와 같은 경로)
  const n5 = await context.newPage();
  await n5.goto('/spike/typeset-measure');
  await expect(n5.getByTestId('typeset-harness-status')).toHaveAttribute('data-ready', 'true');
  expect(await n5.evaluate(() => window.__pixlateTypeset!.open())).toEqual({ ok: true });

  await openRenderer(page);

  for (const c of CASES) {
    const box = BOX(c);
    const n5Input: TypesetMeasureInput = {
      text: c.text,
      role: 'body',
      sourceImageWidth: SECTION.width,
      userFontScale: c.style.fontScale,
      bbox: { x: box.x, y: box.y, width: box.w, height: box.h },
      textAlign: c.style.align,
      serverStyle: c.style,
    };
    const n5Result = await n5.evaluate((i) => {
      const result = window.__pixlateTypeset!.measure(i);
      // N5 Auto Height 와 같은 정의 — 같은 블록 요소를 height:auto 로 둔 높이
      const el = document.querySelector<HTMLElement>('[data-typeset-block]')!;
      el.style.height = 'auto';
      return { result, textHeightPx: el.getBoundingClientRect().height };
    }, n5Input);
    if (!n5Result.result.ok) throw new Error(`[${c.name}] N5 측정 실패: ${n5Result.result.reason} ${n5Result.result.detail}`);
    const n5Measure: TypesetMeasureSuccess = n5Result.result;

    const internal = await render(page, { ...SECTION, backgroundUrl: WHITE_PNG, blocks: [renderBlock(c)] });
    if (!internal.ok) throw new Error(`[${c.name}] 내부 renderer 실패: ${internal.reason} ${internal.detail}`);
    const [block] = internal.blocks;

    const summary = (m: TypesetMeasureSuccess) => ({
      fontPx: m.fontPx,
      lineCount: m.lines.length,
      lines: m.lines.map((l) => l.text),
      overflow: m.overflow,
      blockRect: m.blockRect,
      ink: m.ink,
    });
    console.log(`[${c.name}] N5 ${n5Measure.lines.length}줄 / 내부 ${block.measure.lines.length}줄 fontPx=${block.measure.fontPx} h=${block.textHeightPx}`);
    expect(summary(block.measure), c.name).toEqual(summary(n5Measure));
    expect(block.textHeightPx, c.name).toBe(n5Result.textHeightPx);
    // 촬영 대상 DOM 도 같은 줄바꿈인지
    expect(await domLines(page, 1), c.name).toEqual(n5Measure.lines.map((l) => l.text));
  }
});
