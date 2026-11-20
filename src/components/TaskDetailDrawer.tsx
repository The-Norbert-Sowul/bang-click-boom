"use client";

import React, { useEffect, useState } from "react";
import {
  Calendar,
  CheckCircle2,
  Clock,
  Play,
  SlidersHorizontal,
  Square,
  Trash2,
  X,
} from "lucide-react";
import InlineFieldInput from "@/components/InlineFieldInput";
import {
  formatDurationCompact,
  formatDurationHMS,
  formatHoursForInput,
  getElapsedSeconds,
  getTimeProgressMeta,
  isActualTimeField,
  isEstimatedTimeField,
} from "@/lib/timeUtils";

export interface DrawerCustomFieldDef {
  id: string;
  project_id: string;
  name: string;
  field_type: "single_select" | "time_hours" | "number" | "text" | "percent";
  options_json: string;
  sort_order: number;
  is_visible: number;
}

export interface DrawerTask {
  id: string;
  project_id: string;
  section_id: string;
  title: string;
  description: string;
  completed: number;
  assignee: "You" | "Gemini" | "Unassigned";
  due_date: string | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  timer_started_at?: string | null;
  updated_by: "You" | "Gemini";
  field_values: Record<string, string | number | null>;
}

interface TaskDetailDrawerProps {
  task: DrawerTask;
  projectFields: DrawerCustomFieldDef[];
  nowMs: number;
  onClose: () => void;
  onUpdateTask: (payload: Record<string, any>) => Promise<any>;
  onDeleteTask: (taskId: string) => Promise<any>;
  onStartTimer: (task: DrawerTask) => Promise<any>;
  onStopTimer: (task: DrawerTask) => Promise<any>;
  onOpenCustomize: () => void;
}

