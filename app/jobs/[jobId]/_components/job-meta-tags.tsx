import type { JobMetaViewModel } from '@/lib/n5/adapter';

/**
 * 작업 조건 표시(Figma 「N3 섹션 상단」 1507:21672) — 국가 글자 + 태그(규제 분류 · 카테고리). N3 목록 위·N5 workspace 좌상단이 같이 쓴다.
 * 실제 값이 있는 항목만 그린다. 판매 채널(Figma 표본 「아마존」)은 FE 에 채널 이름을 얻는 계약이 없어 그리지 않는다.
 */
export function JobMetaTags({ meta, testId, className = '' }: { meta: JobMetaViewModel; testId: string; className?: string }) {
  const tags = [meta.regulatoryClassLabel, meta.categoryLabel].filter((label): label is string => !!label);
  if (!meta.countryLabel && tags.length === 0) return null;
  return (
    <div data-testid={testId} className={`flex items-center gap-3 ${className}`}>
      {meta.countryLabel && <p className="text-[12px] leading-[normal] tracking-[-0.02em] whitespace-nowrap text-black">{meta.countryLabel}</p>}
      {tags.length > 0 && (
        <div className="flex items-center gap-0.5">
          {tags.map((label) => (
            <span
              key={label}
              className="flex h-7 items-center justify-center rounded-[6px] border border-[#eaeaea] bg-white px-2 text-[12px] leading-[14px] whitespace-nowrap text-[#171717]"
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
