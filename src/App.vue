<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useDispatchStore } from "./stores/dispatch";
import { estimateTripHours, remainingRouteText, type Gap } from "./domain/rules";
import { TEMP_ZONES, type Assignment, type Handover, type OrderItem, type OrderStatus, type TempZone } from "./types";
import { hoursFromNow, windowText } from "./utils";

const store = useDispatchStore();
const tab = ref("console");

const ZONE_COLORS: Record<TempZone, string> = {
  冷冻: "#1d4ed8",
  冷藏: "#0f766e",
  恒温: "#b45309",
  常温: "#475569",
};

const ORDER_TAG: Record<OrderStatus, "success" | "info" | "warning" | "danger"> = {
  待派: "info",
  已派: "warning",
  在途: "success",
  交接中: "danger",
  已完成: "info",
};

const metrics = computed(() => [
  { label: "待派订单", value: store.pendingOrders.length },
  { label: "在途组合", value: store.liveAssignments.filter((a) => a.status === "在途").length },
  { label: "交接待确认", value: store.pendingHandovers.length },
  { label: "空闲车辆", value: store.freeVehicles.length },
]);

// ---------- 待派区 ----------
const drafts = reactive<Record<string, { vehicleId: string; driverId: string }>>({});

function draftOf(orderId: string) {
  if (!drafts[orderId]) drafts[orderId] = { vehicleId: "", driverId: "" };
  return drafts[orderId];
}

/** 未选完车/司机返回 null，否则返回缺口列表（空数组 = 可派） */
function gapsOf(order: OrderItem): Gap[] | null {
  const d = draftOf(order.id);
  if (!d.vehicleId || !d.driverId) return null;
  return store.gapsFor(order.id, d.vehicleId, d.driverId);
}

function canDispatch(order: OrderItem): boolean {
  const gaps = gapsOf(order);
  return !!gaps && gaps.length === 0;
}

function doAssign(order: OrderItem) {
  const d = draftOf(order.id);
  const gaps = store.assign(order.id, d.vehicleId, d.driverId);
  if (gaps.length) {
    ElMessage.warning("仍有缺口，订单留在待派区");
    return;
  }
  ElMessage.success(`${order.code} 已派车，等待发车`);
}

// ---------- 在途组合 ----------
const orderOf = (a: Assignment) => store.orderById(a.orderId);
const vehicleOf = (a: Assignment) => store.vehicleById(a.vehicleId);
const driverOf = (a: Assignment) => store.driverById(a.driverId);

function doDepart(a: Assignment) {
  store.depart(a.id);
  ElMessage.success("已发车，原组合锁定");
}

function doFinish(a: Assignment) {
  store.finish(a.id);
  ElMessage.success("已送达，组合释放，保养里程与驾驶时长已回写");
}

// ---------- 途中改派 ----------
const handover = reactive({
  visible: false,
  assignmentId: "",
  toVehicleId: "",
  toDriverId: "",
  kmDone: 0,
  reason: "",
});

const handoverAssignment = computed(() => store.assignments.find((a) => a.id === handover.assignmentId));
const handoverOrder = computed(() => {
  const a = handoverAssignment.value;
  return a ? store.orderById(a.orderId) : undefined;
});
const remainingPreview = computed(() => {
  const o = handoverOrder.value;
  return o ? remainingRouteText(o.route, o.routeKm, handover.kmDone) : "";
});
const handoverGaps = computed<Gap[] | null>(() => {
  const o = handoverOrder.value;
  if (!o || !handover.toVehicleId || !handover.toDriverId) return null;
  return store.gapsFor(o.id, handover.toVehicleId, handover.toDriverId, {
    routeKm: Math.max(0, o.routeKm - handover.kmDone),
    ignoreAssignmentId: handover.assignmentId,
  });
});
const canSubmitHandover = computed(() => {
  const g = handoverGaps.value;
  return !!g && g.length === 0 && handover.reason.trim().length > 0;
});

function openHandover(a: Assignment) {
  handover.assignmentId = a.id;
  handover.toVehicleId = "";
  handover.toDriverId = "";
  handover.kmDone = a.kmDone;
  handover.reason = "";
  handover.visible = true;
}

