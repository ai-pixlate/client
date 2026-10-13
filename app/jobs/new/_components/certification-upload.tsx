'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { CloseGlyph16, InfoGlyph20, PlusGlyph16, TooltipTail, TrashGlyph14 } from './n1-glyphs';

// N1 인증 마크 업로드 — Figma 525:3023(하단 action 1089:10035 · tooltip 1090:10048),
// 1170:8460(복수 업로드 Modal).
//
// 계약: 인증 마크 업로드 endpoint·DTO·job 필드가 OpenAPI에 없다. 그래서 선택한 파일은 이 화면(N1 session)의
// FE 상태로만 들고 있고, 서버로 보내거나 업로드 완료 응답을 흉내 내지 않는다. 제출 payload도 바꾸지 않는다.

/** 지원 형식 SVG·PNG·JPG(JPEG) — 이 형식만 받는다. 크기 제한은 요구사항에 없어 두지 않는다. */
const ACCEPT = '.svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg';
const ALLOWED_MIME = ['image/svg+xml', 'image/png', 'image/jpeg'];
const ALLOWED_EXT = /\.(svg|png|jpe?g)$/i;

function isAllowedFile(file: File) {
  return ALLOWED_MIME.includes(file.type) || ALLOWED_EXT.test(file.name);
}

/** 등록한 인증 마크 1개 — id는 목록 key·개별 삭제용 FE 식별자일 뿐 서버 asset key가 아니다. */
export interface CertificationMark {
  id: string;
  file: File;
}

let markSeq = 0;
const toMark = (file: File): CertificationMark => {
  markSeq += 1;
  return { id: `cert_${markSeq}`, file };
};

/** PRD F-SRC-08 tooltip — 버튼 상태(활성/비활성)와 관계없이 같은 두 줄. */
export const CERTIFICATION_TOOLTIP_LINES = [
  '사이즈 변경을 고르면 인증 마크를 올릴 수 있어요.',
  '인증 및 시험 정보의 적용 가능 여부는 사용자가 최종 확인해야 합니다.',
] as const;

/**
 * 하단 인증 마크 action — 상태에 따라 Figma 컴포넌트 자체가 바뀐다.
 *   업로드 전: "인증 마크 업로드 하기" Button Secondary/LG(h45, border #EAEAEA, radius 6, pl 16 / pr 24,
 *             label container px 12(mr −4), 14 Medium −0.42) + trailing Utility/Info 20.
 *   등록 완료: "인증 마크 업로드 완료" Tag/Selectable Selected(925:2529 · 1081:15369) — 170×45, white,
 *             border·text #FF6A38, radius 6, px 8. Info·tooltip 없음. 다시 누르면 같은 모달을 연다.
 *             원본 유지에서는 disabled — Tag/Selectable Disabled: bg #F5F5F5 · border #EAEAEA · text #999.
 *   업로드 전 disabled: Button Secondary/LG Disabled — bg #F5F5F5, text #171717(opacity 감소 없음).
 *
 * 활성 조건(PRD F-SRC-08): 「사이즈 변경」일 때만 누를 수 있다 — disabled는 page.tsx가 정한다.
 * tooltip: 활성이면 Info hover · 버튼 키보드 포커스로 연다. 비활성이면 disabled <button>은 pointer/focus
 * 이벤트를 안정적으로 받지 않으므로, 버튼은 pointer-events를 끄고 감싼 wrapper가 hover·키보드 포커스를 맡는다.
 */
