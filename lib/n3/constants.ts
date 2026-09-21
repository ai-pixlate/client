/**
 * N3 공용 interaction 상수.
 *
 * UI 컴포넌트(section-thumbnail.tsx) 하나가 정본이 되면 n3-view.tsx가 그
 * 컴포넌트 내부 구현에 의존하게 된다 — dnd-kit PointerSensor의
 * activationConstraint.distance와 클릭/드래그 판별 거리(pointerup 기반,
 * section-thumbnail.tsx)가 반드시 같은 값이어야 하므로 이 공용 위치에서
 * 하나로 관리한다.
 */

/**
 * "드래그로 인식되지 않을 만큼 작은 움직임"의 기준(px). dnd-kit
 * PointerSensor의 activationConstraint.distance(n3-view.tsx)와
 * pointerup 기반 click 판별(section-thumbnail.tsx) 양쪽에서 같은 값을
 * 써야 한다 — 다르면 dnd-kit이 drag로 인식하지 않는 움직임을 click 판별
 * 로직이 drag로 오판하거나, 그 반대 상황이 생길 수 있다.
 */
export const N3_DRAG_ACTIVATION_DISTANCE = 4;
