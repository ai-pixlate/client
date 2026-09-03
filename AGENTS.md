<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Communication

- 모든 응답과 설명은 한국어로 작성한다.

## Git Remote

- `origin`: https://github.com/ai-pixlate/client.git — 팀 공식 repository. pull/push/PR 기준.
- `archive`: https://github.com/fivewnzeroS2/pixlate_archive.git — 개인 백업 repository. 팀 협업 기준으로 사용하지 않는다.

## Branch

- `main`, `develop`은 직접 commit/push 금지. `develop`은 PR로만 반영한다.
- 기능 개발은 `feature/*`, 버그 수정은 `fix/*`를 사용한다.
- 브랜치명은 영어 소문자 kebab-case로 쓴다. (예: `feature/job-status-polling`)

## Commit

- 형식: `<type>: <subject>`
- type: `feat` `fix` `docs` `refactor` `chore`
- subject는 한글, 50자 이내, 마침표 없이 쓴다.
- 한 commit에는 한 가지 문제만 담는다.
- commit 전 `git status`, `git diff`, `npm run build`를 확인한다.
- 현재 작업과 관련된 파일만 stage한다. `git add .` / `git add -A`를 습관적으로 쓰지 않는다.

## Push / PR

- `origin`에 push한 뒤 동일 commit을 `archive`에도 push한다.
- `feature/*` → `develop` PR을 기본으로 한다.

## Safety

- `force push`, `reset --hard`, `clean -fd`, branch 삭제는 사용자의 명시적 요청 없이 실행하지 않는다.
- `.env`, `.env.*`, secret, API key, access token, password 등은 commit하지 않는다.
