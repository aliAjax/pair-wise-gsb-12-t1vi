<script setup lang="ts">
// 留档层：派车、拦截、交回、接续、送达、休息、资料变更全部可查。
import { computed, ref } from "vue";
import type { LogType } from "../types";
import { useDispatchStore } from "../stores/dispatch";
import { fmtDateTime, fmtMinutes } from "../utils/time";
import { LOG_TEXT, TRIP_STATUS_TEXT, logTagType } from "../utils/view";

const store = useDispatchStore();
const typeFilter = ref<LogType | "all">("all");

const filters: Array<{ value: LogType | "all"; label: string }> = [
  { value: "all", label: "全部" },
  { value: "dispatched", label: "派车" },
  { value: "blocked", label: "拦截" },
  { value: "handed_over", label: "交回" },
  { value: "reassigned", label: "接续" },
  { value: "completed", label: "送达" },
  { value: "rested", label: "休息" },
  { value: "data", label: "资料" },
];

const logs = computed(() =>
  typeFilter.value === "all" ? store.logs : store.logs.filter((l) => l.type === typeFilter.value)
);
const completedTrips = computed(() =>
  store.trips
    .filter((t) => t.status === "completed")
    .map((trip) => ({ trip, order: store.orderMap[trip.orderId] }))
);
</script>

<template>
  <div class="archive">
    <section class="zone">
      <div class="zone-head">
        <h2>交接档案 <span class="count">{{ completedTrips.length }}</span></h2>
        <p>已送达运次的原车/新车、已跑里程与改派原因永久留档（本地存储）。</p>
      </div>
      <el-empty v-if="completedTrips.length === 0" description="暂无已完成运次" />
      <div v-else class="cards">
        <article v-for="{ trip, order } in completedTrips" :key="trip.id" class="card archive-card">
          <div class="card-head">
            <div>
              <span class="order-no">{{ order?.no ?? trip.orderId }}</span>
              <span class="order-name">{{ order?.name }}</span>
            </div>
            <el-tag type="info" effect="dark" round>{{ TRIP_STATUS_TEXT[trip.status] }}</el-tag>
          </div>
          <div class="kv-grid">
            <div class="kv"><span>线路</span><b>{{ order?.route.name }}</b></div>
            <div class="kv"><span>全程</span><b>{{ trip.runMileageKm }}km / {{ fmtMinutes(trip.runMinutes) }}</b></div>
            <div class="kv"><span>发车</span><b>{{ fmtDateTime(trip.createdAt) }}</b></div>
            <div class="kv"><span>送达</span><b>{{ fmtDateTime(trip.planEnd) }}</b></div>
          </div>
          <el-timeline v-if="trip.history.length" class="history-line">
            <el-timeline-item v-for="(rec, i) in trip.history" :key="i" :timestamp="fmtDateTime(rec.at)"
              placement="top" type="warning">
              <b>第 {{ i + 1 }} 次途中改派：</b>{{ rec.reason }}<br />
              {{ rec.oldVehicleId ? store.vehicleMap[rec.oldVehicleId]?.plate : "—" }}
              / {{ rec.oldDriverId ? store.driverMap[rec.oldDriverId]?.name : "—" }}
              →
              {{ rec.newVehicleId ? store.vehicleMap[rec.newVehicleId]?.plate : "未接续" }}
              / {{ rec.newDriverId ? store.driverMap[rec.newDriverId]?.name : "未接续" }}；
              交回时已跑 {{ rec.runMileageKm }}km（{{ fmtMinutes(rec.runMinutes) }}）
            </el-timeline-item>
          </el-timeline>
          <p v-else class="muted small">全程无改派</p>
        </article>
      </div>
    </section>

    <section class="zone">
      <div class="zone-head">
        <h2>操作日志 <span class="count">{{ store.logs.length }}</span></h2>
        <el-radio-group v-model="typeFilter" size="small">
          <el-radio-button v-for="f in filters" :key="f.value" :value="f.value">{{ f.label }}</el-radio-button>
        </el-radio-group>
      </div>
      <el-empty v-if="logs.length === 0" description="暂无日志" />
      <el-table v-else :data="logs" stripe class="data-table log-table">
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ fmtDateTime(row.at) }}</template>
        </el-table-column>
        <el-table-column label="类型" width="80">
          <template #default="{ row }">
            <el-tag :type="logTagType(row.type as LogType)" size="small">{{ LOG_TEXT[row.type as LogType] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="orderNo" label="运单号" width="120" />
        <el-table-column prop="message" label="内容" min-width="360" />
      </el-table>
    </section>
  </div>
</template>
