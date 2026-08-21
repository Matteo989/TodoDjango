# ─── Dépendances ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# openssl est requis par le moteur de requêtes Prisma sur les images slim.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

# ─── Build ───────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next lit l'environnement au build; une valeur factice suffit car aucune
# connexion n'est ouverte pendant la compilation.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV AUTH_SECRET="build-time-placeholder-secret-value"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

# ─── Exécution ───────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# ffmpeg est le moteur de montage; fonts-dejavu fournit la police des
# incrustations et des sous-titres brûlés.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg openssl fonts-dejavu-core ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 iavid && useradd --system --uid 1001 --gid iavid iavid

COPY --from=builder /app/public ./public
COPY --from=builder --chown=iavid:iavid /app/.next/standalone ./
COPY --from=builder --chown=iavid:iavid /app/.next/static ./.next/static

# Le worker et les migrations tournent depuis les sources TypeScript.
COPY --from=builder --chown=iavid:iavid /app/node_modules ./node_modules
COPY --from=builder --chown=iavid:iavid /app/prisma ./prisma
COPY --from=builder --chown=iavid:iavid /app/src ./src
COPY --from=builder --chown=iavid:iavid /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=iavid:iavid /app/package.json ./package.json

RUN mkdir -p /app/storage && chown -R iavid:iavid /app/storage
VOLUME ["/app/storage"]

USER iavid
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
