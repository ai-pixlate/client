import { type Page, expect, test } from '@playwright/test';

import type { TypesetMeasureInput, TypesetMeasureSuccess } from '@/lib/n5/typeset-measurement';
import type { TypesetRole } from '@/lib/n5/typeset-rules';

// ─────────────────────────────────────────────────────────────────
// N5 조판 브라우저 측정 엔진(lib/n5/typeset-measurement.ts) 검증 — Chromium.
//
// harness(app/spike/typeset-measure, dev 전용)에서 엔진을 실행하고, 두 독립 경로로 대조한다.
//   1) 픽셀: 엔진 ink(Canvas TextMetrics + DOM baseline)를 실제 스크린샷의 글자 픽셀 경계와 비교
//   2) clean 문서: 같은 블록 HTML 을 앱 전역 CSS 없는 setContent 문서에 넣고, 이 spec 의 별도 Range 측정으로
//      줄 수·줄 rect 를 비교(서버 Playwright 렌더와 같은 조건)
// 픽셀 비교의 0.5px(디바이스 픽셀 1개) 허용치는 스크린샷 양자화·안티앨리어싱 때문의 검증 오차이며, 제품 overflow 판정(허용 오차 없음)과 무관하다.
// N5 제품 화면·API 는 건드리지 않는다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', '조판 측정 검증은 Chromium 기준이다');
test.use({ deviceScaleFactor: 2, viewport: { width: 1280, height: 900 } });

const PRETENDARD_CSS = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css';

type Fixture = { name: string; input: TypesetMeasureInput };

function body(text: string, bbox: TypesetMeasureInput['bbox'], extra: Partial<TypesetMeasureInput> = {}): TypesetMeasureInput {
  return { text, role: 'body' as TypesetRole, sourceImageWidth: 375, bbox, ...extra };
}

const WIDE = { x: 20, y: 20, width: 400, height: 60 };
const NARROW = { x: 20, y: 20, width: 120, height: 200 };

const FIXTURES: Fixture[] = [
  { name: '한국어', input: body('브라우저가 실제로 만든 줄바꿈을 그대로 사용합니다', NARROW) },
  { name: '영어', input: body('The browser decides where each line breaks', NARROW) },
  // Pretendard(static) 는 가나를 포함하고 한자는 포함하지 않는다 — 한자 문장은 아래 glyph-fallback 실패 경로에서 본다
  { name: '일본어', input: body('ブラウザがつくったかいぎょうをそのままつかいます', NARROW) },
  { name: '명시적 개행', input: body('hello\nworld', WIDE) },
  { name: '일반 연속 공백', input: body('hello     world', WIDE) },
  { name: 'NBSP 대조(일반 공백)', input: body('hello world', { x: 20, y: 20, width: 60, height: 60 }) },
  { name: 'NBSP', input: body('hello world', { x: 20, y: 20, width: 60, height: 60 }) },
  { name: '하이픈', input: body('cross-border', { x: 20, y: 20, width: 60, height: 60 }) },
  { name: '긴 영단어', input: body('averyveryveryverylongword', { x: 20, y: 20, width: 60, height: 60 }) },
  { name: '끝 개행', input: body('hello\n', WIDE) },
  { name: '한 줄', input: body('Pixlate', WIDE) },
  { name: 'title 600', input: { text: '조판 제목 Title', role: 'title', sourceImageWidth: 375, bbox: { x: 20, y: 20, width: 400, height: 60 } } },
];

async function openHarness(page: Page) {
  await page.goto('/spike/typeset-measure');
  await expect(page.getByTestId('typeset-harness-status')).toHaveAttribute('data-ready', 'true');
  const opened = await page.evaluate(() => window.__pixlateTypeset!.open());
  expect(opened).toEqual({ ok: true });
}

async function measure(page: Page, input: TypesetMeasureInput): Promise<TypesetMeasureSuccess> {
  const result = await page.evaluate((i) => window.__pixlateTypeset!.measure(i), input);
  if (!result.ok) throw new Error(`측정 실패: ${result.reason} ${result.detail}`);
  return result;
}

const strip = (s: string) => s.replace(/[\s ]+/g, '');

