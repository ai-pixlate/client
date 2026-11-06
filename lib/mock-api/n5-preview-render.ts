/**
 * N5 /preview 렌더 입력·시도·결과 Mock(server PR #108 계약 모양). Mock 전용이며 실제 서버 값이 아니다.
 *
 * - 지문은 섹션의 저장 입력(블록 revision·번역문·박스·style·배경)을 이어 붙인 문자열의 64자리 16진수 해시다. 같은 입력이면 같은 값이다.
 * - renderInput.blocks 는 렌더 대상만 담는다(라벨·로고·빈 원문·빈 번역문 제외). box·fontScale 은 적용값(셀러 조정 > 원본 bbox·1.0)이다.
 * - style 8키는 서버 값으로 내려준다. 값은 역할별 승인값을 섹션 원본 폭에 맞춘 "측정값"이다(FE 가 다시 계산하지 않는다).
 * - align 은 left·center·right 를 각 1개 이상 섞는다(9101 center · 9103 right · 나머지 left).
 *
 * ?mockScenario=n5-preview-<state> 는 섹션 502 하나만 그 상태로 덮는다(나머지는 기본값).
 */

import type { ApiPreviewRenderBlock, ApiPreviewRenderInput, ApiTextBlock } from '@/lib/api/n5-schema';

export const MOCK_N5_RENDERER = { rendererId: 'pillow-typeset/2+pillow-11.0.0', bundleId: null } as const;

const SECTION_IMG_BASE = '/mock/n5/sections';

/** 섹션 502 를 덮는 상태 시나리오 */
export const N5_PREVIEW_SCENARIOS = [
  'current',
  'preparing-previous',
  'preparing-failed',
  'input-error',
  'pending',
  'failed',
  'stale',
  'missing',
  'missing-done',
  'updating',
  'update-failed',
  'ab-mismatch',
] as const;
export type N5PreviewScenario = (typeof N5_PREVIEW_SCENARIOS)[number];
export const N5_PREVIEW_SCENARIO_SECTION_ID = 502;

export function getN5PreviewScenario(referrer: string): N5PreviewScenario | null {
  if (!referrer) return null;
  try {
    const value = new URL(referrer).searchParams.get('mockScenario') ?? '';
    const name = value.startsWith('n5-preview-') ? value.slice('n5-preview-'.length) : '';
    return (N5_PREVIEW_SCENARIOS as readonly string[]).includes(name) ? (name as N5PreviewScenario) : null;
  } catch {
    return null;
  }
}

/** 처음부터 입력 준비 중인 섹션 — 504(번역 재시도 대기 블록이 있다) */
export const MOCK_N5_PREPARING_SECTION_IDS: ReadonlySet<number> = new Set([504]);

/** 역할별 승인값(기준 폭 375). Mock 서버가 "측정값"을 만들 때만 쓴다 */
const ROLE_STYLE: Record<string, { fontSizePx: number; fontWeight: number; letterSpacingEm: number }> = {
  title: { fontSizePx: 32, fontWeight: 600, letterSpacingEm: -0.015 },
  body: { fontSizePx: 16, fontWeight: 400, letterSpacingEm: -0.03 },
  caption: { fontSizePx: 14, fontWeight: 400, letterSpacingEm: -0.01 },
  price: { fontSizePx: 24, fontWeight: 600, letterSpacingEm: -0.02 },
  caution: { fontSizePx: 16, fontWeight: 400, letterSpacingEm: -0.03 },
};
const ALIGN_BY_BLOCK: Record<number, 'left' | 'center' | 'right'> = { 9101: 'center', 9103: 'right' };

function isRenderTarget(block: ApiTextBlock): boolean {
  return block.role !== 'product_label' && !block.isExcluded && !!block.sourceKo && !!block.trans1 && block.bbox != null && !!ROLE_STYLE[block.role ?? ''];
}

