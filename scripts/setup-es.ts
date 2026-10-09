/**
 * 用 elastic superuser 建索引、發兩把最小權限的 API key，寫進 .env.local。
 * 之後 app 只用這兩把 key，superuser 密碼不會進到 app。
 *
 *   npm run es:setup             # 索引不存在才建
 *   npm run es:setup -- --recreate   # 刪掉重建（換 embedding 模型、改 mapping 時）
 */
import { Client } from "@elastic/elasticsearch";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "../src/config.js";
import { indexDefinition } from "../src/es/index.js";

const password = process.env.ELASTIC_PASSWORD;
if (!password) throw new Error("需要 .env 裡的 ELASTIC_PASSWORD");
const es = new Client({ node: config.esUrl, auth: { username: "elastic", password } });
const recreate = process.argv.includes("--recreate");

if (recreate && (await es.indices.exists({ index: config.esIndex }))) {
  await es.indices.delete({ index: config.esIndex });
  console.log(`已刪除 ${config.esIndex}`);
}
if (!(await es.indices.exists({ index: config.esIndex }))) {
  await es.indices.create({ index: config.esIndex, ...indexDefinition(config.embedDims) });
  console.log(`已建立 ${config.esIndex}（dims=${config.embedDims}）`);
} else {
  console.log(`${config.esIndex} 已存在`);
}

const keys: Record<string, { name: string; privileges: string[] }> = {
  ES_INGEST_API_KEY: { name: "rag-ingest", privileges: ["read", "write", "view_index_metadata"] },
  // MCP retrieval server 用：只能讀這一個 index
  ES_SEARCH_API_KEY: { name: "rag-search", privileges: ["read"] },
};

const lines = existsSync(".env.local")
  ? readFileSync(".env.local", "utf8").split("\n").filter((l) => l && !Object.keys(keys).some((k) => l.startsWith(`${k}=`)))
  : [];
for (const [envName, k] of Object.entries(keys)) {
  // 舊的同名 key 作廢，避免越發越多
  await es.security.invalidateApiKey({ name: k.name }).catch(() => {});
  const res = await es.security.createApiKey({
    name: k.name,
    role_descriptors: {
      [k.name]: { cluster: [], indices: [{ names: [config.esIndex], privileges: k.privileges }] },
    },
  });
  lines.push(`${envName}=${res.encoded}`);
  console.log(`已發 ${k.name}：${k.privileges.join(", ")} on ${config.esIndex}`);
}
writeFileSync(".env.local", lines.join("\n") + "\n");
console.log("API key 已寫入 .env.local（不進 git）");
