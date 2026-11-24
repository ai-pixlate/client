import LibraryView from './_components/library/library-view';

// M1 보관함 (Figma 719:7428). 모든 "보관함으로 나가기"가 '/'를 가리키므로 root route에 둔다
// — '/library'는 next.config.ts의 백엔드 rewrite(GET /library)와 겹치므로 페이지로 쓰지 않는다.
export default function Home() {
  return <LibraryView />;
}