function toRenderBlock(block: ApiTextBlock, sectionWidth: number): ApiPreviewRenderBlock {
  const role = ROLE_STYLE[block.role as string];
  // 적용값 = 셀러 조정(layoutAdjust)이 있으면 그것, 없으면 원본 bbox · 배율 1.0
  const box = block.layoutAdjust?.box ?? { x: block.bbox!.x ?? 0, y: block.bbox!.y ?? 0, w: block.bbox!.w ?? 0, h: block.bbox!.h ?? 0 };
  return {
    blockId: block.id as number,
    revision: block.revision as number,
    text: block.trans1 as string,
    box: { x: box.x, y: box.y, w: box.w, h: box.h },
    style: {
      fontFamily: 'Pretendard',
      fontWeight: role.fontWeight,
      fontSizePx: (role.fontSizePx * sectionWidth) / 375,
      fontScale: block.layoutAdjust?.fontScale ?? 1,
      fontColor: '#222222',
      align: ALIGN_BY_BLOCK[block.id as number] ?? 'left',
      letterSpacingEm: role.letterSpacingEm,
      lineHeightRatio: 1.2,
    },
  };
}

export function buildMockRenderInput(section: { id: number; width: number; height: number }, blocks: readonly ApiTextBlock[]): ApiPreviewRenderInput {
  return {
    section: {
      id: section.id,
      width: section.width,
      height: section.height,
      background: { url: `${SECTION_IMG_BASE}/${section.id}-background.png`, source: section.id === 505 ? 'original' : 'inpaint', sha256: null },
    },
    blocks: blocks.filter((block) => block.sectionId === section.id && isRenderTarget(block)).map((block) => toRenderBlock(block, section.width)),
  };
}

/** 64자리 16진수(SHA-256 모양) — 암호 해시가 아니라 Mock 동일성 비교용 */
export function mockFingerprint(text: string): string {
  let out = '';
  for (let seed = 0; out.length < 64; seed += 1) {
    let h = 0x811c9dc5 ^ seed;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, '0');
  }
  return out.slice(0, 64);
}

export function mockInputFingerprint(input: ApiPreviewRenderInput): string {
  const { section, blocks } = input;
  return mockFingerprint(JSON.stringify([section.id, section.background.url, section.background.source, MOCK_N5_RENDERER.rendererId, blocks]));
}

const OLD_FINGERPRINT = mockFingerprint('previous saved input');

export interface MockN5SectionRender {
  /** inputFingerprint '' = 처음 fixture 결과 — 첫 저장 전까지 그 시점 입력과 같다고 본다(시나리오 덮어쓰기와 무관하게 최신으로 시작) */
  result: { taskId: number; inputFingerprint: string; rendererId: string } | null;
  attempt: { taskId: number; status: 'pending' | 'running' | 'done' | 'failed'; errorCode: string | null; retryable: boolean } | null;
}

interface MockPreviewSectionBase {
  id: number;
  bucket: 'include' | 'exclude';
  excludedStage: 'N3' | 'N5' | null;
  width: number;
  height: number;
  renderedUrl: string | null;
}

/**
 * 섹션 한 개의 렌더 필드. 키 제공 규칙대로 모든 키를 항상 내고 값이 없으면 null 이다.
 * @param preparing 입력 준비 중(인페인팅·스타일·번역 단계 진행 중)
 */
