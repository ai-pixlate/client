import type { TypesetRenderModel } from '@/lib/n5/typeset-render-model';
import type { FinalOutputSection } from '@/lib/n5/typeset-final-output';

/** QA 전용 예시 데이터 — 실제 API 응답이 아니다 */
export const QA_IMAGE_WIDTH = 375;

/** 입력 순서를 일부러 섞었다 — 계산은 sectionOrder 기준이어야 한다 */
export const QA_SECTIONS: readonly FinalOutputSection[] = [
  { id: 3, sectionOrder: 3, height: 400, bucket: 'include' },
  { id: 1, sectionOrder: 1, height: 500, bucket: 'include' },
  { id: 2, sectionOrder: 2, height: 300, bucket: 'include' },
];

const base = { sourceImageWidth: QA_IMAGE_WIDTH, userFontScale: 1, excluded: false };

export const QA_BLOCKS: readonly TypesetRenderModel[] = [
  { ...base, blockId: 101, sectionId: 1, role: 'title', text: '조판 제목', originalBBox: { x: 24, y: 24, width: 320, height: 60 } },
  { ...base, blockId: 102, sectionId: 1, role: 'body', text: '첫 번째 줄\n두 번째 줄', textAlign: 'center', originalBBox: { x: 24, y: 110, width: 200, height: 60 } },
  // 긴 단어는 강제로 나누지 않으므로 박스만 넘는다
  { ...base, blockId: 103, sectionId: 1, role: 'caption', text: 'averyveryveryverylongword', originalBBox: { x: 24, y: 190, width: 80, height: 40 } },
  { ...base, blockId: 104, sectionId: 1, role: 'price', text: '129,000원', originalBBox: { x: 24, y: 250, width: 200, height: 40 }, adjustedBBox: { x: 24.5, y: 250.25, width: 60.125, height: 40 } },
  // 섹션 끝을 넘지만 뒤 섹션이 있으면 이미지 안이다. S2·S3 를 모두 제외하면 이미지 이탈이 된다
  { ...base, blockId: 105, sectionId: 1, role: 'body', text: '섹션 경계를 넘는 문장', originalBBox: { x: 24, y: 490, width: 300, height: 40 } },
  { ...base, blockId: 201, sectionId: 2, role: 'body', text: '제외하면 최종 출력에서 빠지는 블록', originalBBox: { x: 24, y: 40, width: 320, height: 40 } },
  // 박스 안이지만 마지막 섹션 아래로 나간다
  { ...base, blockId: 301, sectionId: 3, role: 'caution', text: '이미지 경계 밖으로', originalBBox: { x: 24, y: 390, width: 200, height: 40 } },
  { ...base, blockId: 302, sectionId: 3, role: 'body', text: '양쪽넘침', originalBBox: { x: 260, y: 392, width: 20, height: 10 } },
  { ...base, blockId: 303, sectionId: 3, role: 'body', text: '블록 제외 예시', excluded: true, originalBBox: { x: 24, y: 120, width: 200, height: 40 } },
  // Pretendard 에 없는 한자 — 대체 폰트로 측정하지 않고 실패해야 한다
  { ...base, blockId: 304, sectionId: 3, role: 'body', text: '実際', originalBBox: { x: 24, y: 200, width: 200, height: 40 } },
];

/** 측정기 family 를 바꿔 font-not-ready 경로를 보는 값 */
export const QA_MISSING_FONT_FAMILY = 'PixlateNoSuchTypesetFont';
