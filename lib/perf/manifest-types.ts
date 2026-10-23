/**
 * /api/dev/perf-assets manifest 응답 타입.
 * app/perf/long-page harness 전용. 프로덕션 API 계약과 무관하다.
 */

export interface PerfManifestImage {
  path: string;
  url: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface PerfManifestProduct {
  id: string;
  images: PerfManifestImage[];
  totalHeight: number;
  totalSizeBytes: number;
}

export interface PerfManifestResponse {
  products: PerfManifestProduct[];
}
