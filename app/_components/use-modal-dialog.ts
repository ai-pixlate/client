'use client';

import { useEffect, type RefObject } from 'react';

// 모달 확인창 공통 동작 — M1 보관함 다운로드 모달(library-download-modal.tsx)에서 옮겨 왔다.
// N5 미저장 번역문 확인창도 같은 동작을 쓴다(화면마다 따로 구현하지 않는다).

/** focus trap 대상 — disabled control은 Tab 순서에서 빠진다. */
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * dim에서 body까지 올라가며 각 조상의 형제 요소를 inert로 만든다 — 배경이 Tab·클릭·보조기기에서
 * 빠지고, 모달(dim) 자신과 그 조상은 inert가 되지 않는다. 원래 inert였던 요소는 건드리지 않고,
 * 이 함수가 inert로 만든 요소만 되돌리는 함수를 돌려준다.
 */
function inertOutside(root: HTMLElement): () => void {
  const changed: HTMLElement[] = [];
  for (let node: HTMLElement = root; node.parentElement && node !== document.body; node = node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling === node || !(sibling instanceof HTMLElement) || sibling.inert) continue;
      sibling.inert = true;
      changed.push(sibling);
    }
  }
  return () => {
    for (const el of changed) el.inert = false;
  };
}

/** 포커스 복귀 위치로 쓸 수 있는지 — 문서에 남아 있고, 비활성·inert가 아니어야 한다. */
function canReceiveFocus(el: HTMLElement | null): el is HTMLElement {
  return !!el && el.isConnected && !el.matches(':disabled') && !el.closest('[inert]');
}

/**
 * dialogRef(role="dialog", tabIndex -1)가 붙은 동안: 배경을 inert로 막고, 포커스를 모달 안으로 옮기고,
 * Tab/Shift+Tab을 모달 안에서 순환시킨다(focus trap), Escape로 닫는다, 배경 스크롤을 막는다.
 * dialogRef의 부모가 dim(overlay)이어야 한다.
 *
 * Tab은 브라우저 기본 이동에 맡기지 않고 항상 직접 다음/이전 control로 옮긴다 — WebKit(macOS Safari 기본
 * 설정)은 Tab이 텍스트 입력으로만 이동해 checkbox·button을 건너뛰므로, 기본 이동에 맡기면 모달 안에서
 * 다음 대상을 찾지 못하고 배경이나 body로 빠졌다.
 *
 * 닫힐 때(unmount): inert·body overflow를 먼저 되돌린 뒤 포커스를 복귀시킨다(inert 안의 요소는 focus()가
 * 먹지 않는다). 복귀 위치는 returnFocusRef, 없거나 비활성이면 fallbackFocusRef.
 * onClose는 안정된 참조(useCallback)로 넘긴다 — 바뀌면 이 effect가 다시 돌며 포커스가 옮겨진다.
 */
export function useModalDialog(
  dialogRef: RefObject<HTMLElement | null>,
  {
    onClose,
    returnFocusRef,
    fallbackFocusRef,
  }: {
    onClose: () => void;
    returnFocusRef: RefObject<HTMLElement | null>;
    fallbackFocusRef?: RefObject<HTMLElement | null>;
  },
) {
  useEffect(() => {
    const dialog = dialogRef.current;
    const dim = dialog?.parentElement;
    const restoreInert = dim ? inertOutside(dim) : () => {};
    dialog?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialog) return;
      e.preventDefault();
      const focusables = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
      if (focusables.length === 0) {
        dialog.focus();
        return;
      }
      const index = focusables.indexOf(document.activeElement as HTMLElement);
      // 모달 자체(열린 직후)나 목록 밖에 포커스가 있으면 Tab은 첫 control, Shift+Tab은 마지막 control로.
      const next =
        index === -1
          ? e.shiftKey
            ? focusables.length - 1
            : 0
          : (index + (e.shiftKey ? -1 : 1) + focusables.length) % focusables.length;
      focusables[next].focus();
    };
    document.addEventListener('keydown', onKeyDown);

    const returnTarget = returnFocusRef.current;
    const fallbackTarget = fallbackFocusRef?.current ?? null;
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreInert();
      if (canReceiveFocus(returnTarget)) returnTarget.focus();
      else if (canReceiveFocus(fallbackTarget)) fallbackTarget.focus();
    };
  }, [dialogRef, onClose, returnFocusRef, fallbackFocusRef]);
}
