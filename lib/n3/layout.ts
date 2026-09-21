/**
 * N3 공용 레이아웃 상수 (Figma 540:3119 실측, 1920×1080 기준).
 *
 * rail, workspace 카드(n3/detail-panel.tsx), 헤더·하단 안내 문구
 * (n3/n3-view.tsx)가 같은 좌측 시작선/폭을 공유해야 하므로 각 파일에
 * 403px·985px 같은 값을 중복 하드코딩하지 않고 여기서 한 번만 정의한다.
 */

/** thumbnail rail(563:4981) 폭 263px @ 1920 (263/1920 ≈ 13.7vw). */
export const N3_RAIL_WIDTH = 'clamp(220px, 13.7vw, 262px)';

/**
 * 진행단계 아이콘 rail(x=36,w=44 → 끝 80) 다음 thumbnail rail이
 * x=121에서 시작한다 — 그 간격은 41px이지 Tailwind px-8(32px)이 아니다.
 */
export const N3_CONTENT_LEFT_INSET = '41px';

/**
 * rail 폭 + rail-workspace gap(20px)까지 더해야 workspace 카드(x=403)와
 * 같은 좌측 시작선이 된다. 헤더·하단 안내 문구도 이 값을 그대로 쓴다.
 */
export const N3_MAIN_LEFT_INSET = `calc(${N3_CONTENT_LEFT_INSET} + ${N3_RAIL_WIDTH} + 20px)`;

/**
 * workspace 카드(570:5136) 폭 985px @ 1920 (985/1920 ≈ 51.3vw). 헤더·하단
 * 안내 문구 frame도 카드와 같은 폭을 쓴다.
 */
export const N3_MAIN_WIDTH = 'clamp(620px, 51.3vw, 985px)';

/**
 * thumbnail rail(563:4981) 콘텐츠 높이 960px @ 1920 (960/1080 ≈ 88.9vh).
 * rail의 y(=60, 헤더 높이 114px + margin-top -54px로 고정 — 이 두 값은
 * 건드리지 않는다)는 vh와 무관한 상수지만, height는 viewport 높이에
 * 비례해 줄어든다.
 */
export const N3_RAIL_HEIGHT = 'clamp(700px, 88.9vh, 960px)';

/**
 * rail 컨테이너의 하단 y 좌표(= top 60px + height). down chevron
 * (n3-view.tsx, pb-0이라 이 값에서 chevron 절반만큼만 뺀 위치가 중심)과
 * 하단 안내 문구(N3_HELP_TEXT_PADDING_BOTTOM)가 반드시 같은 이 값을
 * 기준으로 계산해야 viewport가 바뀌어도(rail height가 vh로 줄어들 때)
 * 두 요소의 세로 중심이 같이 움직인다 — 각자 다른 vh 계수로 따로
 * 맞추면 1920에서만 우연히 맞고 작은 viewport에서 벌어진다.
 */
export const N3_RAIL_BOTTOM = `calc(60px + ${N3_RAIL_HEIGHT})`;

/**
 * 하단 안내 문구(pt 없이 pb만 있어 텍스트가 박스 맨 위에 붙는 구조,
 * 텍스트 높이 ≈18px)의 padding-bottom. 문구는 `position:absolute;
 * bottom:0`이라 시각적 중심 = 100vh - padding - 9px(텍스트 절반).
 * down chevron 중심(N3_RAIL_BOTTOM - 12px, pb-0 기준)과 같아지도록
 * 역산한 식이다: padding = 100vh - N3_RAIL_BOTTOM + (12 - 9).
 */
export const N3_HELP_TEXT_PADDING_BOTTOM = `calc(100vh - ${N3_RAIL_BOTTOM} + 3px)`;
