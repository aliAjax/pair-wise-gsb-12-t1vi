<script setup lang="ts">
// 车辆调度 · 派车交接台：资料 / 判断 / 留档 / 界面四层分离。
import { computed, ref } from "vue";
import { ElMessageBox } from "element-plus";
import { useDispatchStore } from "./stores/dispatch";
import DispatchBoard from "./components/DispatchBoard.vue";
import DataAdmin from "./components/DataAdmin.vue";
import ArchivePanel from "./components/ArchivePanel.vue";

const store = useDispatchStore();
const tab = ref<"board" | "data" | "archive">("board");

const stats = computed(() => {
  const pending = store.pendingOrders.length;
  const active = store.trips.filter((t) => t.status === "active").length;
  const handover = store.trips.filter((t) => t.status === "handover").length;
  const busyVehicles = new Set(
    store.trips.filter((t) => t.status === "active" && t.vehicleId).map((t) => t.vehicleId)
  ).size;
  return [
    { label: "待派订单", value: pending, hint: "含未消除缺口" },
    { label: "在途运次", value: active, hint: "组合已锁定" },
    { label: "待接续", value: handover, hint: "原车已释放" },
    { label: "车辆占用", value: `${busyVehicles}/${store.vehicles.length}`, hint: "在途车辆数" },
  ];
});

async function resetAll() {
  try {
    await ElMessageBox.confirm("清空本地留档并恢复演示数据？此操作不可撤销。", "重置", {
      type: "warning",
    });
  } catch {
    return;
  }
  localStorage.removeItem("dfwlfront-3-handoff-v1");
  location.reload();
}
</script>
<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">山路冷链 · 物流调度</p>
          <h1>派车交接台</h1>
          <p class="subtitle">
            订单记线路、送达窗口、货温与重量；车辆记核载、温区与保养时点；司机记班次与连续驾驶时长。
            同车/同司机撞班、温区、载重、保养或休息不够一律留在待派区并写明缺口；
            发车即锁定，途中改派先交回剩余线路再由新车接续，全程留档、重开续看。
          </p>
        </div>
        <div class="top-actions">
          <div class="stack">
            <span class="tag">Vue3</span><span class="tag">Pinia</span>
            <span class="tag">Element Plus</span><span class="tag">localStorage</span>
          </div>
          <el-button size="small" plain @click="resetAll">重置演示数据</el-button>
        </div>
      </header>

      <section class="metrics">
        <article v-for="s in stats" :key="s.label" class="metric">
          <span>{{ s.label }}</span>
          <strong>{{ s.value }}</strong>
          <em>{{ s.hint }}</em>
        </article>
      </section>

      <el-tabs v-model="tab" class="main-tabs">
        <el-tab-pane name="board">
          <template #label><b>🚚 派车交接台</b></template>
          <DispatchBoard v-if="tab === 'board'" />
        </el-tab-pane>
        <el-tab-pane name="data" :label="'📋 资料维护'">
          <DataAdmin v-if="tab === 'data'" />
        </el-tab-pane>
        <el-tab-pane name="archive" :label="'🗂 留档查询'">
          <ArchivePanel v-if="tab === 'archive'" />
        </el-tab-pane>
      </el-tabs>
    </div>
  </main>
</template>
