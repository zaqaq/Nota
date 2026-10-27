export function notePayload(db, noteId) {
  const note = db.prepare(`SELECT * FROM notes WHERE id = ?`).get(noteId);
  if (!note) return null;
  const todos = db
    .prepare(`SELECT id, content FROM todos WHERE note_id = ? ORDER BY id`)
    .all(noteId);
  const reminders = db
    .prepare(
      `SELECT id, content, remind_at AS remindAt
       FROM reminders WHERE note_id = ? ORDER BY id`,
    )
    .all(noteId);
  const usage = db
    .prepare(`SELECT count FROM usage WHERE user_id = ? AND day = ?`)
    .get(note.user_id, note.day);
  return {
    id: note.id,
    text: note.text,
    summary: note.summary || "",
    status: note.status,
    messages: note.messages ? JSON.parse(note.messages) : [],
    todos,
    reminders,
    trace: note.trace ? JSON.parse(note.trace) : [],
    usage: { day: note.day, count: usage?.count ?? 0, limit: 10 },
  };
}

export function listNotes(db, userId) {
  const rows = db
    .prepare(
      `SELECT id FROM notes
       WHERE user_id = ? AND status IN ('done', 'asking')
       ORDER BY created_at DESC
       LIMIT 20`,
    )
    .all(userId);
  return rows.map((row) => notePayload(db, row.id));
}
