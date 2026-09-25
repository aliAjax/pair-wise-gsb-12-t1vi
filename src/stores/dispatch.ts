// 状态 + 留档层：资料维护、派车、交回、接续、送达、休息打卡，全部留日志。
// 纯校验委托 rules/dispatch.ts；持久化到 localStorage，重开页面可续看。

import { defineStore } from "pinia";
import type {
  Driver,
  Gap,
  HandoverRecord,
  LogEntry,
  LogType,
  Order,
  PersistShape,
  Trip,
  Vehicle,
} from "../types";
import { evaluateDispatch } from "../rules/dispatch";
import { estDriveMinutes, nowIso, parseLocal } from "../utils/time";

const STORAGE_KEY = "dfwlfront-3-handoff-v1";

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

/* -------------------------------- 种子数据 -------------------------------- */

function seed(): PersistShape {
  // 全部相对"今天此刻（本地时区）"生成，保证演示数据在任何日期打开都未过期。
  const now = new Date();
  const iso = (offsetMin: number) => new Date(now.getTime() + offsetMin * 60000).toISOString();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const dayStr = (offsetDay: number) => {
    const d = new Date(now.getTime() + offsetDay * 86400000);
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  };
  const win = (dayOffset: number, hh: number, mm = 0) => {
    const d = new Date(now.getTime() + dayOffset * 86400000);
    d.setHours(hh, mm, 0, 0);
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(hh)}:${p2(mm)}`;
  };

  const vehicles: Vehicle[] = [
    {
      id: "v1",
      plate: "沪A·D8206",
      payloadKg: 5000,
      zones: ["冷冻", "冷藏"],
      odometerKm: 88200,
      maintenanceDueMileageKm: 88500,
      maintenanceDueDate: dayStr(2),
    },
    {
      id: "v2",
      plate: "沪B·L7319",
      payloadKg: 3000,
      zones: ["冷藏", "恒温"],
      odometerKm: 64500,
      maintenanceDueMileageKm: 70000,
      maintenanceDueDate: dayStr(20),
    },
    {
      id: "v3",
      plate: "沪C·K2058",
      payloadKg: 8000,
      zones: ["冷冻", "冷藏", "恒温"],
      odometerKm: 102300,
      maintenanceDueMileageKm: 102600,
      maintenanceDueDate: dayStr(1),
    },
  ];

  // d2 在途中；班次日班/对班均为 12 小时（长途山路运次需要足够覆盖）
  const d2Start = new Date(now.getTime() - 5 * 3600000);
  const d2End = new Date(now.getTime() + 7 * 3600000);
  const nightStart = new Date(now.getTime() - 2 * 3600000);
  const nightEnd = new Date(now.getTime() + 10 * 3600000);
  const hm = (d: Date) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const drivers: Driver[] = [
    { id: "d1", name: "董飞", shiftDate: dayStr(0), shiftStart: hm(d2Start), shiftEnd: hm(d2End), continuousMinutes: 210 },
    { id: "d2", name: "周航", shiftDate: dayStr(0), shiftStart: hm(d2Start), shiftEnd: hm(d2End), continuousMinutes: 250 },
    { id: "d3", name: "覃海", shiftDate: dayStr(0), shiftStart: hm(nightStart), shiftEnd: hm(nightEnd), continuousMinutes: 0 },
  ];

  const orders: Order[] = [
    {
      id: "o1",
      no: "LL-2609-11",
      name: "冷冻牛排（城北商超）",
      route: {
        name: "云岭山冷库 → 城北冷链分拨中心",
        distanceKm: 120,
        stops: ["云岭山冷库", "盘山垭口检查站", "城北冷链分拨中心"],
      },
      windowStart: win(0, 14),
      windowEnd: win(0, 23),
      tempZone: "冷冻",
      weightKg: 2400,
      status: "pending",
      lastGaps: [],
      lastTriedAt: null,
      tripId: null,
      createdAt: iso(-180),
    },
    {
      id: "o2",
      no: "LL-2609-12",
      name: "冷藏疫苗（市疾控）",
      route: {
        name: "云岭山冷库 → 市疾控中心",
        distanceKm: 95,
        stops: ["云岭山冷库", "东山服务区", "市疾控中心"],
      },
      windowStart: win(0, 16),
      windowEnd: win(1, 12),
      tempZone: "冷藏",
      weightKg: 900,
      status: "pending",
      lastGaps: [],
      lastTriedAt: null,
      tripId: null,
      createdAt: iso(-120),
    },
    {
      id: "o3",
      no: "LL-2609-13",
      name: "冻猪肉（城东市场）",
      route: {
        name: "云岭山冷库 → 城东批发市场",
        distanceKm: 320,
        stops: ["云岭山冷库", "盘山垭口检查站", "临江收费站", "城东批发市场"],
      },
      windowStart: win(1, 6),
      windowEnd: win(1, 20),
      tempZone: "冷冻",
      weightKg: 6500,
      status: "pending",
      lastGaps: [],
      lastTriedAt: null,
      tripId: null,
      createdAt: iso(-60),
    },
    {
      id: "o4",
      no: "LL-2609-14",
      name: "恒温巧克力（城南商超）",
      route: {
        name: "云岭山冷库 → 城南商超总仓",
        distanceKm: 60,
        stops: ["云岭山冷库", "城南商超总仓"],
      },
      windowStart: win(0, 22),
      windowEnd: win(1, 6),
      tempZone: "恒温",
      weightKg: 600,
      status: "pending",
      lastGaps: [],
      lastTriedAt: null,
      tripId: null,
      createdAt: iso(-30),
    },
    {
      id: "o5",
      no: "LL-2609-10",
      name: "冻品水饺（城北商超补货）",
      route: {
        name: "云岭山冷库 → 城北连锁总仓",
        distanceKm: 180,
        stops: ["云岭山冷库", "盘山垭口检查站", "城北连锁总仓"],
      },
      windowStart: win(-1, 9),
      windowEnd: win(0, 20),
      tempZone: "冷冻",
      weightKg: 3200,
      status: "assigned",
      lastGaps: [],
      lastTriedAt: null,
      tripId: "t1",
      createdAt: iso(-600),
    },
    {
      id: "o0",
      no: "LL-2609-08",
      name: "冷藏鲜奶（城东门店）",
      route: { name: "云岭山冷库 → 城东门店群", distanceKm: 140, stops: ["云岭山冷库", "东山服务区", "城东门店群"] },
      windowStart: win(-1, 5),
      windowEnd: win(-1, 12),
      tempZone: "冷藏",
      weightKg: 1800,
      status: "completed",
      lastGaps: [],
      lastTriedAt: null,
      tripId: "t0",
      createdAt: iso(-1800),
    },
  ];

  const activeStart = new Date(now.getTime() - 150 * 60000);
  const trips: Trip[] = [
    {
      id: "t1",
      orderId: "o5",
      planStart: activeStart.toISOString(),
      planEnd: new Date(activeStart.getTime() + estDriveMinutes(180) * 60000).toISOString(),
      estMinutes: estDriveMinutes(180),
      vehicleId: "v1",
      driverId: "d2",
      runMileageKm: 0,
      runMinutes: 0,
      status: "active",
      history: [],
      createdAt: activeStart.toISOString(),
    },
    {
      id: "t0",
      orderId: "o0",
      planStart: iso(-1700),
      planEnd: iso(-1700 + 280),
      estMinutes: estDriveMinutes(140),
      vehicleId: "v2",
      driverId: "d1",
      runMileageKm: 140,
      runMinutes: 280,
      status: "completed",
      history: [],
      createdAt: iso(-1700),
    },
  ];

  const logs: LogEntry[] = [
    { id: uid("log"), at: iso(-1700), type: "dispatched", orderNo: "LL-2609-08", tripId: "t0", message: "派车成功：沪B·L7319 + 董飞，预计驾驶 4小时40分" },
    { id: uid("log"), at: iso(-1420), type: "completed", orderNo: "LL-2609-08", tripId: "t0", message: "送达完成：沪B·L7319 回场，表显 +140km" },
    { id: uid("log"), at: iso(-150), type: "dispatched", orderNo: "LL-2609-10", tripId: "t1", message: "派车成功：沪A·D8206 + 周航，组合已锁定" },
  ];

  return { version: 1, orders, vehicles, drivers, trips, logs };
}

function load(): PersistShape {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as PersistShape;
      if (parsed.version === 1 && Array.isArray(parsed.orders)) return parsed;
    } catch {
      // 存档损坏时回退种子
    }
  }
  return seed();
}

/* --------------------------------- Store --------------------------------- */

export interface ActionResult {
  ok: boolean;
  gaps?: Gap[];
  tripId?: string;
}

export const useDispatchStore = defineStore("dispatch", {
  state: () => load(),

  getters: {
    pendingOrders(state): Order[] {
      return state.orders.filter((o) => o.status === "pending");
    },
    activeTrips(state): Trip[] {
      return state.trips.filter((t) => t.status !== "completed");
    },
    vehicleMap(state): Record<string, Vehicle> {
      return Object.fromEntries(state.vehicles.map((v) => [v.id, v]));
    },
    driverMap(state): Record<string, Driver> {
      return Object.fromEntries(state.drivers.map((d) => [d.id, d]));
    },
    orderMap(state): Record<string, Order> {
      return Object.fromEntries(state.orders.map((o) => [o.id, o]));
    },
  },

  actions: {
    persist() {
      const shape: PersistShape = {
        version: 1,
        orders: this.orders,
        vehicles: this.vehicles,
        drivers: this.drivers,
        trips: this.trips,
        logs: this.logs,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(shape));
    },

    log(type: LogType, message: string, extra?: { orderNo?: string; tripId?: string }) {
      this.logs.unshift({ id: uid("log"), at: nowIso(), type, message, ...extra });
    },

    /* ------------------------------- 资料维护 ------------------------------- */

    addOrder(order: Omit<Order, "id" | "status" | "lastGaps" | "lastTriedAt" | "tripId" | "createdAt">) {
      this.orders.unshift({
        ...order,
        id: uid("o"),
        status: "pending",
        lastGaps: [],
        lastTriedAt: null,
        tripId: null,
        createdAt: nowIso(),
      });
      this.log("data", `新增订单 ${order.no}（${order.tempZone}，${order.weightKg}kg，线路 ${order.route.distanceKm}km）`);
      this.persist();
    },

    updateOrder(id: string, patch: Partial<Order>) {
      const order = this.orders.find((o) => o.id === id);
      if (!order || order.status !== "pending") return;
      Object.assign(order, patch);
      this.persist();
    },

    removeOrder(id: string) {
      const order = this.orders.find((o) => o.id === id);
      if (!order || order.status !== "pending") return;
      this.orders = this.orders.filter((o) => o.id !== id);
      this.log("data", `删除待派订单 ${order.no}`);
      this.persist();
    },

    addVehicle(vehicle: Omit<Vehicle, "id">) {
      this.vehicles.push({ ...vehicle, id: uid("v") });
      this.log("data", `新增车辆 ${vehicle.plate}（核载 ${vehicle.payloadKg}kg，温区 ${vehicle.zones.join("/")}）`);
      this.persist();
    },

    updateVehicle(id: string, patch: Partial<Vehicle>) {
      const vehicle = this.vehicles.find((v) => v.id === id);
      if (vehicle) Object.assign(vehicle, patch);
      this.persist();
    },

    removeVehicle(id: string) {
      const busy = this.trips.some((t) => t.status === "active" && t.vehicleId === id);
      if (busy) return;
      const vehicle = this.vehicles.find((v) => v.id === id);
      this.vehicles = this.vehicles.filter((v) => v.id !== id);
      if (vehicle) this.log("data", `删除车辆 ${vehicle.plate}`);
      this.persist();
    },

    addDriver(driver: Omit<Driver, "id">) {
      this.drivers.push({ ...driver, id: uid("d") });
      this.log("data", `新增司机 ${driver.name}`);
      this.persist();
    },

    updateDriver(id: string, patch: Partial<Driver>) {
      const driver = this.drivers.find((d) => d.id === id);
      if (driver) Object.assign(driver, patch);
      this.persist();
    },

    removeDriver(id: string) {
      const busy = this.trips.some((t) => t.status === "active" && t.driverId === id);
      if (busy) return;
      const driver = this.drivers.find((d) => d.id === id);
      this.drivers = this.drivers.filter((d) => d.id !== id);
      if (driver) this.log("data", `删除司机 ${driver.name}`);
      this.persist();
    },

    /* -------------------------------- 派车 -------------------------------- */

    dispatch(orderId: string, vehicleId: string, driverId: string, startLocal: string): ActionResult {
      const order = this.orders.find((o) => o.id === orderId);
      const start = parseLocal(startLocal);
      if (!order || !start) return { ok: false, gaps: [{ code: "input", message: "请填写发车时间" }] };

      const evaluation = evaluateDispatch(
        { vehicles: this.vehicles, drivers: this.drivers, trips: this.trips },
        { order, vehicleId, driverId, planStart: start }
      );

      if (!evaluation.ok) {
        // 缺口写回订单，留在待派区明示
        order.lastGaps = evaluation.gaps;
        order.lastTriedAt = nowIso();
        this.log(
          "blocked",
          `订单 ${order.no} 派车被拦截（${this.vehicleMap[vehicleId]?.plate ?? "未选车"} + ${this.driverMap[driverId]?.name ?? "未选司机"}）：${evaluation.gaps
            .map((g) => g.message)
            .join("；")}`,
          { orderNo: order.no }
        );
        this.persist();
        return { ok: false, gaps: evaluation.gaps };
      }

      const trip: Trip = {
        id: uid("t"),
        orderId: order.id,
        planStart: start.toISOString(),
        planEnd: evaluation.planEnd.toISOString(),
        estMinutes: evaluation.driveMinutes,
        vehicleId,
        driverId,
        runMileageKm: 0,
        runMinutes: 0,
        status: "active",
        history: [],
        createdAt: nowIso(),
      };
      this.trips.push(trip);
      order.status = "assigned";
      order.tripId = trip.id;
      order.lastGaps = [];
      order.lastTriedAt = null;
      this.log(
        "dispatched",
        `派车成功：${order.no} → ${this.vehicles.find((v) => v.id === vehicleId)?.plate} + ${this.drivers.find((d) => d.id === driverId)?.name}，预计驾驶 ${evaluation.driveMinutes} 分钟，原组合锁定`,
        { orderNo: order.no, tripId: trip.id }
      );
      this.persist();
      return { ok: true, tripId: trip.id };
    },

    /** 休息打卡：连续驾驶时长归零 */
    rest(driverId: string) {
      const driver = this.drivers.find((d) => d.id === driverId);
      if (!driver) return;
      const before = driver.continuousMinutes;
      driver.continuousMinutes = 0;
      this.log("rested", `${driver.name} 休息打卡满 20 分钟，连续驾驶 ${before} 分钟已清零`);
      this.persist();
    },

    /* ------------------------------ 途中改派 ------------------------------ */

    /** 第一步：交回剩余线路。原车/原司机占用立刻释放（trip 置为 handover，资源置空） */
    handover(tripId: string, reason: string, runMileageKm: number, runMinutes: number): ActionResult {
      const trip = this.trips.find((t) => t.id === tripId);
      if (!trip || trip.status !== "active") return { ok: false };
      const order = this.orders.find((o) => o.id === trip.orderId);

      const segKm = Math.max(0, runMileageKm - trip.runMileageKm);
      const segMin = Math.max(0, runMinutes - trip.runMinutes);
      this.applySegment(trip, segKm, segMin);

      const record: HandoverRecord = {
        at: nowIso(),
        reason: reason || "未填写原因",
        runMileageKm: trip.runMileageKm,
        runMinutes: trip.runMinutes,
        oldVehicleId: trip.vehicleId,
        oldDriverId: trip.driverId,
        newVehicleId: null,
        newDriverId: null,
      };
      trip.history.push(record);
      trip.vehicleId = null; // 原占用立刻释放
      trip.driverId = null;
      trip.status = "handover";
      this.log(
        "handed_over",
        `途中交回：${order?.no ?? tripId}，已跑 ${trip.runMileageKm}km / ${trip.runMinutes} 分钟，原车 ${record.oldVehicleId ? this.vehicleMap[record.oldVehicleId]?.plate : "—"}、原司机 ${record.oldDriverId ? this.driverMap[record.oldDriverId]?.name : "—"} 已释放，原因：${record.reason}`,
        { orderNo: order?.no, tripId: trip.id }
      );
      this.persist();
      return { ok: true };
    },

    /** 第二步：确认新车/新司机接续承运（剩余线路） */
    reassign(tripId: string, vehicleId: string, driverId: string, startLocal: string): ActionResult {
      const trip = this.trips.find((t) => t.id === tripId);
      const start = parseLocal(startLocal);
      if (!trip || trip.status !== "handover" || !start) {
        return { ok: false, gaps: [{ code: "input", message: "运次不在待接续状态或时间无效" }] };
      }
      const order = this.orders.find((o) => o.id === trip.orderId);
      if (!order) return { ok: false };

      const evaluation = evaluateDispatch(
        { vehicles: this.vehicles, drivers: this.drivers, trips: this.trips },
        { order, vehicleId, driverId, planStart: start, runMileageKm: trip.runMileageKm, excludeTripId: trip.id }
      );
      if (!evaluation.ok) {
        this.log(
          "blocked",
          `接续被拦截：${order.no}（${this.vehicleMap[vehicleId]?.plate ?? "未选车"} + ${this.driverMap[driverId]?.name ?? "未选司机"}）：${evaluation.gaps
            .map((g) => g.message)
            .join("；")}`,
          { orderNo: order.no, tripId: trip.id }
        );
        this.persist();
        return { ok: false, gaps: evaluation.gaps };
      }

      trip.vehicleId = vehicleId;
      trip.driverId = driverId;
      trip.planStart = start.toISOString();
      trip.planEnd = evaluation.planEnd.toISOString();
      trip.estMinutes = evaluation.driveMinutes;
      trip.status = "active";
      const record = trip.history[trip.history.length - 1];
      if (record) {
        record.newVehicleId = vehicleId;
        record.newDriverId = driverId;
      }
      this.log(
        "reassigned",
        `接续确认：${order.no} 改由 ${this.vehicles.find((v) => v.id === vehicleId)?.plate} + ${this.drivers.find((d) => d.id === driverId)?.name} 承运剩余 ${evaluation.remainingKm}km`,
        { orderNo: order.no, tripId: trip.id }
      );
      this.persist();
      return { ok: true, tripId: trip.id };
    },

    complete(tripId: string) {
      const trip = this.trips.find((t) => t.id === tripId);
      if (!trip || trip.status !== "active") return;
      const order = this.orders.find((o) => o.id === trip.orderId);
      const remainingKm = order ? Math.max(0, order.route.distanceKm - trip.runMileageKm) : 0;
      // 只把当前组合实际承运的这一段落到表显/连续驾驶；前序里程已在交回时记录
      this.applySegment(trip, remainingKm, estDriveMinutes(remainingKm));
      trip.status = "completed";
      trip.planEnd = nowIso();
      if (order) order.status = "completed";
      this.log(
        "completed",
        `送达完成：${order?.no ?? tripId}，${trip.vehicleId ? this.vehicleMap[trip.vehicleId]?.plate : ""} 回场，全程 ${trip.runMileageKm}km`,
        { orderNo: order?.no, tripId: trip.id }
      );
      this.persist();
    },

    /** 把一段实际行驶落到车辆表显与司机连续驾驶时长上 */
    applySegment(trip: Trip, segKm: number, segMin: number) {
      trip.runMileageKm = Math.round((trip.runMileageKm + segKm) * 10) / 10;
      trip.runMinutes += Math.round(segMin);
      const vehicle = trip.vehicleId ? this.vehicles.find((v) => v.id === trip.vehicleId) : null;
      if (vehicle) vehicle.odometerKm = Math.round((vehicle.odometerKm + segKm) * 10) / 10;
      const driver = trip.driverId ? this.drivers.find((d) => d.id === trip.driverId) : null;
      if (driver) driver.continuousMinutes += Math.round(segMin);
    },
  },
});
