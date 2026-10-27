import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { runAgent } from "./agent.js";
import { shanghaiDay } from "./day.js";
import { notePayload, listNotes } from "./notes.js";
import { readUsage, refundNote, reserveNote } from "./quota.js";

const ID = /^[A-Za-z0-9_-]{8,80}$/;
const pagePath = join(dirname(fileURLToPath(import.meta.url)), "../public/index.html");

export function buildApp({ db, chat }) {
  const app = Fastify({ logger: false });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Headers", "Content-Type");
    reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });

  app.get("/", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return readFileSync(pagePath, "utf8");
  });

  app.get("/api/usage", async (request, reply) => {
    const userId = request.query.userId;
    if (!ID.test(userId || "")) return reply.code(400).send({ error: "用户无效" });
    return readUsage(db, userId, shanghaiDay());
  });

  app.get("/api/notes", async (request, reply) => {
    const userId = request.query.userId;
    if (!ID.test(userId || "")) return reply.code(400).send({ error: "用户无效" });
    return listNotes(db, userId);
  });

  app.post("/api/notes", async (request, reply) => {
    const body = request.body || {};
    const userId = body.userId;
    const requestId = body.requestId;
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!ID.test(userId || "") || !ID.test(requestId || "")) {
      return reply.code(400).send({ error: "用户或单号无效" });
    }
    if (!text || text.length > 4000) {
      return reply.code(400).send({ error: "请输入一段话" });
    }

    const now = new Date().toISOString();
    const reserved = reserveNote(db, {
      userId,
      day: shanghaiDay(),
      requestId,
      text,
      now,
    });

    if (reserved.kind === "conflict") {
      return reply.code(409).send({ error: "单号已被占用" });
    }
    if (reserved.kind === "limit") {
      return reply.code(429).send({
        error: "今日 10 次已用完",
        usage: readUsage(db, userId, shanghaiDay()),
      });
    }
    if (reserved.kind === "exists" && reserved.status === "done") {
      return { ...notePayload(db, requestId), replayed: true };
    }
    if (reserved.kind === "exists" && reserved.status === "asking") {
      return { ...notePayload(db, requestId), replayed: true };
    }
    if (reserved.kind === "exists" && reserved.status === "failed") {
      return reply.code(502).send({
        error: "上次整理失败，请换一条再试",
        usage: readUsage(db, userId, shanghaiDay()),
      });
    }
    if (reserved.kind === "exists" && reserved.status === "reserved") {
      db.prepare(`DELETE FROM todos WHERE note_id = ?`).run(requestId);
      db.prepare(`DELETE FROM reminders WHERE note_id = ?`).run(requestId);
    }

    try {
      const history = [{ role: "user", content: text }];
      const result = await runAgent({
        db,
        chat,
        userId,
        noteId: requestId,
        now,
        history,
      });
      saveTurn(db, requestId, history, result);
      return { ...notePayload(db, requestId), replayed: false };
    } catch (error) {
      refundNote(db, requestId);
      const status = error.statusCode || 502;
      return reply.code(status).send({
        error: status === 503 ? error.message : "整理失败，这次额度已退回",
        usage: readUsage(db, userId, shanghaiDay()),
      });
    }
  });

  app.post("/api/notes/:id/reply", async (request, reply) => {
    const body = request.body || {};
    const userId = body.userId;
    const requestId = request.params.id;
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!ID.test(userId || "") || !ID.test(requestId || "")) {
      return reply.code(400).send({ error: "用户或单号无效" });
    }
    if (!text || text.length > 4000) {
      return reply.code(400).send({ error: "请输入一段话" });
    }
    const note = db.prepare(`SELECT * FROM notes WHERE id = ?`).get(requestId);
    if (!note || note.user_id !== userId) {
      return reply.code(404).send({ error: "没有这条记录" });
    }
    if (note.status !== "asking" && !isFollowUp(note.summary)) {
      return reply.code(409).send({ error: "这条记录已经整理完" });
    }

    const history = note.messages ? JSON.parse(note.messages) : [];
    history.push({ role: "user", content: text });
    try {
      const result = await runAgent({
        db,
        chat,
        userId,
        noteId: requestId,
        now: new Date().toISOString(),
        history,
      });
      saveTurn(db, requestId, history, result);
      return notePayload(db, requestId);
    } catch (error) {
      const status = error.statusCode || 502;
      return reply.code(status).send({
        error: status === 503 ? error.message : "回复失败，请再试一次",
        usage: readUsage(db, userId, shanghaiDay()),
      });
    }
  });

  return app;
}

function saveTurn(db, requestId, history, result) {
  const messages = [...history, { role: "assistant", content: result.summary }];
  db.prepare(
    `UPDATE notes SET summary = ?, trace = ?, status = ?, messages = ? WHERE id = ?`,
  ).run(
    result.summary,
    JSON.stringify(result.trace),
    isFollowUp(result.summary) ? "asking" : "done",
    JSON.stringify(messages),
    requestId,
  );
}

function isFollowUp(summary) {
  return /[？?]/.test(summary || "") || /要不要|需要我提醒/.test(summary || "");
}
