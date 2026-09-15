# syntax=docker/dockerfile:1

# --- Stage 1: build (monorepo) ---
FROM node:20-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm install

COPY packages/core packages/core
COPY apps/web apps/web

RUN npm run build --workspace packages/core
RUN npm run build --workspace apps/web

# --- Stage 2: runtime (statico servito da nginx) ---
FROM nginx:1.27-alpine AS runtime

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 5173
