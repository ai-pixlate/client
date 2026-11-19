/**
 * 말풍선 아래 화살표(Figma 1090:10048 — N1 인증 마크 안내). 흰 면 + #ff6a38 선, 12×11. 말풍선 아래 가장자리에 1px 겹쳐 선을 잇는다.
 * 말풍선은 relative 이고 화살표 가로 위치는 호출부가 className 으로 준다.
 */
export function TooltipArrow({ className }: { className: string }) {
  return (
    <svg width="12" height="11" viewBox="0 0 12 11" fill="none" aria-hidden="true" className={`absolute top-[calc(100%-1px)] ${className}`}>
      <path d="M0.5 0.5L6 10L11.5 0.5" fill="white" stroke="#ff6a38" />
      <path d="M1 0H11" stroke="white" strokeWidth="1.5" />
    </svg>
  );
}
