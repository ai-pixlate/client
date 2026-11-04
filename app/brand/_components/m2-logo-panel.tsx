'use client';

import { useRef, useState, type DragEvent } from 'react';

import { PlusGlyph16 } from '@/app/_components/library/library-controls';
import { M2_LOGO_ACCEPT, type M2BrandLogo } from '@/lib/brand/m2-form';

import { M2Button } from './m2-button';

// M2 브랜드 로고 영역 (Figma 753:6373, 폭 568)
//   로고 카드(753:6286): 568×200, BG #F5F5F5, radius 6. 표시 칸은 Figma 워드마크 폭(263)·심볼 높이(120).
//   FileUploader Compact(1100:11870·273:1953·273:1963): Default / DragOver / Invalid.
//
// Figma와 다르게 둔 것:
// - 포맷 문구: Figma는 svg·ai인데 PRD F-BRD-01 기준 SVG·PNG·JPG로 쓴다. 용량 제한은 PRD에 없어 표기하지 않는다.
// - 카드 checkbox: PRD에 대표·활성·복수 선택 의미가 없어 만들지 않고, Figma의 Danger/XS [삭제]를 카드마다 둔다.
// - [로고 변경]: 복수 로고에서 교체 의미가 정해지지 않아 만들지 않는다(추가·삭제로 처리한다).

export function M2LogoPanel({
  logos,
  editable,
  invalidFiles,
  onAddFiles,
  onRemove,
}: {
  logos: M2BrandLogo[];
  editable: boolean;
  invalidFiles: boolean;
  onAddFiles: (files: File[]) => void;
  onRemove: (logoId: string) => void;
}) {
  const uploadButtonRef = useRef<HTMLButtonElement>(null);

  const handleRemove = (logoId: string) => {
    onRemove(logoId);
    // 누른 버튼이 사라지므로 포커스를 다음 조작 위치로 옮긴다
    uploadButtonRef.current?.focus();
  };

  return (
    <section aria-labelledby="m2-logo-title" data-testid="m2-logo-panel" className="col-start-3 flex min-h-0 min-w-0 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1 leading-[normal]">
          <h2 id="m2-logo-title" className="text-[18px] leading-[21px] font-medium tracking-[-0.54px] text-[#171717]">
            브랜드 로고
          </h2>
          <p className="text-[12px] font-light tracking-[-0.48px] text-[#707070]">SVG, PNG, JPG 파일을 등록할 수 있습니다.</p>
        </div>
        {/* Figma 로고 액션(743:6088). 로고 API 전까지 미연결이며, 실제 로컬 삭제는 카드의 삭제 버튼이 맡는다 */}
        <div className="flex shrink-0 items-center gap-2">
          <M2Button variant="secondary" size="xs" label="로고 변경" testId="m2-logo-change" />
          <M2Button variant="danger" size="xs" label="삭제" testId="m2-logo-delete-action" />
        </div>
      </div>

      {/* 로고가 많아지면 이 목록만 스크롤한다 */}
      <div className="min-h-0 flex-initial overflow-x-hidden overflow-y-auto">
        {logos.length > 0 ? (
          <ul data-testid="m2-logo-list" className="flex flex-col gap-3">
            {logos.map((logo) => (
              <LogoCard key={logo.id} logo={logo} editable={editable} onRemove={handleRemove} />
            ))}
          </ul>
        ) : (
          !editable && (
            <p className="flex h-[200px] items-center justify-center rounded-[6px] bg-[#f5f5f5] text-[14px] tracking-[-0.14px] text-[#707070]">
              등록된 로고가 없습니다.
            </p>
          )
        )}
      </div>

      {editable && <LogoUploader invalid={invalidFiles} onAddFiles={onAddFiles} buttonRef={uploadButtonRef} />}
    </section>
  );
}

