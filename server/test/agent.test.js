import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { shanghaiDay } from "../src/day.js";
import { openDatabase } from "../src/db.js";
import { executeTool } from "../src/tools.js";

test("同一件事再次创建时改原来的记录，不另加一条", () => {
  const dir = mkdtempSync(join(tmpdir(), "nota-update-"));
  const db = openDatabase(join(dir, "nota.db"));
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO notes (id, user_id, day, text, status, created_at)
     VALUES ('noteupdate1', 'userupdate1', '2026-10-27', '约饭', 'asking', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO todos (note_id, user_id, content, created_at) VALUES ('noteupdate1', 'userupdate1', '约张总吃饭', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO reminders (note_id, user_id, content, remind_at, created_at)
     VALUES ('noteupdate1', 'userupdate1', '约张总吃饭', '2026-11-03T08:00', ?)`,
  ).run(now);
  const ctx = {
    userId: "userupdate1",
    noteId: "noteupdate1",
    now,
    priorTodoId: 1,
    priorReminderId: 1,
    replacedTodo: false,
    replacedReminder: false,
  };
  executeTool(db, ctx, "create_todo", { content: "11月4日下午约张总吃饭" });
  executeTool(db, ctx, "set_reminder", { content: "下午约张总吃饭", remind_at: "2026-11-03T08:00" });
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM todos`).get().n, 1);
  assert.equal(db.prepare(`SELECT content FROM todos`).get().content, "11月4日下午约张总吃饭");
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM reminders`).get().n, 1);
  db.close();
});

test("上海时区跨过午夜时日期跟着变", () => {
  assert.equal(shanghaiDay(new Date("2026-10-27T15:30:00Z")), "2026-10-27");
  assert.equal(shanghaiDay(new Date("2026-10-27T16:30:00Z")), "2026-10-28");
});

test("查询历史按关键词命中，并带回待办和提醒", () => {
  const dir = mkdtempSync(join(tmpdir(), "nota-search-"));
  const db = openDatabase(join(dir, "nota.db"));
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO notes (id, user_id, day, text, summary, status, created_at)
     VALUES ('histnote01', 'histuser01', '2026-10-27', '下周三下午三点约张总吃饭，提前一天提醒我', '已记下约张总吃饭', 'done', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO todos (note_id, user_id, content, created_at)
     VALUES ('histnote01', 'histuser01', '11月4日下午三点约张总吃饭', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO reminders (note_id, user_id, content, remind_at, created_at)
     VALUES ('histnote01', 'histuser01', '提前确认约饭', '2026-11-03T15:00', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO notes (id, user_id, day, text, status, created_at)
     VALUES ('histask02', 'histuser01', '2026-10-27', '下周三约张总吃饭是几点？', 'reserved', ?)`,
  ).run(now);
  const result = executeTool(
    db,
    { userId: "histuser01", noteId: "histask02", now },
    "search_history",
    { query: "下周三约张总吃饭是几点？提醒设在哪天？" },
  );
  assert.equal(result.ok, true);
  assert.ok(result.matches.length >= 1);
  assert.equal(result.matches[0].todos[0], "11月4日下午三点约张总吃饭");
  assert.equal(result.matches[0].reminders[0].remindAt, "2026-11-03T15:00");
  assert.ok(result.keywords.includes("张总"));
  db.close();
});

