const DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const DATE_TIME = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function shanghaiDay(date = new Date()) {
  return DATE.format(date);
}

export function shanghaiNow(date = new Date()) {
  return DATE_TIME.format(date).replace(" ", "T");
}
