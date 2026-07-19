# ---- build stage -----------------------------------------------------------
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY app/package.json app/
RUN pnpm install --frozen-lockfile

COPY shared shared
COPY server server
COPY app app
RUN pnpm --filter @spots/shared build \
 && pnpm --filter @spots/app build \
 && pnpm --filter @spots/server build \
 && pnpm --filter @spots/server --prod deploy /out/server

# ---- runtime stage ----------------------------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /srv

COPY --from=build /out/server /srv
COPY --from=build /repo/app/build /srv/app

ENV APP_DIR=/srv/app \
    PHOTOS_DIR=/data/photos \
    PORT=8080

EXPOSE 8080
VOLUME /data/photos

CMD ["node", "dist/index.js"]
