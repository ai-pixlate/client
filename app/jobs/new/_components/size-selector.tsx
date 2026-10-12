import { ChevronDownGlyph14, RadioGlyph18 } from './n1-glyphs';

// N1 사이즈 선택 — Figma component set "사이즈선택"(1093:10288)의 3 variant를 하나의 상태로 그린다.
//   Property 1=원본유지   (1093:10279) 472×32  — Tabs만
//   Property 1=커스텀     (1093:10290) 472×140 — Tabs / Radio(커스텀) / W·H Number Input(48)
//   Property 1=판매처 맞춤 (1093:10289) 472×189 — Tabs / Radio(판매처 맞춤) / 판매처 Select + helper / Tag
// 선택된 variant만 렌더한다(숨긴 UI가 높이를 차지하지 않는다). 커스텀 값과 판매처 값은 별도 필드라
// 서로 덮어쓰지 않고, 탭·radio를 오가도 각자 유지된다.
//
// 계약: SpecType은 "9월은 original 고정"이고 JobCreate/JobPatch에 커스텀 W/H 필드가 없다. 판매처 등급
// (Premium A+ 등)·치수도 계약에 없다. 따라서 이 선택은 FE 화면 상태이며 제출 payload(specId)에는
// 반영하지 않는다 — 계약이 정해지면 page.tsx의 handleSubmit에서 연결한다.

export type SizeTab = 'original' | 'resize';
export type ResizeMode = 'custom' | 'channel';

export interface SizeSelection {
  tab: SizeTab;
  resizeMode: ResizeMode;
  customWidth: string;
  customHeight: string;
  channel: string;
  channelTier: string | null;
}

/**
 * 판매처 맞춤 variant의 Figma 예시 값(1093:10289) — 판매처·등급·치수 계약(ChannelSpec에 등급/치수 없음)이
 * 없어 화면 표시용으로만 둔다. 서버 데이터가 아니며 제출되지 않는다.
 */
const CHANNEL_PRESETS = [
  {
    value: 'amazon',
    label: '아마존',
    helper: '베이직(기본 등록) : 최소 500px(짧은 변 기준) ~ 최대 10,000px(긴 변 기준)',
    tiers: [
      { id: 'premium-a-plus', name: 'Premium A+', dims: '(1464 x 600)' },
      { id: 'basic-a-plus', name: 'Basic A+', dims: '(970 x 300)' },
      { id: 'basic', name: 'Basic', dims: null },
    ],
  },
] as const;

export const INITIAL_SIZE_SELECTION: SizeSelection = {
  // 현재 제출 계약(original 고정)과 같은 "원본 유지"에서 시작한다.
  tab: 'original',
  resizeMode: 'custom',
  customWidth: '',
  customHeight: '',
  // 판매처 맞춤 variant를 처음 열었을 때의 모습은 Figma 예시(아마존 · Basic A+ 선택)를 따른다.
  channel: 'amazon',
  channelTier: 'basic-a-plus',
};

