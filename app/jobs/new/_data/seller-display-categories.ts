// N1 셀러 표시용 카테고리 트리(seller-facing display category).
//
// 출처: 「셀러 표시용 카테고리.xlsx」 sheet 「올리브영 카테고리 트리 (1)」 — B열 대분류 · C열 중분류 · D열 소분류,
// 빈 셀은 바로 위 부모를 잇는다. 대분류 11 · 중분류 59 · 최종 선택 가능 항목 166.
// 소분류가 없는 중분류는 그 중분류 자체가 최종 선택값이다.
//
// 계약: 이 트리는 화면 표시용이다. 서버 category_master(GET /master/categories → Category{id, parentId, isLeaf, …})의
// categoryId, internal category(G01~G11) 매핑은 이 Excel에 없어 만들지 않았다 — 서버 master 연결은 별도 작업이다.
// 노드 식별자는 서버 id가 아니라 경로 문자열(categoryPathValue)이다.

export interface DisplayCategoryNode {
  label: string;
  children?: DisplayCategoryNode[];
}

const leaves = (...labels: string[]): DisplayCategoryNode[] => labels.map((label) => ({ label }));

export const SELLER_DISPLAY_CATEGORIES: DisplayCategoryNode[] = [
  {
    label: '스킨케어',
    children: [
      { label: '스킨/토너' },
      { label: '에센스/세럼/앰플' },
      { label: '크림', children: leaves('크림', '아이크림') },
      { label: '로션', children: leaves('로션', '올인원') },
      { label: '미스트/오일', children: leaves('미스트', '페이스오일') },
      { label: '스킨케어세트' },
      { label: '스킨케어 디바이스' },
    ],
  },
  {
    label: '마스크팩',
    children: [
      { label: '시트팩', children: leaves('시트 마스크', '겔 마스크') },
      { label: '패드' },
      { label: '페이셜팩', children: leaves('워시오프팩', '모델링팩', '필오프팩', '슬리핑/앰플팩') },
      { label: '코팩' },
      { label: '패치' },
    ],
  },
  {
    label: '클렌징',
    children: [
      { label: '클렌징폼/젤', children: leaves('클렌징폼/젤', '팩클렌저', '클렌징 비누') },
      { label: '오일/밤', children: leaves('클렌징오일', '클렌징밤') },
      { label: '워터/밀크', children: leaves('클렌징워터', '클렌징밀크/크림') },
      { label: '필링&스크럽', children: leaves('페이셜스크럽', '피지클리너', '파우더워시') },
      { label: '티슈/패드', children: leaves('클렌징티슈/패드') },
      { label: '립&아이리무버' },
      { label: '클렌징 디바이스' },
    ],
  },
  {
    label: '선케어',
    children: [
      { label: '선크림' },
      { label: '선스틱' },
      { label: '선쿠션', children: leaves('선쿠션', '선파우더') },
      { label: '선스프레이/선패치', children: leaves('선스프레이', '선패치') },
      { label: '태닝/애프터선', children: leaves('태닝', '애프터선') },
    ],
  },
  {
    label: '메이크업',
    children: [
      { label: '립메이크업', children: leaves('립틴트', '립스틱', '립라이너', '립케어', '컬러립밤', '립글로스') },
      { label: '베이스메이크업', children: leaves('쿠션', '파운데이션', '블러셔', '파우더/팩트', '컨실러', '프라이머/베이스', '쉐이딩', '하이라이터', '메이크업 픽서', 'BB/CC') },
      { label: '아이메이크업', children: leaves('아이라이너', '마스카라', '아이브로우', '아이섀도우', '아이래쉬 케어', '아이 픽서') },
    ],
  },
  {
    label: '뷰티소품',
    children: [
      { label: '메이크업 툴', children: leaves('퍼프', '브러시', '스펀지', '툴 클렌징') },
      { label: '아이래쉬 툴', children: leaves('속눈썹/쌍꺼풀', '뷰러', '눈썹관리 도구') },
      { label: '페이스 툴', children: leaves('괄사/붓기 케어', '팩/클렌징', '기름종이') },
      { label: '헤어/바디 툴', children: leaves('바디용품', '헤어브러시', '헤어소도구', '헤어/바디 기타') },
      { label: '데일리 툴', children: leaves('화장솜', '페이셜타올', '면봉', '네일소도구', '공용기/파우치/거울') },
    ],
  },
  {
    label: '더모코스메틱',
    children: [
      { label: '스킨케어', children: leaves('로션/크림/올인원', '에센스/세럼', '스킨/토너', '아이크림', '미스트/오일') },
      { label: '바디케어', children: leaves('로션/크림/오일(밤)', '워시', '청결제', '립케어', '핸드크림', '데오/미스트') },
      { label: '클렌징', children: leaves('클렌징워터/티슈', '클렌징폼/젤', '클렌징 오일/밀크', '필링/스크럽') },
      { label: '선케어', children: leaves('선크림/선로션', '선스틱') },
      { label: '마스크팩', children: leaves('마스크/패드') },
    ],
  },
  {
    label: '네일',
    children: [
      { label: '일반네일', children: leaves('일반 폴리시', '일반 베이스/탑코트') },
      { label: '젤네일', children: leaves('젤 폴리시', '젤 베이스 /탑코트') },
      { label: '네일팁/스티커' },
      { label: '네일케어/리무버', children: leaves('큐티클관리', '영양/강화제', '리무버') },
    ],
  },
  {
    label: '헤어케어',
    children: [
      { label: '샴푸/스케일러', children: leaves('샴푸', '드라이샴푸', '스케일러') },
      { label: '트리트먼트/팩', children: leaves('린스/컨디셔너', '헤어 트리트먼트', '헤어팩', '노워시 트리트먼트') },
      { label: '두피에센스', children: leaves('두피토닉/앰플') },
      { label: '헤어에센스', children: leaves('헤어세럼', '헤어오일') },
      { label: '염모제/펌', children: leaves('컬러염색/탈색', '새치커버', '펌제') },
      { label: '헤어기기/브러시', children: leaves('고데기', '드라이기', '헤어 브러시', '두피 디바이스') },
      { label: '스타일링', children: leaves('컬크림/컬링에센스', '왁스/젤/무스/토닉', '스프레이/픽서', '헤어메이크업') },
    ],
  },
  {
    label: '바디케어',
    children: [
      { label: '샤워/입욕', children: leaves('바디워시', '바디스크럽', '입욕제', '비누') },
      { label: '바디로션/크림', children: leaves('바디로션', '바디크림') },
      { label: '오일/미스트', children: leaves('바디미스트', '바디오일') },
      { label: '제모/왁싱', children: leaves('면도기/면도날', '제모크림', '스트립/왁스', '제모기기', '남성 쉐이빙') },
      { label: '데오드란트', children: leaves('데오스틱', '데오롤온', '데오스프레이', '쿨링/데오시트') },
      { label: '핸드케어', children: leaves('핸드크림', '핸드워시') },
      { label: '풋케어', children: leaves('풋크림', '풋샴푸', '발냄새제거제', '발각질제거제', '발관리용품') },
      { label: '유아동/임산부', children: leaves('보습', '세정', '선케어', '임산부 케어') },
    ],
  },
  {
    label: '향수/디퓨저',
    children: [
      { label: '향수', children: leaves('여성향수', '남성향수', '유니섹스향수', '헤어퍼퓸') },
      { label: '미니/고체향수', children: leaves('고체향수', '소용량향수', '디스커버리 세트') },
      { label: '홈프래그런스', children: leaves('디퓨저/캔들/인센스', '룸스프레이/탈취제', '차량용방향제/샤셰') },
    ],
  },
];

/** 경로 구분자 — 라벨 안의 "/"와 겹치지 않게 공백 포함 " > "를 쓴다. 같은 이름(예: 크림 > 크림)도 경로로 구분된다. */
const PATH_SEPARATOR = ' > ';

export const categoryPathValue = (path: DisplayCategoryNode[]) => path.map((node) => node.label).join(PATH_SEPARATOR);

/** 경로 문자열 → 노드 경로(대분류부터). 없으면 null. */
export function findCategoryPath(value: string): DisplayCategoryNode[] | null {
  if (!value) return null;
  const path: DisplayCategoryNode[] = [];
  let level: DisplayCategoryNode[] | undefined = SELLER_DISPLAY_CATEGORIES;
  for (const label of value.split(PATH_SEPARATOR)) {
    const node: DisplayCategoryNode | undefined = level?.find((n) => n.label === label);
    if (!node) return null;
    path.push(node);
    level = node.children;
  }
  return path;
}
