/**
 * FE Spike ④ — 업로드 파일 사전 판독 (N1, 9월 기준)
 *
 * 검증 대상
 *   File API + createImageBitmap 으로 브라우저에서 업로드 파일을
 *   서버로 보내기 전에 안전하게 사전 판독할 수 있는가.
 *
 * 9월 PRD v3.3 N1 기준 (이 파일이 확정하는 범위)
 *   - JPG / PNG 만 업로드 허용, 그 외 포맷은 차단
 *   - File.type·확장자는 신뢰하지 않고 magic bytes(signature)로 실제 포맷을 판별
 *   - 해상도 / 용량 / 색공간은 이번에 차단 기준으로 쓰지 않는다 (F-CH-04, 12월 범위)
 */

export type SupportedFormat = 'JPEG' | 'PNG';
export type DetectedFormat = SupportedFormat | 'UNKNOWN';

export type Verdict =
  | 'PASS'
  | 'UNSUPPORTED_FORMAT'
  | 'SIGNATURE_MISMATCH'
  | 'DECODE_FAILED';

export interface ValidationResult {
  name: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  sizeMB: number;
  lastModified: number;
  /** 확장자/MIME 이 아니라 magic bytes 로 판독한 실제 포맷 */
  actualFormat: DetectedFormat;
  /** F-CH-04(12월) 사전 판정 없이 측정값만 표시 */
  width: number | null;
  height: number | null;
  decodeMs: number | null;
  verdict: Verdict;
  /** 확장자/MIME 이 주장하는 포맷과 실제 signature 가 다른 경우 */
  extensionMismatch: boolean;
  failureReason: string | null;
}

const JPEG_EXTENSIONS = new Set(['jpg', 'jpeg']);
const PNG_EXTENSIONS = new Set(['png']);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function getExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx === -1 || idx === filename.length - 1) return '';
  return filename.slice(idx + 1).toLowerCase();
}

/** 확장자 또는 MIME 이 "JPG/PNG 다" 라고 주장하는지 (신뢰는 하지 않고, mismatch 판단용) */
function isClaimedSupportedFormat(extension: string, mimeType: string): boolean {
  if (JPEG_EXTENSIONS.has(extension) || PNG_EXTENSIONS.has(extension)) return true;
  if (mimeType === 'image/jpeg' || mimeType === 'image/png') return true;
  return false;
}

function extensionMatchesFormat(extension: string, format: SupportedFormat): boolean {
  if (format === 'JPEG') return JPEG_EXTENSIONS.has(extension);
  return PNG_EXTENSIONS.has(extension);
}

async function readSignatureBytes(file: File): Promise<Uint8Array> {
  const buffer = await file.slice(0, 12).arrayBuffer();
  return new Uint8Array(buffer);
}

/** JFIF/EXIF 등 세부 variant 는 구분하지 않고 JPEG/PNG/UNKNOWN 만 판별한다 */
function detectFormatFromBytes(bytes: Uint8Array): DetectedFormat {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'JPEG';
  }
  if (bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    return 'PNG';
  }
  return 'UNKNOWN';
}

/**
 * 파일 하나를 판독한다. 절대 throw 하지 않는다 — 배치 중 한 파일이
 * 손상돼도 나머지 파일 처리를 막지 않기 위해 실패도 결과값(DECODE_FAILED)으로 반환한다.
 */
export async function validateFile(file: File): Promise<ValidationResult> {
  const extension = getExtension(file.name);
  const mimeType = file.type;
  const claimedSupported = isClaimedSupportedFormat(extension, mimeType);

  const base = {
    name: file.name,
    extension,
    mimeType,
    sizeBytes: file.size,
    sizeMB: file.size / (1024 * 1024),
    lastModified: file.lastModified,
  };

  let actualFormat: DetectedFormat = 'UNKNOWN';
  try {
    const bytes = await readSignatureBytes(file);
    actualFormat = detectFormatFromBytes(bytes);
  } catch {
    // signature 조차 못 읽으면 UNKNOWN 으로 유지하고 아래에서 UNSUPPORTED_FORMAT 처리
  }

  if (actualFormat === 'UNKNOWN') {
    return {
      ...base,
      actualFormat,
      width: null,
      height: null,
      decodeMs: null,
      extensionMismatch: claimedSupported,
      verdict: claimedSupported ? 'SIGNATURE_MISMATCH' : 'UNSUPPORTED_FORMAT',
      failureReason: claimedSupported
        ? `확장자/MIME(${extension || '없음'} / ${mimeType || '없음'})은 JPG/PNG를 주장하지만 실제 signature는 JPEG/PNG가 아닙니다.`
        : '실제 signature가 JPEG/PNG가 아닙니다. 9월 N1 기준 JPG/PNG만 업로드 허용합니다.',
    };
  }

  // 실제 signature 는 JPEG/PNG → createImageBitmap 으로 decode 검증
  const extensionMismatch = !extensionMatchesFormat(extension, actualFormat);
  const decodeStart = performance.now();
  try {
    const bitmap = await createImageBitmap(file);
    const decodeMs = performance.now() - decodeStart;
    const { width, height } = bitmap;
    // 대형 이미지 decode 후 메모리를 즉시 해제할 수 있는지 확인하는 것이 이 Spike의 목적 중 하나
    bitmap.close();

    return {
      ...base,
      actualFormat,
      width,
      height,
      decodeMs,
      extensionMismatch,
      verdict: 'PASS',
      failureReason: null,
    };
  } catch (err) {
    const decodeMs = performance.now() - decodeStart;
    return {
      ...base,
      actualFormat,
      width: null,
      height: null,
      decodeMs,
      extensionMismatch,
      verdict: 'DECODE_FAILED',
      failureReason: err instanceof Error ? err.message : 'createImageBitmap 디코딩에 실패했습니다.',
    };
  }
}