function submitHandover() {
  const gaps = store.requestHandover(
    handover.assignmentId,
    handover.toVehicleId,
    handover.toDriverId,
    handover.kmDone,
    handover.reason.trim(),
  );
  if (gaps.length) {
    ElMessage.warning("新组合仍有缺口，未交回");
    return;
  }
  handover.visible = false;
  ElMessage.success("剩余线路已交回，原车/原司机立即释放，待确认后新车接续");
}

function doConfirm(h: Handover) {
  const gaps = store.confirmHandover(h.id);
  if (gaps.length) {
    ElMessage.error(`确认失败：${gaps[0].text}`);
    return;
  }
  ElMessage.success("交接确认，新车继续承运");
}

// ---------- 资料维护 ----------
const orderForm = reactive({
  code: "",
  route: "",
  routeKm: 120,
  windowStart: hoursFromNow(2),
  windowEnd: hoursFromNow(8),
  cargoZone: "冷藏" as TempZone,
  weightKg: 1000,
});

function addOrder() {
  if (!orderForm.code.trim() || !orderForm.route.trim() || !orderForm.windowStart || !orderForm.windowEnd) {
    ElMessage.warning("请补全单号、线路与送达窗口");
    return;
  }
  if (orderForm.windowEnd <= orderForm.windowStart) {
    ElMessage.warning("送达窗口止需晚于窗口起");
    return;
  }
  store.addOrder({ ...orderForm, code: orderForm.code.trim(), route: orderForm.route.trim() });
  ElMessage.success("订单已录入待派区");
  orderForm.code = "";
  orderForm.route = "";
}

const vehicleForm = reactive({
  plate: "",
  capacityKg: 3000,
  zone: "冷藏" as TempZone,
  serviceDueAt: hoursFromNow(72),
  kmToService: 500,
});

function addVehicle() {
  if (!vehicleForm.plate.trim() || !vehicleForm.serviceDueAt) {
    ElMessage.warning("请补全车牌与保养时点");
    return;
  }
  store.addVehicle({ ...vehicleForm, plate: vehicleForm.plate.trim() });
  ElMessage.success("车辆已建档");
  vehicleForm.plate = "";
}

const driverForm = reactive({
  name: "",
  shiftStart: "06:00",
  shiftEnd: "18:00",
  maxContinuousHours: 8,
  drivenHours: 0,
});

function addDriver() {
  if (!driverForm.name.trim()) {
    ElMessage.warning("请填写司机姓名");
    return;
  }
  store.addDriver({ ...driverForm, name: driverForm.name.trim() });
  ElMessage.success("司机已建档");
  driverForm.name = "";
}

function removeOrder(order: OrderItem) {
  const err = store.removeOrder(order.id);
  if (err) ElMessage.warning(err);
  else ElMessage.success("订单已删除");
}

function removeVehicle(id: string) {
  const err = store.removeVehicle(id);
  if (err) ElMessage.warning(err);
  else ElMessage.success("车辆已删除");
}

function removeDriver(id: string) {
  const err = store.removeDriver(id);
  if (err) ElMessage.warning(err);
  else ElMessage.success("司机已删除");
}

async function resetAll() {
  try {
    await ElMessageBox.confirm("将清空当前全部资料与留档，恢复演示数据。", "重置数据", {
      type: "warning",
      confirmButtonText: "重置",
      cancelButtonText: "取消",
    });
    store.resetAll();
    ElMessage.success("已恢复演示数据");
  } catch {
    // 用户取消
  }
}

