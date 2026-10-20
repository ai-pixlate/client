/**
 * M1 보관함 Adapter — GET /library 응답(LibraryCard[]) → 카드 ViewModel (F-LST-02).
 *
 *   OpenAPI DTO → Library Adapter(이 파일) → LibraryCardViewModel → React Component
 *
 * lib/n5/adapter.ts와 같은 패턴의 순수 변환 함수만 둔다 — React를 연결하지 않고
 * scripts/verify-library-adapter.mjs로 Node에서 바로 검증한다.
 *
 * 계약(v3.4.2 openapi.yaml, API-LIB-01): LibraryCard는 "job(is_saved=true) 투영 +
 * deliverable 썸네일(presigned)"이다. 즉
 *   - 카드 1장 = 저장된 job 1건. FE는 productName/국가/언어/규격으로 카드를 병합하거나
 *     중복 제거하지 않는다 — 국가·언어·규격이 다르면 서버가 이미 별도 job(=별도 카드)로 준다.
 *   - 목록에는 저장(완료)된 job만 온다. status/currentStep 필드가 없으므로 미완료 카드의
 *     "마지막 단계"는 이 계약으로 표시할 수 없다 — 여기서 지어내지 않는다.
 *   - 국가/언어/규격은 코드값 그대로 둔다. 표시 문구 매핑은 UI 단계(lib/library/view.ts
 *     getSpecTypeLabel, master 이름 조회)가 맡는다.
 */

import type { ApiLibraryCard } from '@/lib/api/n6-schema';

export interface LibraryCardViewModel {
  /** 카드 식별자. 목록 key와 이후 선택·삭제 등 카드 단위 동작의 기준이다. */
  jobId: number;
  productName: string | null;
  brandName: string | null;
  /** 코드값(예: 'US'). 표시 라벨 매핑은 UI 단계에서 결정한다. */
  targetCountry: string | null;
  /** 코드값(예: 'en'). */
  targetLanguage: string | null;
  /** 코드값('original' | 'site' | 'custom'). 스펙상 optional이라 없으면 null. 표시 이름은 getSpecTypeLabel. */
  specType: ApiLibraryCard['specType'] | null;
  /** presigned URL(만료 5분). 영구 식별자로 저장하지 않는다 — 필요하면 목록을 재조회한다. */
  thumbnailUrl: string | null;
  savedAt: string | null;
}

/**
 * jobId는 스펙상 required가 아니지만 카드 식별에 필수다. 비어 있으면 배열 index 등으로
 * 조용히 대체하지 않고 던진다(lib/n5/adapter.ts의 toBlockViewModel과 같은 이유).
 */
export function toLibraryCardViewModel(dto: ApiLibraryCard): LibraryCardViewModel {
  if (dto.jobId == null) throw new Error('Library Adapter: LibraryCard.jobId가 없습니다');

  return {
    jobId: dto.jobId,
    productName: dto.productName ?? null,
    brandName: dto.brandName ?? null,
    targetCountry: dto.targetCountry ?? null,
    targetLanguage: dto.targetLanguage ?? null,
    specType: dto.specType ?? null,
    thumbnailUrl: dto.thumbnailUrl ?? null,
    savedAt: dto.savedAt ?? null,
  };
}

/** 서버 응답 순서를 그대로 유지한다 — 정렬·병합·중복 제거를 하지 않는다. */
export function toLibraryCardViewModels(cards: ApiLibraryCard[]): LibraryCardViewModel[] {
  return cards.map(toLibraryCardViewModel);
}
