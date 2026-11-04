import type { ApiRegulatoryClass } from '@/lib/api/job-schema';

/**
 * 규제 분류 화면 표기. N1 선택지와 N5 상단 정보가 같은 표기를 쓴다.
 * 정본은 PRD v3.5.10 F-LNG-03(OTC 의약품·잘 모름)이다. Figma 525:3023 드롭다운에는 옛 표기(OTC 화장품·잘모름)가 남아 있어 따르지 않는다.
 */
export const REGULATORY_CLASS_LABELS: Record<ApiRegulatoryClass, string> = {
  cosmetic: '화장품',
  otc: 'OTC 의약품',
  combination: '화장품+OTC 복합',
  unknown: '잘 모름',
};
