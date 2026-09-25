// 判断层：派车/接续资格校验。全部为纯函数，不碰界面与存储。
// 撞班、温区、核载、保养（里程点+日期）、班次、连续驾驶休息，任一不过即返回缺口。

import type { Driver, Gap, Order, TempZone, Trip, Vehicle } from "../types";
import {
  MAX_CONTINUOUS_MINUTES,
  estDriveMinutes,
  needMidTripRest,
  requiredRestBeforeDrive,
  shiftRange,
} from "../utils/time";

export interface RuleState {
  vehicles: Vehicle[];
  drivers: Driver[];
  trips: Trip[];
}

export interface DispatchRequest {
  order: Order;
  vehicleId: string;
  driverId: string;
  /** 发车/接续时刻 */
  planStart: Date;
  /** 已跑里程（首派为 0，途中改派时 > 0），保养里程按剩余线路判断 */
  runMileageKm?: number;
  /** 改派校验时排除自身运次 */
  excludeTripId?: string;
}

export interface Evaluation {
  ok: boolean;
  gaps: Gap[];
  /** 不拦截但调度员须知的提醒（如途中需安排休息） */
  warnings: string[];
  remainingKm: number;
  driveMinutes: number;
  planEnd: Date;
}

function overlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** 仅在途（active）运次占用车/司机；已交回（handover）的运次立即释放占用 */
function occupantTrips(state: RuleState, excludeTripId?: string): Trip[] {
  return state.trips.filter(
    (trip) => trip.status === "active" && trip.id !== excludeTripId
  );
}

export function evaluateDispatch(state: RuleState, req: DispatchRequest): Evaluation {
  const gaps: Gap[] = [];
  const warnings: string[] = [];
  const vehicle = state.vehicles.find((v) => v.id === req.vehicleId);
  const driver = state.drivers.find((d) => d.id === req.driverId);

  const remainingKm = Math.max(0, req.order.route.distanceKm - (req.runMileageKm ?? 0));
  const driveMinutes = estDriveMinutes(remainingKm);
  const planEnd = new Date(req.planStart.getTime() + driveMinutes * 60000);

  if (!vehicle) {
    gaps.push({ code: "vehicle", message: "请选择承运车辆" });
  }
  if (!driver) {
    gaps.push({ code: "driver", message: "请选择承运司机" });
  }

  // 1. 撞班：同车 / 同司机的在途运次时间区间不得重叠
  if (vehicle && driver) {
    for (const trip of occupantTrips(state, req.excludeTripId)) {
      const tStart = new Date(trip.planStart);
      const tEnd = new Date(trip.planEnd);
      if (trip.vehicleId === vehicle.id && overlap(req.planStart, planEnd, tStart, tEnd)) {
        gaps.push({ code: "collision-vehicle", message: `车辆 ${vehicle.plate} 该时段已在执行运次，撞班` });
      }
      if (trip.driverId === driver.id && overlap(req.planStart, planEnd, tStart, tEnd)) {
        gaps.push({ code: "collision-driver", message: `司机 ${driver.name} 该时段已有驾驶任务，撞班` });
      }
    }
  }

  // 2. 温区匹配
  if (vehicle && !vehicle.zones.includes(req.order.tempZone)) {
    gaps.push({
      code: "zone",
      message: `温区不符：货物要求${req.order.tempZone}，车辆仅支持${vehicle.zones.join("/")}`,
    });
  }

  // 3. 核载
  if (vehicle && req.order.weightKg > vehicle.payloadKg) {
    gaps.push({
      code: "load",
      message: `载重不足：货重 ${req.order.weightKg}kg，超过核载 ${vehicle.payloadKg}kg（差 ${req.order.weightKg - vehicle.payloadKg}kg）`,
    });
  }

  // 4. 保养：里程点（跑完剩余线路不得越过下次保养里程）+ 时点（送达日不得晚于保养到期日）
  if (vehicle) {
    const kmToService = vehicle.maintenanceDueMileageKm - vehicle.odometerKm;
    if (kmToService <= 0) {
      gaps.push({
        code: "maintenance-mileage",
        message: `已到保养里程：表显 ${vehicle.odometerKm}km，保养点 ${vehicle.maintenanceDueMileageKm}km，需先保养`,
      });
    } else if (kmToService < remainingKm) {
      gaps.push({
        code: "maintenance-mileage",
        message: `保养里程不够：距保养点仅剩 ${kmToService}km，剩余线路 ${remainingKm}km，途中将到期`,
      });
    }
    const dueDate = new Date(`${vehicle.maintenanceDueDate}T23:59:59`);
    if (!Number.isNaN(dueDate.getTime()) && planEnd.getTime() > dueDate.getTime()) {
      gaps.push({
        code: "maintenance-date",
        message: `保养时点不够：车辆 ${vehicle.maintenanceDueDate} 到期保养，预计 ${formatDate(planEnd)} 才能送达`,
      });
    }
  }

  // 5. 班次：整个驾驶区间要落在班次内
  if (driver) {
    const range = shiftRange(driver);
    if (!range) {
      gaps.push({ code: "shift", message: "司机班次时间不完整" });
    } else if (req.planStart < range.start || planEnd > range.end) {
      const p = (n: number) => String(n).padStart(2, "0");
      const f = (d: Date) =>
        `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
      gaps.push({
        code: "shift",
        message: `班次不够：${driver.name} 班次 ${f(range.start)}–${f(range.end)}，无法覆盖驾驶区间 ${f(req.planStart)}–${f(planEnd)}`,
      });
    }
  }

  // 6. 连续驾驶休息：已满 4 小时必须先休 20 分钟（硬缺口）；
  //    未满 4 小时但本程会超时，途中安排一次休息即可（提醒，不拦截）。
  if (driver) {
    const need = requiredRestBeforeDrive(driver.continuousMinutes);
    if (need > 0) {
      gaps.push({
        code: "rest",
        message: `休息不够：${driver.name} 已连续驾驶 ${driver.continuousMinutes} 分钟，满 ${MAX_CONTINUOUS_MINUTES} 分钟须先休息 ${need} 分钟`,
      });
    } else if (needMidTripRest(driver.continuousMinutes, driveMinutes)) {
      warnings.push(
        `${driver.name} 已连续驾驶 ${driver.continuousMinutes} 分钟，本程约 ${driveMinutes} 分钟，途中须安排一次 20 分钟休息`
      );
    }
  }

  return { ok: gaps.length === 0, gaps, warnings, remainingKm, driveMinutes, planEnd };
}

/** 待派区试算：枚举全部车×司机组合，给出每个订单最优组合的缺口 */
export function bestFit(
  state: RuleState,
  order: Order,
  planStart: Date,
  runMileageKm = 0
): { vehicleId: string; driverId: string; evaluation: Evaluation } | null {
  let best: { vehicleId: string; driverId: string; evaluation: Evaluation } | null = null;
  for (const vehicle of state.vehicles) {
    for (const driver of state.drivers) {
      const evaluation = evaluateDispatch(state, {
        order,
        vehicleId: vehicle.id,
        driverId: driver.id,
        planStart,
        runMileageKm,
      });
      if (evaluation.ok) return { vehicleId: vehicle.id, driverId: driver.id, evaluation };
      if (!best || evaluation.gaps.length < best.evaluation.gaps.length) {
        best = { vehicleId: vehicle.id, driverId: driver.id, evaluation };
      }
    }
  }
  return best;
}

export const ZONE_LABEL: Record<TempZone, string> = {
  冷冻: "冷冻（-18℃ 以下）",
  冷藏: "冷藏（0~8℃）",
  恒温: "恒温（15~25℃）",
};

function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