// ---------- 显示辅助 ----------
const plateOf = (id: string) => store.vehicleById(id)?.plate ?? "已删除车辆";
const nameOf = (id: string) => store.driverById(id)?.name ?? "已删除司机";
const codeOf = (id: string) => store.orderById(id)?.code ?? id;
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">物流 · 山路冷链</p>
          <h1>派车交接台</h1>
          <p class="subtitle">
            订单记线路、送达窗口、货温和重量；车辆记核载、温区和保养时点；司机记班次与连续驾驶时长。
            温区、载重、保养或休息不够就留在待派区并写明缺口；途中改派先交回剩余线路，原占用立即释放，确认后新车继续承运。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">Pinia</span>
          <span class="tag">Element Plus</span>
          <span class="tag">TypeScript</span>
          <el-button size="small" @click="resetAll">重置演示数据</el-button>
        </div>
      </header>

      <section class="metrics">
        <article v-for="m in metrics" :key="m.label" class="metric">
          <span>{{ m.label }}</span>
          <strong>{{ m.value }}</strong>
        </article>
      </section>

      <el-tabs v-model="tab" class="console-tabs">
        <!-- ============ 调度台 ============ -->
        <el-tab-pane label="调度台" name="console">
          <div class="console-grid">
            <section class="col">
              <h2 class="col-title">待派区 <small>缺口写明即留区</small></h2>
              <el-empty v-if="store.pendingOrders.length === 0" description="待派区已清空" :image-size="70" />
              <article v-for="order in store.pendingOrders" :key="order.id" class="order-card">
                <div class="record-head">
                  <p class="record-title">{{ order.code }} · {{ order.route }}</p>
                  <span class="zone-tag" :style="{ background: ZONE_COLORS[order.cargoZone] }">{{ order.cargoZone }}</span>
                </div>
                <div class="details">
                  <span>送达窗口：{{ windowText(order.windowStart, order.windowEnd) }}</span>
                  <span>货重：{{ order.weightKg }} kg</span>
                  <span>线路里程：{{ order.routeKm }} km</span>
                  <span>预估在途：{{ estimateTripHours(order.routeKm).toFixed(1) }} h</span>
                </div>
                <p v-if="order.note" class="note">{{ order.note }}</p>
                <div class="dispatch-row">
                  <el-select v-model="draftOf(order.id).vehicleId" placeholder="选择车辆" clearable>
                    <el-option
                      v-for="v in store.vehicles"
                      :key="v.id"
                      :value="v.id"
                      :label="`${v.plate}｜${v.zone}｜核载${v.capacityKg}kg｜保养剩${v.kmToService}km${store.occupiedVehicleIds.has(v.id) ? '｜占用中' : ''}`"
                    />
                  </el-select>
                  <el-select v-model="draftOf(order.id).driverId" placeholder="选择司机" clearable>
                    <el-option
                      v-for="d in store.drivers"
                      :key="d.id"
                      :value="d.id"
                      :label="`${d.name}｜班次${d.shiftStart}-${d.shiftEnd}｜已驾驶${d.drivenHours}h${store.occupiedDriverIds.has(d.id) ? '｜占用中' : ''}`"
                    />
                  </el-select>
                  <el-button type="primary" :disabled="!canDispatch(order)" @click="doAssign(order)">派车</el-button>
                </div>
                <el-alert v-if="gapsOf(order)?.length" type="warning" :closable="false" show-icon title="留在待派区，缺口：">
                  <ul class="gap-list">
                    <li v-for="g in gapsOf(order)!" :key="g.text">【{{ g.kind }}】{{ g.text }}</li>
                  </ul>
                </el-alert>
                <el-alert
                  v-else-if="gapsOf(order)"
                  type="success"
                  :closable="false"
                  show-icon
                  title="温区、载重、保养、休息均满足，且不撞班，可派车"
                />
              </article>
            </section>

            <section class="col">
              <h2 class="col-title">交接待确认 <small>原车已释放</small></h2>
              <el-empty v-if="store.pendingHandovers.length === 0" description="暂无待确认交接" :image-size="70" />
              <article v-for="h in store.pendingHandovers" :key="h.id" class="assign-card handover-card">
                <div class="record-head">
                  <p class="record-title">{{ codeOf(h.orderId) }} · 途中改派</p>
                  <el-tag type="danger" size="small">原车已释放</el-tag>
                </div>
                <div class="details">
                  <span>原车：{{ plateOf(h.fromVehicleId) }} / {{ nameOf(h.fromDriverId) }}（已跑 {{ h.kmDone }} km）</span>
                  <span>新车：{{ plateOf(h.toVehicleId) }} / {{ nameOf(h.toDriverId) }}</span>
                  <span>剩余线路：{{ h.remainingRoute }}</span>
                  <span>原因：{{ h.reason }}</span>
                </div>
                <div class="actions">
                  <el-button type="success" size="small" @click="doConfirm(h)">确认交接，新车继续承运</el-button>
                </div>
              </article>

              <h2 class="col-title">已派 / 在途组合 <small>发车后锁定</small></h2>
              <el-empty v-if="store.liveAssignments.length === 0" description="暂无已派组合" :image-size="70" />
              <article v-for="a in store.liveAssignments" :key="a.id" class="assign-card">
                <div class="record-head">
                  <p class="record-title">
                    {{ orderOf(a)?.code }} · {{ vehicleOf(a)?.plate }} / {{ driverOf(a)?.name }}
                  </p>
                  <el-tag :type="a.status === '在途' ? 'success' : 'warning'" size="small">
                    {{ a.status }}{{ a.locked ? " · 已锁定" : "" }}
                  </el-tag>
                </div>
                <div class="details">
                  <span>线路：{{ orderOf(a)?.route }}</span>
                  <span>送达窗口：{{ orderOf(a) ? windowText(orderOf(a)!.windowStart, orderOf(a)!.windowEnd) : "-" }}</span>
                  <span>已跑里程：{{ a.kmDone }} / {{ orderOf(a)?.routeKm }} km</span>
                  <span>货温/货重：{{ orderOf(a)?.cargoZone }} · {{ orderOf(a)?.weightKg }} kg</span>
                </div>
                <p v-if="a.note" class="note">{{ a.note }}</p>
                <div class="actions">
                  <el-button v-if="a.status === '已派'" type="success" size="small" @click="doDepart(a)">发车并锁定</el-button>
                  <template v-if="a.status === '在途'">
                    <el-button type="warning" size="small" @click="openHandover(a)">途中改派</el-button>
                    <el-button type="primary" size="small" @click="doFinish(a)">送达完成</el-button>
                  </template>
                </div>
              </article>
            </section>
          </div>
        </el-tab-pane>

        <!-- ============ 订单资料 ============ -->
        <el-tab-pane label="订单资料" name="orders">
          <div class="master-form">
            <el-input v-model="orderForm.code" placeholder="单号，如 CL-2605" />
            <el-input v-model="orderForm.route" placeholder="线路，如 昆明 → 大理" />
            <el-input-number v-model="orderForm.routeKm" :min="1" :max="3000" controls-position="right" placeholder="里程 km" />
            <el-date-picker v-model="orderForm.windowStart" type="datetime" value-format="YYYY-MM-DD HH:mm" placeholder="送达窗口起" />
            <el-date-picker v-model="orderForm.windowEnd" type="datetime" value-format="YYYY-MM-DD HH:mm" placeholder="送达窗口止" />
            <el-select v-model="orderForm.cargoZone" placeholder="货温">
              <el-option v-for="z in TEMP_ZONES" :key="z" :value="z" :label="z" />
            </el-select>
            <el-input-number v-model="orderForm.weightKg" :min="1" controls-position="right" placeholder="重量 kg" />
            <el-button type="primary" @click="addOrder">录入订单</el-button>
          </div>
          <el-table :data="store.orders" size="small" border>
            <el-table-column prop="code" label="单号" width="100" />
            <el-table-column prop="route" label="线路" min-width="170" />
            <el-table-column label="送达窗口" min-width="200">
              <template #default="{ row }">{{ windowText(row.windowStart, row.windowEnd) }}</template>
            </el-table-column>
            <el-table-column label="货温" width="80">
              <template #default="{ row }">
                <span class="zone-tag" :style="{ background: ZONE_COLORS[row.cargoZone as TempZone] }">{{ row.cargoZone }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="weightKg" label="重量 kg" width="90" />
            <el-table-column prop="routeKm" label="里程 km" width="90" />
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="ORDER_TAG[row.status as OrderStatus]" size="small">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80">
              <template #default="{ row }">
                <el-button link type="danger" size="small" @click="removeOrder(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- ============ 车辆资料 ============ -->
        <el-tab-pane label="车辆资料" name="vehicles">
          <div class="master-form">
            <el-input v-model="vehicleForm.plate" placeholder="车牌，如 云A·1A23" />
            <el-input-number v-model="vehicleForm.capacityKg" :min="1" controls-position="right" placeholder="核载 kg" />
            <el-select v-model="vehicleForm.zone" placeholder="温区">
              <el-option v-for="z in TEMP_ZONES" :key="z" :value="z" :label="z" />
            </el-select>
            <el-date-picker v-model="vehicleForm.serviceDueAt" type="datetime" value-format="YYYY-MM-DD HH:mm" placeholder="保养时点" />
            <el-input-number v-model="vehicleForm.kmToService" :min="0" controls-position="right" placeholder="保养剩余里程 km" />
            <el-button type="primary" @click="addVehicle">车辆建档</el-button>
          </div>
          <el-table :data="store.vehicles" size="small" border>
            <el-table-column prop="plate" label="车牌" width="120" />
            <el-table-column prop="capacityKg" label="核载 kg" width="100" />
            <el-table-column label="温区" width="90">
              <template #default="{ row }">
                <span class="zone-tag" :style="{ background: ZONE_COLORS[row.zone as TempZone] }">{{ row.zone }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="serviceDueAt" label="保养时点" width="160" />
            <el-table-column prop="kmToService" label="保养剩余里程 km" width="140" />
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="store.occupiedVehicleIds.has(row.id) ? 'warning' : 'success'" size="small">
                  {{ store.occupiedVehicleIds.has(row.id) ? "占用中" : "空闲" }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80">
              <template #default="{ row }">
                <el-button link type="danger" size="small" @click="removeVehicle(row.id)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- ============ 司机资料 ============ -->
        <el-tab-pane label="司机资料" name="drivers">
          <div class="master-form">
            <el-input v-model="driverForm.name" placeholder="姓名" />
            <el-time-select v-model="driverForm.shiftStart" start="00:00" step="00:30" end="23:30" placeholder="班次起" />
            <el-time-select v-model="driverForm.shiftEnd" start="00:00" step="00:30" end="23:30" placeholder="班次止" />
            <el-input-number v-model="driverForm.maxContinuousHours" :min="1" :max="24" controls-position="right" placeholder="连续驾驶上限 h" />
            <el-input-number v-model="driverForm.drivenHours" :min="0" :max="24" :step="0.5" controls-position="right" placeholder="已连续驾驶 h" />
            <el-button type="primary" @click="addDriver">司机建档</el-button>
          </div>
          <el-table :data="store.drivers" size="small" border>
            <el-table-column prop="name" label="姓名" width="110" />
            <el-table-column label="班次" width="150">
              <template #default="{ row }">{{ row.shiftStart }} – {{ row.shiftEnd }}</template>
            </el-table-column>
            <el-table-column prop="maxContinuousHours" label="连续驾驶上限 h" width="140" />
            <el-table-column prop="drivenHours" label="已连续驾驶 h" width="130" />
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="store.occupiedDriverIds.has(row.id) ? 'warning' : 'success'" size="small">
                  {{ store.occupiedDriverIds.has(row.id) ? "占用中" : "空闲" }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80">
              <template #default="{ row }">
                <el-button link type="danger" size="small" @click="removeDriver(row.id)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- ============ 交接留档 ============ -->
        <el-tab-pane label="交接留档" name="archive">
          <h3 class="table-title">改派交接记录</h3>
          <el-table :data="store.handovers" size="small" border>
            <el-table-column prop="createdAt" label="登记时间" width="150" />
            <el-table-column label="订单" width="90">
              <template #default="{ row }">{{ codeOf(row.orderId) }}</template>
            </el-table-column>
            <el-table-column label="原车 / 原司机" min-width="160">
              <template #default="{ row }">{{ plateOf(row.fromVehicleId) }} / {{ nameOf(row.fromDriverId) }}</template>
            </el-table-column>
            <el-table-column label="新车 / 新司机" min-width="160">
              <template #default="{ row }">{{ plateOf(row.toVehicleId) }} / {{ nameOf(row.toDriverId) }}</template>
            </el-table-column>
            <el-table-column prop="kmDone" label="已跑 km" width="90" />
            <el-table-column prop="remainingRoute" label="交回剩余线路" min-width="180" />
            <el-table-column prop="reason" label="原因" min-width="180" />
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="row.status === '待确认' ? 'danger' : 'success'" size="small">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="110">
              <template #default="{ row }">
                <el-button v-if="row.status === '待确认'" link type="success" size="small" @click="doConfirm(row)">确认交接</el-button>
                <span v-else class="muted">{{ row.confirmedAt }}</span>
              </template>
            </el-table-column>
          </el-table>

          <h3 class="table-title">派车留档</h3>
          <el-table :data="store.assignments" size="small" border>
            <el-table-column label="订单" width="90">
              <template #default="{ row }">{{ codeOf(row.orderId) }}</template>
            </el-table-column>
            <el-table-column label="车辆" width="110">
              <template #default="{ row }">{{ plateOf(row.vehicleId) }}</template>
            </el-table-column>
            <el-table-column label="司机" width="90">
              <template #default="{ row }">{{ nameOf(row.driverId) }}</template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag
                  :type="row.status === '在途' ? 'success' : row.status === '已派' ? 'warning' : row.status === '已交回' ? 'danger' : 'info'"
                  size="small"
                >{{ row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="kmDone" label="已跑 km" width="90" />
            <el-table-column prop="departedAt" label="发车时间" width="150" />
            <el-table-column prop="finishedAt" label="结束时间" width="150" />
            <el-table-column prop="note" label="备注" min-width="200" />
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- ============ 途中改派对话框 ============ -->
    <el-dialog v-model="handover.visible" title="途中改派 · 交回剩余线路" width="580px">
      <div v-if="handoverOrder && handoverAssignment" class="dialog-body">
        <el-alert
          type="info"
          :closable="false"
          show-icon
          :title="`原组合 ${plateOf(handoverAssignment.vehicleId)} / ${nameOf(handoverAssignment.driverId)} 已跑 ${handoverAssignment.kmDone} km，提交后原占用立即释放`"
        />
        <el-form label-position="top">
          <el-form-item :label="`已跑里程（km，全程 ${handoverOrder.routeKm} km）`">
            <el-input-number v-model="handover.kmDone" :min="0" :max="handoverOrder.routeKm" controls-position="right" />
          </el-form-item>
          <p class="remaining-preview">交回剩余线路：{{ remainingPreview }}</p>
          <el-form-item label="新车">
            <el-select v-model="handover.toVehicleId" placeholder="选择新车" style="width: 100%">
              <el-option
                v-for="v in store.vehicles"
                :key="v.id"
                :value="v.id"
                :label="`${v.plate}｜${v.zone}｜核载${v.capacityKg}kg｜保养剩${v.kmToService}km${store.occupiedVehicleIds.has(v.id) ? '｜占用中' : ''}`"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="新司机">
            <el-select v-model="handover.toDriverId" placeholder="选择新司机" style="width: 100%">
              <el-option
                v-for="d in store.drivers"
                :key="d.id"
                :value="d.id"
                :label="`${d.name}｜班次${d.shiftStart}-${d.shiftEnd}｜已驾驶${d.drivenHours}h${store.occupiedDriverIds.has(d.id) ? '｜占用中' : ''}`"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="改派原因">
            <el-input
              v-model="handover.reason"
              type="textarea"
              :rows="2"
              placeholder="如：原车制冷机组报警 / 司机连续驾驶到限需休息"
            />
          </el-form-item>
        </el-form>
        <el-alert v-if="handoverGaps && handoverGaps.length" type="warning" :closable="false" show-icon title="新组合缺口：">
          <ul class="gap-list">
            <li v-for="g in handoverGaps" :key="g.text">【{{ g.kind }}】{{ g.text }}</li>
          </ul>
        </el-alert>
        <el-alert v-else-if="handoverGaps" type="success" :closable="false" show-icon title="新组合可接续剩余线路" />
      </div>
      <template #footer>
        <el-button @click="handover.visible = false">取消</el-button>
        <el-button type="primary" :disabled="!canSubmitHandover" @click="submitHandover">交回剩余线路并释放原车</el-button>
      </template>
    </el-dialog>
  </main>
</template>
