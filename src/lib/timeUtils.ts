/**
 * Shared time-tracking, formatting, and progress-bar calculation helpers.
 */

export function isActualTimeField(field: { name: string; field_type: string }): boolean {
  return field.field_type === "time_hours" && field.name.toLowerCase().includes("actual");
}

export function isEstimatedTimeField(field: { name: string; field_type: string }): boolean {
  return field.field_type === "time_hours" && field.name.toLowerCase().includes("estimat");
}

export function getElapsedSeconds(timerStartedAt: string | null | undefined, nowMs: number): number {
  if (!timerStartedAt) return 0;
  const startMs = new Date(timerStartedAt).getTime();
  if (Number.isNaN(startMs)) return 0;
  return Math.max(0, Math.floor((nowMs - startMs) / 1000));
}

export function formatDurationHMS(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

export function formatDurationCompact(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  if (safe === 0) return "0s";
  if (safe < 60) return `${safe}s`;
  if (safe < 3600) {
    const m = Math.floor(safe / 60);
    const s = safe % 60;
    return s === 0 ? `${m}m` : `${m}m ${s}s`;
  }
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatHoursForInput(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === "") return "";
  const num = Number(val);
  if (Number.isNaN(num)) return "";
  if (num === 0) return "0";
  if (Math.abs(num) >= 0.01) return String(Number(num.toFixed(2)));
  return String(Number(num.toFixed(4)));
}

export type TimeProgressStatus = "green" | "yellow" | "orange" | "red";

export interface TimeProgressMeta {
  hasEstimate: boolean;
  rawPct: number;
  barWidthPct: number;
  status: TimeProgressStatus;
  barHex: string;
  textHex: string;
}

export function getTimeProgressMeta(actualHours: number, estimatedHours: number): TimeProgressMeta {
  const hasEstimate = estimatedHours > 0;
  const rawPct = hasEstimate ? (actualHours / estimatedHours) * 100 : 0;
  const barWidthPct = hasEstimate ? Math.min(100, Math.max(0, rawPct)) : 0;

  let status: TimeProgressStatus = "green";
  let barHex = "#22C55E";
  let textHex = "#4ADE80";

  if (rawPct > 90) {
    status = "red";
    barHex = "#EF4444";
    textHex = "#F87171";
  } else if (rawPct > 66) {
    status = "orange";
    barHex = "#F97316";
    textHex = "#FB923C";
  } else if (rawPct > 33) {
    status = "yellow";
    barHex = "#EAB308";
    textHex = "#FACC15";
  }

  return {
    hasEstimate,
    rawPct,
    barWidthPct,
    status,
    barHex,
    textHex,
  };
}
