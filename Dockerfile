# FE 컨테이너 — 외부 백엔드(AWS ALB)에 붙는 실서버 연동용.
# `next build` + `next start` 방식이며 npm(package-lock.json) 기준이다.
#
# 아래 값은 "빌드 시점"에 굳는다 (그래서 ARG로만 받는다). runtime env를 바꿔도 반영되지 않는다.
#  - BACKEND_ORIGIN: next.config.ts의 rewrites()가 build 때 평가되어 routes-manifest에 기록된다.
#  - NEXT_PUBLIC_API_MOCKING: client 번들에 문자열로 치환된다.
#  - NEXT_PUBLIC_AUTH_MODE: client 번들에 문자열로 치환된다. `session`이면 실서버 session/social 인증을 켜고,
#    비우면(기본) 기존 dev-login을 쓴다. 인증 방식을 바꾸려면 다시 빌드해야 한다.
#  - NEXT_PUBLIC_PIXLATE_FE_REVISION: 빌드 대상 commit 의 전체 40자 SHA. 내부 렌더 경로(/internal/typeset-render)가
#    <html data-fe-revision> 으로 노출해 BE 가 bundleId(fe-<SHA>)와 대조한다. 예: --build-arg NEXT_PUBLIC_PIXLATE_FE_REVISION=$(git rev-parse HEAD)
# secret은 넣지 않는다. (이 값들은 공개 가능한 설정값이다.)
# 내부 렌더 토큰 PIXLATE_INTERNAL_RENDER_TOKEN 은 secret 이므로 ARG/ENV 로 두지 않는다 — 컨테이너 실행 시 runtime env 로만 주입한다.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
ARG BACKEND_ORIGIN
ARG NEXT_PUBLIC_API_MOCKING=disabled
ARG NEXT_PUBLIC_AUTH_MODE
ARG NEXT_PUBLIC_PIXLATE_FE_REVISION
# 비어 있으면 data-fe-revision 을 노출하지 않는다(내부 렌더 대조 불가). 값이 있으면 소문자 전체 40자 SHA 가 아니면 빌드를 멈춘다(짧은 SHA·태그 금지)
RUN if [ -n "$NEXT_PUBLIC_PIXLATE_FE_REVISION" ] && ! echo "$NEXT_PUBLIC_PIXLATE_FE_REVISION" | grep -Eq '^[0-9a-f]{40}$'; then \
      echo "NEXT_PUBLIC_PIXLATE_FE_REVISION must be a full lowercase 40-char commit SHA" >&2; exit 1; fi
ENV BACKEND_ORIGIN=${BACKEND_ORIGIN} \
    NEXT_PUBLIC_API_MOCKING=${NEXT_PUBLIC_API_MOCKING} \
    NEXT_PUBLIC_AUTH_MODE=${NEXT_PUBLIC_AUTH_MODE} \
    NEXT_PUBLIC_PIXLATE_FE_REVISION=${NEXT_PUBLIC_PIXLATE_FE_REVISION} \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build /app/package.json /app/package-lock.json /app/next.config.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["npm", "run", "start"]
