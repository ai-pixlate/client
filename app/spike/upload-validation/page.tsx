'use client';

/**
 * FE Spike ④ — 업로드 파일 사전 판독 (N1, 9월 기준)
 *
 * 이 파일이 왜 필요한가
 *   File API + createImageBitmap 만으로 브라우저에서 업로드 파일을
 *   서버로 보내기 전에 안전하게 사전 판독할 수 있는지 확인하는 개발용 검증 화면입니다.
 *   S2 프로덕션 UI가 아니고, 기존 N1(app/jobs/new)의 업로드 로직도 건드리지 않습니다.
 *
 * 9월 PRD v3.3 N1 기준 (이 Spike가 확정하는 범위)
 *   - JPG / PNG 만 업로드 허용, 그 외 포맷은 차단
 *   - File.type·확장자는 신뢰하지 않고 magic bytes(signature)로 실제 포맷 판별
 *   - 해상도 / 용량 / 색공간은 이번에 차단 기준으로 쓰지 않는다 (F-CH-04, 12월 범위)
 *     → width/height/size는 "측정값"으로만 표시하고 임의의 상한/하한을 만들지 않는다.
 *
 * 실제 판독 로직은 lib/spike/upload-validation.ts 에 있습니다.
 */

import { useEffect, useRef, useState } from 'react';
import { validateFile, type Verdict, type ValidationResult } from '@/lib/spike/upload-validation';

interface Row {
  id: string;
  file: File;
  previewUrl: string;
  status: 'pending' | 'done';
  result: ValidationResult | null;
}

const VERDICT_STYLE: Record<Verdict, string> = {
  PASS: 'bg-green-100 text-green-700',
  UNSUPPORTED_FORMAT: 'bg-gray-200 text-gray-700',
  SIGNATURE_MISMATCH: 'bg-orange-100 text-orange-700',
  DECODE_FAILED: 'bg-red-100 text-red-700',
};

