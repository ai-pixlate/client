# FE 컨테이너 — 외부 백엔드(AWS ALB)에 붙는 실서버 연동용.
# `next build` + `next start` 방식이며 npm(package-lock.json) 기준이다.
#
# 아래 두 값은 "빌드 시점"에 굳는다 (그래서 ARG로만 받는다).
#  - BACKEND_ORIGIN: next.config.ts의 rewrites()가 build 때 평가되어 routes-manifest에 기록된다.
#  - NEXT_PUBLIC_API_MOCKING: client 번들에 문자열로 치환된다.
# secret은 넣지 않는다. (이 두 값은 공개 가능한 설정값이다.)

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
ARG BACKEND_ORIGIN
ARG NEXT_PUBLIC_API_MOCKING=disabled
ENV BACKEND_ORIGIN=${BACKEND_ORIGIN} \
    NEXT_PUBLIC_API_MOCKING=${NEXT_PUBLIC_API_MOCKING} \
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
