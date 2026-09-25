// 纯函数工具：时间、温区、班次。供规则层与界面层共用，不依赖 Vue/Pinia。

export const MOUNTAIN_SPEED_KMH = 30; // 山路冷链均速，用于估算驾驶时长

export function nowIso(): string {
  return new Date().toISOString();
}

/** "YYYY-MM-DD HH:mm" 或 "YYYY-MM-DDTHH:mm" -> Date */
export function parseLocal(text: string): Date | null {
  if (!text) return null;
  const d = new Date(text.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function todayStr(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return h > 0 ? `${h}小时${rest ? `${rest}分` : ""}` : `${m}分`;
}

/** 交车时刻 + 预计驾驶分钟 => 预计送达时刻 */
export function eta(planStartIso: string, estMinutes: number): Date {
  return new Date(new Date(planStartIso).getTime() + estMinutes * 60000);
}

/** 预计驾驶分钟 = 剩余里程 / 山路均速 */
export function estDriveMinutes(remainingKm: number): number {
  return Math.round((remainingKm / MOUNTAIN_SPEED_KMH) * 60);
}

/**
 * 连续驾驶 4 小时必须休息 20 分钟（道路交通安全法实施条例第六十二条）。
 * 仅当司机当前已连续驾驶满 4 小时，发车前才必须先休；
 * 未满 4 小时但本程较长，途中安排 20 分钟休息即可（由 needMidTripRest 提示，不拦截）。
 */
export const MAX_CONTINUOUS_MINUTES = 4 * 60;
export const REQUIRED_REST_MINUTES = 20;

export function requiredRestBeforeDrive(continuousMinutes: number): number {
  return continuousMinutes >= MAX_CONTINUOUS_MINUTES ? REQUIRED_REST_MINUTES : 0;
}

/** 本程途中是否需要安排一次 20 分钟休息（提醒用，不作硬缺口） */
export function needMidTripRest(continuousMinutes: number, driveMinutes: number): boolean {
  return continuousMinutes < MAX_CONTINUOUS_MINUTES && continuousMinutes + driveMinutes > MAX_CONTINUOUS_MINUTES;
}

export function shiftRange(driver: {
  shiftDate: string;
  shiftStart: string;
  shiftEnd: string;
}): { start: Date; end: Date } | null {
  const start = parseLocal(`${driver.shiftDate} ${driver.shiftStart}`);
  const endBase = parseLocal(`${driver.shiftDate} ${driver.shiftEnd}`);
  if (!start || !endBase) return null;
  const end = endBase <= start ? new Date(endBase.getTime() + 86400000) : endBase;
  return { start, end };
}

export function fmtShift(driver: { shiftDate: string; shiftStart: string; shiftEnd: string }): string {
  return `${driver.shiftDate} ${driver.shiftStart}–${driver.shiftEnd}`;
}

/** Date -> datetime 输入框值 "YYYY-MM-DD HH:mm" */
export function toLocalInput(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