function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString('ko-KR')} B`;
}

function formatMB(sizeMB: number): string {
  return `${sizeMB.toFixed(2)} MB`;
}

function formatMs(ms: number | null): string {
  if (ms === null) return '-';
  return `${ms.toFixed(1)} ms`;
}

let rowSeq = 0;

export default function UploadValidationSpikePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 언마운트 시점에 살아있는 모든 preview URL을 revoke 하기 위한 참조
  const previewUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const urls = previewUrlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const addFiles = (files: File[]) => {
    if (files.length === 0) return;

    const newRows: Row[] = files.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.add(previewUrl);
      rowSeq += 1;
      return {
        id: `row_${rowSeq}_${file.name}`,
        file,
        previewUrl,
        status: 'pending',
        result: null,
      };
    });

    setRows((prev) => [...prev, ...newRows]);

    // 파일별로 독립 실행 — 하나가 실패해도 다른 파일 처리를 막지 않는다
    newRows.forEach((row) => {
      validateFile(row.file).then((result) => {
        setRows((prev) =>
          prev.map((r) => (r.id === row.id ? { ...r, status: 'done', result } : r)),
        );
      });
    });
  };

  const removeRow = (id: string) => {
    setRows((prev) => {
      const target = prev.find((r) => r.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        previewUrlsRef.current.delete(target.previewUrl);
      }
      return prev.filter((r) => r.id !== id);
    });
  };

  const clearAll = () => {
    rows.forEach((r) => {
      URL.revokeObjectURL(r.previewUrl);
      previewUrlsRef.current.delete(r.previewUrl);
    });
    setRows([]);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    addFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    addFiles(files);
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <div className="flex items-center gap-2">
            <span className="rounded bg-gray-700 px-2 py-0.5 text-xs font-bold text-white">
              SPIKE
            </span>
            <h1 className="text-lg font-semibold text-gray-800">
              업로드 파일 사전 판독 (N1, 9월 기준)
            </h1>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            File API + createImageBitmap 검증용 개발 화면입니다. 실제 N1 화면과 연결되어 있지 않습니다.
          </p>
        </header>

        {/* 정책 안내 박스 */}
        <div className="rounded border border-gray-300 bg-white p-4 text-xs text-gray-600">
          <p className="font-semibold text-gray-700">9월 N1 판정 기준</p>
          <ul className="mt-1.5 list-inside list-disc space-y-0.5">
            <li>JPG / PNG만 업로드 허용 (magic bytes 기준, File.type/확장자는 신뢰하지 않음)</li>
            <li>해상도 차단: 없음 (측정값만 표시)</li>
            <li>용량 차단: 없음 (측정값만 표시)</li>
            <li>색공간 검사: 미검사 (F-CH-04, 12월 범위)</li>
          </ul>
        </div>

        {/* 업로드 영역 */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setIsDragOver(false);
          }}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed p-10 text-center transition-colors ${
            isDragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-gray-200'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={handleFileInputChange}
          />
          <p className="text-sm font-medium text-gray-600">
            파일을 드래그하거나 클릭해서 선택하세요
          </p>
          <p className="mt-1 text-xs text-gray-400">
            accept는 image/jpeg,image/png 이지만 실제 판정은 magic bytes로 합니다.
          </p>
        </div>

        {rows.length > 0 && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">{rows.length}개 파일</p>
            <button
              type="button"
              onClick={clearAll}
              className="rounded border border-gray-300 bg-white px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
            >
              전체 지우기
            </button>
          </div>
        )}

        {/* 결과 목록 */}
        <div className="space-y-3">
          {rows.map((row) => (
            <ResultCard key={row.id} row={row} onRemove={() => removeRow(row.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ResultCard({ row, onRemove }: { row: Row; onRemove: () => void }) {
  const { file, previewUrl, status, result } = row;

  return (
    <div className="flex gap-4 rounded border border-gray-300 bg-white p-4">
      {/* 썸네일 */}
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded bg-gray-200">
        {/* eslint-disable-next-line @next/next/no-img-element -- 로컬 blob URL 미리보기, next/image 최적화 대상 아님 */}
        <img src={previewUrl} alt={file.name} className="h-full w-full object-cover" />
      </div>

      {/* 정보 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-gray-800" title={file.name}>
            {file.name}
          </span>
          {status === 'pending' && (
            <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">
              판독 중...
            </span>
          )}
          {result && (
            <span
              className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold ${VERDICT_STYLE[result.verdict]}`}
            >
              {result.verdict}
            </span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 text-xs text-gray-400 hover:text-red-500"
          >
            삭제
          </button>
        </div>

        {result && (
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 sm:grid-cols-4">
            <Field label="extension" value={result.extension || '(없음)'} />
            <Field label="File.type" value={result.mimeType || '(없음)'} />
            <Field label="size bytes" value={formatBytes(result.sizeBytes)} />
            <Field label="size MB" value={formatMB(result.sizeMB)} />
            <Field label="lastModified" value={new Date(result.lastModified).toLocaleString('ko-KR')} />
            <Field label="실제 판독 포맷" value={result.actualFormat} />
            <Field label="width" value={result.width !== null ? `${result.width}px` : '-'} />
            <Field label="height" value={result.height !== null ? `${result.height}px` : '-'} />
            <Field label="decode 시간" value={formatMs(result.decodeMs)} />
            <Field label="색공간" value="미검사" />
            <Field
              label="extension/MIME 불일치"
              value={result.extensionMismatch ? '예' : '아니오'}
            />
            {result.failureReason && (
              <div className="col-span-2 sm:col-span-4">
                <span className="text-gray-400">실패 사유: </span>
                <span className="text-red-600">{result.failureReason}</span>
              </div>
            )}
          </dl>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="truncate">
      <span className="text-gray-400">{label}: </span>
      <span className="text-gray-700">{value}</span>
    </div>
  );
}