test("问以前的安排时，即使模型没主动查，也会先查历史再回答", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nota-recall-"));
  const db = openDatabase(join(dir, "nota.db"));
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO notes (id, user_id, day, text, summary, status, created_at)
     VALUES ('oldnote001', 'recalluser1', '2026-10-20', '下周三下午三点约张总吃饭', '已记下下午三点约张总', 'done', ?)`,
  ).run(now);
  let step = 0;
  const app = buildApp({
    db,
    chat: async () => {
      step += 1;
      if (step === 1) return { content: "我猜是晚上七点。", toolCalls: [] };
      return { content: "历史里写的是下周三下午三点约张总吃饭。", toolCalls: [] };
    },
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  try {
    const { port } = app.server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "recalluser1",
        requestId: "recallnote1",
        text: "下周三约张总吃饭是几点？",
      }),
    });
    const body = await response.json();
    assert.equal(body.trace.some((item) => item.tool === "search_history" && item.ok), true);
    assert.equal(body.summary, "历史里写的是下周三下午三点约张总吃饭。");
    assert.equal(body.todos.length, 0);
  } finally {
    await app.close();
    db.close();
  }
});

test("没有钟点的提醒不会写入", () => {
  const dir = mkdtempSync(join(tmpdir(), "nota-tool-"));
  const db = openDatabase(join(dir, "nota.db"));
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO notes (id, user_id, day, text, status, created_at)
     VALUES ('note12345', 'user12345', '2026-10-27', '约饭', 'reserved', ?)`,
  ).run(now);
  const result = executeTool(
    db,
    { userId: "user12345", noteId: "note12345", now },
    "set_reminder",
    { content: "约张总吃饭", remind_at: "下午" },
  );
  assert.equal(result.ok, false);
  const count = db.prepare(`SELECT COUNT(*) AS n FROM reminders`).get().n;
  assert.equal(count, 0);
  db.close();
});

test("Agent 会调用查询、待办和提醒，而不是只生成一段文字", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nota-agent-"));
  const db = openDatabase(join(dir, "nota.db"));
  let step = 0;
  const app = buildApp({
    db,
    chat: async () => {
      step += 1;
      if (step === 1) {
        return {
          content: "",
          toolCalls: [
            { id: "call-search", name: "search_history", arguments: { query: "报价" } },
            { id: "call-todo", name: "create_todo", arguments: { content: "回复张总报价" } },
          ],
        };
      }
      if (step === 2) {
        return {
          content: "",
          toolCalls: [
            {
              id: "call-remind",
              name: "set_reminder",
              arguments: { content: "提醒回复报价", remind_at: "2026-11-04T15:00" },
            },
          ],
        };
      }
      return { content: "下周三下午三点前回复张总报价。", toolCalls: [] };
    },
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  try {
    const { port } = app.server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "agentuser1",
        requestId: "agentnote1",
        text: "查一下报价，明天下午三点提醒我回复张总",
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.summary, "下周三下午三点前回复张总报价。");
    assert.equal(body.status, "done");
    assert.deepEqual(
      body.trace.map((item) => item.tool),
      ["search_history", "create_todo", "set_reminder"],
    );
    assert.equal(body.todos.length, 1);
    assert.equal(body.todos[0].content, "回复张总报价");
    assert.equal(body.reminders[0].remindAt, "2026-11-04T15:00");
    assert.equal(step, 3);
  } finally {
    await app.close();
    db.close();
  }
});