test('Pretendard 400/600 이 실제 FontFace 로 로드됐는지 확인하고, 없으면 측정기를 열지 않는다', async ({ page }) => {
  await openHarness(page);
  const ready = await page.evaluate(() => window.__pixlateTypeset!.fontReadiness());
  expect(ready).toEqual({ ok: true, family: 'Pretendard', weights: [400, 600] });

  // fonts.check() 는 문서에 없는 family 에도 true 를 돌려준다 — 그래서 check 만으로 성공 처리하지 않는다
  const family = 'PixlateNoSuchTypesetFont';
  const checkOnly = await page.evaluate((f) => document.fonts.check(`400 16px "${f}"`), family);
  const failed = await page.evaluate((f) => window.__pixlateTypeset!.open(f), family);
  console.log(`[font] fonts.check(없는 family)=${checkOnly} → open 결과 ${JSON.stringify(failed)}`);
  expect(failed).toEqual({
    ok: false,
    reason: 'font-not-ready',
    fonts: {
      ok: false,
      family,
      missing: [
        { weight: 400, problem: 'no-font-face' },
        { weight: 600, problem: 'no-font-face' },
      ],
    },
  });
  // 실패 뒤에는 측정하지 않는다(fallback 으로 계속하지 않음)
  const after = await page.evaluate(() => window.__pixlateTypeset!.measure({ text: 'x', role: 'body', sourceImageWidth: 375, bbox: { x: 0, y: 0, width: 10, height: 10 } }));
  expect(after.ok).toBe(false);
});

test('언어·특수 문자열 줄바꿈은 브라우저 결과를 그대로 쓴다', async ({ page }) => {
  await openHarness(page);
  const results = new Map<string, TypesetMeasureSuccess>();
  for (const f of FIXTURES) {
    const r = await measure(page, f.input);
    results.set(f.name, r);
    console.log(`[line] ${f.name}: ${JSON.stringify(r.lines.map((l) => l.text))} overflow=${JSON.stringify(r.overflow)}`);
    expect(r.coordinateSpace).toBe('section-local-original-px');
    // 줄 조각을 이으면 원문의 보이는 글자가 빠짐없이 순서대로 나온다(임의 분해·누락 없음)
    expect(strip(r.lines.map((l) => l.text).join(''))).toBe(strip(f.input.text));
  }
  const lines = (name: string) => results.get(name)!.lines.map((l) => l.text);

  expect(lines('한국어').length).toBeGreaterThan(1);
  expect(lines('일본어').length).toBeGreaterThan(1);
  // 영어는 공백에서만 나뉜다 — 각 줄의 단어가 원문 단어 그대로다
  const words = new Set(FIXTURES.find((f) => f.name === '영어')!.input.text.split(' '));
  expect(lines('영어').length).toBeGreaterThan(1);
  for (const l of lines('영어')) for (const w of l.trim().split(' ')) expect(words.has(w)).toBe(true);

  expect(lines('명시적 개행')).toEqual(['hello', 'world']);
  expect(lines('일반 연속 공백')).toEqual(['hello world']);
  expect(lines('NBSP 대조(일반 공백)')).toEqual(['hello', 'world']);
  expect(lines('NBSP')).toEqual(['hello world']);
  expect(results.get('NBSP')!.overflow.right).toBe(true);
  // 하이픈 뒤 줄바꿈은 브라우저 기본 동작(새 hyphen 규칙 없음)
  expect(lines('하이픈')).toEqual(['cross-', 'border']);
  // 긴 단어는 강제 분해하지 않고 오른쪽으로 넘친다
  expect(lines('긴 영단어')).toEqual(['averyveryveryverylongword']);
  expect(results.get('긴 영단어')!.overflow).toMatchObject({ left: false, right: true });
  expect(lines('끝 개행')).toEqual(['hello']);
  expect(lines('한 줄')).toEqual(['Pixlate']);

  // 끝 개행이 빈 줄 상자를 더 만드는지 — 같은 style 로 높이 auto 일 때 높이를 비교한다
  const heights = await page.evaluate(() => {
    const block = document.querySelector<HTMLElement>('[data-typeset-block]')!;
    const probe = block.cloneNode(false) as HTMLElement;
    probe.style.height = 'auto';
    block.parentElement!.appendChild(probe);
    const h = (t: string) => {
      probe.textContent = t;
      return probe.getBoundingClientRect().height;
    };
    const out = { plain: h('hello'), trailing: h('hello\n'), twoLines: h('hello\nworld') };
    probe.remove();
    return out;
  });
  console.log(`[line] 끝 개행 높이 ${JSON.stringify(heights)}`);
  expect(heights.trailing).toBe(heights.plain);
  expect(heights.twoLines).toBeGreaterThan(heights.plain);
});

test('baseline 은 실제 DOM 위치에서 얻고, 줄 간격은 CSS line-height 와 일치한다', async ({ page }) => {
  await openHarness(page);
  for (const name of ['한국어', '영어', '일본어']) {
    const r = await measure(page, FIXTURES.find((f) => f.name === name)!.input);
    for (const l of r.lines) {
      expect(l.baselineY).toBeGreaterThan(l.rect.top);
      expect(l.baselineY).toBeLessThan(l.rect.bottom);
      expect(l.ink.top).toBeLessThan(l.baselineY);
    }
    for (let i = 1; i < r.lines.length; i += 1) {
      // 검증용 비교(측정에 쓰지 않음): LayoutUnit(1/64px) 반올림 이내
      expect(Math.abs(r.lines[i].baselineY - r.lines[i - 1].baselineY - r.fontPx * 1.2)).toBeLessThanOrEqual(1 / 32);
    }
    console.log(`[baseline] ${name}: ${JSON.stringify(r.lines.map((l) => [l.rect.top, l.baselineY, l.rect.bottom]))}`);
  }
});

