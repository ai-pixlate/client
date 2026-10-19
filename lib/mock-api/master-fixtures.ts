/**
 * Master mock fixture — GET /master/countries, GET /master/languages (API-MST-01/02).
 *
 * MSW 전용 데이터다(production 코드에서 import하지 않는다). 실제 서버의 국가·언어
 * 목록을 대신하는 것이 아니라, 보관함 fixture(library-fixtures.ts)와 N1·N5 mock이
 * 쓰는 코드값에 표시 이름을 붙이기 위한 최소 목록이다.
 */

import type { ApiCountry, ApiLanguage } from '@/lib/api/master-schema';

export const mockMasterCountries: ApiCountry[] = [
  { code: 'US', name: '미국', hasRegulatoryDictionary: true, release: null },
  { code: 'JP', name: '일본', hasRegulatoryDictionary: true, release: null },
  { code: 'AE', name: '아랍에미리트', hasRegulatoryDictionary: false, release: null },
  { code: 'CN', name: '중국', hasRegulatoryDictionary: false, release: null },
  { code: 'DE', name: '독일', hasRegulatoryDictionary: false, release: null },
  { code: 'FR', name: '프랑스', hasRegulatoryDictionary: false, release: null },
];

export const mockMasterLanguages: ApiLanguage[] = [
  { code: 'en', name: '영어', release: null },
  { code: 'ja', name: '일본어', release: null },
  { code: 'ar', name: '아랍어', release: null },
  { code: 'zh', name: '중국어 간체', release: null },
  { code: 'de', name: '독일어', release: null },
  { code: 'fr', name: '프랑스어', release: null },
];
