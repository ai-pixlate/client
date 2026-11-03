'use client';

import { useState } from 'react';

type SizeTab = 'original' | 'change';

const SIZE_TABS: { value: SizeTab; label: string }[] = [
  { value: 'original', label: '원본 유지' },
  { value: 'change', label: '사이즈 변경' },
];

const SIZE_TAB_HELPER: Record<SizeTab, string> = {
  original: '원본 크기와 배치를 유지하고 글자만 번역해요. 규격을 바꿀 필요가 없을 때 선택하세요.',
  change: '사이트 규격에 맞게 이미지를 다시 구성해요. 크기와 배치가 원본과 달라져요.',
};

function DisabledRadio({ label }: { label: string }) {
  return (
    <label className="flex h-7 w-fit cursor-not-allowed items-center gap-2">
      <input
        type="radio"
        name="n1-size-change-mode"
        disabled
        className="size-[18px] cursor-not-allowed appearance-none rounded-full border border-[#eaeaea] bg-white"
      />
      <span className="text-[14px] leading-[normal] tracking-[-0.01em] text-[#999]">{label}</span>
    </label>
  );
}

function DisabledSizeInput({ axis, label }: { axis: 'W' | 'H'; label: string }) {
  return (
    <label className="flex h-12 min-w-0 flex-1 cursor-not-allowed items-center gap-2 overflow-hidden rounded-[6px] border border-[#eaeaea] bg-white py-2 pr-4 pl-3 text-[12px] leading-[normal] font-light tracking-[-0.04em] text-[#999]">
      <span>{axis}</span>
      <input
        type="number"
        disabled
        aria-label={label}
        placeholder="80"
        className="w-full min-w-0 flex-1 cursor-not-allowed bg-transparent text-[14px] font-normal tracking-[-0.01em] outline-none placeholder:text-[#999]"
      />
      <span>px</span>
    </label>
  );
}

/**
 * 사이즈 선택 — Figma 「사이즈선택」(1093:10288, 원본유지 · 판매처 맞춤 · 커스텀).
 *
 * OpenAPI JobPatch.specType은 「1.0.0은 original만 사용」이라 이 컴포넌트의 탭은 화면 표시 상태일 뿐
 * 서버로 가는 값이 아니다(N1 제출은 항상 specType 'original'). 그래서 값을 부모로 올리지 않는다.
 * 사이즈 변경 탭은 Figma 구조를 보여주되 판매처 맞춤·커스텀·W/H를 모두 비활성으로 두고,
 * Figma에 없는 준비 중 안내를 덧붙여 원본 유지로 진행된다는 사실을 숨기지 않는다.
 */
export function SizeSelection() {
  const [tab, setTab] = useState<SizeTab>('original');

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-2 leading-[normal]">
        <p id="n1-size-label" className="text-[16px] tracking-[-0.03em] text-[#171717]">
          사이즈 선택
        </p>
        <span className="text-[18px] font-medium tracking-[-0.03em] text-[#ff6a38]">*</span>
      </div>

      <div className="flex w-full flex-col gap-4">
        <div className="flex w-full flex-col items-center gap-2">
          <div role="tablist" aria-labelledby="n1-size-label" className="flex w-full items-center" data-testid="n1-size-tabs">
            {SIZE_TABS.map(({ value, label }) => {
              const selected = tab === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  id={`n1-size-tab-${value}`}
                  aria-selected={selected}
                  aria-controls="n1-size-panel"
                  onClick={() => setTab(value)}
                  className={`relative flex h-8 min-w-0 flex-1 justify-center pt-1 text-[16px] leading-[normal] tracking-[-0.03em] ${
                    selected ? 'text-[#171717]' : 'text-[#707070]'
                  }`}
                >
                  {label}
                  {selected && (
                    <span
                      data-testid="n1-size-tab-underline"
                      aria-hidden="true"
                      className="absolute bottom-0 left-1/2 h-0.5 w-14 -translate-x-1/2 bg-[#ff6a38]"
                    />
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-center text-[12px] leading-[normal] font-light tracking-[-0.04em] break-keep text-[#707070]">
            {SIZE_TAB_HELPER[tab]}
          </p>
        </div>

        {tab === 'change' && (
          <div
            id="n1-size-panel"
            role="tabpanel"
            aria-labelledby="n1-size-tab-change"
            className="flex w-full flex-col gap-3"
          >
            <div className="flex w-full items-start">
              <div className="min-w-0 flex-1">
                <DisabledRadio label="판매처 맞춤" />
              </div>
              <div className="min-w-0 flex-1">
                <DisabledRadio label="커스텀" />
              </div>
            </div>
            <div className="flex w-full items-center gap-1">
              <DisabledSizeInput axis="W" label="가로 크기(px)" />
              <DisabledSizeInput axis="H" label="세로 크기(px)" />
            </div>
            <p data-testid="n1-size-change-notice" className="text-[12px] leading-[normal] font-light tracking-[-0.04em] text-[#999]">
              사이즈 변경은 준비 중이에요. 지금은 원본 유지로 진행돼요.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
