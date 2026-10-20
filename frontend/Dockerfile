FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* values are inlined at build time.
# Local (Caddy): "/api" = same origin. Render/Vercel: full backend URL via env var.
ARG NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_WS_URL=
ARG NEXT_PUBLIC_USE_MOCK=false
ARG NEXT_PUBLIC_USE_MOCK_AUTH=false
ARG NEXT_PUBLIC_USE_MOCK_DATA=false
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    NEXT_PUBLIC_USE_MOCK=$NEXT_PUBLIC_USE_MOCK \
    NEXT_PUBLIC_USE_MOCK_AUTH=$NEXT_PUBLIC_USE_MOCK_AUTH \
    NEXT_PUBLIC_USE_MOCK_DATA=$NEXT_PUBLIC_USE_MOCK_DATA \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 3000
# Platforms like Render may override HOSTNAME with the container id; force 0.0.0.0
# PORT is read from the environment (Render sets it, local uses 3000)
CMD ["sh", "-c", "HOSTNAME=0.0.0.0 node server.js"]