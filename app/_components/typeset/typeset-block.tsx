import type { CSSProperties } from 'react';

import { toTypesetMeasureInput, type TypesetRenderModel } from '@/lib/n5/typeset-render-model';
import { typesetBlockStyle } from '@/lib/n5/typeset-rules';

/**
 * 조판 규칙대로 블록 한 개를 DOM 으로 그린다. 표시만 하고 측정·넘침 판정은 하지 않는다(typeset-measurement 담당).
 * 가장 가까운 positioned 조상을 섹션 원점으로 삼아 1:1 원본 px 로 배치한다.
 *
 * 글자가 구워진 renderedUrl 위에 겹치면 이중 렌더가 되므로 renderInput 배경(background.url) 위에만 그린다.
 */
export function TypesetBlock({ model }: { model: TypesetRenderModel }) {
  if (model.excluded) return null;
  const style = typesetBlockStyle(toTypesetMeasureInput(model));
  if (!style) return null;
  return (
    <div data-typeset-render={model.blockId} style={style as CSSProperties}>
      {model.text}
    </div>
  );
}
