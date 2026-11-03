/**
 * IME(한글·일본어·중국어) 조합 중 keydown인지 판단한다. 조합 중 Enter는 글자 확정용이라 검색·제출로 처리하면 안 된다.
 * keyCode 229는 isComposing이 false로 오는 브라우저(Safari 등)의 조합 확정 keydown까지 잡기 위한 방어다.
 */
export function isImeComposingKeyEvent(event: { isComposing: boolean; keyCode: number }): boolean {
  return event.isComposing || event.keyCode === 229;
}
