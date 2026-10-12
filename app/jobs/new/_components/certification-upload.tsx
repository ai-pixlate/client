'use client';

import { useEffect, useRef, useState } from 'react';

import { CloseGlyph16, InfoGlyph20, PlusGlyph24, TooltipTail } from './n1-glyphs';

// N1 인증 마크 업로드 — Figma 525:3023(하단 action 1089:10035 · tooltip 1090:10048),
// 1094:11283(Dim 1081:15561 · Modal 1084:4119).
//
// 계약: 인증 마크 업로드 endpoint·DTO·job 필드가 OpenAPI에 없다. 그래서 선택한 파일은 이 화면(N1 session)의
// FE 상태로만 들고 있고, 서버로 보내거나 업로드 완료 응답을 흉내 내지 않는다. 제출 payload도 바꾸지 않는다.

/** Figma FileUploader 안내 "SVG·PNG·JPG" — 이 세 형식만 받는다. */
const ACCEPT = '.svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg';
const ALLOWED_MIME = ['image/svg+xml', 'image/png', 'image/jpeg'];
const ALLOWED_EXT = /\.(svg|png|jpe?g)$/i;

function isAllowedFile(file: File) {
  return ALLOWED_MIME.includes(file.type) || ALLOWED_EXT.test(file.name);
}

const TOOLTIP_TEXT_LINE_1 = '인증 및 시험 정보의 적용 가능 여부는';
const TOOLTIP_TEXT_LINE_2 = '사용자가 최종 확인해야 합니다.';

/**
 * 하단 인증 마크 action — 상태에 따라 Figma 컴포넌트 자체가 바뀐다.
 *   업로드 전: "인증 마크 업로드 하기" Button Secondary/LG(h45, border #EAEAEA, radius 6, pl 16 / pr 24,
 *             label container px 12(mr −4), 14 Medium −0.42) + trailing Utility/Info 20. Info에 hover하거나
 *             버튼에 키보드 포커스가 오면 tooltip을 보여준다.
 *   등록 완료: "인증 마크 업로드 완료" Tag/Selectable Selected(925:2529 · 1081:15369) — 170×45, white,
 *             border·text #FF6A38, radius 6, px 8. Info·tooltip 없음. 다시 누르면 같은 모달을 연다
 *             (재업로드 전용 상태는 Figma에 없다). 클릭 대상은 그대로 <button>이다.
 */
