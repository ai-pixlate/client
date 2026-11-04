import M2BrandView from './_components/m2-brand-view';

// M2 브랜드 정보 (Figma 743:6039). '/brands'는 next.config.ts의 백엔드 rewrite와 겹치므로 페이지로 쓰지 않는다.
export default function BrandPage() {
  return <M2BrandView />;
}
