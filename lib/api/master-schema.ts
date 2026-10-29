/**
 * Master(국가/언어 등 기준 데이터)에서 쓰는 OpenAPI generated 스키마 별칭.
 *
 * lib/api/n5-schema.ts·n6-schema.ts와 같은 경계 원칙 — 화면 코드는
 * lib/api/generated/openapi.d.ts를 직접 import하지 않고 이 별칭만 참조한다.
 */

import type { components } from './generated/openapi';

/** GET /master/countries 원소 (API-MST-01) — master_country, 자연키 code */
export type ApiCountry = components['schemas']['Country'];

/** GET /master/languages 원소 (API-MST-02) */
export type ApiLanguage = components['schemas']['Language'];

/** GET /master/categories 원소 (API-MST-04) — category_master 평면 노드. 트리는 parentId로 잇는다 */
export type ApiCategory = components['schemas']['Category'];
