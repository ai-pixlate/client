/**
 * Master mock fixture — GET /master/categories (API-MST-04).
 *
 * MSW 전용 데이터다(production 코드에서 import하지 않는다). 실제 category_master를 대신하지 않으며,
 * 실서버 응답과 같은 shape(OpenAPI Category: id · parentId · name · amazonNode · isLeaf · path)의
 * 평면 배열로만 내보낸다. 트리 이름은 「셀러 표시용 카테고리.xlsx」(대분류 11종 · 3단계)에서 옮긴 것으로,
 * 테스트가 다음 구조를 모두 만나게 한다.
 *   대분류(하위 있음 — 최종 선택 불가) → 중분류(하위 있음) → 소분류(leaf)
 *   대분류 → 하위 없는 중분류(leaf, 예: 선케어 > 선크림)
 * id는 아래 트리를 깊이 우선으로 훑은 순서(1부터)다. amazonNode는 mock에서 쓰지 않아 null이다.
 */

import type { ApiCategory } from '@/lib/api/master-schema';

interface CategorySeed {
  name: string;
  children?: CategorySeed[];
}

const CATEGORY_SEED: CategorySeed[] = [] = [
  {
    name: '스킨케어',
    children: [
      { name: '스킨/토너' },
      { name: '에센스/세럼/앰플' },
      {
        name: '크림',
        children: [
          { name: '크림' },
          { name: '아이크림' },
        ],
      },
      {
        name: '로션',
        children: [
          { name: '로션' },
          { name: '올인원' },
        ],
      },
      {
        name: '미스트/오일',
        children: [
          { name: '미스트' },
          { name: '페이스오일' },
        ],
      },
      { name: '스킨케어세트' },
      { name: '스킨케어 디바이스' },
    ],
  },
  {
    name: '마스크팩',
    children: [
      {
        name: '시트팩',
        children: [
          { name: '시트 마스크' },
          { name: '겔 마스크' },
        ],
      },
      { name: '패드' },
      {
        name: '페이셜팩',
        children: [
          { name: '워시오프팩' },
          { name: '모델링팩' },
          { name: '필오프팩' },
          { name: '슬리핑/앰플팩' },
        ],
      },
      { name: '코팩' },
      { name: '패치' },
    ],
  },
  {
    name: '클렌징',
    children: [
      {
        name: '클렌징폼/젤',
        children: [
          { name: '클렌징폼/젤' },
          { name: '팩클렌저' },
          { name: '클렌징 비누' },
        ],
      },
      {
        name: '오일/밤',
        children: [
          { name: '클렌징오일' },
          { name: '클렌징밤' },
        ],
      },
      {
        name: '워터/밀크',
        children: [
          { name: '클렌징워터' },
          { name: '클렌징밀크/크림' },
        ],
      },
      {
        name: '필링&스크럽',
        children: [
          { name: '페이셜스크럽' },
          { name: '피지클리너' },
          { name: '파우더워시' },
        ],
      },
      {
        name: '티슈/패드',
        children: [
          { name: '클렌징티슈/패드' },
        ],
      },
      { name: '립&아이리무버' },
      { name: '클렌징 디바이스' },
    ],
  },
  {
    name: '선케어',
    children: [
      { name: '선크림' },
      { name: '선스틱' },
      {
        name: '선쿠션',
        children: [
          { name: '선쿠션' },
          { name: '선파우더' },
        ],
      },
      {
        name: '선스프레이/선패치',
        children: [
          { name: '선스프레이' },
          { name: '선패치' },
        ],
      },
      {
        name: '태닝/애프터선',
        children: [
          { name: '태닝' },
          { name: '애프터선' },
        ],
      },
    ],
  },
  {
    name: '메이크업',
    children: [
      {
        name: '립메이크업',
        children: [
          { name: '립틴트' },
          { name: '립스틱' },
          { name: '립라이너' },
          { name: '립케어' },
          { name: '컬러립밤' },
          { name: '립글로스' },
        ],
      },
      {
        name: '베이스메이크업',
        children: [
          { name: '쿠션' },
          { name: '파운데이션' },
          { name: '블러셔' },
          { name: '파우더/팩트' },
          { name: '컨실러' },
          { name: '프라이머/베이스' },
          { name: '쉐이딩' },
          { name: '하이라이터' },
          { name: '메이크업 픽서' },
          { name: 'BB/CC' },
        ],
      },
      {
        name: '아이메이크업',
        children: [
          { name: '아이라이너' },
          { name: '마스카라' },
          { name: '아이브로우' },
          { name: '아이섀도우' },
          { name: '아이래쉬 케어' },
          { name: '아이 픽서' },
        ],
      },
    ],
  },
  {
    name: '뷰티소품',
    children: [
      {
        name: '메이크업 툴',
        children: [
          { name: '퍼프' },
          { name: '브러시' },
          { name: '스펀지' },
          { name: '툴 클렌징' },
        ],
      },
      {
        name: '아이래쉬 툴',
        children: [
          { name: '속눈썹/쌍꺼풀' },
          { name: '뷰러' },
          { name: '눈썹관리 도구' },
        ],
      },
      {
        name: '페이스 툴',
        children: [
          { name: '괄사/붓기 케어' },
          { name: '팩/클렌징' },
          { name: '기름종이' },
        ],
      },
      {
        name: '헤어/바디 툴',
        children: [
          { name: '바디용품' },
          { name: '헤어브러시' },
          { name: '헤어소도구' },
          { name: '헤어/바디 기타' },
        ],
      },
      {
        name: '데일리 툴',
        children: [
          { name: '화장솜' },
          { name: '페이셜타올' },
          { name: '면봉' },
          { name: '네일소도구' },
          { name: '공용기/파우치/거울' },
        ],
      },
    ],
  },
  {
    name: '더모코스메틱',
    children: [
      {
        name: '스킨케어',
        children: [
          { name: '로션/크림/올인원' },
          { name: '에센스/세럼' },
          { name: '스킨/토너' },
          { name: '아이크림' },
          { name: '미스트/오일' },
        ],
      },
      {
        name: '바디케어',
        children: [
          { name: '로션/크림/오일(밤)' },
          { name: '워시' },
          { name: '청결제' },
          { name: '립케어' },
          { name: '핸드크림' },
          { name: '데오/미스트' },
        ],
      },
      {
        name: '클렌징',
        children: [
          { name: '클렌징워터/티슈' },
          { name: '클렌징폼/젤' },
          { name: '클렌징 오일/밀크' },
          { name: '필링/스크럽' },
        ],
      },
      {
        name: '선케어',
        children: [
          { name: '선크림/선로션' },
          { name: '선스틱' },
        ],
      },
      {
        name: '마스크팩',
        children: [
          { name: '마스크/패드' },
        ],
      },
    ],
  },
  {
    name: '네일',
    children: [
      {
        name: '일반네일',
        children: [
          { name: '일반 폴리시' },
          { name: '일반 베이스/탑코트' },
        ],
      },
      {
        name: '젤네일',
        children: [
          { name: '젤 폴리시' },
          { name: '젤 베이스 /탑코트' },
        ],
      },
      { name: '네일팁/스티커' },
      {
        name: '네일케어/리무버',
        children: [
          { name: '큐티클관리' },
          { name: '영양/강화제' },
          { name: '리무버' },
        ],
      },
    ],
  },
  {
    name: '헤어케어',
    children: [
      {
        name: '샴푸/스케일러',
        children: [
          { name: '샴푸' },
          { name: '드라이샴푸' },
          { name: '스케일러' },
        ],
      },
      {
        name: '트리트먼트/팩',
        children: [
          { name: '린스/컨디셔너' },
          { name: '헤어 트리트먼트' },
          { name: '헤어팩' },
          { name: '노워시 트리트먼트' },
        ],
      },
      {
        name: '두피에센스',
        children: [
          { name: '두피토닉/앰플' },
        ],
      },
      {
        name: '헤어에센스',
        children: [
          { name: '헤어세럼' },
          { name: '헤어오일' },
        ],
      },
      {
        name: '염모제/펌',
        children: [
          { name: '컬러염색/탈색' },
          { name: '새치커버' },
          { name: '펌제' },
        ],
      },
      {
        name: '헤어기기/브러시',
        children: [
          { name: '고데기' },
          { name: '드라이기' },
          { name: '헤어 브러시' },
          { name: '두피 디바이스' },
        ],
      },
      {
        name: '스타일링',
        children: [
          { name: '컬크림/컬링에센스' },
          { name: '왁스/젤/무스/토닉' },
          { name: '스프레이/픽서' },
          { name: '헤어메이크업' },
        ],
      },
    ],
  },
  {
    name: '바디케어',
    children: [
      {
        name: '샤워/입욕',
        children: [
          { name: '바디워시' },
          { name: '바디스크럽' },
          { name: '입욕제' },
          { name: '비누' },
        ],
      },
      {
        name: '바디로션/크림',
        children: [
          { name: '바디로션' },
          { name: '바디크림' },
        ],
      },
      {
        name: '오일/미스트',
        children: [
          { name: '바디미스트' },
          { name: '바디오일' },
        ],
      },
      {
        name: '제모/왁싱',
        children: [
          { name: '면도기/면도날' },
          { name: '제모크림' },
          { name: '스트립/왁스' },
          { name: '제모기기' },
          { name: '남성 쉐이빙' },
        ],
      },
      {
        name: '데오드란트',
        children: [
          { name: '데오스틱' },
          { name: '데오롤온' },
          { name: '데오스프레이' },
          { name: '쿨링/데오시트' },
        ],
      },
      {
        name: '핸드케어',
        children: [
          { name: '핸드크림' },
          { name: '핸드워시' },
        ],
      },
      {
        name: '풋케어',
        children: [
          { name: '풋크림' },
          { name: '풋샴푸' },
          { name: '발냄새제거제' },
          { name: '발각질제거제' },
          { name: '발관리용품' },
        ],
      },
      {
        name: '유아동/임산부',
        children: [
          { name: '보습' },
          { name: '세정' },
          { name: '선케어' },
          { name: '임산부 케어' },
        ],
      },
    ],
  },
  {
    name: '향수/디퓨저',
    children: [
      {
        name: '향수',
        children: [
          { name: '여성향수' },
          { name: '남성향수' },
          { name: '유니섹스향수' },
          { name: '헤어퍼퓸' },
        ],
      },
      {
        name: '미니/고체향수',
        children: [
          { name: '고체향수' },
          { name: '소용량향수' },
          { name: '디스커버리 세트' },
        ],
      },
      {
        name: '홈프래그런스',
        children: [
          { name: '디퓨저/캔들/인센스' },
          { name: '룸스프레이/탈취제' },
          { name: '차량용방향제/샤셰' },
        ],
      },
    ],
  },
];

function flatten(seeds: CategorySeed[], parent: ApiCategory | null, out: ApiCategory[]): ApiCategory[] {
  for (const seed of seeds) {
    const node: ApiCategory = {
      id: out.length + 1,
      parentId: parent?.id ?? null,
      name: seed.name,
      amazonNode: null,
      isLeaf: !seed.children?.length,
      path: parent?.path ? `${parent.path} > ${seed.name}` : seed.name,
    };
    out.push(node);
    if (seed.children) flatten(seed.children, node, out);
  }
  return out;
}

export const mockMasterCategories: ApiCategory[] = flatten(CATEGORY_SEED, null, []);
