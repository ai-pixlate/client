// ─────────────────────────────────────────────────────────────────
// 기존 작업의 N1 복원 (N2 [중단] → 서버 draft/N1 복귀 등) — 서버 응답에서 N1 입력 초기값을 고른다. React 를 쓰지 않는다.
//
// 정본은 서버다: JOB-03(GET /jobs/{jobId}) 의 N1 값과 SRC-01(GET /jobs/{jobId}/source-images) 의 원본 목록.
// 서버가 주지 않는 값은 FE 가 채우지 않는다.
// - 규격(specType)은 탭(원본 규격 · 사이즈 변경)과 방식(판매처 · 직접 입력)까지만 복원한다. 판매처 규격 세부(channelSpecId)는 FE 가
//   보내지 않고(채널 규격 API 미연결) 화면 선택지와 id 가 연결돼 있지 않아 복원하지 않는다. specType 이 없으면 화면 기본값(원본 규격)이다.
// - OTC 종류(Job·JobPatch 에 필드 없음 — 서버 구현 대기) · 책임 동의(F-ACC-04, 서버 미저장 · consentId 미사용) — 다시 고른다(자동 선택하지 않는다)
// - 원본 파일명 — SourceImage 에 이름 필드가 없다. 화면 이름은 업로드 순서로만 부른다(원본 이미지 N)
// 화면 선택지에 없는 값(국가·언어·규제 분류)은 고른 것으로 보이지 않게 비워 둔다 — 다시 고르게 한다.
// ─────────────────────────────────────────────────────────────────

import type { ApiJob, ApiRegulatoryClass } from '@/lib/api/job-schema';
import type { ApiSourceImage } from '@/lib/api/n3-schema';
import { INITIAL_SIZE_SELECTION, type SizeSelectionState } from './size-selection.ts';

export interface RestoredN1 {
  jobId: string;
  /** job.brandId — 없으면 null(주소의 brandId 를 쓰지 않는다: 다른 브랜드 작업으로 섞이지 않게) */
  brandId: string | null;
  productName: string;
  productCode: string;
  targetCountry: string;
  targetLanguage: string;
  regulatoryClass: ApiRegulatoryClass | '';
  categoryId: number | null;
  keywords: string[];
  /** job.specType → 사이즈 선택 탭·방식. 세부 규격·직접 입력 크기는 서버 값이 없어 화면 기본값이다 */
  sizeSelection: SizeSelectionState;
  /** 서버 업로드 순서(uploadOrder) 오름차순 · id 가 있는 원본만 */
  sourceImages: ApiSourceImage[];
}

const REGULATORY_CLASSES: readonly ApiRegulatoryClass[] = ['cosmetic', 'otc', 'combination', 'unknown'];

function pickOption(value: string | null | undefined, allowed: readonly string[]): string {
  return value != null && allowed.includes(value) ? value : '';
}

export function buildRestoredN1(
  jobId: string,
  job: ApiJob,
  sourceImages: readonly ApiSourceImage[],
  options: { countries: readonly string[]; languages: readonly string[] },
): RestoredN1 {
  const regulatoryClass = REGULATORY_CLASSES.find((value) => value === job.regulatoryClass) ?? '';
  return {
    jobId,
    brandId: job.brandId != null ? String(job.brandId) : null,
    productName: job.productName ?? '',
    productCode: job.productCode ?? '',
    targetCountry: pickOption(job.targetCountry, options.countries),
    targetLanguage: pickOption(job.targetLanguage, options.languages),
    regulatoryClass,
    categoryId: job.categoryId ?? null,
    keywords: [...(job.keywords ?? [])],
    sizeSelection:
      job.specType === 'site' || job.specType === 'custom'
        ? { ...INITIAL_SIZE_SELECTION, tab: 'change', mode: job.specType }
        : { ...INITIAL_SIZE_SELECTION, tab: 'original' },
    sourceImages: sourceImages
      .filter((image) => image.id != null)
      .sort((a, b) => (a.uploadOrder ?? 0) - (b.uploadOrder ?? 0)),
  };
}

/** 주소의 jobId — 비어 있거나 공백뿐이면 복원하지 않는다(새 작업 N1) */
export function parseRestoreJobId(raw: string | null): string | null {
  const value = raw?.trim();
  return value ? value : null;
}
