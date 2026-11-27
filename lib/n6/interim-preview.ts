import type { components } from '../api/generated/openapi';

type ApiReviewPreview = components['schemas']['ReviewPreview'];

/**
 * N6 최종 렌더 진행 · 실패 중 좌측 뷰어의 미리보기(BE 11-26 추가 회신 — 기존 GET /jobs/{jobId}/preview 를 N6 에서도 요청할 수 있다).
 * 순수 함수(scripts/verify-n6-interim-preview.mjs).
 *
 * - 최종 산출물이 아니다. 최종 렌더 성공 뒤에는 FIN-02 deliverables 만 보이고 이 값은 쓰지 않는다(화면 쪽에서 분기).
 * - 포함 섹션만 순서대로 쓴다. N5 제외 섹션(bucket = exclude · excludedStage 있음)은 최종 결과에 들어가지 않으므로 그리지 않는다.
 * - 이미지는 서버가 준 renderedUrl 이 있고 그 근거(render.result)가 있을 때만 쓴다. 없으면 그 섹션은 「미리보기 없음」 자리로 둔다 —
 *   원본이나 다른 이미지로 채우지 않는다.
 * - render.isCurrent 가 false 인 이미지가 하나라도 있으면 「이전 미리보기」 안내를 낸다. true 여도 최종 렌더 완료를 뜻하지 않는다.
 * - 응답이 없거나(null) 보여 줄 이미지가 하나도 없으면 null — 빈 상태 안내를 쓴다.
 */
export interface N6InterimPreviewItem {
  sectionId: number;
  /** 원본 px — 자리 비율용 */
  width: number;
  height: number;
  /** 표시할 미리보기 이미지. 없으면 null(미리보기 없음 자리) */
  url: string | null;
  /** 이 이미지가 지금 입력의 결과인가(render.isCurrent === true) */
  isCurrent: boolean;
}

export interface N6InterimPreview {
  items: N6InterimPreviewItem[];
  /** 보이는 이미지 중 최신 입력의 결과가 아닌 것이 있다 */
  hasStale: boolean;
  /** 포함 섹션 중 미리보기 이미지가 없는 것이 있다 */
  hasMissing: boolean;
}

export function toN6InterimPreview(preview: ApiReviewPreview | null | undefined): N6InterimPreview | null {
  if (!preview || !Array.isArray(preview.sections)) return null;
  const items: N6InterimPreviewItem[] = [...preview.sections]
    .filter((section) => section.bucket === 'include' && section.excludedStage == null && typeof section.id === 'number')
    .sort((a, b) => (a.sectionOrder ?? 0) - (b.sectionOrder ?? 0))
    .map((section) => {
      const url = typeof section.renderedUrl === 'string' && section.renderedUrl.trim() !== '' && section.render?.result != null ? section.renderedUrl : null;
      return {
        sectionId: section.id as number,
        width: section.width ?? 0,
        height: section.height ?? 0,
        url,
        isCurrent: url != null && section.render?.isCurrent === true,
      };
    });
  const shown = items.filter((item) => item.url != null);
  if (shown.length === 0) return null;
  return { items, hasStale: shown.some((item) => !item.isCurrent), hasMissing: shown.length < items.length };
}
