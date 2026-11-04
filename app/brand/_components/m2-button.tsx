/* eslint-disable @next/next/no-img-element -- 고정 크기 Figma glyph 라 next/image 최적화 대상이 아니다 */

import type { Ref } from 'react';

/**
 * Figma Button(708:5827) 중 M2 가 쓰는 variant. 프로젝트에 공용 Button 이 없어 M2 안에서만 재현한다.
 * Figma 는 stroke 를 안쪽에 그려 border 가 크기에 포함되므로, 테두리 있는 variant 는 좌우 padding 을 1px 줄인다.
 *
 * onClick 이 없으면 미연결 버튼이다. 모습은 enabled 그대로이고 포커스도 받지만 눌러도 아무 일이 일어나지 않으며,
 * 보조기기에는 aria-disabled 로 동작이 없음을 알린다. 시각 표현은 aria-disabled 에 반응하지 않는다.
 */
const VARIANT = {
  secondary: 'border border-[#eaeaea] text-[#171717]',
  tertiary: 'text-[#171717]',
  danger: 'border border-[#e5484d] text-[#e5484d]',
} as const;

const SIZE = {
  sm: { box: 'h-[30px]', padding: { bordered: 'px-[11px]', plain: 'px-3' }, label: 'px-2' },
  xs: { box: 'h-6', padding: { bordered: 'px-[9px]', plain: 'px-[10px]' }, label: 'px-0.5' },
} as const;

export function M2Button({
  variant,
  size,
  label,
  leadingPlus = false,
  onClick,
  testId,
  buttonRef,
  box,
  className = '',
}: {
  variant: keyof typeof VARIANT;
  size: keyof typeof SIZE;
  label: string;
  leadingPlus?: boolean;
  onClick?: () => void;
  testId?: string;
  buttonRef?: Ref<HTMLButtonElement>;
  /** Figma 인스턴스가 variant 기본 크기를 덮어쓸 때 넘긴다 */
  box?: string;
  /** 배치 보정만 넘긴다 */
  className?: string;
}) {
  const { box: defaultBox, padding, label: labelClass } = SIZE[size];
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-disabled={onClick ? undefined : true}
      data-testid={testId}
      className={`box-border flex shrink-0 items-center justify-center rounded-[4px] bg-white text-[12px] leading-[14px] tracking-[-0.24px] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38] ${VARIANT[variant]} ${box ?? defaultBox} ${
        variant === 'tertiary' ? padding.plain : padding.bordered
      } ${onClick ? 'hover:bg-[#f5f5f5]' : ''} ${className}`}
    >
      {leadingPlus && (
        <span aria-hidden="true" className="relative -mr-1 block size-3.5 shrink-0 overflow-hidden">
          <span className="absolute inset-[20%] block">
            <span className="absolute inset-[-5.95%] block">
              <img alt="" src="/brand/icons/plus-14.svg" className="block size-full max-w-none" />
            </span>
          </span>
        </span>
      )}
      <span className={labelClass}>{label}</span>
    </button>
  );
}