export function buildMockPreviewRenderFields(
  section: MockPreviewSectionBase,
  blocks: readonly ApiTextBlock[],
  render: MockN5SectionRender,
  options: { preparing: boolean; inputError?: { code: string; blockIds: number[] } | null },
) {
  if (section.bucket === 'exclude') {
    return { renderedUrl: section.renderedUrl, renderInput: null, inputFingerprint: null, inputError: null, render: null };
  }
  const renderInput = options.preparing || options.inputError ? null : buildMockRenderInput(section, blocks);
  const inputFingerprint = renderInput ? mockInputFingerprint(renderInput) : null;
  const resultFingerprint = render.result?.inputFingerprint === '' ? (inputFingerprint ?? OLD_FINGERPRINT) : render.result?.inputFingerprint;
  const isCurrent = render.result != null && inputFingerprint != null && resultFingerprint === inputFingerprint;
  return {
    renderedUrl: render.result ? `${SECTION_IMG_BASE}/${section.id}-translated.png` : null,
    renderInput,
    inputFingerprint,
    inputError: options.inputError ?? null,
    render: {
      attempt: render.attempt,
      result: render.result
        ? {
            ...render.result,
            inputFingerprint: resultFingerprint as string,
            // 최신 결과만 넘침을 싣는다. 블록 ID 문자열 key. Mock 은 block overflow 또는 width_overflow signal 을 넘침으로 본다
            overflow: isCurrent
              ? Object.fromEntries(
                  (renderInput?.blocks ?? []).map((b) => {
                    const block = blocks.find((x) => x.id === b.blockId);
                    return [String(b.blockId), block?.overflow === true || (block?.signals ?? []).some((sig) => sig.code === 'width_overflow')];
                  }),
                )
              : null,
          }
        : null,
      isCurrent,
    },
  };
}


/** ?mockScenario=n5-preview-<state> — 섹션 502 의 입력·렌더 상태 */
export function getMockPreviewScenarioState(
  scenario: N5PreviewScenario,
  current: MockN5SectionRender,
): { preparing: boolean; inputError: { code: string; blockIds: number[] } | null; render: MockN5SectionRender; blockFingerprint?: string } {
  const previous = { taskId: 81502, inputFingerprint: OLD_FINGERPRINT, rendererId: MOCK_N5_RENDERER.rendererId };
  switch (scenario) {
    case 'current':
      return { preparing: false, inputError: null, render: current };
    case 'preparing-previous':
      return { preparing: true, inputError: null, render: { result: previous, attempt: { taskId: 81502, status: 'done', errorCode: null, retryable: false } } };
    case 'preparing-failed':
      return { preparing: true, inputError: null, render: { result: null, attempt: { taskId: 81503, status: 'failed', errorCode: 'PREVIEW_FAILED', retryable: true } } };
    case 'input-error':
      return { preparing: false, inputError: { code: 'STYLE_RESULT_INVALID', blockIds: [9104] }, render: { result: null, attempt: null } };
    case 'pending':
      return { preparing: false, inputError: null, render: { result: null, attempt: { taskId: 81504, status: 'pending', errorCode: null, retryable: false } } };
    case 'failed':
      return { preparing: false, inputError: null, render: { result: null, attempt: { taskId: 81505, status: 'failed', errorCode: 'PREVIEW_FAILED', retryable: true } } };
    case 'stale':
      return { preparing: false, inputError: null, render: { result: previous, attempt: { taskId: 81502, status: 'done', errorCode: null, retryable: false } } };
    case 'missing':
      return { preparing: false, inputError: null, render: { result: null, attempt: null } };
    case 'missing-done':
      // 결과 없음 + 끝난 시도 — 실패가 아니라 결과 없음이다
      return { preparing: false, inputError: null, render: { result: null, attempt: { taskId: 81506, status: 'done', errorCode: null, retryable: false } } };
    case 'updating':
      // N5 수정 후 재렌더 진행 중 + 이전 성공 결과
      return { preparing: false, inputError: null, render: { result: previous, attempt: { taskId: 81507, status: 'running', errorCode: null, retryable: false } } };
    case 'update-failed':
      // N5 수정 후 재렌더 실패 + 이전 성공 결과(F-CFM-02)
      return { preparing: false, inputError: null, render: { result: previous, attempt: { taskId: 81508, status: 'failed', errorCode: 'PREVIEW_FAILED', retryable: true } } };
    case 'ab-mismatch':
      // /blocks 의 지문 A 가 계속 다르다 — 화면은 다시 불러온 뒤에도 표와 뷰어를 잇지 않아야 한다
      return { preparing: false, inputError: null, render: current, blockFingerprint: mockFingerprint('other read time') };
  }
}
