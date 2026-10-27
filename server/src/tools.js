const CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function likeContains(query) {
  const escaped = query.replace(/[\\%_]/g, (char) => `\\${char}`);
  return `%${escaped}%`;
}

export function executeTool(db, ctx, name, args) {
  if (name === "create_todo") return createTodo(db, ctx, args);
  if (name === "set_reminder") return setReminder(db, ctx, args);
  if (name === "search_history") return searchHistory(db, ctx, args);
  return { ok: false, error: "没有这个工具" };
}

function createTodo(db, ctx, args) {
  const content = typeof args.content === "string" ? args.content.trim() : "";
  if (!content || content.length > 200) {
    return { ok: false, error: "待办内容无效" };
  }
  if (ctx.priorTodoId && !ctx.replacedTodo) {
    db.prepare(`UPDATE todos SET content = ? WHERE id = ?`).run(content, ctx.priorTodoId);
    ctx.replacedTodo = true;
    return { ok: true, updated: true, id: ctx.priorTodoId, content };
  }
  const count = db
    .prepare(`SELECT COUNT(*) AS n FROM todos WHERE note_id = ?`)
    .get(ctx.noteId).n;
  if (count >= 10) return { ok: false, error: "这条记录的待办已够多" };
  const result = db
    .prepare(
      `INSERT INTO todos (note_id, user_id, content, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(ctx.noteId, ctx.userId, content, ctx.now);
  return { ok: true, id: Number(result.lastInsertRowid), content };
}

function setReminder(db, ctx, args) {
  const content = typeof args.content === "string" ? args.content.trim() : "";
  const remindAt = typeof args.remind_at === "string" ? args.remind_at.trim() : "";
  if (!content) return { ok: false, error: "提醒内容无效" };
  if (!CLOCK.test(remindAt)) {
    return { ok: false, error: "缺少具体钟点，格式应为 YYYY-MM-DDTHH:mm" };
  }
  const parsed = new Date(`${remindAt}:00+08:00`);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, error: "提醒时间无效" };
  }
  if (ctx.priorReminderId && !ctx.replacedReminder) {
    db.prepare(`UPDATE reminders SET content = ?, remind_at = ? WHERE id = ?`).run(
      content,
      remindAt,
      ctx.priorReminderId,
    );
    ctx.replacedReminder = true;
    return { ok: true, updated: true, id: ctx.priorReminderId, content, remindAt };
  }
  const result = db
    .prepare(
      `INSERT INTO reminders (note_id, user_id, content, remind_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(ctx.noteId, ctx.userId, content, remindAt, ctx.now);
  return {
    ok: true,
    id: Number(result.lastInsertRowid),
    content,
    remindAt,
  };
}

function searchHistory(db, ctx, args) {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query || query.length > 80) return { ok: false, error: "请给出要查的关键词" };
  const keys = keywords(query);
  if (!keys.length) return { ok: true, matches: [], keywords: [] };

  const rows = db
    .prepare(
      `SELECT id, text, summary, created_at
       FROM notes
       WHERE user_id = ?
         AND id != ?
         AND status IN ('done', 'asking')
       ORDER BY created_at DESC
       LIMIT 80`,
    )
    .all(ctx.userId, ctx.noteId);

  const scored = [];
  for (const row of rows) {
    const todos = db
      .prepare(`SELECT content FROM todos WHERE note_id = ? ORDER BY id`)
      .all(row.id)
      .map((item) => item.content);
    const reminders = db
      .prepare(
        `SELECT content, remind_at AS remindAt FROM reminders WHERE note_id = ? ORDER BY id`,
      )
      .all(row.id);
    const haystack = [
      row.text,
      row.summary || "",
      ...todos,
      ...reminders.map((item) => `${item.remindAt} ${item.content}`),
    ].join("\n");
    const hit = keys.filter((key) => haystack.includes(key));
    if (!hit.length) continue;
    const strong = hit.filter((key) => /总|老师|经理|周[一二三四五六日天]|今天|明天|打球|吃饭|报价/.test(key));
    if (keys.some((key) => /总|老师|经理|打球|吃饭|报价/.test(key)) && !strong.length && hit.length < 2) {
      continue;
    }
    scored.push({
      score: hit.length * 10 + strong.length * 20 + Math.min(haystack.length, 40) / 40,
      match: {
        id: row.id,
        at: row.created_at,
        text: clip(row.text, 180),
        summary: clip(row.summary || "", 180),
        todos,
        reminders,
        hit,
      },
    });
  }

  scored.sort((a, b) => b.score - a.score || b.match.at.localeCompare(a.match.at));
  return {
    ok: true,
    keywords: keys,
    matches: scored.slice(0, 5).map((item) => item.match),
  };
}

const FILLERS = [
  "什么时候",
  "上个月",
  "下个月",
  "有没有",
  "是不是",
  "查一下",
  "找一下",
  "告诉我",
  "是多少",
  "提醒我",
  "那个",
  "这个",
  "什么",
  "多少",
  "时候",
  "请问",
  "帮我",
  "一下",
  "可以",
  "我想",
  "我要",
  "记得",
  "提醒",
  "设置",
  "创建",
  "整理",
  "查询",
  "几点",
  "何时",
  "之前",
  "以前",
  "上次",
  "最近",
  "关于",
  "哪天",
  "设在",
];

function keywords(query) {
  const found = new Set();
  for (const match of query.matchAll(/[\u4e00-\u9fff](?:总|老师|经理|同学|哥|姐)/g)) {
    found.add(match[0]);
  }
  for (const match of query.matchAll(/下?周[一二三四五六日天]|今天|明天|后天|昨天/g)) {
    found.add(match[0]);
  }
  let rest = query;
  for (const filler of FILLERS) rest = rest.split(filler).join(" ");
  for (const kept of found) rest = rest.split(kept).join(" ");
  rest = rest.replace(/[^\u4e00-\u9fffA-Za-z0-9]+/g, " ");
  for (const part of rest.split(/\s+/)) {
    if (part.length < 2) continue;
    if (part.length <= 6) found.add(part);
    if (part.length > 2) {
      for (let index = 0; index + 2 <= part.length; index += 1) {
        found.add(part.slice(index, index + 2));
      }
    }
  }
  return [...found]
    .filter((item) => item.length >= 2)
    .sort((left, right) => {
      const weight = (value) =>
        (/总|老师|经理|周[一二三四五六日天]|今天|明天/.test(value) ? 20 : 0) + value.length;
      return weight(right) - weight(left);
    })
    .slice(0, 12);
}

function clip(value, limit = 120) {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

export const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "create_todo",
      description: "创建一条待办",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          content: { type: "string", description: "待办内容" },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_reminder",
      description:
        "设置提醒。remind_at 必须带具体钟点，格式 YYYY-MM-DDTHH:mm，上海时区。没有钟点时不要调用。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          content: { type: "string" },
          remind_at: { type: "string", description: "YYYY-MM-DDTHH:mm" },
        },
        required: ["content", "remind_at"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_history",
      description:
        "查询这位用户以前的便签、待办和提醒。用户在回忆、核对、追问以前安排或数字时必须先调用。可传入人名、事项或原话里的关键词。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "关键词，例如张总、打球、报价" },
        },
        required: ["query"],
      },
    },
  },
];