export function CertificationUploadButton({
  registered,
  disabled,
  onOpen,
  buttonRef,
}: {
  registered: boolean;
  disabled: boolean;
  onOpen: () => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const [hover, setHover] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const showTooltip = hover || keyboardFocus;

  if (registered) {
    return (
      <button
        ref={buttonRef}
        type="button"
        onClick={onOpen}
        disabled={disabled}
        aria-haspopup="dialog"
        data-testid="n1-certification-button"
        data-state="registered"
        className="group flex h-[45px] w-[170px] shrink-0 items-center justify-center gap-1 rounded-[6px] border border-[#ff6a38] bg-white px-2 disabled:cursor-not-allowed disabled:border-[#eaeaea] disabled:bg-[#f5f5f5]"
      >
        <span className="text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-[#ff6a38] group-disabled:text-[#999]">인증 마크 업로드 완료</span>
      </button>
    );
  }

  const trackFocus = (e: React.FocusEvent<HTMLElement>) => setKeyboardFocus(e.currentTarget.matches(':focus-visible'));
  const hoverHandlers = { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) };

  return (
    <div
      data-testid="n1-certification-trigger"
      className={`relative shrink-0 ${disabled ? 'cursor-not-allowed' : ''}`}
      {...(disabled && {
        ...hoverHandlers,
        tabIndex: 0,
        onFocus: trackFocus,
        onBlur: () => setKeyboardFocus(false),
        'aria-describedby': 'n1-certification-tooltip',
      })}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={onOpen}
        disabled={disabled}
        onFocus={trackFocus}
        onBlur={() => setKeyboardFocus(false)}
        aria-haspopup="dialog"
        aria-describedby="n1-certification-tooltip"
        data-testid="n1-certification-button"
        data-state="default"
        className="flex h-[45px] items-center justify-center rounded-[6px] border border-[#eaeaea] bg-white py-[14px] pr-6 pl-4 enabled:hover:bg-gray-50 disabled:pointer-events-none disabled:bg-[#f5f5f5]"
      >
        <span className="mr-[-4px] px-3 text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-[#171717]">
          인증 마크 업로드 하기
        </span>
        <span data-testid="n1-certification-info" {...(!disabled && hoverHandlers)}>
          <InfoGlyph20 />
        </span>
      </button>

      {/* Tooltip(525:3023) 193×82 — border 1 + padding 10 + 두 줄 문구(각 2행, 12/14) + 줄 간 4. 버튼 위, 꼬리가
          Info 중심(버튼 오른쪽 끝에서 24 + 10)을 가리킨다. */}
      <div
        id="n1-certification-tooltip"
        role="tooltip"
        hidden={!showTooltip}
        data-testid="n1-certification-tooltip"
        className="absolute -right-[62px] bottom-full z-30 w-[193px] rounded-[8px] border border-[#ff6a38] bg-white p-[10px]"
      >
        <div className="flex flex-col gap-1 text-[12px] leading-[14px] font-light tracking-[-0.48px] text-[#ff6a38]">
          {CERTIFICATION_TOOLTIP_LINES.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <TooltipTail className="absolute top-full left-1/2 -translate-x-1/2 -translate-y-[2px]" />
      </div>
    </div>
  );
}

/** focus trap 대상 — disabled control은 Tab 순서에서 빠진다. */
const FOCUSABLE_SELECTOR = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * 인증 마크 업로드 모달(1170:8460) — 720×696, white, radius 8, padding 40, 세로 gap 32, viewport 중앙.
 * Dim rgba(23,23,23,0.4). 닫기: 우상단 32×32(Close 16) · 취소 · Escape. backdrop 클릭 닫기는 두지 않는다.
 *
 * 복수 등록(PRD F-SRC-08): 새로 고른 파일은 목록 뒤에 붙고(교체 아님), 카드마다 개별 삭제한다. 모달 안의
 * 편집은 등록하기를 눌러야 반영되고, 취소·닫기·Escape는 편집만 버린다 — 이미 등록한 목록은 그대로다.
 */
export function CertificationUploadModal({
  initialMarks,
  onClose,
  onRegister,
}: {
  initialMarks: CertificationMark[];
  onClose: () => void;
  onRegister: (marks: CertificationMark[]) => void;
}) {
  const [pendingMarks, setPendingMarks] = useState<CertificationMark[]>(initialMarks);
  const [isDragOver, setIsDragOver] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 열려 있는 동안: 포커스를 모달 안으로, Tab/Shift+Tab을 모달 안에서 순환, Escape 닫기, 배경 스크롤 잠금.
  // 닫힐 때 body overflow는 열기 전 값으로 되돌린다. 포커스 복귀는 onClose를 넘긴 쪽이 맡는다.
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialog) return;
      // display:none인 파일 input 등 화면에 없는 요소는 포커스를 받을 수 없으므로 뺀다.
      const focusables = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((el) => el.getClientRects().length > 0);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const outside = !dialog.contains(active);
      if (e.shiftKey && (active === first || active === dialog || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const addFiles = (files: FileList | File[] | null) => {
    const allowed = files ? [...files].filter(isAllowedFile) : [];
    if (allowed.length > 0) setPendingMarks((prev) => [...prev, ...allowed.map(toMark)]);
  };

  const removeMark = (id: string) => {
    setPendingMarks((prev) => prev.filter((m) => m.id !== id));
    // 누른 삭제 버튼이 사라지므로 포커스를 모달로 돌려 focus trap 안에 남긴다.
    dialogRef.current?.focus();
  };

  // 목록을 모두 지운 경우에도 등록하기로 "등록 해제"를 반영할 수 있어야 한다 — 둘 다 비었을 때만 막는다.
  const canRegister = pendingMarks.length > 0 || initialMarks.length > 0;

  return (
    <div data-testid="n1-certification-dim" className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(23,23,23,0.4)]">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="n1-certification-title"
        aria-describedby="n1-certification-description"
        tabIndex={-1}
        data-testid="n1-certification-modal"
        className="relative flex w-[720px] max-w-[calc(100vw-32px)] flex-col items-start gap-8 rounded-[8px] bg-white p-10 outline-none"
      >
        <div className="flex flex-col items-start gap-[6px] leading-[normal] whitespace-nowrap">
          <h2 id="n1-certification-title" className="text-[20px] leading-[24px] font-semibold tracking-[-0.4px] text-[#171717]">
            인증 마크 업로드
          </h2>
          <p id="n1-certification-description" className="text-[14px] leading-[17px] tracking-[-0.14px] text-[#707070]">
            선택 사항입니다. 올리지 않아도 다음 단계로 진행할 수 있습니다.
          </p>
        </div>

        {/* FileUploader compact — 640×112, border #EAEAEA, radius 8, padding 24/32, 한 줄 justify-between:
            [40×40 원형 icon(Plus 16) · gap 12 · 문구(gap 8)] … [파일 선택 107×37]. 드래그 중에는 N1 원본 uploader와
            같은 DragOver 표현(orange border + #FAF3ED)을 쓴다. */}
        <div
          data-testid="n1-certification-dropzone"
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
          className={`flex h-[112px] w-full items-center justify-between rounded-[8px] border px-6 py-8 ${
            isDragOver ? 'border-[#ff6a38] bg-[#faf3ed]' : 'border-[#eaeaea] bg-white'
          }`}
        >
          <div className="flex items-center gap-3">
            {/* 원형 Secondary icon(장식) — 파일 선택은 오른쪽 버튼 하나가 맡는다. */}
            <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[#eaeaea] bg-white">
              <PlusGlyph16 />
            </span>
            <div className="flex flex-col items-start gap-2 leading-[normal]">
              <p className="text-[18px] leading-[21px] font-medium tracking-[-0.54px] whitespace-nowrap text-[#171717]">파일을 이곳에 놓아주세요.</p>
              <p className="text-[14px] leading-[17px] tracking-[-0.14px] whitespace-nowrap text-[#707070]">또는 클릭해서 선택 SVG·PNG·JPG</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            data-testid="n1-certification-pick"
            className="flex h-[37px] w-[107px] shrink-0 items-center justify-center rounded-[6px] bg-[#171717]"
          >
            <span className="text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-white">파일 선택</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            data-testid="n1-certification-input"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {/* 등록된 인증 마크 — 영역 높이는 고정(193)이고 목록이 많아지면 이 안에서만 세로 스크롤한다. */}
        <section aria-labelledby="n1-certification-list-title" className="flex h-[193px] w-full flex-col gap-[6px]">
          <h3 id="n1-certification-list-title" className="text-[16px] leading-[19px] font-medium tracking-[-0.48px] text-[#171717]">
            등록된 인증 마크
          </h3>
          <ul data-testid="n1-certification-list" className="n3-scroll-hidden grid min-h-0 flex-1 auto-rows-[80px] grid-cols-2 content-start gap-x-5 gap-y-2 overflow-y-auto">
            {pendingMarks.map((mark) => (
              <li
                key={mark.id}
                data-testid="n1-certification-item"
                className="flex h-20 min-w-0 items-center gap-3 rounded-[8px] border border-[#eaeaea] bg-white px-3"
              >
                <MarkThumbnail file={mark.file} />
                <p data-testid="n1-certification-file-name" className="min-w-0 flex-1 truncate text-[12px] leading-[14px] font-light tracking-[-0.48px] text-[#707070]">
                  {mark.file.name}
                </p>
                <button
                  type="button"
                  onClick={() => removeMark(mark.id)}
                  aria-label={`${mark.file.name} 삭제`}
                  data-testid="n1-certification-remove"
                  className="flex shrink-0 items-center justify-center gap-1 rounded-[4px] bg-[#171717] px-3 py-2 text-white"
                >
                  <TrashGlyph14 />
                  <span className="text-[12px] leading-[14px] font-normal tracking-[-0.24px] whitespace-nowrap">삭제</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <div className="flex w-full flex-col gap-1 leading-[normal] whitespace-nowrap">
          <p className="text-[18px] leading-[21px] font-medium tracking-[-0.54px] text-[#171717]">업로드 전에 확인해 주세요</p>
          <div className="flex flex-col gap-[2px] text-[14px] leading-[17px] tracking-[-0.14px] text-[#707070]">
            <p>사용 권한이 있는 인증 마크만 올려 주세요.</p>
            <p>이 제품이 실제로 받은 인증인지, 판매 국가에서 표시해도 되는지 확인해 주세요.</p>
            <p>pix/ate는 인증 마크의 진위와 유효성을 검증하지 않습니다.</p>
          </div>
        </div>

        <div className="flex h-14 w-full items-center gap-[13px]">
          <button
            type="button"
            onClick={onClose}
            data-testid="n1-certification-cancel"
            className="flex h-full min-w-0 flex-1 items-center justify-center rounded-[6px] border border-[#eaeaea] bg-white px-8"
          >
            <span className="px-3 text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-[#171717]">취소</span>
          </button>
          <button
            type="button"
            disabled={!canRegister}
            onClick={() => onRegister(pendingMarks)}
            data-testid="n1-certification-register"
            className="flex h-full min-w-0 flex-1 items-center justify-center rounded-[6px] bg-[#171717] px-8 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="px-3 text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-white">등록하기</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          data-testid="n1-certification-close"
          className="absolute top-10 right-10 flex size-8 items-center justify-center rounded-[6px] border border-[#eaeaea] bg-white"
        >
          <CloseGlyph16 />
        </button>
      </div>
    </div>
  );
}

/**
 * 파일 카드 썸네일 60×60 — 로컬 File을 blob URL로 미리 본다. URL은 이 img가 붙어 있는 동안만 살리고
 * 떨어질 때 revoke한다(React 19 ref cleanup).
 */
function MarkThumbnail({ file }: { file: File }) {
  const attachPreview = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img) return;
      const url = URL.createObjectURL(file);
      img.src = url;
      return () => URL.revokeObjectURL(url);
    },
    [file],
  );
  // eslint-disable-next-line @next/next/no-img-element -- 로컬 blob: objectURL이라 next/image 최적화 대상이 아니다
  return <img ref={attachPreview} alt="" className="size-[60px] shrink-0 rounded-[4px] object-contain" />;
}
