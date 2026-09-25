// 资料模型：订单（线路/送达窗口/货温/重量）、车辆（核载/温区/保养时点）、
// 司机（班次/连续驾驶时长）、运次（派车-交回-接续的留档载体）。

export type TempZone = "冷冻" | "冷藏" | "恒温";

export type OrderStatus = "pending" | "assigned" | "completed";

export interface RouteInfo {
  /** 线路名称，例如：城北冷链仓 → 云岭服务区 */
  name: string;
  /** 单程里程（公里，山路） */
  distanceKm: number;
  /** 线路节点 */
  stops: string[];
}

export interface Gap {
  /** 缺口类型：zone/load/maintenance-mileage/maintenance-date/shift/rest/collision-vehicle/collision-driver */
  code: string;
  /** 面向调度员的人话说明，直接展示在待派区 */
  message: string;
}

export interface Order {
  id: string;
  /** 运单号 */
  no: string;
  /** 货物名称 */
  name: string;
  route: RouteInfo;
  /** 送达窗口起，格式 YYYY-MM-DD HH:mm */
  windowStart: string;
  /** 送达窗口止 */
  windowEnd: string;
  tempZone: TempZone;
  /** 货重（kg） */
  weightKg: number;
  status: OrderStatus;
  /** 最近一次试算/派车失败留下的缺口，待派区直接展示 */
  lastGaps: Gap[];
  lastTriedAt: string | null;
  tripId: string | null;
  createdAt: string;
}

export interface Vehicle {
  id: string;
  plate: string;
  /** 核载（kg） */
  payloadKg: number;
  /** 可用温区 */
  zones: TempZone[];
  /** 当前表显里程（km） */
  odometerKm: number;
  /** 下次保养里程点（km） */
  maintenanceDueMileageKm: number;
  /** 下次保养日期 YYYY-MM-DD */
  maintenanceDueDate: string;
}

export interface Driver {
  id: string;
  name: string;
  /** 班次日期 YYYY-MM-DD（夜班可跨到次日） */
  shiftDate: string;
  shiftStart: string; // HH:mm
  shiftEnd: string; // HH:mm，<= 开始时间视为次日
  /** 连续驾驶时长（分钟），休息打卡后归零 */
  continuousMinutes: number;
}

export type TripStatus = "active" | "handover" | "completed";

/** 一次交回/接续记录：原车、新车、已跑里程、原因 */
export interface HandoverRecord {
  at: string;
  reason: string;
  runMileageKm: number;
  runMinutes: number;
  oldVehicleId: string | null;
  oldDriverId: string | null;
  newVehicleId: string | null;
  newDriverId: string | null;
}

export interface Trip {
  id: string;
  orderId: string;
  /** 计划占用区间，用于撞班判断 */
  planStart: string;
  planEnd: string;
  /** 本程预计驾驶分钟（按山路均速估算） */
  estMinutes: number;
  /** 当前承运车辆；交回后为 null，原占用已释放 */
  vehicleId: string | null;
  driverId: string | null;
  /** 已跑里程/分钟（累计，含被交回的前一段） */
  runMileageKm: number;
  runMinutes: number;
  status: TripStatus;
  history: HandoverRecord[];
  createdAt: string;
}

export type LogType =
  | "dispatched"
  | "blocked"
  | "handed_over"
  | "reassigned"
  | "completed"
  | "rested"
  | "data";

export interface LogEntry {
  id: string;
  at: string;
  type: LogType;
  orderNo?: string;
  tripId?: string;
  message: string;
}

export interface PersistShape {
  version: 1;
  orders: Order[];
  vehicles: Vehicle[];
  drivers: Driver[];
  trips: Trip[];
  logs: LogEntry[];
}
