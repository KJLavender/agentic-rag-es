# app 和 MCP retrieval server 共用一個 image，用不同的指令啟動
FROM node:22-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 在 Linux 上從原始碼編譯
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# rerank 模型在 build 時下載進 image：執行時 MCP 容器不需要外網
RUN npx vite build && RERANK_CACHE=/app/models npx tsx scripts/fetch-rerank-model.ts && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production RERANK_CACHE=/app/models RERANK_OFFLINE=1 DOCS_DIR=/app/data/docs
# LibreOffice（headless）把 PPTX / DOCX 轉成 PDF 才能擷取每頁截圖；Noto CJK 讓中文投影片正確顯示
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-impress-nogui libreoffice-writer-nogui fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/web/dist web/dist
COPY --from=build /app/models models
COPY src src
COPY scripts scripts
COPY corpus corpus
COPY eval eval
# SQLite 放在 volume；先建好目錄給 node 使用者
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8787 8788
CMD ["node", "--import", "tsx", "src/server/index.ts"]