export function CertificationUploadButton({
  registered,
  onOpen,
  buttonRef,
}: {
  registered: boolean;
  onOpen: () => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const [iconHover, setIconHover] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const showTooltip = iconHover || keyboardFocus;

  if (registered) {
    return (
      <button
        ref={buttonRef}
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        data-testid="n1-certification-button"
        data-state="registered"
        className="flex h-[45px] w-[170px] shrink-0 items-center justify-center gap-1 rounded-[6px] border border-[#ff6a38] bg-white px-2"
      >
        <span className="text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-[#ff6a38]">인증 마크 업로드 완료</span>
      </button>
    );
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={onOpen}
        onFocus={(e) => setKeyboardFocus(e.currentTarget.matches(':focus-visible'))}
        onBlur={() => setKeyboardFocus(false)}
        aria-haspopup="dialog"
        aria-describedby="n1-certification-tooltip"
        data-testid="n1-certification-button"
        data-state="default"
        className="flex h-[45px] items-center justify-center rounded-[6px] border border-[#eaeaea] bg-white py-[14px] pr-6 pl-4 hover:bg-gray-50"
      >
        <span className="mr-[-4px] px-3 text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-[#171717]">
          인증 마크 업로드 하기
        </span>
        <span data-testid="n1-certification-info" onMouseEnter={() => setIconHover(true)} onMouseLeave={() => setIconHover(false)}>
          <InfoGlyph20 />
        </span>
      </button>

      {/* Tooltip(1090:10048) 186×50 — 버튼 위, 꼬리가 Info 중심(버튼 오른쪽 끝에서 24 + 10)을 가리킨다:
          tooltip 오른쪽 끝 = 버튼 오른쪽 끝 + 59. */}
      <div
        id="n1-certification-tooltip"
        role="tooltip"
        hidden={!showTooltip}
        data-testid="n1-certification-tooltip"
        className="absolute -right-[59px] bottom-full z-30 flex h-[50px] w-[186px] items-center justify-center rounded-[8px] border border-[#ff6a38] bg-white p-[10px]"
      >
        <p className="text-[12px] leading-[14px] font-light tracking-[-0.48px] whitespace-nowrap text-[#ff6a38]">
          {TOOLTIP_TEXT_LINE_1}
          <br />
          {TOOLTIP_TEXT_LINE_2}
        </p>
        <TooltipTail />
      </div>
    </div>
  );
}

/** focus trap 대상 — disabled control은 Tab 순서에서 빠진다. */
const FOCUSABLE_SELECTOR = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * 인증 마크 업로드 모달(1084:4119) — 720×697, white, radius 8, padding 40, 세로 gap 28, viewport 중앙.
 * Dim(1081:15561) rgba(23,23,23,0.4). 닫기: 우상단 32×32(Close 16) · 취소 · Escape. backdrop 클릭 닫기는
 * Figma에 정의가 없어 두지 않는다. 등록하기는 파일을 고른 뒤에만 누를 수 있다.
 */
export function CertificationUploadModal({
  initialFile,
  onClose,
  onRegister,
}: {
  initialFile: File | null;
  onClose: () => void;
  onRegister: (file: File) => void;
}) {
  const [pendingFile, setPendingFile] = useState<File | null>(initialFile);
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

  const pickFile = (files: FileList | File[] | null) => {
    const file = files ? [...files].find(isAllowedFile) : undefined;
    if (file) setPendingFile(file);
  };

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
        className="relative flex w-[720px] max-w-[calc(100vw-32px)] flex-col items-start gap-7 rounded-[8px] bg-white p-10 outline-none"
      >
        <div className="flex flex-col items-start gap-[6px] leading-[normal] whitespace-nowrap">
          <h2 id="n1-certification-title" className="text-[20px] leading-[24px] font-semibold tracking-[-0.4px] text-[#171717]">
            인증 마크 업로드
          </h2>
          <p id="n1-certification-description" className="text-[14px] leading-[17px] tracking-[-0.14px] text-[#707070]">
            선택 사항입니다. 올리지 않아도 다음 단계로 진행할 수 있습니다.
          </p>
        </div>

        {/* FileUploader(273:2103) Dropzone — 640×350, border #EAEAEA, radius 8. 드래그 중에는 N1 원본
            uploader와 같은 DragOver 표현(orange border + #FAF3ED)을 쓴다. */}
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
            pickFile(e.dataTransfer.files);
          }}
          className={`flex h-[350px] w-full items-center justify-center rounded-[8px] border px-5 py-5 ${
            isDragOver ? 'border-[#ff6a38] bg-[#faf3ed]' : 'border-[#eaeaea] bg-white'
          }`}
        >
          <div className="flex w-[178px] flex-col items-center justify-center gap-5">
            <div className="flex size-[72px] items-center justify-center rounded-full border border-[#eaeaea] bg-white">
              <PlusGlyph24 />
            </div>
            <div className="flex w-full flex-col items-center gap-2 text-center leading-[normal]">
              <p className="text-[18px] leading-[21px] font-medium tracking-[-0.54px] whitespace-nowrap text-[#171717]">파일을 이곳에 놓아주세요.</p>
              <p className="text-[14px] leading-[17px] tracking-[-0.14px] text-[#707070]">또는 클릭해서 선택 SVG·PNG·JPG</p>
            </div>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              data-testid="n1-certification-pick"
              className="flex h-[45px] items-center justify-center rounded-[6px] bg-[#171717] px-8 py-[14px]"
            >
              <span className="px-3 text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-white">파일 선택</span>
            </button>
            {/* Figma FileUploader에 "선택됨" 상태가 없어, 고른 파일을 알 수 있도록 파일 이름만 최소로 보여준다. */}
            {pendingFile && (
              <p data-testid="n1-certification-file-name" className="max-w-[560px] truncate text-[12px] font-light tracking-[-0.48px] text-[#707070]">
                {pendingFile.name}
              </p>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            data-testid="n1-certification-input"
            onChange={(e) => {
              pickFile(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

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
            disabled={!pendingFile}
            onClick={() => pendingFile && onRegister(pendingFile)}
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
