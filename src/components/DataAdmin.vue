<script setup lang="ts">
// 资料维护层：订单（线路/窗口/货温/重量）、车辆（核载/温区/保养时点）、
// 司机（班次/连续驾驶时长）。只读展示在途占用，避免误改。
import { reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import type { Driver, Order, TempZone, Vehicle } from "../types";
import { useDispatchStore } from "../stores/dispatch";
import { MAX_CONTINUOUS_MINUTES, fmtShift, todayStr } from "../utils/time";
import { ZONES, zoneTagType } from "../utils/view";

const store = useDispatchStore();
const tab = ref<"orders" | "vehicles" | "drivers">("orders");

/* --------------------------------- 订单 --------------------------------- */

const emptyOrder = () => ({
  no: "",
  name: "",
  routeName: "",
  distanceKm: 100,
  stops: "",
  windowStart: `${todayStr()} 09:00`,
  windowEnd: `${todayStr()} 12:00`,
  tempZone: "冷藏" as TempZone,
  weightKg: 1000,
});
const orderForm = reactive(emptyOrder());

function submitOrder() {
  if (!orderForm.no.trim() || !orderForm.routeName.trim()) {
    ElMessage.warning("运单号和线路名称必填");
    return;
  }
  if (orderForm.distanceKm <= 0 || orderForm.weightKg <= 0) {
    ElMessage.warning("里程和重量需大于 0");
    return;
  }
  store.addOrder({
    no: orderForm.no.trim(),
    name: orderForm.name.trim() || orderForm.no,
    route: {
      name: orderForm.routeName.trim(),
      distanceKm: orderForm.distanceKm,
      stops: orderForm.stops.split(/[→\n,，]/).map((s) => s.trim()).filter(Boolean),
    },
    windowStart: orderForm.windowStart,
    windowEnd: orderForm.windowEnd,
    tempZone: orderForm.tempZone,
    weightKg: orderForm.weightKg,
  });
  ElMessage.success(`订单 ${orderForm.no} 已进入待派区`);
  Object.assign(orderForm, emptyOrder());
}

async function removeOrder(order: Order) {
  try {
    await ElMessageBox.confirm(`删除待派订单 ${order.no}？`, "确认", { type: "warning" });
  } catch {
    return;
  }
  store.removeOrder(order.id);
}

/* --------------------------------- 车辆 --------------------------------- */

const emptyVehicle = (): Omit<Vehicle, "id"> => ({
  plate: "",
  payloadKg: 3000,
  zones: ["冷藏"],
  odometerKm: 0,
  maintenanceDueMileageKm: 10000,
  maintenanceDueDate: todayStr(new Date(Date.now() + 14 * 86400000)),
});
const vehicleForm = reactive<Omit<Vehicle, "id">>(emptyVehicle());

function submitVehicle() {
  if (!vehicleForm.plate.trim()) {
    ElMessage.warning("车牌号必填");
    return;
  }
  if (vehicleForm.zones.length === 0) {
    ElMessage.warning("至少选择一个温区");
    return;
  }
  if (vehicleForm.maintenanceDueMileageKm <= vehicleForm.odometerKm) {
    ElMessage.warning("下次保养里程点必须大于当前表显里程");
    return;
  }
  store.addVehicle({ ...vehicleForm, plate: vehicleForm.plate.trim() });
  ElMessage.success("车辆已建档");
  Object.assign(vehicleForm, emptyVehicle());
}

async function removeVehicle(vehicle: Vehicle) {
  try {
    await ElMessageBox.confirm(`删除车辆 ${vehicle.plate}？在途车辆不可删。`, "确认", { type: "warning" });
  } catch {
    return;
  }
  const before = store.vehicles.length;
  store.removeVehicle(vehicle.id);
  if (store.vehicles.length === before) ElMessage.warning("该车在在途运次中，不可删除");
}

function isVehicleBusy(id: string) {
  return store.trips.some((t) => t.status === "active" && t.vehicleId === id);
}

/* --------------------------------- 司机 --------------------------------- */

const emptyDriver = (): Omit<Driver, "id"> => ({
  name: "",
  shiftDate: todayStr(),
  shiftStart: "08:00",
  shiftEnd: "16:00",
  continuousMinutes: 0,
});
const driverForm = reactive<Omit<Driver, "id">>(emptyDriver());

function submitDriver() {
  if (!driverForm.name.trim()) {
    ElMessage.warning("司机姓名必填");
    return;
  }
  store.addDriver({ ...driverForm, name: driverForm.name.trim() });
  ElMessage.success("司机已建档");
  Object.assign(driverForm, emptyDriver());
}

async function removeDriver(driver: Driver) {
  try {
    await ElMessageBox.confirm(`删除司机 ${driver.name}？在途司机不可删。`, "确认", { type: "warning" });
  } catch {
    return;
  }
  const before = store.drivers.length;
  store.removeDriver(driver.id);
  if (store.drivers.length === before) ElMessage.warning("该司机在在途运次中，不可删除");
}

function isDriverBusy(id: string) {
  return store.trips.some((t) => t.status === "active" && t.driverId === id);
}

function tripOfVehicle(id: string) {
  return store.trips.find((t) => t.status === "active" && t.vehicleId === id);
}
function tripOfDriver(id: string) {
  return store.trips.find((t) => t.status === "active" && t.driverId === id);
}
function orderLabel(tripId?: string | null) {
  if (!tripId) return "";
  const trip = store.trips.find((t) => t.id === tripId);
  return trip ? store.orderMap[trip.orderId]?.no : "";
}
</script>

<template>
  <el-tabs v-model="tab" class="data-tabs">
    <!-- 订单 -->
    <el-tab-pane label="订单资料" name="orders">
      <el-card shadow="never" class="form-card">
        <template #header><b>新增订单</b>（线路 / 送达窗口 / 货温 / 重量）</template>
        <el-form :model="orderForm" label-position="top" class="data-form">
          <div class="fld"><label>运单号</label>
            <el-input v-model="orderForm.no" placeholder="LL-2609-15" /></div>
          <div class="fld"><label>货物名称</label>
            <el-input v-model="orderForm.name" placeholder="冷冻牛排" /></div>
          <div class="fld span2"><label>线路名称</label>
            <el-input v-model="orderForm.routeName" placeholder="云岭山冷库 → 城北分拨中心" /></div>
          <div class="fld"><label>单程里程 km</label>
            <el-input-number v-model="orderForm.distanceKm" :min="1" :step="10" /></div>
          <div class="fld"><label>货重 kg</label>
            <el-input-number v-model="orderForm.weightKg" :min="1" :step="100" /></div>
          <div class="fld"><label>货温温区</label>
            <el-select v-model="orderForm.tempZone">
              <el-option v-for="z in ZONES" :key="z" :value="z" :label="z" />
            </el-select></div>
          <div class="fld span2"><label>途经节点（用 → 或逗号分隔）</label>
            <el-input v-model="orderForm.stops" placeholder="云岭山冷库 → 垭口检查站 → 城北分拨中心" /></div>
          <div class="fld"><label>窗口起</label>
            <el-date-picker v-model="orderForm.windowStart" type="datetime" format="MM-dd HH:mm"
              value-format="YYYY-MM-DD HH:mm" class="full" /></div>
          <div class="fld"><label>窗口止</label>
            <el-date-picker v-model="orderForm.windowEnd" type="datetime" format="MM-dd HH:mm"
              value-format="YYYY-MM-DD HH:mm" class="full" /></div>
          <div class="fld span2 actions-cell">
            <el-button type="primary" @click="submitOrder">加入待派区</el-button>
          </div>
        </el-form>
      </el-card>

      <el-table :data="store.orders" stripe class="data-table">
        <el-table-column prop="no" label="运单号" width="120" />
        <el-table-column prop="name" label="货物" min-width="160" />
        <el-table-column label="温区" width="80">
          <template #default="{ row }: { row: Order }">
            <el-tag :type="zoneTagType(row.tempZone)" size="small">{{ row.tempZone }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="线路 / 里程" min-width="220">
          <template #default="{ row }: { row: Order }">
            {{ row.route.name }}（{{ row.route.distanceKm }}km）
          </template>
        </el-table-column>
        <el-table-column label="送达窗口" min-width="200">
          <template #default="{ row }: { row: Order }">{{ row.windowStart }} ~ {{ row.windowEnd.slice(-5) }}</template>
        </el-table-column>
        <el-table-column prop="weightKg" label="货重kg" width="90" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }: { row: Order }">
            <el-tag size="small" :type="row.status === 'pending' ? 'info' : row.status === 'assigned' ? 'success' : 'primary'">
              {{ row.status === "pending" ? "待派" : row.status === "assigned" ? "在途" : "送达" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90">
          <template #default="{ row }: { row: Order }">
            <el-button v-if="row.status === 'pending'" link type="danger" @click="removeOrder(row)">删除</el-button>
            <span v-else class="muted">已派车锁定</span>
          </template>
        </el-table-column>
      </el-table>
    </el-tab-pane>

    <!-- 车辆 -->
    <el-tab-pane label="车辆资料" name="vehicles">
      <el-card shadow="never" class="form-card">
        <template #header><b>新增车辆</b>（核载 / 温区 / 保养时点）</template>
        <el-form :model="vehicleForm" label-position="top" class="data-form">
          <div class="fld"><label>车牌号</label><el-input v-model="vehicleForm.plate" placeholder="沪D·X1234" /></div>
          <div class="fld"><label>核载 kg</label>
            <el-input-number v-model="vehicleForm.payloadKg" :min="500" :step="500" /></div>
          <div class="fld span2"><label>可用温区</label>
            <el-checkbox-group v-model="vehicleForm.zones">
              <el-checkbox v-for="z in ZONES" :key="z" :value="z" :label="z" />
            </el-checkbox-group>
          </div>
          <div class="fld"><label>当前表显 km</label>
            <el-input-number v-model="vehicleForm.odometerKm" :min="0" :step="1000" /></div>
          <div class="fld"><label>下次保养里程点 km</label>
            <el-input-number v-model="vehicleForm.maintenanceDueMileageKm" :min="0" :step="1000" /></div>
          <div class="fld"><label>下次保养日期</label>
            <el-date-picker v-model="vehicleForm.maintenanceDueDate" type="date" format="YYYY-MM-DD"
              value-format="YYYY-MM-DD" class="full" /></div>
          <div class="fld actions-cell">
            <el-button type="primary" @click="submitVehicle">建档车辆</el-button>
          </div>
        </el-form>
      </el-card>

      <el-table :data="store.vehicles" stripe class="data-table">
        <el-table-column prop="plate" label="车牌" width="120" />
        <el-table-column prop="payloadKg" label="核载kg" width="90" />
        <el-table-column label="温区" min-width="150">
          <template #default="{ row }: { row: Vehicle }">
            <el-tag v-for="z in row.zones" :key="z" :type="zoneTagType(z)" size="small" class="mr4">{{ z }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="表显 / 保养点" width="170">
          <template #default="{ row }: { row: Vehicle }">
            <span :class="{ warn: row.maintenanceDueMileageKm - row.odometerKm < 300 }">
              {{ row.odometerKm }} / {{ row.maintenanceDueMileageKm }} km
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="maintenanceDueDate" label="保养到期" width="110" />
        <el-table-column label="当前占用" min-width="120">
          <template #default="{ row }: { row: Vehicle }">
            <el-tag v-if="isVehicleBusy(row.id)" type="success" size="small">
              在途 {{ orderLabel(tripOfVehicle(row.id)?.id) }}
            </el-tag>
            <el-tag v-else type="info" size="small">空闲</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90">
          <template #default="{ row }: { row: Vehicle }">
            <el-button link type="danger" :disabled="isVehicleBusy(row.id)" @click="removeVehicle(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-tab-pane>

    <!-- 司机 -->
    <el-tab-pane label="司机资料" name="drivers">
      <el-card shadow="never" class="form-card">
        <template #header><b>新增司机</b>（班次 / 连续驾驶时长）</template>
        <el-form :model="driverForm" label-position="top" class="data-form">
          <div class="fld"><label>姓名</label><el-input v-model="driverForm.name" placeholder="司机姓名" /></div>
          <div class="fld"><label>班次日期</label>
            <el-date-picker v-model="driverForm.shiftDate" type="date" format="YYYY-MM-DD"
              value-format="YYYY-MM-DD" class="full" /></div>
          <div class="fld"><label>上班</label><el-time-picker v-model="driverForm.shiftStart" format="HH:mm"
            value-format="HH:mm" class="full" placeholder="上班时间" /></div>
          <div class="fld"><label>下班（次日亦可）</label><el-time-picker v-model="driverForm.shiftEnd" format="HH:mm"
            value-format="HH:mm" class="full" placeholder="下班时间" /></div>
          <div class="fld"><label>连续驾驶分钟</label>
            <el-input-number v-model="driverForm.continuousMinutes" :min="0" :max="600" :step="10" /></div>
          <div class="fld actions-cell">
            <el-button type="primary" @click="submitDriver">建档司机</el-button>
          </div>
        </el-form>
      </el-card>

      <el-table :data="store.drivers" stripe class="data-table">
        <el-table-column prop="name" label="姓名" width="100" />
        <el-table-column label="班次" min-width="200">
          <template #default="{ row }: { row: Driver }">{{ fmtShift(row) }}</template>
        </el-table-column>
        <el-table-column label="连续驾驶" width="180">
          <template #default="{ row }: { row: Driver }">
            <el-tag :type="row.continuousMinutes >= MAX_CONTINUOUS_MINUTES ? 'danger' : 'info'" size="small">
              {{ row.continuousMinutes }} 分钟
            </el-tag>
            <span v-if="row.continuousMinutes >= MAX_CONTINUOUS_MINUTES" class="warn-inline">须休 20 分</span>
          </template>
        </el-table-column>
        <el-table-column label="当前占用" min-width="120">
          <template #default="{ row }: { row: Driver }">
            <el-tag v-if="isDriverBusy(row.id)" type="success" size="small">
              在途 {{ orderLabel(tripOfDriver(row.id)?.id) }}
            </el-tag>
            <el-tag v-else type="info" size="small">空闲</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90">
          <template #default="{ row }: { row: Driver }">
            <el-button link type="danger" :disabled="isDriverBusy(row.id)" @click="removeDriver(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-tab-pane>
  </el-tabs>
</template>
