/**
 * M2 브랜드 정보에서 쓰는 OpenAPI generated 스키마 별칭.
 *
 * lib/api/master-schema.ts 와 같은 경계 원칙 — 화면 코드는 lib/api/generated/openapi.d.ts 를 직접 import 하지 않고 이 별칭만 참조한다.
 */

import type { components } from './generated/openapi';

/** GET /brands 원소 · GET·PATCH /brands/{brandId} 응답 (ERD brand) */
export type ApiBrand = components['schemas']['Brand'];

/** PATCH /brands/{brandId} 본문 — 부분 수정. nameEn 을 null·빈값으로 바꾸면 400 */
export type ApiBrandUpdate = components['schemas']['BrandUpdate'];

/** GET /brands/{brandId}/logos 원소 · POST 응답 (ERD brand_logo). logoUrl 은 presigned(만료 5분) */
export type ApiBrandLogo = components['schemas']['BrandLogo'];

export type ApiBrandLogoFormat = NonNullable<ApiBrandLogo['format']>;
