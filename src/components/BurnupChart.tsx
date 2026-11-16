"use client";

import React, { useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";

export interface BurnupTaskInput {
  id: string;
  completed: number;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  is_archived?: boolean | number;
}

export type BurnupDateRange = "1w" | "2w" | "1m" | "3m" | "all" | "custom";

export interface BurnupPoint {
  dateKey: string; // YYYY-MM-DD
  label: string;   // MM/DD/YY
  total: number;
  activeTotal: number;
  completed: number;
  activeCompleted: number;
}

export interface BurnupResult {
  points: BurnupPoint[];
  yMax: number;
  maxTotal: number;
}

/**
 * Adjustable Y-axis scaling configuration.
 * - BURNUP_HEADROOM_PERCENT: Extra percentage added to max total tasks (e.g. 0.05 = 5%)
 * - BURNUP_Y_ROUNDING_FACTOR: Round Y-axis max up to nearest 10, 50, or 100
 */
export const BURNUP_HEADROOM_PERCENT = 0.05;
export const BURNUP_Y_ROUNDING_FACTOR: 10 | 50 | 100 = 100;

export function calculateBurnupYMax(
  maxTotal: number,
  headroomPercent: number = BURNUP_HEADROOM_PERCENT,
  roundingFactor: 10 | 50 | 100 = BURNUP_Y_ROUNDING_FACTOR
): number {
  const withHeadroom = maxTotal * (1 + headroomPercent);
  if (withHeadroom <= 0) return roundingFactor;
  return Math.ceil(withHeadroom / roundingFactor) * roundingFactor;
}

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatAxisDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-");
  return `${m}/${d}/${y.slice(2)}`;
}

function parseLocalDateKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Reusable pure function to compute burnup chart series for any list of tasks
 * (all workspace tasks on Analytics Dashboard, or single-project tasks in Project Analytics).
 */
export function buildBurnupSeries(
  tasks: BurnupTaskInput[],
  range: BurnupDateRange,
  customStart?: string,
  customEnd?: string,
  headroomPercent: number = BURNUP_HEADROOM_PERCENT,
  roundingFactor: 10 | 50 | 100 = BURNUP_Y_ROUNDING_FACTOR
): BurnupResult {
  const today = new Date();
  const todayKey = toDateKey(today);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const tomorrowKey = toDateKey(tomorrow);

  let endKey = tomorrowKey;
  let startDate = new Date(today);

  if (range === "1w") {
    startDate.setDate(today.getDate() - 6);
  } else if (range === "2w") {
    startDate.setDate(today.getDate() - 13);
  } else if (range === "1m") {
    startDate.setDate(today.getDate() - 29);
  } else if (range === "3m") {
    startDate.setDate(today.getDate() - 89);
  } else if (range === "all") {
    if (tasks.length > 0) {
      const earliest = tasks.reduce((min, t) => {
        const k = t.created_at.slice(0, 10);
        return k < min ? k : min;
      }, todayKey);
      startDate = parseLocalDateKey(earliest);
      // Ensure at least 7 days span so the chart has width
      const diffDays = Math.round((tomorrow.getTime() - startDate.getTime()) / 86400000);
      if (diffDays < 7) {
        startDate = new Date(today);
        startDate.setDate(today.getDate() - 6);
      }
    } else {
      startDate.setDate(today.getDate() - 6);
    }
  } else if (range === "custom") {
    if (customStart) startDate = parseLocalDateKey(customStart);
    else startDate.setDate(today.getDate() - 6);
    if (customEnd) endKey = customEnd;
    else endKey = todayKey;
  }

  const endDate = parseLocalDateKey(endKey);
  if (startDate > endDate) {
    startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 6);
  }

  // Generate all days between startDate and endDate
  const allDays: string[] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    allDays.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  // Sample up to 12 points for longer ranges so X-axis dates remain clean & readable
  let sampledDays: string[] = allDays;
  if (allDays.length > 14) {
    const targetTicks = 12;
    sampledDays = [];
    for (let i = 0; i < targetTicks; i++) {
      const idx = Math.round((i * (allDays.length - 1)) / (targetTicks - 1));
      if (!sampledDays.includes(allDays[idx])) {
        sampledDays.push(allDays[idx]);
      }
    }
  }

  const points: BurnupPoint[] = sampledDays.map((dateKey) => {
    let total = 0;
    let activeTotal = 0;
    let completed = 0;
    let activeCompleted = 0;

    for (const t of tasks) {
      const isActive = !t.is_archived;
      const createdKey = t.created_at.slice(0, 10);
      if (createdKey <= dateKey) {
        total += 1;
        if (isActive) activeTotal += 1;

        if (t.completed === 1) {
          const compKey = (t.completed_at || t.updated_at).slice(0, 10);
          if (compKey <= dateKey) {
            completed += 1;
            if (isActive) activeCompleted += 1;
          }
        }
      }
    }

    return {
      dateKey,
      label: formatAxisDate(dateKey),
      total,
      activeTotal,
      completed,
      activeCompleted,
    };
  });

  const maxTotal = points.reduce((m, p) => Math.max(m, p.total), 0);
  const yMax = calculateBurnupYMax(maxTotal, headroomPercent, roundingFactor);

  return { points, yMax, maxTotal };
}

