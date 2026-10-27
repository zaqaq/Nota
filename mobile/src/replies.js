export function needsReply(note) {
  if (!note) return false;
  if (note.status === "asking") return true;
  const last = [...(note.messages || [])].reverse().find((item) => item.role === "assistant");
  return /[？?]/.test(last?.content || note.summary || "");
}

export function quickReplies(note) {
  const last = [...(note.messages || [])].reverse().find((item) => item.role === "assistant");
  const question = last?.content || note.summary || "";
  const earlier = (note.messages || []).map((item) => item.content).join("");
  const replies = [];
  const asksTime = /几点|什么时候|何时/.test(question);
  const asksReminder = /提醒/.test(question);
  const hintText = /比如|例如/.test(question) ? question.split(/比如|例如/).pop() : question;
  const suggested = asksReminder
    ? hintText.match(/([0-9]{1,2}|[一二两三四五六七八九十]{1,3})\s*点\s*([0-9]{1,2}|[一二三四五六七八九十]{1,2})?\s*分?/)
    : null;
  if (asksTime) {
    const period = /下午/.test(question + earlier) ? "下午" : /上午/.test(question + earlier) ? "上午" : "";
    for (const hour of ["2点", "3点", "4点"]) {
      replies.push(asksReminder ? `${period}${hour}，要提醒` : `${period}${hour}`);
    }
  }
  if (asksReminder) {
    if (suggested) {
      const minute = suggested[2] ? `${suggested[1]}点${suggested[2]}` : `${suggested[1]}点`;
      replies.unshift(`要，${minute}提醒`);
    } else if (!asksTime) {
      replies.push("要提醒");
    }
    replies.push("不用提醒");
  }
  return [...new Set(replies)];
}
