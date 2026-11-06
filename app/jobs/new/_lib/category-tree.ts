/**
 * N1 카테고리 트리 — GET /master/categories(API-MST-04) 평면 노드 배열을 parentId로 이어 트리로 만든다.
 *
 * 선택 가능한 항목(leaf)은 「하위 항목이 없는 카테고리」다 — 단계 이름(소분류)과 같은 뜻이 아니다.
 * PRD v3.5.10 F-SRC-04 ② — 소분류가 없는 중분류는 그 중분류가 최종 선택값이다.
 * leaf 판정은 isCategoryLeaf 한 곳에서만 한다. 응답의 isLeaf 플래그 대신 실제 하위 노드 유무를 본다
 * (둘이 어긋나면 하위가 있는 노드를 확정할 수 있게 되므로, 트리에서 펼칠 수 있는지가 기준이다).
 *
 * React·브라우저 API를 쓰지 않는 순수 함수라 scripts/verify-n1-category-tree.mjs가 그대로 import한다.
 */

import type { ApiCategory } from '@/lib/api/master-schema';

export interface CategoryNode {
  id: number;
  name: string;
  children: CategoryNode[];
}

/** 서버 배열 순서를 형제 순서로 유지한다. id·name이 없는 노드와 부모를 찾을 수 없는 노드는 트리에 넣지 않는다. */
export function buildCategoryTree(categories: ApiCategory[]): CategoryNode[] {
  const childrenByParent = new Map<number | null, ApiCategory[]>();
  for (const category of categories) {
    if (typeof category.id !== 'number' || !category.name) continue;
    const parentId = category.parentId ?? null;
    const siblings = childrenByParent.get(parentId);
    if (siblings) siblings.push(category);
    else childrenByParent.set(parentId, [category]);
  }

  const visited = new Set<number>();
  const build = (parentId: number | null): CategoryNode[] =>
    (childrenByParent.get(parentId) ?? []).flatMap((category) => {
      const id = category.id as number;
      // 잘못된 parentId 순환이 있어도 한 노드는 한 번만 그린다
      if (visited.has(id)) return [];
      visited.add(id);
      return [{ id, name: category.name as string, children: build(id) }];
    });

  return build(null);
}

export function isCategoryLeaf(node: CategoryNode): boolean {
  return node.children.length === 0;
}

/** 루트부터 id 노드까지의 경로. 없으면 null */
export function findCategoryPath(nodes: CategoryNode[], id: number, path: CategoryNode[] = []): CategoryNode[] | null {
  for (const node of nodes) {
    const nextPath = [...path, node];
    if (node.id === id) return nextPath;
    const found = findCategoryPath(node.children, id, nextPath);
    if (found) return found;
  }
  return null;
}

/**
 * 검색어에 맞는 leaf와 그 leaf까지의 상위만 남긴 트리. 이미 받은 GET /master/categories 데이터만 쓴다.
 * 공백을 다듬은 뒤 대소문자 없이 전체 경로(이름 포함)에 부분 일치하는지 본다. 남은 노드는 하위가 있거나 원래 leaf라
 * isCategoryLeaf 판정이 바뀌지 않는다. 검색어가 비면 트리를 그대로 돌려준다.
 */
export function filterCategoryTree(nodes: CategoryNode[], query: string): CategoryNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return nodes;
  const walk = (siblings: CategoryNode[], parents: CategoryNode[]): CategoryNode[] =>
    siblings.flatMap((node) => {
      const path = [...parents, node];
      if (isCategoryLeaf(node)) return formatCategoryPath(path).toLowerCase().includes(needle) ? [node] : [];
      const children = walk(node.children, path);
      return children.length > 0 ? [{ ...node, children }] : [];
    });
  return walk(nodes, []);
}

/** 첫 번째 가지를 leaf 바로 위까지 펼친 경로. 검색 결과를 열 때 쓰며 leaf는 사용자가 직접 고른다 */
export function firstBranchPath(nodes: CategoryNode[]): CategoryNode[] {
  const path: CategoryNode[] = [];
  let current = nodes[0];
  while (current && !isCategoryLeaf(current)) {
    path.push(current);
    current = current.children[0];
  }
  return path;
}

/** N1 필드 표시 문구 — 확정한 경로 전체(예: 스킨케어 > 크림 > 아이크림). id는 화면에 노출하지 않는다 */
export function formatCategoryPath(path: CategoryNode[]): string {
  return path.map((node) => node.name).join(' > ');
}
