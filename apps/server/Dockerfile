# syntax=docker/dockerfile:1

# --- Stage 1: build (monorepo) ---
FROM node:20-alpine AS build
# openssl richiesto dai binary engine di Prisma (schema/query engine) su
# alpine/musl, altrimenti falliscono con "Could not parse schema engine
# response" alla prima invocazione (prisma generate / migrate deploy).
RUN apk add --no-cache openssl
WORKDIR /repo

# Copia i manifest a livello di monorepo per sfruttare la cache dei layer
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm install

# Copia il resto dei sorgenti necessari alla build di core + server
COPY packages/core packages/core
COPY apps/server apps/server

RUN npm run build --workspace packages/core
# Il client Prisma va generato prima della build TypeScript del server:
# tsc si affida ai tipi generati da `@prisma/client` (altrimenti alcuni
# parametri di taskService.ts risolvono a `any` implicito e la build fallisce
# in strict mode).
RUN npm run --workspace apps/server prisma:generate
RUN npm run build --workspace apps/server

# --- Stage 2: runtime ---
FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl
WORKDIR /repo

ENV NODE_ENV=production

# Manifest per un install di produzione (solo dipendenze runtime, tutti i workspace
# perche' apps/server dipende da @my-planner/core come workspace package)
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm install --omit=dev

# Codice compilato + schema Prisma (necessario a runtime per `migrate deploy`)
# + client Prisma generato nello stage di build
COPY --from=build /repo/packages/core/dist packages/core/dist
# packages/core/package.json (copiato sopra dal sorgente, per la risoluzione
# workspace di npm) punta "main"/"types" ai sorgenti TS (src/index.ts), utile
# in sviluppo con tsx/vite che eseguono i .ts direttamente. A runtime pero'
# node deve risolvere il pacchetto compilato (dist/index.js), che è l'unica
# cosa copiata in questa immagine: qui si sovrascrive il manifest runtime.
RUN node -e "const fs=require('fs');const p='packages/core/package.json';const j=JSON.parse(fs.readFileSync(p));j.main='dist/index.js';j.types='dist/index.d.ts';j.type='module';fs.writeFileSync(p, JSON.stringify(j, null, 2));"
COPY --from=build /repo/apps/server/dist apps/server/dist
COPY --from=build /repo/apps/server/prisma apps/server/prisma
COPY --from=build /repo/node_modules/.prisma node_modules/.prisma
COPY --from=build /repo/node_modules/@prisma node_modules/@prisma

COPY apps/server/docker-entrypoint.sh apps/server/docker-entrypoint.sh
RUN chmod +x apps/server/docker-entrypoint.sh

WORKDIR /repo/apps/server

EXPOSE 3000 3100

ENTRYPOINT ["./docker-entrypoint.sh"]
