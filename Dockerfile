# app 和 MCP retrieval server 共用一個 image，用不同的指令啟動
FROM node:22-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 在 Linux 上從原始碼編譯
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx vite build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/web/dist web/dist
COPY src src
COPY scripts scripts
COPY corpus corpus
COPY eval eval
# SQLite 和 rerank 模型快取放在 volume；先建好目錄給 node 使用者
RUN mkdir -p /app/data/models && chown -R node:node /app/data
USER node
EXPOSE 8787 8788
CMD ["node", "--import", "tsx", "src/server/index.ts"]
