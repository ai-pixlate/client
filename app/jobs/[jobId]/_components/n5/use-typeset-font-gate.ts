'use client';

import { useCallback, useEffect, useState } from 'react';

import { checkTypesetFontReady } from '@/lib/n5/typeset-measurement';
import type { TypesetServerStyle } from '@/lib/n5/typeset-rules';

// ─────────────────────────────────────────────────────────────────
// 서버 style 의 fontFamily·fontWeight 가 실제로 준비됐는지(typeset-measurement 의 font gate 와 같은 확인).
// 준비되지 않은 글꼴로는 HTML 조판·Auto Height 측정을 하지 않는다 — 시스템 대체 글꼴로 조용히 그리지 않는다.
// 확인 전·실패면 false 이고, 그동안 화면은 서버 결과 이미지로 남는다.
// ─────────────────────────────────────────────────────────────────

const fontKey = (style: Pick<TypesetServerStyle, 'fontFamily' | 'fontWeight'>) => `${style.fontFamily}|${style.fontWeight}`;

export type TypesetFontGate = (style: Pick<TypesetServerStyle, 'fontFamily' | 'fontWeight'>) => boolean;

export function useTypesetFontGate(styles: readonly Pick<TypesetServerStyle, 'fontFamily' | 'fontWeight'>[]): TypesetFontGate {
  const [ready, setReady] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const wanted = [...new Set(styles.map(fontKey))].sort();
  const wantedKey = wanted.join('\n');

  useEffect(() => {
    if (!wantedKey) return;
    let cancelled = false;
    const check = async () => {
      const entries = await Promise.all(
        wantedKey.split('\n').map(async (key) => {
          const [family, weight] = key.split('|');
          const result = await checkTypesetFontReady(document, family, [Number(weight)]);
          return [key, result.ok] as const;
        }),
      );
      if (cancelled) return;
      setReady((prev) => {
        if (entries.every(([key, ok]) => prev.get(key) === ok)) return prev;
        const next = new Map(prev);
        for (const [key, ok] of entries) next.set(key, ok);
        return next;
      });
    };
    void check();
    // 글꼴이 늦게 오면 로딩이 끝날 때 다시 확인한다
    document.fonts.addEventListener('loadingdone', check);
    return () => {
      cancelled = true;
      document.fonts.removeEventListener('loadingdone', check);
    };
  }, [wantedKey]);

  return useCallback((style) => ready.get(fontKey(style)) === true, [ready]);
}
