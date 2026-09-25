import type { Assignment, Driver, OrderItem, TempZone, Vehicle } from "../types";
import { minutesOfDay } from "../utils";

export type GapKind = "温区" | "载重" | "保养" | "休息" | "撞班";

/** 缺口：不满足时订单留在待派区，并把缺口写明 */
export interface Gap {
  kind: GapKind;
  text: string;
}

/** 温区能力等级：数字越小越冷，冷车可承运更暖温区的货 */
export const ZONE_RANK: Record<TempZone, number> = { 冷冻: 0, 冷藏: 1, 恒温: 2, 常温: 3 };

/** 山路均速（km/h），用于估算在途时长 */
export const MOUNTAIN_SPEED_KMH = 55;

export function estimateTripHours(km: number): number {
  return km / MOUNTAIN_SPEED_KMH;
}

const OCCUPIED_STATUSES: Assignment["status"][] = ["已派", "在途"];

/** 已派未交回/未完成的组合都算占用 */
export function isOccupied(a: Assignment): boolean {
  return OCCUPIED_STATUSES.includes(a.status);
}

export interface DispatchInput {
  order: OrderItem;
  vehicle: Vehicle;
  driver: Driver;
  assignments: Assignment[]; // 全部派车单，函数内部只看占用中的
  routeKm?: number; // 改派时传剩余里程，默认整单里程
  ignoreAssignmentId?: string; // 改派评估时排除正要交回的原组合
}

/**
 * 派车判断：同车或同一司机不能撞班；
 * 温区、载重、保养或休息不够就返回缺口，调用方把订单留在待派区。
 */
export function evaluateDispatch(input: DispatchInput): Gap[] {
  const { order, vehicle, driver } = input;
  const km = input.routeKm ?? order.routeKm;
  const gaps: Gap[] = [];

  // 温区：车辆温区要比货温更冷或持平
  if (ZONE_RANK[vehicle.zone] > ZONE_RANK[order.cargoZone]) {
    gaps.push({ kind: "温区", text: `货温需${order.cargoZone}，${vehicle.plate} 仅到${vehicle.zone}` });
  }

  // 载重
  if (order.weightKg > vehicle.capacityKg) {
    gaps.push({
      kind: "载重",
      text: `超重 ${order.weightKg - vehicle.capacityKg} kg（货 ${order.weightKg} kg / 核载 ${vehicle.capacityKg} kg）`,
    });
  }

  // 保养：送达窗口不能晚于保养时点，线路不能超出保养剩余里程
  if (order.windowEnd > vehicle.serviceDueAt) {
    gaps.push({ kind: "保养", text: `送达窗口止 ${order.windowEnd} 晚于保养时点 ${vehicle.serviceDueAt}` });
  }
  if (km > vehicle.kmToService) {
    gaps.push({ kind: "保养", text: `线路 ${km} km 超出保养剩余里程 ${vehicle.kmToService} km，差 ${km - vehicle.kmToService} km` });
  }

  // 休息：连续驾驶不能超上限
  const totalHours = driver.drivenHours + estimateTripHours(km);
  if (totalHours > driver.maxContinuousHours) {
    gaps.push({
      kind: "休息",
      text: `连续驾驶将达 ${totalHours.toFixed(1)} h，超上限 ${driver.maxContinuousHours} h（已驾驶 ${driver.drivenHours} h）`,
    });
  }

  // 班次：送达窗口要与司机班次有重叠（跨午夜窗口/班次按 +24h 归一）
  let ws = minutesOfDay(order.windowStart);
  let we = minutesOfDay(order.windowEnd);
  let ss = minutesOfDay(driver.shiftStart);
  let se = minutesOfDay(driver.shiftEnd);
  if (se <= ss) se += 1440;
  if (we < ws) we += 1440;
  if (ws > se || we < ss) {
    gaps.push({
      kind: "休息",
      text: `送达窗口 ${order.windowStart.slice(11, 16)}–${order.windowEnd.slice(11, 16)} 与班次 ${driver.shiftStart}–${driver.shiftEnd} 不重叠`,
    });
  }

  // 撞班：同车或同一司机已有已派/在途任务
  const seen = new Set<string>();
  for (const a of input.assignments) {
    if (!isOccupied(a) || a.id === input.ignoreAssignmentId) continue;
    if (a.vehicleId === vehicle.id) seen.add(`${vehicle.plate} 已有${a.status}任务`);
    if (a.driverId === driver.id) seen.add(`${driver.name} 已有${a.status}任务`);
  }
  for (const text of seen) {
    gaps.push({ kind: "撞班", text });
  }

  return gaps;
}

/** 按已跑里程推算剩余线路：从未到达的下一站开始列 */
export function remainingRouteText(route: string, routeKm: number, kmDone: number): string {
  const stops = route.split("→").map((s) => s.trim()).filter(Boolean);
  const leftKm = Math.max(0, Math.round(routeKm - kmDone));
  if (stops.length < 2 || kmDone <= 0) return `${route}（剩余约 ${leftKm} km）`;
  const nextIdx = Math.min(stops.length - 1, Math.ceil((kmDone / routeKm) * (stops.length - 1)));
  return `${stops.slice(nextIdx).join(" → ")}（剩余约 ${leftKm} km）`;
}