test('가로·세로 ink overflow 를 방향별로 판정하고 +0.115px 도 넘침이다', async ({ page }) => {
  await openHarness(page);

  // 실제 glyph 가 박스 왼쪽·위쪽을 넘는 경우: j 의 음수 왼쪽 여백, Å 의 링
  const leftInk = await measure(page, body('jump', { x: 20, y: 20, width: 120, height: 60 }));
  expect(leftInk.overflow).toMatchObject({ left: true, right: false, top: false, bottom: false, any: true });
  const topInk = await measure(page, body('Å', { x: 20, y: 20, width: 120, height: 60 }));
  expect(topInk.overflow).toMatchObject({ left: false, right: false, top: true, bottom: false, any: true });

  // 박스보다 긴 줄은 text-align:right 여도 시작(왼쪽) 정렬된다(CSS Text) — 엔진은 브라우저 결과대로 오른쪽 넘침으로 판정한다
  const rightAligned = await measure(page, body('averyveryveryverylongword', { x: 200, y: 20, width: 60, height: 60 }, { textAlign: 'right' }));
  expect(rightAligned.lines[0].rect.left).toBe(200);
  expect(rightAligned.overflow).toMatchObject({ left: false, right: true, top: false, bottom: false, any: true });
  // 박스 안에 들어가는 줄은 오른쪽 정렬이 그대로 적용된다
  const rightFit = await measure(page, body('Pixlate', { x: 200, y: 20, width: 100, height: 60 }, { textAlign: 'right' }));
  expect(rightFit.lines[0].rect.right).toBeCloseTo(300, 1);

  const short = await measure(page, body('The browser decides where each line breaks', { x: 20, y: 20, width: 120, height: 20 }));
  expect(short.overflow).toMatchObject({ left: false, right: false, top: false, bottom: true, any: true });

  // 한 단어·좌측 정렬: 박스 폭·높이를 바꿔도 줄과 글자 위치는 그대로다
  const base = await measure(page, body('Pixlate', { x: 20, y: 20, width: 400, height: 60 }));
  const ink = base.ink!;
  const edge = { x: 20, y: 20, width: ink.right - 20, height: ink.bottom - 20 };
  const atEdge = await measure(page, body('Pixlate', edge));
  expect(atEdge.ink).toEqual(ink);
  expect(atEdge.overflow.any).toBe(false);

  const overRight = await measure(page, body('Pixlate', { ...edge, width: edge.width - 0.115 }));
  expect(overRight.overflow).toMatchObject({ right: true, bottom: false, left: false, top: false });
  const overBottom = await measure(page, body('Pixlate', { ...edge, height: edge.height - 0.115 }));
  expect(overBottom.overflow).toMatchObject({ right: false, bottom: true, left: false, top: false });
  console.log(`[overflow] ink=${JSON.stringify(ink)} edge=${JSON.stringify(edge)}`);
});

test('엔진 ink 경계가 실제 렌더 픽셀 경계와 일치한다(Canvas TextMetrics + DOM baseline)', async ({ page }) => {
  await openHarness(page);
  const host = page.getByTestId('typeset-host');
  for (const name of ['한국어', '영어', '일본어', 'title 600', '긴 영단어', '하이픈']) {
    const r = await measure(page, FIXTURES.find((f) => f.name === name)!.input);
    const ink = r.ink!;
    const hostBox = (await host.boundingBox())!;
    const pad = 12;
    // clip 을 정수 CSS px 에 맞춰 스크린샷 픽셀 ↔ CSS px 환산에 반올림이 끼지 않게 한다(deviceScaleFactor 2)
    const clip = {
      x: Math.floor(hostBox.x + ink.left - pad),
      y: Math.floor(hostBox.y + ink.top - pad),
      width: Math.ceil(ink.right - ink.left + pad * 2),
      height: Math.ceil(ink.bottom - ink.top + pad * 2),
    };
    const png = await page.screenshot({ clip, scale: 'device' });
    const px = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let l = Infinity, t = Infinity, rr = -Infinity, b = -Infinity;
      for (let y = 0; y < c.height; y += 1) {
        for (let x = 0; x < c.width; x += 1) {
          const k = (y * c.width + x) * 4;
          if (Math.min(d[k], d[k + 1], d[k + 2]) < 230) {
            l = Math.min(l, x); t = Math.min(t, y); rr = Math.max(rr, x + 1); b = Math.max(b, y + 1);
          }
        }
      }
      return { l, t, r: rr, b };
    }, png.toString('base64'));
    const ratio = 2; // device px / CSS px
    const originX = clip.x - hostBox.x;
    const originY = clip.y - hostBox.y;
    const pixelInk = {
      left: originX + px.l / ratio,
      top: originY + px.t / ratio,
      right: originX + px.r / ratio,
      bottom: originY + px.b / ratio,
    };
    const diff = {
      left: pixelInk.left - ink.left,
      top: pixelInk.top - ink.top,
      right: pixelInk.right - ink.right,
      bottom: pixelInk.bottom - ink.bottom,
    };
    console.log(`[pixel] ${name}: engine=${JSON.stringify(ink)} pixel=${JSON.stringify(pixelInk)} diff=${JSON.stringify(diff)}`);
    // 디바이스 픽셀 1개(0.5 CSS px) 이내 — 스크린샷 양자화·안티앨리어싱 범위
    for (const v of Object.values(diff)) expect(Math.abs(v)).toBeLessThanOrEqual(0.5);
  }
});

