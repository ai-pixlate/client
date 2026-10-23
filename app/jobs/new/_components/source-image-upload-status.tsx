'use client';

import type { SourceImageUpload } from '../_lib/use-source-image-uploads';

// ─────────────────────────────────────────────────────────────────
// N1 썸네일 카드의 업로드 상태 표시 — 임시 표현.
//
// 업로드 실패 상태의 Figma가 아직 없어 기존 N1 토큰만 쓴다(흰 배경, #eaeaea border,
// #171717/#707070 텍스트, 기존 하단 오류 문구와 같은 text-red-500, 보조 버튼은
// 「선택하기」 버튼 스타일). Figma가 확정되면 이 컴포넌트만 교체한다 — 상태·로직은
// _lib/use-source-image-uploads.ts에 있다. 업로드 전(idle)과 완료(done)는 표시하지 않는다.
// ─────────────────────────────────────────────────────────────────

/** 서버 error.code → 짧은 사유. 계약 Error enum 중 업로드 거절 코드만 옮기고, 제한 수치는 쓰지 않는다. */
const UPLOAD_ERROR_REASON: Partial<Record<string, string>> = {
  UNSUPPORTED_FORMAT: '지원하지 않는 형식',
  FILE_TOO_LARGE: '파일 용량 초과',
};

export function SourceImageUploadStatus({
  fileName,
  upload,
  onRetry,
  retryDisabled,
}: {
  fileName: string;
  upload: SourceImageUpload;
  onRetry: () => void;
  retryDisabled?: boolean;
}) {
  if (upload.status === 'uploading') {
    return (
      <div
        role="status"
        className="absolute inset-x-0 bottom-0 border-t border-[#eaeaea] bg-white px-3 py-2 text-[12px] tracking-[-0.01em] text-[#707070]"
      >
        업로드 중
      </div>
    );
  }

  if (upload.status !== 'failed') return null;

  const reason = upload.errorCode ? UPLOAD_ERROR_REASON[upload.errorCode] : undefined;
  return (
    <div
      role="alert"
      data-testid="n1-source-upload-failed"
      className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 border-t border-[#eaeaea] bg-white px-3 py-2"
    >
      <p className="min-w-0 truncate text-[12px] tracking-[-0.01em] text-red-500" title={reason ? `업로드 실패 · ${reason}` : '업로드 실패'}>
        업로드 실패{reason ? ` · ${reason}` : ''}
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={retryDisabled}
        aria-label={`${fileName} 다시 시도`}
        className="shrink-0 rounded-[6px] border border-[#eaeaea] bg-white px-2.5 py-1 text-[12px] font-medium tracking-[-0.03em] text-[#171717] hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        다시 시도
      </button>
    </div>
  );
}
