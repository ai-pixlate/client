import type { ApiRegulatoryClass } from '@/lib/api/job-schema';

/** 규제 분류 화면 표기(Figma 525:3023 dropdown). N1 선택지와 N5 상단 정보가 같은 표기를 쓴다 */
export const REGULATORY_CLASS_LABELS: Record<ApiRegulatoryClass, string> = {
  cosmetic: '화장품',
  otc: 'OTC 화장품',
  combination: '화장품+OTC 복합',
  unknown: '잘모름',
};
