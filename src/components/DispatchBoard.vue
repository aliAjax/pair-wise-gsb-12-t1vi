<script setup lang="ts">
// 派车交接台：待派区（缺口明示）+ 在途区（锁定组合、途中改派两步走）。
import { computed, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import type { Driver, Order, Trip, Vehicle } from "../types";
import { useDispatchStore } from "../stores/dispatch";
import { evaluateDispatch } from "../rules/dispatch";
import {
  MOUNTAIN_SPEED_KMH,
  estDriveMinutes,
  fmtDateTime,
  fmtMinutes,
  fmtShift,
  parseLocal,
  toLocalInput,
} from "../utils/time";
import { TRIP_STATUS_TEXT, zoneTagType } from "../utils/view";

const store = useDispatchStore();

/* ------------------------------- 待派区试算 ------------------------------- */

const selections = reactive<Record<string, { vehicleId: string; driverId: string; start: string }>>({});

function pick(orderId: string) {
  if (!selections[orderId]) {
    selections[orderId] = {
      vehicleId: store.vehicles[0]?.id ?? "",
      driverId: store.drivers[0]?.id ?? "",
      start: toLocalInput(),
    };
  }
  return selections[orderId];
}

function evaluationOf(order: Order) {
  const sel = pick(order.id);
  const start = parseLocal(sel.start);
  if (!start || !sel.vehicleId || !sel.driverId) return null;
  return evaluateDispatch(
    { vehicles: store.vehicles, drivers: store.drivers, trips: store.trips },
    { order, vehicleId: sel.vehicleId, driverId: sel.driverId, planStart: start }
  );
}

/** 一键带出缺口最少 / 直接可行的车+司机组合 */
function suggest(order: Order) {
  const sel = pick(order.id);
  const start = parseLocal(sel.start) ?? new Date();
  let best: { v: string; d: string; count: number } | null = null;
  for (const v of store.vehicles) {
    for (const d of store.drivers) {
      const ev = evaluateDispatch(
        { vehicles: store.vehicles, drivers: store.drivers, trips: store.trips },
        { order, vehicleId: v.id, driverId: d.id, planStart: start }
      );
      if (ev.ok) {
        sel.vehicleId = v.id;
        sel.driverId = d.id;
        ElMessage.success(`已带出可行组合：${v.plate} + ${d.name}`);
        return;
      }
      if (!best || ev.gaps.length < best.count) best = { v: v.id, d: d.id, count: ev.gaps.length };
    }
  }
  if (best) {
    sel.vehicleId = best.v;
    sel.driverId = best.d;
    ElMessage.warning("暂无完全可行组合，已带出缺口最少的组合");
  }
}

function doDispatch(order: Order) {
  const sel = pick(order.id);
  const result = store.dispatch(order.id, sel.vehicleId, sel.driverId, sel.start);
  if (result.ok) {
    ElMessage.success(`已派车，组合锁定：${order.no}`);
  } else {
    ElMessage.error("有缺口，订单留在待派区");
  }
}

/* ------------------------------ 在途：交回/接续 ------------------------------ */

interface HandoverForm {
  tripId: string;
  reason: string;
  runMileageKm: number | null;
  runMinutes: number | null;
}
const handoverForm = ref<HandoverForm | null>(null);

function openHandover(trip: Trip) {
  const order = store.orderMap[trip.orderId];
  handoverForm.value = {
    tripId: trip.id,
    reason: "",
    runMileageKm: Math.min(trip.runMileageKm + 45, order?.route.distanceKm ?? trip.runMileageKm),
    runMinutes: trip.runMinutes + 90,
  };
}

const handoverTrip = computed(() =>
  handoverForm.value ? store.trips.find((t) => t.id === handoverForm.value!.tripId) : null
);
const showHandover = computed({
  get: () => handoverForm.value !== null,
  set: (v: boolean) => {
    if (!v) handoverForm.value = null;
  },
});

function confirmHandover() {
  const form = handoverForm.value;
  const trip = handoverTrip.value;
  if (!form || !trip) return;
  if (!form.reason.trim()) {
    ElMessage.warning("请填写改派原因（如：换车、司机连续驾驶超时）");
    return;
  }
  if (form.runMileageKm == null || form.runMileageKm <= trip.runMileageKm) {
    ElMessage.warning("已跑里程需大于交回时的累计里程");
    return;
  }
  const order = store.orderMap[trip.orderId];
  if (order && form.runMileageKm > order.route.distanceKm) {
    ElMessage.warning("已跑里程不能超过线路总里程");
    return;
  }
  store.handover(trip.id, form.reason.trim(), form.runMileageKm, form.runMinutes ?? trip.runMinutes);
  handoverForm.value = null;
  ElMessage.success("剩余线路已交回，原车/司机占用立即释放");
}

const reassignSel = reactive<Record<string, { vehicleId: string; driverId: string; start: string }>>({});

function reassignPick(tripId: string) {
  if (!reassignSel[tripId]) {
    reassignSel[tripId] = {
      vehicleId: store.vehicles[0]?.id ?? "",
      driverId: store.drivers[0]?.id ?? "",
      start: toLocalInput(),
    };
  }
  return reassignSel[tripId];
}

function reassignEvaluation(trip: Trip) {
  const order = store.orderMap[trip.orderId];
  const sel = reassignPick(trip.id);
  const start = parseLocal(sel.start);
  if (!order || !start || !sel.vehicleId || !sel.driverId) return null;
  return evaluateDispatch(
    { vehicles: store.vehicles, drivers: store.drivers, trips: store.trips },
    {
      order,
      vehicleId: sel.vehicleId,
      driverId: sel.driverId,
      planStart: start,
      runMileageKm: trip.runMileageKm,
      excludeTripId: trip.id,
    }
  );
}

function confirmReassign(trip: Trip) {
  const sel = reassignPick(trip.id);
  const result = store.reassign(trip.id, sel.vehicleId, sel.driverId, sel.start);
  if (result.ok) {
    ElMessage.success("新车已确认，继续承运剩余线路");
  } else {
    ElMessage.error("组合仍有缺口，运次保留在待接续");
  }
}

function rest(driverId: string) {
  store.rest(driverId);
  ElMessage.success("已打卡休息 20 分钟，连续驾驶时长清零");
}

function complete(trip: Trip) {
  store.complete(trip.id);
  ElMessage.success("已送达并回场");
}

/* --------------------------------- 展示 --------------------------------- */

function vehicleOf(trip: Trip): Vehicle | undefined {
  return trip.vehicleId ? store.vehicleMap[trip.vehicleId] : undefined;
}
function driverOf(trip: Trip): Driver | undefined {
  return trip.driverId ? store.driverMap[trip.driverId] : undefined;
}
function windowWarn(order: Order, selStart: string): boolean {
  const start = parseLocal(selStart);
  if (!start) return false;
  const minutes = estDriveMinutes(order.route.distanceKm);
  const etaTime = new Date(start.getTime() + minutes * 60000);
  const winEnd = parseLocal(order.windowEnd);
  return !!winEnd && etaTime > winEnd;
}
</script>

<template>
  <div class="board">
    <!-- 待派区 -->
    <section class="zone">
      <div class="zone-head">
        <h2>待派区 <span class="count">{{ store.pendingOrders.length }}</span></h2>
        <p>温区、载重、保养里程/时点、班次或休息不够即拦截，缺口写在订单下方。</p>
      </div>
      <el-empty v-if="store.pendingOrders.length === 0" description="没有待派订单" />
      <div v-else class="cards">
        <article v-for="order in store.pendingOrders" :key="order.id" class="card pending-card">
          <div class="card-head">
            <div>
              <span class="order-no">{{ order.no }}</span>
              <span class="order-name">{{ order.name }}</span>
            </div>
            <el-tag :type="zoneTagType(order.tempZone)" effect="dark" round>{{ order.tempZone }}</el-tag>
          </div>

          <div class="kv-grid">
            <div class="kv"><span>线路</span><b>{{ order.route.name }}</b></div>
            <div class="kv"><span>里程 / 均速</span><b>{{ order.route.distanceKm }}km · {{ MOUNTAIN_SPEED_KMH }}km/h</b></div>
            <div class="kv"><span>送达窗口</span><b>{{ order.windowStart }} ~ {{ order.windowEnd.slice(-5) }}</b></div>
            <div class="kv"><span>货重 / 核载需求</span><b>{{ order.weightKg }}kg</b></div>
            <div class="kv kv-wide"><span>途经</span><b>{{ order.route.stops.join(" → ") }}</b></div>
          </div>

          <div class="assign-row">
            <el-select v-model="pick(order.id).vehicleId" placeholder="选车" size="large" class="grow">
              <el-option v-for="v in store.vehicles" :key="v.id" :value="v.id"
                :label="`${v.plate}｜核载${v.payloadKg}kg｜${v.zones.join('/')}`" />
            </el-select>
            <el-select v-model="pick(order.id).driverId" placeholder="选司机" size="large" class="grow">
              <el-option v-for="d in store.drivers" :key="d.id" :value="d.id"
                :label="`${d.name}｜已连续驾驶${d.continuousMinutes}分`" />
            </el-select>
            <el-date-picker v-model="pick(order.id).start" type="datetime" format="MM-dd HH:mm"
              value-format="YYYY-MM-DD HH:mm" placeholder="发车时间" size="large" class="grow" />
            <el-button size="large" @click="suggest(order)">智能匹配</el-button>
            <el-button size="large" type="primary" @click="doDispatch(order)">派车锁定</el-button>
          </div>

          <!-- 实时试算 -->
          <template v-if="evaluationOf(order)">
            <div v-if="evaluationOf(order)!.ok" class="gaps ok">
              <el-icon><span>✓</span></el-icon>
              组合可行：预计驾驶 {{ fmtMinutes(evaluationOf(order)!.driveMinutes) }}，
              预计 {{ fmtDateTime(evaluationOf(order)!.planEnd.toISOString()) }} 送达
              <el-alert v-for="(w, i) in evaluationOf(order)!.warnings" :key="i" type="warning" :closable="false"
                :title="w" class="inline-alert" />
              <el-alert v-if="windowWarn(order, pick(order.id).start)" type="warning" :closable="false"
                title="预计送达晚于窗口截止，请尽快发车或换更近车辆" class="inline-alert" />
            </div>
            <ul v-else class="gaps">
              <li v-for="gap in evaluationOf(order)!.gaps" :key="gap.code" class="gap-item">
                <el-tag type="danger" size="small" effect="plain">缺口</el-tag>{{ gap.message }}
              </li>
            </ul>
          </template>

          <!-- 最近一次派车被拒留档的缺口（实时校验也不通过时重复展示无意义） -->
          <ul
            v-if="order.lastGaps.length && (!evaluationOf(order) || !evaluationOf(order)!.ok)"
            class="gaps stamped"
          >
            <li v-for="gap in order.lastGaps" :key="gap.code" class="gap-item">
              <el-tag type="warning" size="small" effect="plain">留档缺口</el-tag>{{ gap.message }}
            </li>
          </ul>
        </article>
      </div>
    </section>

    <!-- 在途 / 待接续 -->
    <section class="zone">
      <div class="zone-head">
        <h2>在途运次 <span class="count">{{ store.activeTrips.length }}</span></h2>
        <p>发车后车+司机组合锁定；途中改派先交回剩余线路并记录原车/新车、已跑里程与原因。</p>
      </div>
      <el-empty v-if="store.activeTrips.length === 0" description="暂无在途运次" />
      <div v-else class="cards">
        <article v-for="trip in store.activeTrips" :key="trip.id" class="card"
          :class="trip.status === 'handover' ? 'handover-card' : 'active-card'">
          <div class="card-head">
            <div>
              <span class="order-no">{{ store.orderMap[trip.orderId]?.no }}</span>
              <span class="order-name">{{ store.orderMap[trip.orderId]?.name }}</span>
            </div>
            <el-tag :type="trip.status === 'active' ? 'success' : 'warning'" effect="dark" round>
              {{ TRIP_STATUS_TEXT[trip.status] }}
            </el-tag>
          </div>

          <!-- 交回记录（留档：原车/新车/里程/原因） -->
          <div v-for="(rec, i) in trip.history" :key="i" class="handover-recap">
            <div class="recap-title">
              第 {{ i + 1 }} 次途中改派 · {{ fmtDateTime(rec.at) }}
            </div>
            <div class="kv-grid">
              <div class="kv"><span>原车</span><b>{{ rec.oldVehicleId ? store.vehicleMap[rec.oldVehicleId]?.plate : "—" }}</b></div>
              <div class="kv"><span>原司机</span><b>{{ rec.oldDriverId ? store.driverMap[rec.oldDriverId]?.name : "—" }}</b></div>
              <div class="kv"><span>新车</span><b>{{ rec.newVehicleId ? store.vehicleMap[rec.newVehicleId]?.plate : "待接续" }}</b></div>
              <div class="kv"><span>新司机</span><b>{{ rec.newDriverId ? store.driverMap[rec.newDriverId]?.name : "待接续" }}</b></div>
              <div class="kv"><span>交回时已跑</span><b>{{ rec.runMileageKm }}km / {{ fmtMinutes(rec.runMinutes) }}</b></div>
              <div class="kv kv-wide"><span>原因</span><b>{{ rec.reason }}</b></div>
            </div>
          </div>

          <div class="kv-grid" v-if="store.orderMap[trip.orderId]">
            <div class="kv"><span>线路</span><b>{{ store.orderMap[trip.orderId].route.name }}</b></div>
            <div class="kv">
              <span>已跑 / 全程</span>
              <b>{{ trip.runMileageKm }}km / {{ store.orderMap[trip.orderId].route.distanceKm }}km
                （剩 {{ Math.max(0, store.orderMap[trip.orderId].route.distanceKm - trip.runMileageKm) }}km）</b>
            </div>
            <div class="kv">
              <span>当前车辆</span>
              <b :class="{ muted: !vehicleOf(trip) }">{{ vehicleOf(trip)?.plate ?? "已交回" }}</b>
            </div>
            <div class="kv">
              <span>当前司机</span>
              <b :class="{ muted: !driverOf(trip) }">
                {{ driverOf(trip)?.name ?? "已交回" }}
                <em v-if="driverOf(trip)">连续驾驶 {{ driverOf(trip)!.continuousMinutes }} 分</em>
              </b>
            </div>
            <div class="kv kv-wide"><span>司机班次</span><b>{{ driverOf(trip) ? fmtShift(driverOf(trip)!) : "—" }}</b></div>
          </div>

          <!-- 在途：可休息 / 交回 / 送达 -->
          <div v-if="trip.status === 'active'" class="assign-row">
            <el-button :disabled="!driverOf(trip)" @click="driverOf(trip) && rest(driverOf(trip)!.id)">
              休息打卡 20 分
            </el-button>
            <el-button type="warning" plain @click="openHandover(trip)">途中改派：交回剩余线路</el-button>
            <el-button type="success" plain class="grow-0" @click="complete(trip)">确认送达</el-button>
          </div>

          <!-- 待接续：选新车+新司机，确认后续运 -->
          <div v-else class="reassign-box">
            <p class="box-title">原占用已释放，请确认新车/新司机接续剩余线路：</p>
            <div class="assign-row">
              <el-select v-model="reassignPick(trip.id).vehicleId" placeholder="选车" size="large" class="grow">
                <el-option v-for="v in store.vehicles" :key="v.id" :value="v.id"
                  :label="`${v.plate}｜核载${v.payloadKg}kg｜${v.zones.join('/')}`" />
              </el-select>
              <el-select v-model="reassignPick(trip.id).driverId" placeholder="选司机" size="large" class="grow">
                <el-option v-for="d in store.drivers" :key="d.id" :value="d.id"
                  :label="`${d.name}｜连续驾驶${d.continuousMinutes}分`" />
              </el-select>
              <el-date-picker v-model="reassignPick(trip.id).start" type="datetime" format="MM-dd HH:mm"
                value-format="YYYY-MM-DD HH:mm" placeholder="接续时间" size="large" class="grow" />
              <el-button size="large" type="primary" @click="confirmReassign(trip)">确认接续承运</el-button>
            </div>
            <template v-if="reassignEvaluation(trip)">
              <div v-if="reassignEvaluation(trip)!.ok" class="gaps ok">
                ✓ 接续可行：剩余 {{ reassignEvaluation(trip)!.remainingKm }}km，预计驾驶
                {{ fmtMinutes(reassignEvaluation(trip)!.driveMinutes) }}
                <el-alert v-for="(w, i) in reassignEvaluation(trip)!.warnings" :key="i" type="warning"
                  :closable="false" :title="w" class="inline-alert" />
              </div>
              <ul v-else class="gaps">
                <li v-for="gap in reassignEvaluation(trip)!.gaps" :key="gap.code" class="gap-item">
                  <el-tag type="danger" size="small" effect="plain">缺口</el-tag>{{ gap.message }}
                </li>
              </ul>
            </template>
          </div>
        </article>
      </div>
    </section>

    <!-- 交回弹窗 -->
    <el-dialog v-model="showHandover" title="途中改派：交回剩余线路" width="520px">
      <el-alert type="warning" :closable="false" class="dialog-alert"
        title="交回后原车/原司机占用立即释放，可派新单；本运次进入待接续，需选新车确认后续运。" />
      <el-form label-position="top" class="handover-form">
        <el-form-item label="改派原因（留档）">
          <el-input v-model="handoverForm!.reason" type="textarea" :rows="2"
            placeholder="如：车辆故障拖车 / 司机连续驾驶满 4 小时需休息" />
        </el-form-item>
        <el-form-item v-if="handoverTrip && store.orderMap[handoverTrip.orderId]" :label="`已跑里程（全程 ${store.orderMap[handoverTrip.orderId].route.distanceKm}km，当前累计 ${handoverTrip.runMileageKm}km）`">
          <el-input-number v-model="handoverForm!.runMileageKm" :min="handoverTrip.runMileageKm"
            :max="store.orderMap[handoverTrip.orderId].route.distanceKm" :step="5" />
          <span class="unit">km</span>
        </el-form-item>
        <el-form-item label="本段已驾驶分钟">
          <el-input-number v-model="handoverForm!.runMinutes" :min="handoverTrip?.runMinutes ?? 0" :step="10" />
          <span class="unit">分钟</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="handoverForm = null">取消</el-button>
        <el-button type="warning" @click="confirmHandover">交回并释放占用</el-button>
      </template>
    </el-dialog>
  </div>
</template>
