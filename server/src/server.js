import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildApp } from "./app.js";
import { openDatabase } from "./db.js";
import { createChat } from "./llm.js";

loadEnv(join(process.cwd(), ".env"));

const db = openDatabase(
  process.env.DB_PATH || join(process.cwd(), "data", "nota.db"),
);
const app = buildApp({ db, chat: createChat() });
const port = Number(process.env.PORT || 3000);

await app.listen({ port, host: "0.0.0.0" });
console.log(`网页：http://127.0.0.1:${port}`);
console.log(`手机请把 App 配到这台电脑的局域网 IP，端口 ${port}`);

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
