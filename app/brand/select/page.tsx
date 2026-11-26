import M0BrandSelectView from './_components/m0-brand-select-view';

// M0 브랜드 선택 (Figma 1792:20008). 기존 M2(/brand)와 겹치지 않도록 하위 경로에 둔다.
// '/brands'는 next.config.ts 의 백엔드 rewrite 라 페이지로 쓰지 않는다.
export default function BrandSelectPage() {
  return <M0BrandSelectView />;
}
