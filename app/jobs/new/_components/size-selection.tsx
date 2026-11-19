'use client';

import type { ReactNode } from 'react';

import {
  SITE_OPTIONS,
  SITE_SPEC_GUIDE,
  SITE_SPEC_OPTIONS,
  type SizeChangeMode,
  type SizeSelectionAction,
  type SizeSelectionState,
  type SizeTab,
} from '../_lib/size-selection';

const SIZE_TABS: { value: SizeTab; label: string }[] = [
  { value: 'original', label: '원본 유지' },
  { value: 'change', label: '사이즈 변경' },
];

const SIZE_TAB_HELPER: Record<SizeTab, string> = {
  original: '원본 크기와 배치를 유지하고 글자만 번역해요. 규격을 바꿀 필요가 없을 때 선택하세요.',
  change: '사이트 규격에 맞게 이미지를 다시 구성해요. 크기와 배치가 원본과 달라져요.',
};

const SIZE_CHANGE_MODES: { value: SizeChangeMode; label: string }[] = [
  { value: 'site', label: '판매처 맞춤' },
  { value: 'custom', label: '커스텀' },
];

function SizeRadio({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex h-7 w-fit cursor-pointer items-center gap-2">
      <span className="relative flex size-[18px] shrink-0 items-center justify-center">
        <input
          type="radio"
          name="n1-size-change-mode"
          checked={checked}
          onChange={onChange}
          className="peer size-[18px] cursor-pointer appearance-none rounded-full border border-[#eaeaea] bg-white outline-offset-2 checked:border-[#ff6a38] focus-visible:outline-2 focus-visible:outline-[#ff6a38]"
        />
        <span className="pointer-events-none absolute hidden size-2 rounded-full bg-[#ff6a38] peer-checked:block" />
      </span>
      <span className="text-[14px] leading-[normal] tracking-[-0.01em] whitespace-nowrap text-[#171717]">{label}</span>
    </label>
  );
}

function SizeInput({ axis, label, value, onChange }: { axis: 'W' | 'H'; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex h-12 min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-[6px] border border-[#eaeaea] bg-white py-2 pr-4 pl-3 text-[12px] leading-[normal] font-light tracking-[-0.04em] text-[#999] focus-within:border-[#ff6a38]">
      <span>{axis}</span>
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 flex-1 bg-transparent text-[14px] font-normal tracking-[-0.01em] text-[#171717] outline-none"
      />
      <span>px</span>
    </label>
  );
}

/**
 * 사이즈 선택 — Figma 「사이즈선택」(1093:10288, 원본유지 · 판매처 맞춤 · 커스텀).
 * 사이즈 변경 쪽 값은 화면 상태일 뿐 서버로 보내지 않는다(_lib/size-selection.ts).
 * children은 [다음]을 막았을 때의 오류 문구 자리다.
 */
export function SizeSelection({
  state,
  dispatch,
  children,
}: {
  state: SizeSelectionState;
  dispatch: (action: SizeSelectionAction) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1" data-testid="n1-size-selection">
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
              const selected = state.tab === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  id={`n1-size-tab-${value}`}
                  aria-selected={selected}
                  onClick={() => dispatch({ type: 'selectTab', tab: value })}
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
            {SIZE_TAB_HELPER[state.tab]}
          </p>
        </div>

        {state.tab === 'change' && (
          <div role="tabpanel" aria-labelledby="n1-size-tab-change" className="flex w-full flex-col gap-3">
            <div className="flex w-full items-start">
              {SIZE_CHANGE_MODES.map(({ value, label }) => (
                <div key={value} className="min-w-0 flex-1">
                  <SizeRadio label={label} checked={state.mode === value} onChange={() => dispatch({ type: 'selectMode', mode: value })} />
                </div>
              ))}
            </div>

            {state.mode === 'site' ? (
              <>
                <div className="flex w-full flex-col gap-1">
                  <select
                    aria-label="판매처"
                    className="h-[39px] w-full appearance-none rounded-[6px] border border-[#eaeaea] bg-white bg-[url('data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%2214%22%20height=%2214%22%20fill=%22none%22%3E%3Cpath%20d=%22M3.5%205.5L7%209l3.5-3.5%22%20stroke=%22%23707070%22%20stroke-width=%221.3%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22/%3E%3C/svg%3E')] bg-[position:right_14px_center] bg-no-repeat px-[14px] text-[14px] tracking-[-0.01em] text-[#707070] outline-none focus:border-[#ff6a38]"
                  >
                    {SITE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[12px] leading-[normal] font-light tracking-[-0.04em] text-[#999]">{SITE_SPEC_GUIDE}</p>
                </div>
                <div role="radiogroup" aria-label="판매처 규격" className="flex w-full flex-wrap items-center justify-end gap-1">
                  {SITE_SPEC_OPTIONS.map((o) => {
                    const selected = state.siteSpec === o.value;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => dispatch({ type: 'selectSiteSpec', siteSpec: o.value })}
                        className={`flex h-7 items-center justify-center gap-1 rounded-[6px] border bg-white px-3 text-[12px] leading-[normal] tracking-[-0.02em] whitespace-nowrap transition-colors ${
                          selected ? 'border-[#ff6a38] text-[#ff6a38]' : 'border-[#eaeaea] text-[#171717] hover:bg-gray-50'
                        }`}
                      >
                        {o.label}
                        {o.size && <span className="font-light tracking-[-0.04em]">{o.size}</span>}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="flex w-full items-center gap-1">
                <SizeInput
                  axis="W"
                  label="가로 크기(px)"
                  value={state.customWidth}
                  onChange={(value) => dispatch({ type: 'setCustomWidth', value })}
                />
                <SizeInput
                  axis="H"
                  label="세로 크기(px)"
                  value={state.customHeight}
                  onChange={(value) => dispatch({ type: 'setCustomHeight', value })}
                />
              </div>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
