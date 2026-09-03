/**
 * 스파이크 전용 테스트 데이터 (fixture).
 *
 * ★ 이 파일은 서비스 자산이 아니라 검증용 가짜 데이터입니다.
 *   실제 API가 생기면 이 파일을 통째로 지우고, S1 업로드 응답(F-SRC-01)에서
 *   같은 모양의 SourceImage 를 받아 쓰면 됩니다.
 *
 * 실제 업로드 응답 규약 (pixate-frontend-data-spec.md · S1 "업로드 응답"):
 *   sourceImageId, originalWidth, originalHeight,
 *   originalUrl,   원본 (OCR·인페인팅용 · 프론트는 표시에 쓰지 않음)
 *   previewUrl,    다운스케일 프리뷰 (S2 표시용)
 *   previewScale   previewWidth / originalWidth
 *
 * ★ 실제 API 교체 지점은 이 파일 맨 아래 getSpikeSourceImages() 한 곳뿐입니다.
 */

import type { SourceImage } from './coordinates';

/**
 * 눈금 이미지는 scripts/make-ruler.mjs 로 생성합니다.
 * 100px 마다 가는 선, 500px 마다 굵은 선과 숫자가 들어 있어
 * 크롭 좌표가 맞는지 눈으로 바로 확인할 수 있습니다.
 */
export const SPIKE_SOURCE_IMAGES: SourceImage[] = [
  {
    sourceImageId: 'fx-7000',
    label: '7,000px · previewScale 1 (기본 검증)',
    previewUrl: '/spike/ruler-7000.png',
    originalWidth: 1000,
    originalHeight: 7000,
    // 원본을 그대로 표시하는 경우. 다운스케일이 없으므로 1.
    previewScale: 1,
  },
  {
    sourceImageId: 'fx-10000',
    label: '10,000px · previewScale 1 (F-CRP-01a 수용기준 ①)',
    previewUrl: '/spike/ruler-10000.png',
    originalWidth: 1000,
    originalHeight: 10000,
    previewScale: 1,
  },
  {
    // ★ 가장 중요한 fixture.
    // 원본은 2000x14000 이라고 가정하고, 실제 파일은 1000x7000 입니다.
    // previewScale 이 1 이 아닐 때도 좌표가 맞는지를 이 항목으로 검증합니다.
    // previewScale = 1000 / 2000 = 0.5
    sourceImageId: 'fx-14000-preview',
    label: '14,000px 원본 · previewScale 0.5 (다운스케일 검증)',
    previewUrl: '/spike/ruler-14000-preview.png',
    originalWidth: 2000,
    originalHeight: 14000,
    previewScale: 0.5,
  },
];

/**
 * 에러 케이스 fixture. 정상 목록과 섞지 않고 따로 둡니다.
 * 화면에서 일부러 골라 실패 동작을 확인하는 용도입니다.
 */
export const SPIKE_ERROR_FIXTURES: SourceImage[] = [
  {
    sourceImageId: 'err-404',
    label: '[에러] 이미지 로딩 실패 (없는 경로)',
    previewUrl: '/spike/does-not-exist.png',
    originalWidth: 1000,
    originalHeight: 7000,
    previewScale: 1,
  },
  {
    sourceImageId: 'err-scale-zero',
    label: '[에러] previewScale = 0 (0으로 나누기)',
    previewUrl: '/spike/ruler-7000.png',
    originalWidth: 1000,
    originalHeight: 7000,
    previewScale: 0,
  },
  {
    sourceImageId: 'err-scale-missing',
    label: '[에러] previewScale 누락 (백엔드 필드 없음 가정)',
    previewUrl: '/spike/ruler-7000.png',
    originalWidth: 1000,
    originalHeight: 7000,
    // 백엔드가 필드를 빼먹으면 런타임에 undefined 가 들어옵니다.
    // 타입은 number 이지만 실제로는 뚫릴 수 있으므로 일부러 재현합니다.
    previewScale: undefined as unknown as number,
  },
  {
    sourceImageId: 'err-no-size',
    label: '[에러] originalWidth/Height 를 못 받은 경우',
    previewUrl: '/spike/ruler-7000.png',
    originalWidth: 0,
    originalHeight: 0,
    previewScale: 1,
  },
];

export const ALL_SPIKE_FIXTURES: SourceImage[] = [
  ...SPIKE_SOURCE_IMAGES,
  ...SPIKE_ERROR_FIXTURES,
];

/**
 * ★ 실제 API 교체 지점.
 *
 * 지금 : 배열을 그대로 돌려줍니다.
 * 나중 : GET /jobs/{jobId}/source-images 응답을 Zod 로 검증한 뒤 돌려줍니다.
 *        호출부는 useQuery(['sourceImages', jobId], ...) 로 감싸면 됩니다.
 */
export function getSpikeSourceImages(): SourceImage[] {
  return ALL_SPIKE_FIXTURES;
}
