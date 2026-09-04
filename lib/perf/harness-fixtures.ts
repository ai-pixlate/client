/**
 * 3일차 long-page 성능 baseline harness(app/perf/long-page) 전용 synthetic fixture 생성기.
 *
 * - N3: 현재 SectionCard와 동일한 DOM 밀도(thumbnail·verdict badge·problem·basis·
 *   include/exclude action)를 가진 Section[]을 section count만큼 생성한다.
 * - N5: 실제 perf-assets 이미지(manifest)로 sourceImages[]를 만들고, textBlock 부하는
 *   TextBlockEditor와 동일한 구조(source/translated text·badge·button·basis)로
 *   synthetic 생성한다.
 *
 * production mock fixture(lib/mock-api/fixtures.ts)와는 별개이며, 이 harness에서만 쓴다.
 */

import type {
  Section,
  ReviewSection,
  ReviewSourceImage,
  TextBlock,
  BlockRole,
} from '@/lib/api/types';
import type { PerfManifestProduct } from './manifest-types';

// 1x1 회색 PNG. N3는 이미지 decode 테스트가 아니므로 네트워크 요청 없는 최소 placeholder만 사용한다.
const PLACEHOLDER_THUMB =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// ─────────────────────────────────────────────────────────────────
// N3 — section fixture
// ─────────────────────────────────────────────────────────────────

export function buildN3Sections(count: number): Section[] {
  return Array.from({ length: count }, (_, i) => {
    const order = i + 1;
    const hasVerdict = order % 3 === 0;
    const isExcluded = order % 7 === 0;

    return {
      sectionId: `perf_n3_sec_${order}`,
      sourceImageId: `perf_n3_src_${Math.ceil(order / 10)}`,
      sectionOrder: order,
      thumbnailUrl: PLACEHOLDER_THUMB,
      bucket: isExcluded ? 'exclude' : 'include',
      exclusionReason: isExcluded ? '성능 baseline 합성 데이터 — 자동 제외 샘플' : null,
      excludedStage: isExcluded ? 'N3' : null,
      bbox: { x: 0, y: (order - 1) * 600, width: 1000, height: 600 },
      verdicts: hasVerdict
        ? [
            {
              verdictId: `perf_n3_vrd_${order}`,
              verdictType: 'regulatory',
              verdictStatus: 'warning',
              problemText: `합성 판정 문구 #${order} — 성능 baseline 측정용`,
              basis:
                '성능 baseline 측정을 위한 synthetic 근거 텍스트입니다. 실제 규제 판단 근거가 아닙니다.',
            },
          ]
        : [],
    };
  });
}

// ─────────────────────────────────────────────────────────────────
// N5 — sourceImages + textBlock fixture
// ─────────────────────────────────────────────────────────────────

const BLOCK_ROLES: BlockRole[] = ['title', 'body', 'caption', 'price', 'caution'];

function buildTextBlocks(sectionId: string, count: number, seedOffset: number): TextBlock[] {
  return Array.from({ length: count }, (_, i) => {
    const n = seedOffset + i;
    const role = BLOCK_ROLES[n % BLOCK_ROLES.length];
    const isFailed = n % 11 === 0;
    const hasCandidates = n % 3 === 0;

    return {
      blockId: `perf_n5_blk_${n}`,
      sectionId,
      sourceText: `합성 원문 텍스트 샘플 #${n} — 성능 baseline 측정용 더미 문장입니다.`,
      translatedText: isFailed
        ? ''
        : `Synthetic translated sample #${n} for long-page N5 performance baseline.`,
      translationStatus: n % 5 === 0 ? 'userEdited' : 'machine',
      role,
      blockStatus: isFailed ? 'failed' : 'done',
      needsReview: n % 4 === 0,
      complianceFlags: n % 9 === 0 ? ['SYNTHETIC_FLAG'] : [],
      autoAdjust: n % 6 === 0,
      basis: '성능 baseline 측정을 위한 synthetic 근거 텍스트입니다. 실제 로컬라이징 근거가 아닙니다.',
      bbox: { x: 0, y: n * 80, width: 900, height: 60 },
      candidates: hasCandidates
        ? [
            {
              candidateId: `perf_n5_cand_${n}_1`,
              translatedText: `Candidate A for sample #${n}`,
              isSelected: true,
            },
            {
              candidateId: `perf_n5_cand_${n}_2`,
              translatedText: `Candidate B for sample #${n}`,
              isSelected: false,
            },
          ]
        : [],
    };
  });
}

export interface N5FixtureResult {
  sourceImages: ReviewSourceImage[];
  sections: ReviewSection[];
  imageCount: number;
  totalImageHeight: number;
  totalImageBytes: number;
  textBlockCount: number;
}

/**
 * @param products manifest에서 이번 Case에 포함할 제품만 필터링해 전달한다.
 * @param textBlockCount 이번 Case에 고정 배정된 textBlock 총 개수 (A=30 / B=90 / C=300).
 */
export function buildN5Fixtures(
  products: PerfManifestProduct[],
  textBlockCount: number,
): N5FixtureResult {
  // 이미지 순서는 manifest가 이미 filename 숫자 순서로 정렬해 두었으므로 그대로 보존한다.
  const sourceImages: ReviewSourceImage[] = products.flatMap((product) =>
    product.images.map((img) => ({
      sourceImageId: `perf_n5_img_${product.id}_${img.path}`,
      // 원문/번역문 미리보기 구분 자산이 없으므로 같은 실제 파일을 그대로 사용한다.
      // (렌더링/decode 부하 측정이 목적이며, 실제 번역 합성 이미지 유무는 이번 baseline 범위 밖)
      originalPreviewUrl: img.url,
      translatedPreviewUrl: img.url,
    })),
  );

  const imageCount = sourceImages.length;
  const totalImageHeight = products.reduce((sum, p) => sum + p.totalHeight, 0);
  const totalImageBytes = products.reduce((sum, p) => sum + p.totalSizeBytes, 0);

  // textBlock을 나눠 담을 synthetic section 수: 실제 상세페이지 밀도(섹션당 약 6개)에 맞춘다.
  const sectionCount = Math.max(1, Math.round(textBlockCount / 6));
  const base = Math.floor(textBlockCount / sectionCount);
  const remainder = textBlockCount % sectionCount;

  let seed = 0;
  const sections: ReviewSection[] = Array.from({ length: sectionCount }, (_, i) => {
    const order = i + 1;
    const countForThisSection = base + (i < remainder ? 1 : 0);
    const sectionId = `perf_n5_sec_${order}`;
    const blocks = buildTextBlocks(sectionId, countForThisSection, seed);
    seed += countForThisSection;

    return {
      sectionId,
      sourceImageId: sourceImages[i % Math.max(1, sourceImages.length)]?.sourceImageId ?? '',
      sectionOrder: order,
      bucket: 'include',
      excludedStage: null,
      textBlocks: blocks,
    };
  });

  return {
    sourceImages,
    sections,
    imageCount,
    totalImageHeight,
    totalImageBytes,
    textBlockCount: sections.reduce((sum, s) => sum + s.textBlocks.length, 0),
  };
}