export function SizeSelector({ value, onChange }: { value: SizeSelection; onChange: (next: SizeSelection) => void }) {
  const set = (patch: Partial<SizeSelection>) => onChange({ ...value, ...patch });
  const channel = CHANNEL_PRESETS.find((c) => c.value === value.channel) ?? CHANNEL_PRESETS[0];

  return (
    <div data-testid="n1-size-selector" data-variant={value.tab === 'original' ? 'original' : value.resizeMode} className="flex w-full flex-col gap-4 bg-white">
      <div role="tablist" aria-label="사이즈 선택" className="flex w-full items-center">
        <SizeTabButton label="원본 유지" selected={value.tab === 'original'} onSelect={() => set({ tab: 'original' })} testId="n1-size-tab-original" />
        <SizeTabButton label="사이즈 변경" selected={value.tab === 'resize'} onSelect={() => set({ tab: 'resize' })} testId="n1-size-tab-resize" />
      </div>

      {value.tab === 'resize' && (
        <div className="flex w-full flex-col gap-4">
          <div role="radiogroup" aria-label="사이즈 변경 방식" className="flex items-center px-2">
            <SizeRadio label="커스텀" name="n1-resize-mode" checked={value.resizeMode === 'custom'} onSelect={() => set({ resizeMode: 'custom' })} testId="n1-resize-custom" />
            <SizeRadio label="판매처 맞춤" name="n1-resize-mode" checked={value.resizeMode === 'channel'} onSelect={() => set({ resizeMode: 'channel' })} testId="n1-resize-channel" />
          </div>

          {value.resizeMode === 'custom' ? (
            <div className="flex w-full items-center gap-1">
              <NumberInput axis="W" value={value.customWidth} onChange={(v) => set({ customWidth: v })} testId="n1-size-width" />
              <NumberInput axis="H" value={value.customHeight} onChange={(v) => set({ customHeight: v })} testId="n1-size-height" />
            </div>
          ) : (
            <div className="flex w-full flex-col items-end gap-3">
              <div className="flex w-full flex-col gap-1">
                <label className="relative flex w-full items-center">
                  <span className="sr-only">판매처</span>
                  <select
                    value={value.channel}
                    onChange={(e) => set({ channel: e.target.value })}
                    data-testid="n1-size-channel"
                    className="w-full appearance-none rounded-[6px] border border-[#eaeaea] bg-white py-[10px] pr-[38px] pl-[14px] text-[14px] leading-[17px] tracking-[-0.14px] text-[#707070] outline-none focus:border-[#ff6a38]"
                  >
                    {CHANNEL_PRESETS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute top-1/2 right-[14px] -translate-y-1/2">
                    <ChevronDownGlyph14 />
                  </span>
                </label>
                <p className="text-[12px] leading-[14px] font-light tracking-[-0.48px] text-[#999]">{channel.helper}</p>
              </div>
              <div className="flex items-center gap-1" role="group" aria-label="판매처 규격">
                {channel.tiers.map((tier) => {
                  const selected = value.channelTier === tier.id;
                  return (
                    <button
                      key={tier.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => set({ channelTier: tier.id })}
                      data-testid={`n1-size-tier-${tier.id}`}
                      className={`flex h-7 shrink-0 items-center justify-center rounded-[6px] border bg-white px-3 text-[12px] leading-[14px] tracking-[-0.24px] whitespace-nowrap ${
                        selected ? 'border-[#ff6a38] text-[#ff6a38]' : 'border-[#eaeaea] text-[#171717]'
                      }`}
                    >
                      {tier.name}
                      {tier.dims && <span className="ml-[3px] font-light tracking-[-0.48px]">{tier.dims}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Tabs(28:94) — h32, 16 Regular −0.48. 선택: #171717 + 아래 orange 2px(폭 56), 비선택: #707070. */
function SizeTabButton({ label, selected, onSelect, testId }: { label: string; selected: boolean; onSelect: () => void; testId: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      data-testid={testId}
      className={`relative h-8 min-w-0 flex-1 pb-[3px] text-center text-[16px] leading-[19px] tracking-[-0.48px] ${selected ? 'text-[#171717]' : 'text-[#707070]'}`}
    >
      {label}
      {selected && <span data-testid={`${testId}-underline`} aria-hidden="true" className="absolute bottom-0 left-1/2 h-[2px] w-14 -translate-x-1/2 bg-[#ff6a38]" />}
    </button>
  );
}

/** Radio(28:88) — 92×28, 18 glyph + gap 8 + 14 Regular −0.14. */
function SizeRadio({ label, name, checked, onSelect, testId }: { label: string; name: string; checked: boolean; onSelect: () => void; testId: string }) {
  return (
    <label className="relative flex h-7 w-[92px] shrink-0 cursor-pointer items-center gap-2">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        data-testid={testId}
        className="peer absolute top-1/2 left-0 size-[18px] -translate-y-1/2 cursor-pointer opacity-0"
      />
      <span className="pointer-events-none rounded-full peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#ff6a38]">
        <RadioGlyph18 selected={checked} />
      </span>
      <span className="text-[14px] leading-[17px] tracking-[-0.14px] whitespace-nowrap text-[#171717]">{label}</span>
    </label>
  );
}

/** Number Input(384:3820) — h48, pl 12 / pr 16, gap 8: 축(12 Light #999) · 값(14 #171717) · px(12 Light #999). */
function NumberInput({ axis, value, onChange, testId }: { axis: 'W' | 'H'; value: string; onChange: (v: string) => void; testId: string }) {
  return (
    <label className="flex h-12 min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-[6px] border border-[#eaeaea] bg-white pr-4 pl-3 focus-within:border-[#ff6a38]">
      <span className="shrink-0 text-[12px] font-light tracking-[-0.48px] text-[#999]">{axis}</span>
      <input
        type="text"
        inputMode="numeric"
        aria-label={axis === 'W' ? '가로(px)' : '세로(px)'}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
        data-testid={testId}
        className="min-w-0 flex-1 bg-transparent text-[14px] leading-[17px] tracking-[-0.14px] text-[#171717] outline-none"
      />
      <span className="shrink-0 text-[12px] font-light tracking-[-0.48px] text-[#999]">px</span>
    </label>
  );
}
