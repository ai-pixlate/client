import HomeView from './_components/home-view';

// H 홈 (Figma 1492:10051 랜딩 · 1776:4171 로그인 후 · 1779:4227 신규 사용자). 기존 M1(/)과 겹치지 않도록 /home 에 둔다.
// 사용자 상태별 뷰는 한 컴포넌트(HomeView)가 고른다 — 세 화면을 따로 만들지 않는다.
export default function HomePage() {
  return <HomeView />;
}