interface BurnupChartProps {
  tasks: BurnupTaskInput[];
  title?: string;
  headroomPercent?: number;
  roundingFactor?: 10 | 50 | 100;
}

export default function BurnupChart({
  tasks,
  title = "Task Completion Burnup",
  headroomPercent = BURNUP_HEADROOM_PERCENT,
  roundingFactor = BURNUP_Y_ROUNDING_FACTOR,
}: BurnupChartProps) {
  const [range, setRange] = useState<BurnupDateRange>("1w");
  const [customStart, setCustomStart] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return toDateKey(d);
  });
  const [customEnd, setCustomEnd] = useState<string>(() => toDateKey(new Date()));

  const { points, yMax } = useMemo(
    () => buildBurnupSeries(tasks, range, customStart, customEnd, headroomPercent, roundingFactor),
    [tasks, range, customStart, customEnd, headroomPercent, roundingFactor]
  );

  // SVG layout dimensions
  const svgWidth = 860;
  const svgHeight = 290;
  const padLeft = 72;
  const padRight = 32;
  const padTop = 34; // Extra top padding so Total labels never clip
  const padBottom = 64; // Extra bottom padding for -45deg tilted date labels

  const plotWidth = svgWidth - padLeft - padRight;
  const plotHeight = svgHeight - padTop - padBottom;
  const baselineY = padTop + plotHeight;

  const getX = (idx: number) => {
    if (points.length <= 1) return padLeft + plotWidth / 2;
    return padLeft + (idx / (points.length - 1)) * plotWidth;
  };

  const getY = (val: number) => {
    const clamped = Math.max(0, Math.min(val, yMax));
    return baselineY - (clamped / yMax) * plotHeight;
  };

  const totalLinePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(p.total)}`)
    .join(" ");

  const totalAreaPath =
    points.length > 0
      ? `${totalLinePath} L ${getX(points.length - 1)} ${baselineY} L ${getX(0)} ${baselineY} Z`
      : "";

  const activeTotalLinePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(p.activeTotal)}`)
    .join(" ");

  const activeTotalAreaPath =
    points.length > 0
      ? `${activeTotalLinePath} L ${getX(points.length - 1)} ${baselineY} L ${getX(0)} ${baselineY} Z`
      : "";

  const completedLinePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(p.completed)}`)
    .join(" ");

  const completedAreaPath =
    points.length > 0
      ? `${completedLinePath} L ${getX(points.length - 1)} ${baselineY} L ${getX(0)} ${baselineY} Z`
      : "";

  const activeCompletedLinePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(p.activeCompleted)}`)
    .join(" ");

  const activeCompletedAreaPath =
    points.length > 0
      ? `${activeCompletedLinePath} L ${getX(points.length - 1)} ${baselineY} L ${getX(0)} ${baselineY} Z`
      : "";

  const yTicks = [0, Math.round(yMax / 2), yMax];

  return (
    <div className="bg-bcb-coffee border border-bcb-border rounded-xl p-6 space-y-4">
      {/* Header & Date Range Dropdown */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-bcb-border pb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-bcb-tea" />
          <h3 className="font-semibold text-white text-sm uppercase tracking-wider">
            {title}
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {range === "custom" && (
            <div className="flex items-center gap-2 text-xs">
              <input
                type="date"
                value={customStart}
                max={customEnd}
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) return;
                  setCustomStart(val > customEnd ? customEnd : val);
                }}
                className="bg-bcb-canvas border border-bcb-border rounded-lg px-2.5 py-1.5 text-stone-200 focus:border-bcb-cerulean focus:outline-none"
              />
              <span className="text-stone-400">to</span>
              <input
                type="date"
                value={customEnd}
                min={customStart}
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) return;
                  setCustomEnd(val < customStart ? customStart : val);
                }}
                className="bg-bcb-canvas border border-bcb-border rounded-lg px-2.5 py-1.5 text-stone-200 focus:border-bcb-cerulean focus:outline-none"
              />
            </div>
          )}

          <select
            value={range}
            onChange={(e) => setRange(e.target.value as BurnupDateRange)}
            className="bg-bcb-canvas border border-bcb-border rounded-lg px-3 py-1.5 text-xs font-semibold text-bcb-tea focus:border-bcb-cerulean focus:outline-none cursor-pointer"
          >
            <option value="1w">1 Week (Default)</option>
            <option value="2w">2 Weeks</option>
            <option value="1m">1 Month</option>
            <option value="3m">3 Months</option>
            <option value="all">All Time</option>
            <option value="custom">Custom Date Range</option>
          </select>
        </div>
      </div>

      {/* Burnup SVG Chart */}
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-auto min-w-[600px]"
          role="img"
          aria-label={title}
        >
          {/* Y-Axis Title */}
          <text
            x={18}
            y={padTop + plotHeight / 2}
            textAnchor="middle"
            transform={`rotate(-90, 18, ${padTop + plotHeight / 2})`}
            className="fill-stone-400 text-[11px] font-medium"
          >
            Task count
          </text>

          {/* Horizontal Gridlines & Y-Axis Ticks */}
          {yTicks.map((tick) => {
            const y = getY(tick);
            return (
              <g key={tick}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={svgWidth - padRight}
                  y2={y}
                  stroke="#463634"
                  strokeWidth={tick === 0 ? 1.5 : 1}
                  strokeDasharray={tick === 0 ? undefined : "3 3"}
                />
                <text
                  x={padLeft - 12}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-stone-400 text-[11px] font-medium"
                >
                  {tick}
                </text>
              </g>
            );
          })}

          {/* Total Tasks Area (All: Active + Archived) */}
          {totalAreaPath && (
            <path d={totalAreaPath} fill="#477998" fillOpacity={0.2} />
          )}
          {totalLinePath && (
            <path d={totalLinePath} fill="none" stroke="#5C92B4" strokeWidth={2.5} />
          )}

          {/* Active Total Tasks Area (Active Projects Only) */}
          {activeTotalAreaPath && (
            <path d={activeTotalAreaPath} fill="#8AB8D4" fillOpacity={0.14} />
          )}
          {activeTotalLinePath && (
            <path
              d={activeTotalLinePath}
              fill="none"
              stroke="#8AB8D4"
              strokeWidth={2}
              strokeDasharray="5 4"
            />
          )}

          {/* Completed Tasks Area (All: Active + Archived) */}
          {completedAreaPath && (
            <path d={completedAreaPath} fill="#9AB380" fillOpacity={0.35} />
          )}
          {completedLinePath && (
            <path
              d={completedLinePath}
              fill="none"
              stroke="#9AB380"
              strokeWidth={2}
              strokeDasharray="5 4"
            />
          )}

          {/* Active Completed Tasks Area (Active Projects Only) */}
          {activeCompletedAreaPath && (
            <path d={activeCompletedAreaPath} fill="#C4D6B0" fillOpacity={0.8} />
          )}
          {activeCompletedLinePath && (
            <path d={activeCompletedLinePath} fill="none" stroke="#C4D6B0" strokeWidth={2.5} />
          )}

          {/* Data Labels & Tilted X-Axis Dates */}
          {points.map((p, i) => {
            const x = getX(i);
            const yTotal = getY(p.total);
            const yActiveTotal = getY(p.activeTotal);
            const yCompleted = getY(p.completed);
            const yActiveCompleted = getY(p.activeCompleted);
            const bothZero = p.total === 0 && p.completed === 0;

            // Total label always above the Total line
            const totalLabelY = Math.max(14, yTotal - 10);
            // Active Total label (only shown when different from Total)
            const activeTotalLabelY =
              Math.abs(yActiveTotal - 10 - totalLabelY) < 16
                ? Math.min(baselineY - 6, yActiveTotal + 16)
                : Math.max(14, yActiveTotal - 10);

            // Completed label always below the Completed line (with padding above baseline)
            const completedLabelY = Math.min(baselineY - 6, yCompleted + 16);
            // Active Completed label (only shown when different from Completed)
            const activeCompletedLabelY =
              Math.abs(yActiveCompleted + 16 - completedLabelY) < 16
                ? Math.max(14, yActiveCompleted - 8)
                : Math.min(baselineY - 6, yActiveCompleted + 16);

            const renderPill = (cx: number, cy: number, val: number) => {
              const digits = String(val).length;
              const w = Math.max(18, digits * 8 + 8);
              return (
                <rect
                  x={cx - w / 2}
                  y={cy - 11}
                  width={w}
                  height={15}
                  rx={4}
                  fill="#1A1312"
                  fillOpacity={0.85}
                />
              );
            };

            return (
              <g key={p.dateKey}>
                {bothZero ? (
                  <g>
                    {renderPill(x, baselineY - 10, 0)}
                    <text
                      x={x}
                      y={baselineY - 10}
                      textAnchor="middle"
                      fill="#F5F2F0"
                      className="text-[11px] font-bold"
                    >
                      0
                    </text>
                  </g>
                ) : (
                  <>
                    {/* Total number above Total line */}
                    <g>
                      {renderPill(x, totalLabelY, p.total)}
                      <text
                        x={x}
                        y={totalLabelY}
                        textAnchor="middle"
                        fill="#F5F2F0"
                        className="text-[11px] font-bold"
                      >
                        {p.total}
                      </text>
                    </g>

                    {/* Active Total number (when archived tasks exist) */}
                    {p.activeTotal !== p.total && (
                      <g>
                        {renderPill(x, activeTotalLabelY, p.activeTotal)}
                        <text
                          x={x}
                          y={activeTotalLabelY}
                          textAnchor="middle"
                          fill="#8AB8D4"
                          className="text-[11px] font-bold"
                        >
                          {p.activeTotal}
                        </text>
                      </g>
                    )}

                    {/* Completed number below Completed line */}
                    <g>
                      {renderPill(x, completedLabelY, p.completed)}
                      <text
                        x={x}
                        y={completedLabelY}
                        textAnchor="middle"
                        fill="#9AB380"
                        className="text-[11px] font-bold"
                      >
                        {p.completed}
                      </text>
                    </g>

                    {/* Active Completed number (when archived completed tasks exist) */}
                    {p.activeCompleted !== p.completed && (
                      <g>
                        {renderPill(x, activeCompletedLabelY, p.activeCompleted)}
                        <text
                          x={x}
                          y={activeCompletedLabelY}
                          textAnchor="middle"
                          fill="#C4D6B0"
                          className="text-[11px] font-bold"
                        >
                          {p.activeCompleted}
                        </text>
                      </g>
                    )}
                  </>
                )}

                {/* Tilted X-Axis Date */}
                <text
                  x={x}
                  y={baselineY + 14}
                  textAnchor="end"
                  transform={`rotate(-45, ${x}, ${baselineY + 14})`}
                  className="fill-stone-300 text-[11px] font-medium"
                >
                  {p.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Bottom-Right Legend */}
      <div className="flex flex-wrap items-center justify-end gap-5 pt-1 text-xs font-medium text-stone-300">
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-3.5 rounded-sm bg-bcb-cerulean border border-bcb-cerulean-light inline-block" />
          <span>Total (All)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-0.5 border-t-2 border-dashed border-[#8AB8D4] inline-block" />
          <span>Active Total</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-3.5 rounded-sm bg-bcb-tea-dark/70 border border-dashed border-bcb-tea-dark inline-block" />
          <span>Completed (All)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-3.5 rounded-sm bg-bcb-tea inline-block" />
          <span>Active Completed</span>
        </div>
      </div>
    </div>
  );
}
