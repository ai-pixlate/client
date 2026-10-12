/**
 * M1 보관함 mock fixture — GET /library (API-LIB-01, F-LST-02).
 *
 * MSW 전용 데이터다(production 코드에서 import하지 않는다). 계약상 목록은
 * job(is_saved=true) 투영이므로 여기에는 저장(완료)된 job만 둔다 — 미완료 job은
 * 이 응답에 올 수 없다.
 *
 *   - 9001: 모든 필드가 채워진 완료 카드(F-LST-02 A)
 *   - 9002·9003: 9001과 같은 상품명이지만 국가·언어(9002) / 규격(9003)이 달라
 *     별도 job = 별도 카드(F-LST-02 B). FE는 이 셋을 병합하지 않는다.
 *   - 9004: 다른 상품명·국가(AE) — M1 상품명 검색·국가 필터 확인용. 이 카드만
 *     thumbnailUrl을 채워 실제 썸네일 렌더를 확인한다(나머지는 null placeholder).
 *
 * jobId는 MSW의 실제 흐름 job(mockN5Job.id = 1)과 겹치지 않게 9000번대를 쓴다.
 * thumbnailUrl은 계약상 nullable이다. 9004의 값은 기존 N6 mock 결과 이미지 경로를
 * 재사용한다(실제 서버에서는 deliverable 썸네일의 presigned URL).
 */

import type { ApiLibraryCard } from '@/lib/api/n6-schema';

export const mockLibraryCards: ApiLibraryCard[] = [
  {
    jobId: 9001,
    productName: '비타민C 세럼',
    brandName: null,
    targetCountry: 'US',
    targetLanguage: 'en',
    specType: 'original',
    thumbnailUrl: null,
    savedAt: '2026-10-01T09:00:00Z',
  },
  {
    jobId: 9002,
    productName: '비타민C 세럼',
    brandName: null,
    targetCountry: 'JP',
    targetLanguage: 'ja',
    specType: 'original',
    thumbnailUrl: null,
    savedAt: '2026-10-02T09:00:00Z',
  },
  {
    jobId: 9003,
    productName: '비타민C 세럼',
    brandName: null,
    targetCountry: 'US',
    targetLanguage: 'en',
    specType: 'site',
    thumbnailUrl: null,
    savedAt: '2026-10-03T09:00:00Z',
  },
  {
    jobId: 9004,
    productName: '히알루론산 토너',
    brandName: null,
    targetCountry: 'AE',
    targetLanguage: 'ar',
    specType: 'original',
    thumbnailUrl: '/mock/n5/sections/501-translated.png',
    savedAt: '2026-09-28T09:00:00Z',
  },
];