function LogoCard({
  logo,
  editable,
  onRemove,
}: {
  logo: M2BrandLogo;
  editable: boolean;
  onRemove: (logoId: string) => void;
}) {
  // 확장자가 맞아도 깨진 파일일 수 있다(파일 내용 검증은 서버 책임) — 빈 칸 대신 이유를 보여 준다.
  const [previewFailed, setPreviewFailed] = useState(false);

  return (
    <li data-testid="m2-logo-card" className="relative flex h-[200px] items-center justify-center rounded-[6px] bg-[#f5f5f5]">
      {previewFailed ? (
        <p className="text-[14px] tracking-[-0.14px] text-[#707070]">미리보기를 표시할 수 없습니다.</p>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- 로컬 blob: URL도 표시해 next/image 최적화 대상이 아니다
        <img
          src={logo.src}
          alt={logo.name}
          data-testid="m2-logo-image"
          onError={() => setPreviewFailed(true)}
          className="h-[120px] w-[263px] object-contain"
        />
      )}
      {editable && (
        <button
          type="button"
          onClick={() => onRemove(logo.id)}
          aria-label={`${logo.name} 삭제`}
          className="absolute top-2 right-2 flex items-center justify-center rounded-[4px] border border-[#e5484d] bg-white px-[12px] py-[5px] text-[12px] leading-[normal] tracking-[-0.24px] text-[#e5484d]"
        >
          삭제
        </button>
      )}
    </li>
  );
}

function LogoUploader({
  invalid,
  onAddFiles,
  buttonRef,
}: {
  invalid: boolean;
  onAddFiles: (files: File[]) => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    onAddFiles(Array.from(event.dataTransfer.files));
  };

  const state = dragOver ? 'dragover' : invalid ? 'invalid' : 'default';
  const frameClass = {
    default: 'border-[#eaeaea] bg-white',
    dragover: 'border-[#eaeaea] bg-[#f5f5f5]',
    invalid: 'border-[#e5484d] bg-white',
  }[state];

  return (
    <div
      data-testid="m2-logo-uploader"
      data-state={state}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
      }}
      onDrop={handleDrop}
      className={`flex w-full shrink-0 items-center justify-between rounded-[8px] border px-6 py-8 ${frameClass}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
            state === 'default' ? 'border border-[#eaeaea] bg-white' : 'bg-[#f5f5f5]'
          }`}
        >
          <PlusGlyph16 />
        </div>
        <div role={invalid ? 'alert' : undefined} className="flex min-w-0 flex-col gap-2 leading-[normal]">
          <p className={`text-[16px] font-medium tracking-[-0.48px] ${state === 'invalid' ? 'text-[#e5484d]' : 'text-[#171717]'}`}>
            {state === 'dragover' ? '여기에 놓기' : state === 'invalid' ? '업로드할 수 없는 파일입니다.' : '로고 파일 추가'}
          </p>
          <p className={`text-[12px] tracking-[-0.12px] ${state === 'invalid' ? 'text-[#171717]' : 'text-[#707070]'}`}>
            {state === 'dragover' ? '파일을 놓아주세요' : state === 'invalid' ? 'SVG, PNG, JPG 파일만 등록할 수 있습니다.' : 'SVG, PNG, JPG'}
          </p>
        </div>
      </div>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => inputRef.current?.click()}
        className={`flex h-[37px] w-[107px] shrink-0 items-center justify-center rounded-[6px] text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap ${
          state === 'dragover' ? 'bg-[#f5f5f5] text-[#999]' : 'bg-[#171717] text-white hover:opacity-90'
        }`}
      >
        {state === 'invalid' ? '다시 선택' : '파일 선택'}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={M2_LOGO_ACCEPT}
        hidden
        data-testid="m2-logo-input"
        onChange={(event) => {
          onAddFiles(Array.from(event.target.files ?? []));
          // 같은 파일을 다시 고를 수 있게 비운다
          event.target.value = '';
        }}
      />
    </div>
  );
}