test("模糊安排会追问，普通待办则直接记下", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nota-ask-"));
  const db = openDatabase(join(dir, "nota.db"));
  const scripts = {
    "明天下午我要打球": [
      { content: "明天下午几点？需要我提醒你吗？", toolCalls: [] },
    ],
    "三点，要提醒": [
      {
        content: "",
        toolCalls: [
          { id: "call-todo", name: "create_todo", arguments: { content: "打球" } },
          {
            id: "call-remind",
            name: "set_reminder",
            arguments: { content: "打球", remind_at: "2026-10-28T15:00" },
          },
        ],
      },
      { content: "已记下明天下午三点打球，并设置提醒。", toolCalls: [] },
    ],
    "记得买牛奶": [
      {
        content: "",
        toolCalls: [{ id: "call-milk", name: "create_todo", arguments: { content: "买牛奶" } }],
      },
      { content: "已记下买牛奶。", toolCalls: [] },
    ],
  };
  const cursors = new Map();
  const app = buildApp({
    db,
    chat: async ({ messages }) => {
      const latest = [...messages].reverse().find((message) => message.role === "user").content;
      const steps = scripts[latest];
      const index = cursors.get(latest) || 0;
      cursors.set(latest, index + 1);
      return steps[Math.min(index, steps.length - 1)];
    },
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  try {
    const { port } = app.server.address();
    const first = await fetch(`http://127.0.0.1:${port}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "askuser001",
        requestId: "asknote001",
        text: "明天下午我要打球",
      }),
    });
    const asked = await first.json();
    assert.equal(first.status, 200);
    assert.equal(asked.status, "asking");
    assert.equal(asked.todos.length, 0);
    assert.match(asked.summary, /几点/);

    const second = await fetch(`http://127.0.0.1:${port}/api/notes/asknote001/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "askuser001", text: "三点，要提醒" }),
    });
    const done = await second.json();
    assert.equal(done.status, "done");
    assert.equal(done.todos.length, 1);
    assert.equal(done.reminders.length, 1);
    const usage = await fetch(`http://127.0.0.1:${port}/api/usage?userId=askuser001`).then((response) => response.json());
    assert.equal(usage.count, 1);

    const milk = await fetch(`http://127.0.0.1:${port}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "askuser001",
        requestId: "asknote002",
        text: "记得买牛奶",
      }),
    });
    const noted = await milk.json();
    assert.equal(noted.status, "done");
    assert.equal(noted.todos[0].content, "买牛奶");
    assert.equal(noted.messages.some((item) => item.role === "assistant" && /[？?]/.test(item.content)), false);
  } finally {
    await app.close();
    db.close();
  }
});

test("已经记下待办但仍在追问时，可以继续回复并设置提醒", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nota-continue-"));
  const db = openDatabase(join(dir, "nota.db"));
  const scripts = {
    "2点吧": [
      {
        content: "",
        toolCalls: [{ id: "call-todo", name: "create_todo", arguments: { content: "打球" } }],
      },
      { content: "记下了：明天下午2点打球。要不要提前提醒你？", toolCalls: [] },
    ],
    "要，1点40": [
      {
        content: "",
        toolCalls: [{
          id: "call-remind",
          name: "set_reminder",
          arguments: { content: "打球", remind_at: "2026-10-28T13:40" },
        }],
      },
      { content: "已设置明天13:40的提醒。", toolCalls: [] },
    ],
  };
  const cursors = new Map();
  const app = buildApp({
    db,
    chat: async ({ messages }) => {
      const latest = [...messages].reverse().find((message) => message.role === "user").content;
      const steps = scripts[latest];
      const index = cursors.get(latest) || 0;
      cursors.set(latest, index + 1);
      return steps[index];
    },
  });
  const now = new Date().toISOString();
  const day = shanghaiDay();
  db.prepare(
    `INSERT INTO notes (id, user_id, day, text, summary, status, messages, created_at)
     VALUES ('keepopen01', 'userkeep01', ?, '明天下午我要打球', '几点？', 'asking', ?, ?)`,
  ).run(day, JSON.stringify([
    { role: "user", content: "明天下午我要打球" },
    { role: "assistant", content: "几点？要不要提醒？" },
  ]), now);
  db.prepare(
    `INSERT INTO usage (user_id, day, count) VALUES ('userkeep01', ?, 1)`,
  ).run(day);
  await app.listen({ port: 0, host: "127.0.0.1" });
  try {
    const { port } = app.server.address();
    const reply = await fetch(`http://127.0.0.1:${port}/api/notes/keepopen01/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "userkeep01", text: "2点吧" }),
    });
    const asked = await reply.json();
    assert.equal(asked.status, "asking");
    assert.equal(asked.todos.length, 1);
    assert.match(asked.summary, /要不要/);

    const again = await fetch(`http://127.0.0.1:${port}/api/notes/keepopen01/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "userkeep01", text: "要，1点40" }),
    });
    const done = await again.json();
    assert.equal(done.status, "done");
    assert.equal(done.reminders[0].remindAt, "2026-10-28T13:40");
    const usage = await fetch(`http://127.0.0.1:${port}/api/usage?userId=userkeep01`).then((response) => response.json());
    assert.equal(usage.count, 1);
  } finally {
    await app.close();
    db.close();
  }
});
