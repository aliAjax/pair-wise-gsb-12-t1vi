export function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Date → "YYYY-MM-DD HH:mm" */
export function fmt(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function nowStr(): string {
  return fmt(new Date());
}

export function hoursFromNow(hours: number): string {
  return fmt(new Date(Date.now() + hours * 3600_000));
}

/** 取一天中的分钟数，兼容 "YYYY-MM-DD HH:mm" 与 "HH:mm" */
export function minutesOfDay(s: string): number {
  const t = s.includes(" ") ? s.slice(11) : s;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** "YYYY-MM-DD HH:mm" → "HH:mm"，已是 "HH:mm" 则原样返回 */
export function hhmm(s: string): string {
  return s.includes(" ") ? s.slice(11, 16) : s;
}

/** 送达窗口展示：同一天省略结束日期 */
export function windowText(start: string, end: string): string {
  return start.slice(0, 10) === end.slice(0, 10) ? `${start} ~ ${hhmm(end)}` : `${start} ~ ${end}`;
}
