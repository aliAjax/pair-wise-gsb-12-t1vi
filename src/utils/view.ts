// 界面展示辅助：标签配色、状态文案。仅供组件使用。

import type { LogType, TempZone, TripStatus } from "../types";

export function zoneTagType(zone: TempZone): "primary" | "success" | "warning" {
  if (zone === "冷冻") return "primary";
  if (zone === "冷藏") return "success";
  return "warning";
}

export const ZONES: TempZone[] = ["冷冻", "冷藏", "恒温"];

export const TRIP_STATUS_TEXT: Record<TripStatus, string> = {
  active: "在途",
  handover: "待接续",
  completed: "已送达",
};

export const LOG_TEXT: Record<LogType, string> = {
  dispatched: "派车",
  blocked: "拦截",
  handed_over: "交回",
  reassigned: "接续",
  completed: "送达",
  rested: "休息",
  data: "资料",
};

export function logTagType(type: LogType): "success" | "danger" | "warning" | "info" | "primary" {
  switch (type) {
    case "dispatched":
    case "reassigned":
      return "success";
    case "blocked":
      return "danger";
    case "handed_over":
      return "warning";
    case "completed":
      return "primary";
    default:
      return "info";
  }
}
