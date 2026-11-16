import type { JobMetaViewModel } from '@/lib/n5/adapter';

/**
 * 작업 조건 표시(Figma 「N3 섹션 상단」 1507:21672 · N3 1759:11536) — 국가 · 판매 채널은 12px 글자, 규제 분류 · 카테고리는 태그.
 * 순서는 Figma 그대로(미국 · 아마존 · [OTC 의약품] [선크림]). N3 목록 위·N5 workspace 좌상단이 같이 쓴다.
 * 실제 값이 있는 항목만 그린다 — 채널은 Job.channelSpecId 를 GET /master/channel-specs 의 name 으로 찾고, 못 찾으면 생략한다.
 */
export function JobMetaTags({ meta, testId, className = '' }: { meta: JobMetaViewModel; testId: string; className?: string }) {
  const tags = [meta.regulatoryClassLabel, meta.categoryLabel].filter((label): label is string => !!label);
  const texts = [meta.countryLabel, meta.channelLabel].filter((label): label is string => !!label);
  if (texts.length === 0 && tags.length === 0) return null;
  return (
    <div data-testid={testId} className={`flex items-center gap-3 ${className}`}>
      {texts.map((label) => (
        <p key={label} className="text-[12px] leading-[normal] tracking-[-0.02em] whitespace-nowrap text-black">
          {label}
        </p>
      ))}
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
