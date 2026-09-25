import type { Assignment, Driver, Handover, OrderItem, Vehicle } from "../types";
import { fmt, hoursFromNow } from "../utils";

function todayAt(hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return fmt(d);
}

export interface SeedData {
  orders: OrderItem[];
  vehicles: Vehicle[];
  drivers: Driver[];
  assignments: Assignment[];
  handovers: Handover[];
}

/**
 * 演示资料：山路冷链。
 * 场景覆盖——在途车被撞班、保养里程/时点不够、司机连续驾驶到限、
 * 一单制冷机组报警后交回剩余线路等待确认。
 */
export function buildSeed(): SeedData {
  const orders: OrderItem[] = [
    {
      id: "O-2600", code: "CL-2600", route: "昆明 → 玉溪 → 普洱", routeKm: 420,
      windowStart: hoursFromNow(-2), windowEnd: hoursFromNow(6),
      cargoZone: "冷冻", weightKg: 5000, status: "在途",
      note: "山路长下坡多，注意制动与厢温",
    },
    {
      id: "O-2601", code: "CL-2601", route: "昆明 → 楚雄 → 大理", routeKm: 330,
      windowStart: hoursFromNow(3), windowEnd: hoursFromNow(10),
      cargoZone: "冷冻", weightKg: 4200, status: "待派", note: "",
    },
    {
      id: "O-2602", code: "CL-2602", route: "大理 → 丽江", routeKm: 190,
      windowStart: hoursFromNow(4), windowEnd: hoursFromNow(8),
      cargoZone: "冷藏", weightKg: 2600, status: "待派", note: "",
    },
    {
      id: "O-2603", code: "CL-2603", route: "昆明 → 建水 → 蒙自", routeKm: 260,
      windowStart: hoursFromNow(26), windowEnd: hoursFromNow(32),
      cargoZone: "恒温", weightKg: 6800, status: "待派", note: "",
    },
    {
      id: "O-2604", code: "CL-2604", route: "丽江 → 香格里拉", routeKm: 180,
      windowStart: hoursFromNow(5), windowEnd: hoursFromNow(11),
      cargoZone: "冷冻", weightKg: 1500, status: "待派", note: "",
    },
    {
      id: "O-2598", code: "CL-2598", route: "昆明 → 曲靖", routeKm: 150,
      windowStart: todayAt(14), windowEnd: todayAt(20),
      cargoZone: "冷藏", weightKg: 2000, status: "交接中",
      note: "原车机组报警，已交回剩余线路",
    },
    {
      id: "O-2597", code: "CL-2597", route: "昆明 → 楚雄", routeKm: 160,
      windowStart: hoursFromNow(-30), windowEnd: hoursFromNow(-24),
      cargoZone: "冷藏", weightKg: 1800, status: "已完成", note: "",
    },
  ];

  const vehicles: Vehicle[] = [
    { id: "V-6F21", plate: "云A·6F21", capacityKg: 8000, zone: "冷冻", serviceDueAt: hoursFromNow(72), kmToService: 900 },
    { id: "V-9K35", plate: "云A·9K35", capacityKg: 5000, zone: "冷藏", serviceDueAt: hoursFromNow(20), kmToService: 240 },
    { id: "V-2Q78", plate: "云B·2Q78", capacityKg: 3000, zone: "恒温", serviceDueAt: hoursFromNow(120), kmToService: 1200 },
    { id: "V-7M16", plate: "云C·7M16", capacityKg: 12000, zone: "冷冻", serviceDueAt: hoursFromNow(8), kmToService: 150 },
    { id: "V-4S09", plate: "云D·4S09", capacityKg: 6000, zone: "冷藏", serviceDueAt: hoursFromNow(96), kmToService: 800 },
  ];

  const drivers: Driver[] = [
    { id: "D-dong", name: "董飞", shiftStart: "06:00", shiftEnd: "14:00", maxContinuousHours: 8, drivenHours: 1.5 },
    { id: "D-zhou", name: "周航", shiftStart: "08:00", shiftEnd: "18:00", maxContinuousHours: 8, drivenHours: 6.8 },
    { id: "D-li", name: "李峰", shiftStart: "14:00", shiftEnd: "22:00", maxContinuousHours: 8, drivenHours: 0.5 },
    { id: "D-wang", name: "王强", shiftStart: "06:00", shiftEnd: "18:00", maxContinuousHours: 8, drivenHours: 1.6 },
  ];

  const assignments: Assignment[] = [
    {
      id: "A-1", orderId: "O-2600", vehicleId: "V-6F21", driverId: "D-wang",
      status: "在途", locked: true, kmDone: 90,
      departedAt: hoursFromNow(-2), note: "", createdAt: hoursFromNow(-3),
    },
    {
      id: "A-2", orderId: "O-2598", vehicleId: "V-9K35", driverId: "D-dong",
      status: "已交回", locked: true, kmDone: 70,
      departedAt: hoursFromNow(-6), finishedAt: hoursFromNow(-1), note: "", createdAt: hoursFromNow(-7),
    },
    {
      id: "A-3", orderId: "O-2597", vehicleId: "V-4S09", driverId: "D-zhou",
      status: "已交回", locked: true, kmDone: 60,
      departedAt: hoursFromNow(-30), finishedAt: hoursFromNow(-28), note: "", createdAt: hoursFromNow(-31),
    },
    {
      id: "A-4", orderId: "O-2597", vehicleId: "V-9K35", driverId: "D-dong",
      status: "已完成", locked: true, kmDone: 60,
      departedAt: hoursFromNow(-28), finishedAt: hoursFromNow(-25),
      note: "接续剩余线路：楚雄（剩余约 100 km）", createdAt: hoursFromNow(-28),
    },
  ];

  const handovers: Handover[] = [
    {
      id: "H-1", orderId: "O-2598", fromAssignmentId: "A-2",
      fromVehicleId: "V-9K35", fromDriverId: "D-dong",
      toVehicleId: "V-4S09", toDriverId: "D-li",
      kmDone: 70, remainingRoute: "曲靖（剩余约 80 km）",
      reason: "原车制冷机组报警，靠边交回剩余线路",
      status: "待确认", createdAt: hoursFromNow(-1),
    },
    {
      id: "H-2", orderId: "O-2597", fromAssignmentId: "A-3",
      fromVehicleId: "V-4S09", fromDriverId: "D-zhou",
      toVehicleId: "V-9K35", toDriverId: "D-dong",
      kmDone: 60, remainingRoute: "楚雄（剩余约 100 km）",
      reason: "司机连续驾驶到限，换车换人",
      status: "已确认", createdAt: hoursFromNow(-28), confirmedAt: hoursFromNow(-28),
    },
  ];

  return { orders, vehicles, drivers, assignments, handovers };
}