export default function TaskDetailDrawer({
  task,
  projectFields,
  nowMs,
  onClose,
  onUpdateTask,
  onDeleteTask,
  onStartTimer,
  onStopTimer,
  onOpenCustomize,
}: TaskDetailDrawerProps) {
  const actualTimeField = projectFields.find(isActualTimeField);
  const estimatedTimeField = projectFields.find(isEstimatedTimeField);
  const otherFields = projectFields.filter(
    (f) => f.id !== actualTimeField?.id && f.id !== estimatedTimeField?.id
  );

  const isTimerRunning = Boolean(task.timer_started_at);
  const storedActual = actualTimeField ? Number(task.field_values[actualTimeField.id] || 0) || 0 : 0;
  const liveElapsedSec = getElapsedSeconds(task.timer_started_at, nowMs);
  const effectiveActualHours = storedActual + liveElapsedSec / 3600;
  const estimatedHours = estimatedTimeField ? Number(task.field_values[estimatedTimeField.id] || 0) || 0 : 0;
  const progress = getTimeProgressMeta(effectiveActualHours, estimatedHours);

  // Controlled-safe Task Notes syncing when not focused
  const [notesDraft, setNotesDraft] = useState(task.description || "");
  const [isNotesFocused, setIsNotesFocused] = useState(false);

  useEffect(() => {
    if (!isNotesFocused) {
      setNotesDraft(task.description || "");
    }
  }, [task.id, task.description, isNotesFocused]);

  return (
    <aside className="w-[420px] h-screen sticky top-0 bg-bcb-coffee border-l border-bcb-border flex flex-col shrink-0 shadow-2xl">
      {/* 1. Top Bar: Mark Complete + Close */}
      <div className="px-6 py-4 border-b border-bcb-border flex items-center justify-between shrink-0">
        <button
          onClick={() =>
            onUpdateTask({
              action: "update_task",
              id: task.id,
              completed: task.completed === 0,
            })
          }
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
            task.completed
              ? "bg-bcb-tea text-bcb-coffee border-bcb-tea"
              : "bg-bcb-surface text-stone-200 border-bcb-border hover:border-bcb-tea"
          }`}
        >
          <CheckCircle2 className="w-4 h-4" />
          {task.completed ? "Completed" : "Mark Complete"}
        </button>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-bcb-surface text-stone-400 hover:text-white transition"
          title="Close details"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* 2. Task Title */}
        <div>
          <label className="text-[11px] uppercase tracking-wider text-stone-400 font-semibold">
            Task Title
          </label>
          <InlineFieldInput
            value={task.title}
            isNumeric={false}
            placeholder="Task title..."
            onCommit={(nextTitle) => {
              const trimmed = nextTitle.trim();
              if (trimmed && trimmed !== task.title) {
                onUpdateTask({
                  action: "update_task",
                  id: task.id,
                  title: trimmed,
                });
              }
            }}
            className="w-full mt-1 bg-bcb-canvas border border-bcb-border rounded-lg px-3 py-2 text-sm font-semibold text-white focus:border-bcb-cerulean focus:outline-none"
          />
        </div>

        {/* 3. Actual Time + Timer, Estimate Time, & Time Progress Bar */}
        <div className="space-y-3.5">
          {/* Actual Time + Live Timer */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] uppercase tracking-wider text-stone-400 font-semibold flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-bcb-cerulean-light" />
                Actual Time
              </label>
              {isTimerRunning ? (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-bcb-cerulean/25 text-bcb-tea border border-bcb-cerulean/60 animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-bcb-tea" />
                  LIVE +{formatDurationHMS(liveElapsedSec)}
                </span>
              ) : storedActual > 0 ? (
                <span className="text-[11px] text-stone-400">
                  {formatDurationCompact(Math.round(storedActual * 3600))}
                </span>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-1.5 bg-bcb-canvas border border-bcb-border rounded-lg px-3 py-2">
                {isTimerRunning ? (
                  <div className="flex items-center justify-between w-full">
                    <span className="font-mono text-xs font-semibold text-bcb-tea">
                      {formatDurationHMS(Math.round(effectiveActualHours * 3600))}
                    </span>
                    <span className="text-[11px] text-stone-400">
                      ({effectiveActualHours.toFixed(2)}h)
                    </span>
                  </div>
                ) : actualTimeField ? (
                  <>
                    <InlineFieldInput
                      value={task.field_values[actualTimeField.id] ?? ""}
                      isNumeric
                      step="0.25"
                      min="0"
                      placeholder="0"
                      formatDisplay={formatHoursForInput}
                      onCommit={(nextVal) =>
                        onUpdateTask({
                          action: "update_task",
                          id: task.id,
                          is_numeric_field: true,
                          field_values: { [actualTimeField.id]: nextVal },
                        })
                      }
                      className="w-full bg-transparent text-xs text-white focus:outline-none"
                    />
                    <span className="text-[11px] text-stone-400 shrink-0">h</span>
                  </>
                ) : (
                  <span className="text-xs text-stone-500 italic">No Actual Time field</span>
                )}
              </div>

              {isTimerRunning ? (
                <button
                  type="button"
                  onClick={() => onStopTimer(task)}
                  title="Stop timer and log elapsed time"
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/50 transition"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  Stop Timer
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onStartTimer(task)}
                  title="Start timer and move task to In Progress"
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-bcb-cerulean hover:bg-bcb-cerulean-light text-white transition"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Start Timer
                </button>
              )}
            </div>
          </div>

          {/* Estimate Time */}
          <div>
            <label className="text-[11px] uppercase tracking-wider text-stone-400 font-semibold block mb-1">
              Estimate Time
            </label>
            <div className="bg-bcb-canvas border border-bcb-border rounded-lg px-3 py-2 flex items-center gap-1.5">
              {estimatedTimeField ? (
                <>
                  <InlineFieldInput
                    value={task.field_values[estimatedTimeField.id] ?? ""}
                    isNumeric
                    step="0.25"
                    min="0"
                    placeholder="0"
                    formatDisplay={formatHoursForInput}
                    onCommit={(nextVal) =>
                      onUpdateTask({
                        action: "update_task",
                        id: task.id,
                        is_numeric_field: true,
                        field_values: { [estimatedTimeField.id]: nextVal },
                      })
                    }
                    className="w-full bg-transparent text-xs text-white focus:outline-none"
                  />
                  <span className="text-[11px] text-stone-400 shrink-0">h</span>
                </>
              ) : (
                <span className="text-xs text-stone-500 italic">No Estimate Time field</span>
              )}
            </div>
          </div>

          {/* Actual / Estimate Progress Bar */}
          <div>
            <div className="flex items-center justify-between text-[11px] mb-1.5">
              <span className="uppercase tracking-wider text-stone-400 font-semibold">
                Time Progress
              </span>
              <div className="flex items-center gap-1.5">
                <span
                  className={`font-semibold ${progress.hasEstimate ? "" : "text-stone-400"}`}
                  style={progress.hasEstimate ? { color: progress.textHex } : undefined}
                >
                  {progress.hasEstimate ? `${Math.round(progress.rawPct)}%` : "No estimate"}
                </span>
                <span className="text-stone-400">
                  ({effectiveActualHours.toFixed(2)}h / {estimatedHours.toFixed(2)}h)
                </span>
              </div>
            </div>
            <div className="h-2.5 w-full rounded-full bg-bcb-canvas border border-bcb-border overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${progress.barWidthPct}%`,
                  backgroundColor: progress.barHex,
                }}
              />
            </div>
          </div>
        </div>

        {/* 4. Visual Break */}
        <div className="border-t border-bcb-border" />

        {/* 5. Assigned To & Due Date */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] uppercase tracking-wider text-stone-400 font-semibold">
              Assigned To
            </label>
            <select
              value={task.assignee}
              onChange={(e) =>
                onUpdateTask({
                  action: "update_task",
                  id: task.id,
                  assignee: e.target.value,
                })
              }
              className="w-full mt-1 bg-bcb-canvas border border-bcb-border rounded-lg px-3 py-2 text-xs text-white focus:border-bcb-cerulean focus:outline-none"
            >
              <option value="You">👤 You</option>
              <option value="Gemini">✨ Gemini</option>
              <option value="Unassigned">Unassigned</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] uppercase tracking-wider text-stone-400 font-semibold">
              Due Date
            </label>
            <div className="mt-1 flex items-center gap-1.5">
              <label className="relative flex-1 inline-flex items-center justify-between px-3 py-2 rounded-lg border border-bcb-border bg-bcb-canvas hover:border-bcb-cerulean text-xs cursor-pointer transition">
                <span className={task.due_date ? "text-stone-200 font-medium" : "text-transparent select-none"}>
                  {task.due_date
                    ? `${task.due_date.slice(5, 7)}/${task.due_date.slice(8, 10)}/${task.due_date.slice(0, 4)}`
                    : "\u00A0"}
                </span>
                <Calendar
                  className={`w-3.5 h-3.5 shrink-0 ${task.due_date ? "text-bcb-tea" : "text-stone-400"}`}
                />
                <input
                  type="date"
                  value={task.due_date || ""}
                  onClick={(e) => {
                    try {
                      (e.currentTarget as HTMLInputElement).showPicker?.();
                    } catch {}
                  }}
                  onChange={(e) =>
                    onUpdateTask({
                      action: "update_task",
                      id: task.id,
                      due_date: e.target.value || null,
                    })
                  }
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </label>
              {task.due_date && (
                <button
                  type="button"
                  onClick={() =>
                    onUpdateTask({
                      action: "update_task",
                      id: task.id,
                      due_date: null,
                    })
                  }
                  title="Clear due date"
                  className="p-2 rounded-lg border border-bcb-border bg-bcb-canvas hover:bg-bcb-surface text-stone-400 hover:text-white transition shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 6. Task Fields Table (Bullet-Point Format, Dynamic Height) */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <label className="text-[11px] uppercase tracking-wider text-stone-400 font-semibold">
                Task Fields
              </label>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-bcb-surface text-stone-300 border border-bcb-border">
                {otherFields.length}
              </span>
            </div>
            <button
              type="button"
              onClick={onOpenCustomize}
              className="inline-flex items-center gap-1 text-[11px] text-bcb-tea hover:text-white transition"
            >
              <SlidersHorizontal className="w-3 h-3" />
              Customize
            </button>
          </div>

          <div className="rounded-lg border border-bcb-border bg-bcb-canvas/70 overflow-hidden">
            {otherFields.length === 0 ? (
              <div className="px-3.5 py-3 flex items-center justify-between text-xs text-stone-400">
                <span>No additional task fields yet.</span>
                <button
                  type="button"
                  onClick={onOpenCustomize}
                  className="text-bcb-cerulean-light hover:underline font-medium"
                >
                  Add Field
                </button>
              </div>
            ) : (
              <table className="w-full text-xs border-collapse">
                <tbody className="divide-y divide-bcb-border">
                  {otherFields.map((field) => {
                    const rawVal = task.field_values[field.id] ?? "";
                    const isNumeric =
                      field.field_type === "time_hours" ||
                      field.field_type === "number" ||
                      field.field_type === "percent";

                    let opts: { label: string; color: string }[] = [];
                    if (field.field_type === "single_select") {
                      try {
                        opts = JSON.parse(field.options_json || "[]");
                      } catch {}
                    }
                    const activeOpt = opts.find((o) => o.label === rawVal);

                    return (
                      <tr key={field.id} className="hover:bg-bcb-surface/40 transition">
                        <td className="w-[44%] px-3 py-2.5 bg-bcb-coffee/45 border-r border-bcb-border/60 align-middle">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-bcb-tea shrink-0" />
                            <span className="text-stone-300 font-medium truncate" title={field.name}>
                              {field.name}
                            </span>
                            {field.is_visible === 0 && (
                              <span className="text-[10px] text-stone-500 shrink-0">(hidden)</span>
                            )}
                          </div>
                        </td>

                        <td className="px-3 py-2 align-middle">
                          {field.field_type === "single_select" ? (
                            <select
                              value={String(rawVal)}
                              onChange={(e) =>
                                onUpdateTask({
                                  action: "update_task",
                                  id: task.id,
                                  field_values: { [field.id]: e.target.value },
                                })
                              }
                              style={{
                                backgroundColor: activeOpt ? `${activeOpt.color}25` : "#1A1312",
                                color: activeOpt ? activeOpt.color : "#C4D6B0",
                                borderColor: activeOpt ? activeOpt.color : "#463634",
                              }}
                              className="text-xs font-semibold px-2.5 py-1 rounded-full border cursor-pointer focus:outline-none max-w-full"
                            >
                              <option value="">—</option>
                              {opts.map((o) => (
                                <option key={o.label} value={o.label} className="bg-bcb-coffee text-white">
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <InlineFieldInput
                                value={rawVal}
                                isNumeric={isNumeric}
                                step={isNumeric ? "0.25" : undefined}
                                min={field.field_type === "time_hours" ? "0" : undefined}
                                placeholder="—"
                                formatDisplay={
                                  field.field_type === "time_hours" ? formatHoursForInput : undefined
                                }
                                onCommit={(nextVal) =>
                                  onUpdateTask({
                                    action: "update_task",
                                    id: task.id,
                                    is_numeric_field: isNumeric,
                                    field_values: { [field.id]: nextVal },
                                  })
                                }
                                className="w-full bg-transparent border border-transparent hover:border-bcb-border focus:border-bcb-cerulean rounded px-1.5 py-1 text-xs text-stone-200 focus:outline-none"
                              />
                              {field.field_type === "time_hours" && (
                                <span className="text-[11px] text-stone-400 shrink-0">h</span>
                              )}
                              {field.field_type === "percent" && (
                                <span className="text-[11px] text-stone-400 shrink-0">%</span>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* 7. Task Notes */}
        <div>
          <label className="text-[11px] uppercase tracking-wider text-stone-400 font-semibold">
            Task Notes
          </label>
          <textarea
            rows={4}
            value={notesDraft}
            onFocus={() => setIsNotesFocused(true)}
            onChange={(e) => setNotesDraft(e.target.value)}
            onBlur={() => {
              setIsNotesFocused(false);
              if (notesDraft !== (task.description || "")) {
                onUpdateTask({
                  action: "update_task",
                  id: task.id,
                  description: notesDraft,
                });
              }
            }}
            placeholder="Add task details, links, or instructions for Gemini..."
            className="w-full mt-1 bg-bcb-canvas border border-bcb-border rounded-lg p-3 text-xs text-stone-200 focus:border-bcb-cerulean focus:outline-none"
          />
        </div>
      </div>

      {/* Pinned Footer */}
      <div className="px-6 py-4 border-t border-bcb-border flex items-center justify-between text-[11px] text-stone-400 shrink-0">
        <span>Last updated by: {task.updated_by}</span>
        <button
          onClick={() => {
            onDeleteTask(task.id);
            onClose();
          }}
          className="text-red-400 hover:underline flex items-center gap-1"
        >
          <Trash2 className="w-3.5 h-3.5" /> Delete
        </button>
      </div>
    </aside>
  );
}