test('같은 HTML·CSS·Pretendard 를 clean 문서에서 별도 측정해도 줄 수와 줄 rect 가 같다', async ({ page, context }) => {
  await openHarness(page);
  const clean = await context.newPage();
  let compared = 0;
  for (const f of FIXTURES) {
    const r = await measure(page, f.input);
    const blockHtml = await page.evaluate(() => document.querySelector('[data-typeset-block]')!.outerHTML);
    await clean.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${PRETENDARD_CSS}">` +
        `<style>html,body{margin:0;padding:0;background:#fff}</style></head>` +
        `<body><div id="host" style="position:relative;width:100px;height:100px;margin:40px">${blockHtml}</div></body></html>`,
      { waitUntil: 'load' },
    );
    const independent = await clean.evaluate(async () => {
      await document.fonts.load('400 16px "Pretendard"');
      await document.fonts.load('600 16px "Pretendard"');
      const host = document.getElementById('host')!;
      const block = host.firstElementChild as HTMLElement;
      const hr = host.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(block);
      // 이 spec 의 별도 방법: 블록 전체 Range 의 줄 조각 rect 를 세로 겹침으로 묶는다
      const rects = Array.from(range.getClientRects())
        .filter((x) => x.width > 0)
        .map((x) => ({ left: x.left - hr.left, top: x.top - hr.top, right: x.right - hr.left, bottom: x.bottom - hr.top }))
        .sort((a, b) => a.top - b.top);
      const lines: typeof rects = [];
      for (const x of rects) {
        const last = lines[lines.length - 1];
        if (last && x.top < last.bottom && x.bottom > last.top) {
          last.left = Math.min(last.left, x.left);
          last.right = Math.max(last.right, x.right);
          last.top = Math.min(last.top, x.top);
          last.bottom = Math.max(last.bottom, x.bottom);
        } else lines.push({ ...x });
      }
      return lines;
    });
    const maxDiff = Math.max(
      0,
      ...independent.flatMap((l, i) => {
        const m = r.lines[i]?.rect;
        return m ? [l.left - m.left, l.top - m.top, l.right - m.right, l.bottom - m.bottom].map(Math.abs) : [Infinity];
      }),
    );
    console.log(`[compare] ${f.name}: engine ${r.lines.length}줄 / clean ${independent.length}줄, 최대 rect 차이 ${maxDiff}px`);
    expect(independent.length).toBe(r.lines.length);
    expect(maxDiff).toBe(0);
    compared += 1;
  }
  expect(compared).toBe(FIXTURES.length);
  await clean.close();
});

test('지정 폰트에 없는 글자(일본어 한자)는 대체 폰트로 측정하지 않고 실패한다', async ({ page }) => {
  await openHarness(page);
  const result = await page.evaluate((i) => window.__pixlateTypeset!.measure(i), body('ブラウザが実際に作った改行', NARROW));
  console.log(`[glyph] ${JSON.stringify(result)}`);
  expect(result).toMatchObject({ ok: false, reason: 'glyph-fallback' });
  if (result.ok) return;
  // 한자만 걸리고 가나는 걸리지 않는다
  expect(result.fallbackGraphemes!.sort()).toEqual(['作', '実', '改', '行', '際'].sort());
  // 한국어·영어·가나·NBSP 는 Pretendard 글리프다
  for (const f of FIXTURES) expect((await page.evaluate((i) => window.__pixlateTypeset!.measure(i), f.input)).ok).toBe(true);
});
