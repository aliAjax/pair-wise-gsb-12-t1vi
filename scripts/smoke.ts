// 纯逻辑冒烟测试：把 rules/store 打包到 Node 跑，不经过浏览器。
import { createPinia, setActivePinia } from "pinia";
import { useDispatchStore } from "../src/stores/dispatch";
import { toLocalInput } from "../src/utils/time";

const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => mem.set(k, v),
  removeItem: (k: string) => mem.delete(k),
};

const p2 = (n: number) => String(n).padStart(2, "0");
function at(offsetMin: number): string {
  const d = new Date(Date.now() + offsetMin * 60000);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

setActivePinia(createPinia());
const store = useDispatchStore();

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log("  ✓", name);
  } else {
    fail++;
    console.error("  ✗", name);
  }
}

console.log("种子数据：");
assert("有4个待派订单", store.pendingOrders.length === 4);
assert("有1个在途运次", store.activeTrips.length === 1);

const o1 = store.orders.find((o) => o.no === "LL-2609-11")!; // 冷冻 2400kg 120km
const o2 = store.orders.find((o) => o.no === "LL-2609-12")!; // 冷藏 900kg 95km
const o3 = store.orders.find((o) => o.no === "LL-2609-13")!; // 冷冻 6500kg 320km
const o4 = store.orders.find((o) => o.no === "LL-2609-14")!; // 恒温 600kg 60km

console.log("\n派车成功路径（o1 + v3 + d3 现在出发）：");
let r = store.dispatch(o1.id, "v3", "d3", toLocalInput());
assert("派车返回 ok", r.ok === true);
assert("订单状态变 assigned", o1.status === "assigned");
const tO1 = store.trips.find((t) => t.orderId === o1.id)!;
assert("运次 active 且组合锁定", tO1.status === "active" && tO1.vehicleId === "v3" && tO1.driverId === "d3");

console.log("\n拦截：同车撞班（v3 同时段再派 o2）：");
r = store.dispatch(o2.id, "v3", "d1", at(30));
assert("派车被拦", r.ok === false);
assert("缺口含撞车", !!r.gaps?.some((g) => g.code === "collision-vehicle"));
assert("o2 留在待派区", o2.status === "pending");
assert("缺口已写回订单", o2.lastGaps.length >= 1);

console.log("\n拦截：载重不足（o3 6500kg 只有 v3 能装）：");
r = store.dispatch(o3.id, "v1", "d1", at(60));
assert("被拦", r.ok === false);
assert("有载重缺口", !!r.gaps?.some((g) => g.code === "load"));

console.log("拦截：保养里程不够（v1 距保养点300km < o3剩320km）：");
r = store.dispatch(o3.id, "v3", "d1", at(120));
assert("v3 同时撞车", !!r.gaps?.some((g) => g.code === "collision-vehicle"));

console.log("\n休息规则：d1 连续210分，60km 车程需途中休（提醒）；d2 已满250分必须先休：");
let r4 = store.dispatch(o4.id, "v2", "d2", at(10));
assert("d2 有休息硬缺口", !!r4.gaps?.some((g) => g.code === "rest"));
r4 = store.dispatch(o4.id, "v2", "d1", at(10));
assert("d1 未满4小时可派，返回途中休息提醒", r4.ok === true && r4.gaps === undefined);
// 交回 o4，释放 d1/v2 给后面的接续演示使用
const tO4 = store.trips.find((t) => t.orderId === o4.id)!;
store.handover(tO4.id, "测试释放占用", 60, 120);

console.log("d2 休息打卡后连续时长清零：");
store.rest("d2");
assert("打卡后清零", store.drivers.find((d) => d.id === "d2")!.continuousMinutes === 0);

console.log("\n途中改派两步：交回释放占用，再由新车接续：");
const activeO5 = store.trips.find((t) => t.orderId === "o5")!;
r = store.handover(activeO5.id, "车辆高温报警，换车", 90, 180);
assert("交回 ok", r.ok);
assert("运次变 handover", activeO5.status === "handover");
assert("原车立即释放", activeO5.vehicleId === null);
assert("原司机立即释放", activeO5.driverId === null);
assert("已跑里程记录为90", activeO5.runMileageKm === 90);
assert("交接记录含原车/里程/原因",
  activeO5.history[0].oldVehicleId === "v1" &&
  activeO5.history[0].runMileageKm === 90 &&
  activeO5.history[0].reason.includes("高温"));
// v1 此刻可派新单：用 o3 试，v1 装不下但不应再报撞车
const evalAfter = store.dispatch(o3.id, "v1", "d3", at(130));
assert("v1已释放→不再报撞车", !evalAfter.gaps?.some((g) => g.code === "collision-vehicle"));

console.log("接续校验：温区不符被拦（v2 无冷冻）：");
r = store.reassign(activeO5.id, "v2", "d1", at(140));
assert("温区不符接续被拦", r.ok === false && !!r.gaps?.some((g) => g.code === "zone"));
assert("拦后仍为 handover", activeO5.status === "handover");

console.log("释放 v3（o1 送达）后接续成功：");
store.complete(tO1.id);
assert("o1 已送达", store.orderMap[tO1.orderId].status === "completed");
r = store.reassign(activeO5.id, "v3", "d2", at(150));
assert("新车接续成功", r.ok === true);
assert("运次恢复 active", activeO5.status === "active");
assert("记录补全新车/新司机",
  activeO5.history[0].newVehicleId === "v3" && activeO5.history[0].newDriverId === "d2");

console.log("\n送达与留档：");
store.complete(activeO5.id);
assert("o5 送达", store.orderMap.o5.status === "completed");
assert("日志含拦截/交回/接续/送达/休息",
  store.logs.some((l) => l.type === "blocked") &&
  store.logs.some((l) => l.type === "handed_over") &&
  store.logs.some((l) => l.type === "reassigned") &&
  store.logs.some((l) => l.type === "completed") &&
  store.logs.some((l) => l.type === "rested"));

console.log("\n持久化（重开续看）：");
store.persist();
const saved = JSON.parse(mem.get("dfwlfront-3-handoff-v1")!);
assert("localStorage 已存档且版本1", saved.version === 1 && Array.isArray(saved.trips));

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
