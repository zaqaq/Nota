import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";

async function start() {
  const dir = mkdtempSync(join(tmpdir(), "nota-"));
  const db = openDatabase(join(dir, "nota.db"));
  let calls = 0;
  const app = buildApp({
    db,
    chat: async () => {
      calls += 1;
      return { content: "摘要", toolCalls: [] };
    },
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address();
  return {
    db,
    app,
    port,
    calls: () => calls,
    close: async () => {
      await app.close();
      db.close();
    },
  };
}

async function post(port, body) {
  const response = await fetch(`http://127.0.0.1:${port}/api/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("同一用户并发 15 次只成功 10 次，重复单号不再扣", async () => {
  const server = await start();
  try {
    const userId = "userquota1";
    const responses = await Promise.all(
      Array.from({ length: 15 }, (_item, index) =>
        post(server.port, {
          userId,
          requestId: `request${String(index).padStart(8, "0")}`,
          text: `第 ${index} 条`,
        }),
      ),
    );
    const ok = responses.filter((item) => item.status === 200);
    const limited = responses.filter((item) => item.status === 429);
    assert.equal(ok.length, 10);
    assert.equal(limited.length, 5);
    assert.equal(server.calls(), 10);

    const usage = await fetch(
      `http://127.0.0.1:${server.port}/api/usage?userId=${userId}`,
    ).then((response) => response.json());
    assert.equal(usage.count, 10);

    const replay = await post(server.port, {
      userId,
      requestId: ok[0].body.id,
      text: "同一条再传一次",
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(server.calls(), 10);

    const rejected = limited[0];
    const again = await post(server.port, {
      userId,
      requestId: `request${String(responses.indexOf(rejected)).padStart(8, "0")}`,
      text: "被拒绝的再传一次",
    });
    assert.equal(again.status, 429);
    const usageAfter = await fetch(
      `http://127.0.0.1:${server.port}/api/usage?userId=${userId}`,
    ).then((response) => response.json());
    assert.equal(usageAfter.count, 10);

    const other = await post(server.port, {
      userId: "userquota2",
      requestId: "otheruser1",
      text: "另一个用户",
    });
    assert.equal(other.status, 200);
    assert.equal(other.body.usage.count, 1);
    const firstAfterOther = await fetch(
      `http://127.0.0.1:${server.port}/api/usage?userId=${userId}`,
    ).then((response) => response.json());
    assert.equal(firstAfterOther.count, 10);
  } finally {
    await server.close();
  }
});
