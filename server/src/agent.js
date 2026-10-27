import { shanghaiNow } from "./day.js";
import { executeTool, toolDefinitions } from "./tools.js";

const MAX_ROUNDS = 8;

function latestUserText(history) {
  return [...history].reverse().find((message) => message.role === "user")?.content || "";
}

function isRecall(text) {
  return /几点|什么时候|多少|哪天|上次|之前|以前|有没有|提醒设|安排在/.test(text);
}

export async function runAgent({ db, chat, userId, noteId, now, history }) {
  const existingTodos = db
    .prepare(`SELECT id, content FROM todos WHERE note_id = ? ORDER BY id`)
    .all(noteId);
  const existingReminders = db
    .prepare(`SELECT id, content, remind_at FROM reminders WHERE note_id = ? ORDER BY id`)
    .all(noteId);
  const already = [
    existingTodos.length ? `已有待办：${existingTodos.map((item) => item.content).join("；")}` : "",
    existingReminders.length
      ? `已有提醒：${existingReminders.map((item) => `${item.remind_at} ${item.content}`).join("；")}`
      : "",
  ].filter(Boolean).join("\n");
  const messages = [
    {
      role: "system",
      content: [
        "你是 Nota。信息不全时，先判断要不要追问，再决定是否创建。",
        `当前上海时间：${shanghaiNow(new Date(now))}`,
        "缺的信息会改变待办或提醒时，只追问最关键的一点，不要调用 create_todo 或 set_reminder，也不要说已经记下。",
        "例如只有「明天下午打球」这种模糊时段：要问具体几点，以及要不要提醒。",
        "缺的信息不影响记下这件事时，直接创建待办，不必追问。例如「记得买牛奶」。",
        "已经有具体钟点，并且用户说了要提醒或不用提醒，就创建待办；要提醒时再调用 set_reminder。",
        "如果待办已经记下，但还要问要不要提醒，最终回复就只追问，等用户回答后再设置提醒，不要重复创建待办。",
        "同一件事后面又调用创建时，会改原来的那一条，不要为了补充时间再新增一条。",
        already,
        "用户在提问、回忆或核对以前的安排时，必须先调用 search_history，不要直接创建待办。",
        "例如：几点、什么时候、有没有、多少、上次、之前、张总、打球。用关键词去查。",
        "只根据查到的原文、待办和提醒回答；没有就说没找到，不要编造数字或时间。",
        "最终回复不要描述工具名称。",
      ].filter(Boolean).join("\n"),
    },
    ...history,
  ];
  const trace = [];
  const ctx = {
    userId,
    noteId,
    now,
    priorTodoId: existingTodos.at(-1)?.id,
    priorReminderId: existingReminders.at(-1)?.id,
    replacedTodo: false,
    replacedReminder: false,
  };

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const result = await chat({ messages, tools: toolDefinitions });
    const toolCalls = result.toolCalls || [];
    if (toolCalls.length === 0) {
      const asked = latestUserText(history);
      const searched = trace.some((item) => item.tool === "search_history");
      if (isRecall(asked) && !searched) {
        const output = executeTool(db, ctx, "search_history", { query: asked });
        trace.push({ tool: "search_history", ok: Boolean(output.ok) });
        messages.push({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "search-required",
              type: "function",
              function: {
                name: "search_history",
                arguments: JSON.stringify({ query: asked }),
              },
            },
          ],
        });
        messages.push({
          role: "tool",
          tool_call_id: "search-required",
          content: JSON.stringify(output),
        });
        continue;
      }
      return { summary: (result.content || "").trim() || "已记下。", trace };
    }

    messages.push({
      role: "assistant",
      content: result.content || "",
      tool_calls: toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments || {}),
        },
      })),
    });

    for (const call of toolCalls) {
      const output = executeTool(db, ctx, call.name, call.arguments || {});
      trace.push({ tool: call.name, ok: Boolean(output.ok) });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(output),
      });
    }
  }

  return { summary: "已经记下可以执行的事项。", trace };
}
