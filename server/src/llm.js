export function createChat() {
  return async function chat({ messages, tools }) {
    const apiKey = process.env.LLM_API_KEY;
    if (!apiKey) {
      const error = new Error("未配置 LLM_API_KEY");
      error.statusCode = 503;
      throw error;
    }
    const base = (process.env.LLM_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || "deepseek-flash",
        temperature: 0,
        messages,
        tools,
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) {
      throw new Error(`模型请求失败：${response.status}`);
    }
    const data = await response.json();
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("模型没有返回内容");
    const toolCalls = (message.tool_calls || []).map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: parseArguments(call.function.arguments),
    }));
    return { content: message.content || "", toolCalls };
  };
}

function parseArguments(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
