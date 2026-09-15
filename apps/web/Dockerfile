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

# Hardening: gira come utente non privilegiato invece di root. L'immagine
# nginx:alpine include gia' l'utente/gruppo "nginx" (creato dal pacchetto),
# qui gli si da' solo il possesso delle directory che nginx deve poter
# scrivere a runtime (cache, log, pid) oltre ai file statici serviti.
# La porta 5173 e' > 1024 quindi puo' comunque essere aperta da un processo
# non-root.
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /etc/nginx/conf.d && \
    chown -R nginx:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && chown nginx:nginx /var/run/nginx.pid

USER nginx

EXPOSE 5173
