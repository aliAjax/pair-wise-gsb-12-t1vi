import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import type { Assignment, Driver, Handover, OrderItem, TempZone, Vehicle } from "../types";
import { evaluateDispatch, estimateTripHours, remainingRouteText, type Gap } from "../domain/rules";
import { buildSeed, type SeedData } from "../data/seed";
import { nowStr, uid } from "../utils";

const STORAGE_KEY = "dfwlfront-3-dispatch";

function load(): SeedData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SeedData>;
      if (Array.isArray(parsed.orders) && Array.isArray(parsed.assignments) && Array.isArray(parsed.handovers)) {
        return parsed as SeedData;
      }
    }
  } catch {
    // 存档损坏时回退到演示资料
  }
  return buildSeed();
}

export const useDispatchStore = defineStore("dispatch", () => {
  const initial = load();
  const orders = ref<OrderItem[]>(initial.orders);
  const vehicles = ref<Vehicle[]>(initial.vehicles);
  const drivers = ref<Driver[]>(initial.drivers);
  const assignments = ref<Assignment[]>(initial.assignments);
  const handovers = ref<Handover[]>(initial.handovers);

  // 留档持久化：任何变动都写回，重开续看
  watch(
    [orders, vehicles, drivers, assignments, handovers],
    () => {
      const snapshot: SeedData = {
        orders: orders.value,
        vehicles: vehicles.value,
        drivers: drivers.value,
        assignments: assignments.value,
        handovers: handovers.value,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    },
    { deep: true },
  );

  // ---------- 查询 ----------
  const orderById = (id: string) => orders.value.find((o) => o.id === id);
  const vehicleById = (id: string) => vehicles.value.find((v) => v.id === id);
  const driverById = (id: string) => drivers.value.find((d) => d.id === id);

  const pendingOrders = computed(() => orders.value.filter((o) => o.status === "待派"));
  const liveAssignments = computed(() =>
    assignments.value
      .filter((a) => a.status === "已派" || a.status === "在途")
      .sort((a, b) => (a.status === b.status ? 0 : a.status === "在途" ? -1 : 1)),
  );
  const pendingHandovers = computed(() => handovers.value.filter((h) => h.status === "待确认"));
  const occupiedVehicleIds = computed(() => new Set(liveAssignments.value.map((a) => a.vehicleId)));
  const occupiedDriverIds = computed(() => new Set(liveAssignments.value.map((a) => a.driverId)));
  const freeVehicles = computed(() => vehicles.value.filter((v) => !occupiedVehicleIds.value.has(v.id)));

  // ---------- 判断入口 ----------
  function gapsFor(
    orderId: string,
    vehicleId: string,
    driverId: string,
    opts?: { routeKm?: number; ignoreAssignmentId?: string },
  ): Gap[] {
    const order = orderById(orderId);
    const vehicle = vehicleById(vehicleId);
    const driver = driverById(driverId);
    if (!order || !vehicle || !driver) return [{ kind: "撞班", text: "资料缺失，无法判断" }];
    return evaluateDispatch({
      order,
      vehicle,
      driver,
      assignments: assignments.value,
      routeKm: opts?.routeKm,
      ignoreAssignmentId: opts?.ignoreAssignmentId,
    });
  }

  // ---------- 流程动作 ----------
  /** 派车：有缺口则留在待派区，返回缺口 */
  function assign(orderId: string, vehicleId: string, driverId: string): Gap[] {
    const gaps = gapsFor(orderId, vehicleId, driverId);
    if (gaps.length) return gaps;
    assignments.value.unshift({
      id: uid("A"), orderId, vehicleId, driverId,
      status: "已派", locked: false, kmDone: 0, note: "", createdAt: nowStr(),
    });
    const order = orderById(orderId);
    if (order) order.status = "已派";
    return [];
  }

  /** 发车：原组合锁定 */
  function depart(assignmentId: string): void {
    const a = assignments.value.find((x) => x.id === assignmentId);
    if (!a || a.status !== "已派") return;
    a.status = "在途";
    a.locked = true;
    a.departedAt = nowStr();
    const order = orderById(a.orderId);
    if (order) order.status = "在途";
  }

  /**
   * 途中改派：先交回剩余线路，记录原车、新车、已跑里程和原因；
   * 原占用立刻释放，等确认后新车才接续承运。
   */
  function requestHandover(
    assignmentId: string,
    toVehicleId: string,
    toDriverId: string,
    kmDone: number,
    reason: string,
  ): Gap[] {
    const a = assignments.value.find((x) => x.id === assignmentId);
    const order = a ? orderById(a.orderId) : undefined;
    if (!a || !order || a.status !== "在途") return [{ kind: "撞班", text: "仅在途组合可改派" }];

    const remainingKm = Math.max(0, order.routeKm - kmDone);
    const gaps = gapsFor(order.id, toVehicleId, toDriverId, {
      routeKm: remainingKm,
      ignoreAssignmentId: a.id,
    });
    if (gaps.length) return gaps;

    // 原组合交回，占用立刻释放；已跑里程回写车辆保养与司机驾驶时长
    a.status = "已交回";
    a.kmDone = kmDone;
    a.finishedAt = nowStr();
    const fromVehicle = vehicleById(a.vehicleId);
    if (fromVehicle) fromVehicle.kmToService = Math.max(0, fromVehicle.kmToService - kmDone);
    const fromDriver = driverById(a.driverId);
    if (fromDriver) fromDriver.drivenHours = +(fromDriver.drivenHours + estimateTripHours(kmDone)).toFixed(1);

    handovers.value.unshift({
      id: uid("H"), orderId: order.id, fromAssignmentId: a.id,
      fromVehicleId: a.vehicleId, fromDriverId: a.driverId,
      toVehicleId, toDriverId, kmDone,
      remainingRoute: remainingRouteText(order.route, order.routeKm, kmDone),
      reason, status: "待确认", createdAt: nowStr(),
    });
    order.status = "交接中";
    return [];
  }

  /** 确认交接：确认时再校验一次新车新司机，通过则新车继续承运 */
  function confirmHandover(handoverId: string): Gap[] {
    const h = handovers.value.find((x) => x.id === handoverId);
    const order = h ? orderById(h.orderId) : undefined;
    if (!h || !order || h.status !== "待确认") return [{ kind: "撞班", text: "交接单不存在或已确认" }];

    const remainingKm = Math.max(0, order.routeKm - h.kmDone);
    const gaps = gapsFor(order.id, h.toVehicleId, h.toDriverId, { routeKm: remainingKm });
    if (gaps.length) return gaps;

    h.status = "已确认";
    h.confirmedAt = nowStr();
    assignments.value.unshift({
      id: uid("A"), orderId: order.id,
      vehicleId: h.toVehicleId, driverId: h.toDriverId,
      status: "在途", locked: true, kmDone: h.kmDone,
      departedAt: nowStr(),
      note: `接续剩余线路：${h.remainingRoute}`,
      createdAt: nowStr(),
    });
    order.status = "在途";
    return [];
  }

  /** 送达完成：释放组合，回写保养里程与驾驶时长 */
  function finish(assignmentId: string): void {
    const a = assignments.value.find((x) => x.id === assignmentId);
    const order = a ? orderById(a.orderId) : undefined;
    if (!a || !order || a.status !== "在途") return;
    a.status = "已完成";
    a.finishedAt = nowStr();
    order.status = "已完成";

    const km = Math.max(0, order.routeKm - a.kmDone);
    const vehicle = vehicleById(a.vehicleId);
    if (vehicle) vehicle.kmToService = Math.max(0, vehicle.kmToService - km);
    const driver = driverById(a.driverId);
    if (driver) driver.drivenHours = +(driver.drivenHours + estimateTripHours(km)).toFixed(1);
  }

  // ---------- 资料维护 ----------
  function addOrder(input: {
    code: string; route: string; routeKm: number;
    windowStart: string; windowEnd: string;
    cargoZone: TempZone; weightKg: number; note?: string;
  }): void {
    orders.value.unshift({
      id: uid("O"), status: "待派", note: input.note ?? "",
      code: input.code, route: input.route, routeKm: input.routeKm,
      windowStart: input.windowStart, windowEnd: input.windowEnd,
      cargoZone: input.cargoZone, weightKg: input.weightKg,
    });
  }

  function addVehicle(input: {
    plate: string; capacityKg: number; zone: TempZone; serviceDueAt: string; kmToService: number;
  }): void {
    vehicles.value.push({ id: uid("V"), ...input });
  }

  function addDriver(input: {
    name: string; shiftStart: string; shiftEnd: string; maxContinuousHours: number; drivenHours: number;
  }): void {
    drivers.value.push({ id: uid("D"), ...input });
  }

  /** 删除返回 null 表示成功，否则为原因 */
  function removeOrder(id: string): string | null {
    const order = orderById(id);
    if (!order) return "订单不存在";
    if (order.status !== "待派" && order.status !== "已完成") return "仅待派或已完成订单可删除";
    orders.value = orders.value.filter((o) => o.id !== id);
    return null;
  }

  function removeVehicle(id: string): string | null {
    if (occupiedVehicleIds.value.has(id)) return "车辆有已派/在途任务，不能删除";
    vehicles.value = vehicles.value.filter((v) => v.id !== id);
    return null;
  }

  function removeDriver(id: string): string | null {
    if (occupiedDriverIds.value.has(id)) return "司机有已派/在途任务，不能删除";
    drivers.value = drivers.value.filter((d) => d.id !== id);
    return null;
  }

  function resetAll(): void {
    const seed = buildSeed();
    orders.value = seed.orders;
    vehicles.value = seed.vehicles;
    drivers.value = seed.drivers;
    assignments.value = seed.assignments;
    handovers.value = seed.handovers;
  }

  return {
    orders, vehicles, drivers, assignments, handovers,
    orderById, vehicleById, driverById,
    pendingOrders, liveAssignments, pendingHandovers,
    occupiedVehicleIds, occupiedDriverIds, freeVehicles,
    gapsFor, assign, depart, requestHandover, confirmHandover, finish,
    addOrder, addVehicle, addDriver, removeOrder, removeVehicle, removeDriver, resetAll,
  };
});
