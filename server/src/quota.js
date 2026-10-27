const LIMIT = 10;

export function reserveNote(db, { userId, day, requestId, text, now }) {
  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO usage (user_id, day, count) VALUES (?, ?, 0)
       ON CONFLICT (user_id, day) DO NOTHING`,
    ).run(userId, day);

    const existing = db
      .prepare(
        `SELECT id, user_id, status FROM notes WHERE id = ?`,
      )
      .get(requestId);

    if (existing && existing.user_id !== userId) {
      return { kind: "conflict" };
    }
    if (existing) {
      return { kind: "exists", status: existing.status };
    }

    const usage = db
      .prepare(`SELECT count FROM usage WHERE user_id = ? AND day = ?`)
      .get(userId, day);
    if (usage.count >= LIMIT) {
      return { kind: "limit", count: usage.count };
    }

    db.prepare(
      `INSERT INTO notes (id, user_id, day, text, status, created_at)
       VALUES (?, ?, ?, ?, 'reserved', ?)`,
    ).run(requestId, userId, day, text, now);
    db.prepare(
      `UPDATE usage SET count = count + 1 WHERE user_id = ? AND day = ?`,
    ).run(userId, day);
    return { kind: "reserved", count: usage.count + 1 };
  });
  return run.immediate();
}

export function refundNote(db, requestId) {
  const run = db.transaction(() => {
    const note = db
      .prepare(
        `SELECT user_id, day, status, refunded FROM notes WHERE id = ?`,
      )
      .get(requestId);
    if (!note || note.refunded || note.status === "done") return;
    db.prepare(
      `UPDATE usage SET count = count - 1
       WHERE user_id = ? AND day = ? AND count > 0`,
    ).run(note.user_id, note.day);
    db.prepare(
      `UPDATE notes SET status = 'failed', refunded = 1 WHERE id = ?`,
    ).run(requestId);
  });
  run.immediate();
}

export function readUsage(db, userId, day) {
  const row = db
    .prepare(`SELECT count FROM usage WHERE user_id = ? AND day = ?`)
    .get(userId, day);
  return { day, count: row?.count ?? 0, limit: LIMIT };
}
