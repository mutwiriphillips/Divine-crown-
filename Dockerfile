# One image for both the web app and the background worker.
#   docker build -t herbal-shop .
#   docker run --env-file .env -p 3000:3000 herbal-shop              # web
#   docker run --env-file .env herbal-shop npm run worker             # worker
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 1001 shop && mkdir -p /app/storage && chown shop /app/storage
COPY --from=build --chown=shop /app ./
USER shop
EXPOSE 3000
CMD ["npm", "start"]
