/** 温区：数字越小越冷，冷车可承运更暖温区的货 */
export type TempZone = "冷冻" | "冷藏" | "恒温" | "常温";

export const TEMP_ZONES: readonly TempZone[] = ["冷冻", "冷藏", "恒温", "常温"];

/** 日期时间统一存 "YYYY-MM-DD HH:mm" 本地字符串，可直接做字典序比较 */
export type DateStr = string;

export type OrderStatus = "待派" | "已派" | "在途" | "交接中" | "已完成";

/** 订单：记线路、送达窗口、货温和重量 */
export interface OrderItem {
  id: string;
  code: string; // 单号
  route: string; // 线路，如 "昆明 → 大理 → 丽江"
  routeKm: number; // 线路里程
  windowStart: DateStr; // 送达窗口起
  windowEnd: DateStr; // 送达窗口止
  cargoZone: TempZone; // 货温
  weightKg: number; // 重量
  status: OrderStatus;
  note: string;
}

/** 车辆：记核载、温区和保养时点 */
export interface Vehicle {
  id: string;
  plate: string; // 车牌
  capacityKg: number; // 核载
  zone: TempZone; // 温区能力（可覆盖更暖温区）
  serviceDueAt: DateStr; // 保养时点
  kmToService: number; // 距保养剩余里程
}

/** 司机：记班次与连续驾驶时长 */
export interface Driver {
  id: string;
  name: string;
  shiftStart: string; // 班次起 "HH:mm"
  shiftEnd: string; // 班次止 "HH:mm"
  maxContinuousHours: number; // 连续驾驶上限（小时）
  drivenHours: number; // 已连续驾驶（小时）
}

export type AssignmentStatus = "已派" | "在途" | "已交回" | "已完成";

/** 派车单：一个订单在某段线路上占用的车 + 司机组合 */
export interface Assignment {
  id: string;
  orderId: string;
  vehicleId: string;
  driverId: string;
  status: AssignmentStatus;
  locked: boolean; // 发车后原组合锁定
  kmDone: number; // 该组合已跑里程
  departedAt?: DateStr;
  finishedAt?: DateStr;
  note: string; // 如 "接续剩余线路：…"
  createdAt: DateStr;
}

export type HandoverStatus = "待确认" | "已确认";

/** 交接留档：途中改派时记录原车、新车、已跑里程和原因 */
export interface Handover {
  id: string;
  orderId: string;
  fromAssignmentId: string;
  fromVehicleId: string;
  fromDriverId: string;
  toVehicleId: string;
  toDriverId: string;
  kmDone: number; // 已跑里程
  remainingRoute: string; // 交回的剩余线路
  reason: string; // 改派原因
  status: HandoverStatus;
  createdAt: DateStr;
  confirmedAt?: DateStr;
}
