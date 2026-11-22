"use client";

import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  Circle,
  Plus,
  LayoutDashboard,
  FolderKanban,
  Briefcase,
  Sparkles,
  SlidersHorizontal,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Pencil,
  Settings,
  Trash2,
  Save,
  Clock,
  Eye,
  EyeOff,
  X,
  Rocket,
  Activity,
  Menu,
  Archive,
  ArchiveRestore,
  Calendar,
  Play,
  Square,
  GripVertical,
} from "lucide-react";
import BurnupChart from "@/components/BurnupChart";
import InlineFieldInput from "@/components/InlineFieldInput";
import TaskDetailDrawer from "@/components/TaskDetailDrawer";
import {
  isActualTimeField,
  getElapsedSeconds,
  formatDurationHMS,
  formatDurationCompact,
  formatHoursForInput,
} from "@/lib/timeUtils";

interface Portfolio {
  id: string;
  name: string;
  description: string;
  color: string;
}

interface Project {
  id: string;
  portfolio_id: string;
  name: string;
  description: string;
  status: string;
  icon: string;
  is_archived: number;
  in_progress_section_id: string | null;
  completed_section_id: string | null;
}

interface Section {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
}

interface CustomFieldDef {
  id: string;
  project_id: string;
  name: string;
  field_type: "single_select" | "time_hours" | "number" | "text" | "percent";
  options_json: string;
  sort_order: number;
  is_visible: number;
}

interface Task {
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

interface ActivityItem {
  id: string;
  actor: string;
  action: string;
  task_title: string;
  created_at: string;
}

interface WorkspaceData {
  portfolios: Portfolio[];
  projects: Project[];
  sections: Section[];
  customFields: CustomFieldDef[];
  tasks: Task[];
  activity: ActivityItem[];
}

export default function BangClickBoomApp() {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [activeView, setActiveView] = useState<"dashboard" | "portfolio" | string>("proj-bcb");
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showCustomizeModal, setShowCustomizeModal] = useState(false);
  const [showAutomationModal, setShowAutomationModal] = useState(false);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);

  // Section management state
  const [isAddingSection, setIsAddingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingSectionName, setEditingSectionName] = useState("");
  const [sectionToDelete, setSectionToDelete] = useState<Section | null>(null);
  const [reassignTargetSectionId, setReassignTargetSectionId] = useState<string>("");
  const [automationError, setAutomationError] = useState<string | null>(null);

  // Live timer clock & Drag-and-drop state
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverSectionId, setDragOverSectionId] = useState<string | null>(null);

  // Quick-add task state per section
  const [newTaskTitle, setNewTaskTitle] = useState<Record<string, string>>({});
  const [newTaskAssignee, setNewTaskAssignee] = useState<Record<string, "You" | "Gemini">>({} as any);

  // New Custom Field form state
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<CustomFieldDef["field_type"]>("text");
  const [newFieldOptions, setNewFieldOptions] = useState("Option 1, Option 2, Option 3");

  // New Project form state
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDesc, setNewProjectDesc] = useState("");

  // Project menu & Archive/Delete state
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const [showArchivedProjects, setShowArchivedProjects] = useState(true);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  // Backup toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  async function fetchWorkspace() {
    const res = await fetch("/api/bcb");
    if (res.ok) {
      const json = await res.json();
      setData(json);
    }
  }

  useEffect(() => {
    fetchWorkspace();
    const interval = setInterval(fetchWorkspace, 4000);
    return () => clearInterval(interval);
  }, []);

  const hasRunningTimer = Boolean(data?.tasks.some((t) => Boolean(t.timer_started_at)));

  useEffect(() => {
    if (!hasRunningTimer) return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasRunningTimer]);

  const selectedTask = data?.tasks.find((t) => t.id === selectedTaskId) || null;

  async function apiAction(payload: Record<string, any>) {
    const res = await fetch("/api/bcb", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json) {
      setData(json);
      return json;
    }
    if (json?.error) {
      triggerToast(`Error: ${json.error}`);
    }
    return null;
  }

  function triggerToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-bcb-canvas flex items-center justify-center text-bcb-tea">
        <div className="flex items-center gap-3 text-lg font-medium animate-pulse">
          <Sparkles className="w-6 h-6 text-bcb-cerulean" />
          Loading Bang Click Boom (BCB)...
        </div>
      </div>
    );
  }

  const activeProject = data.projects.find((p) => p.id === activeView);
  const projectSections = activeProject
    ? data.sections.filter((s) => s.project_id === activeProject.id)
    : [];
  const activeInProgressSection = activeProject?.in_progress_section_id
    ? projectSections.find((s) => s.id === activeProject.in_progress_section_id) || null
    : null;
  const projectFields = activeProject
    ? data.customFields.filter((f) => f.project_id === activeProject.id)
    : [];
  const visibleProjectFields = projectFields.filter((f) => f.is_visible === 1);

  const activeProjects = data.projects.filter((p) => !p.is_archived);
  const archivedProjects = data.projects.filter((p) => p.is_archived === 1);
  const activeProjectIds = new Set(activeProjects.map((p) => p.id));
  const activeTasks = data.tasks.filter((t) => activeProjectIds.has(t.project_id));

  // Analytics calculations (scoped to active non-archived projects)
  const totalTasks = activeTasks.length;
  const completedTasks = activeTasks.filter((t) => t.completed === 1).length;
  const geminiTasks = activeTasks.filter((t) => t.assignee === "Gemini").length;
  const yourTasks = activeTasks.filter((t) => t.assignee === "You").length;

  let totalEstHours = 0;
  let totalActualHours = 0;

  for (const t of activeTasks) {
    const pFields = data.customFields.filter((f) => f.project_id === t.project_id);
    for (const f of pFields) {
      const val = Number(t.field_values[f.id] || 0);
      if (!isNaN(val)) {
        if (f.name.toLowerCase().includes("estimated")) totalEstHours += val;
        if (f.name.toLowerCase().includes("actual")) totalActualHours += val;
      }
    }
  }

  async function handleQuickAddTask(sectionId: string, projectId: string) {
    const title = (newTaskTitle[sectionId] || "").trim();
    if (!title) return;
    const assignee = newTaskAssignee[sectionId] || "You";
    setNewTaskTitle({ ...newTaskTitle, [sectionId]: "" });
    await apiAction({
      action: "create_task",
      project_id: projectId,
      section_id: sectionId,
      title,
      assignee,
    });
  }

  async function handleStartTimer(task: Task) {
    const res = await apiAction({ action: "start_timer", id: task.id });
    if (res?.movedToSection) {
      triggerToast(`Timer started — moved "${task.title}" to ${res.movedToSection}`);
    } else if (res) {
      triggerToast(`Timer started for "${task.title}"`);
    }
  }

  async function handleStopTimer(task: Task) {
    const res = await apiAction({ action: "stop_timer", id: task.id });
    if (res?.timerSummary) {
      triggerToast(
        `Timer stopped — logged +${formatDurationCompact(res.timerSummary.elapsedSeconds)} to Actual Time`
      );
    }
  }

  async function handleMoveTaskToSection(task: Task, targetSection: Section) {
    if (task.section_id === targetSection.id) return;
    await apiAction({
      action: "move_task_section",
      id: task.id,
      section_id: targetSection.id,
    });
    triggerToast(`Moved "${task.title}" to ${targetSection.name}`);
  }

  async function handleCreateSection() {
    const trimmed = newSectionName.trim();
    if (!activeProject || !trimmed) {
      setIsAddingSection(false);
      setNewSectionName("");
      return;
    }
    setNewSectionName("");
    setIsAddingSection(false);
    const res = await apiAction({
      action: "create_section",
      project_id: activeProject.id,
      name: trimmed,
    });
    if (res) {
      triggerToast(`Added section "${trimmed}"`);
    }
  }

  async function handleRenameSection(section: Section) {
    const trimmed = editingSectionName.trim();
    setEditingSectionId(null);
    setEditingSectionName("");
    if (!trimmed || trimmed === section.name) return;
    const res = await apiAction({
      action: "rename_section",
      section_id: section.id,
      name: trimmed,
    });
    if (res) {
      triggerToast(`Renamed section to "${trimmed}"`);
    }
  }

  async function handleReorderSection(section: Section, direction: "up" | "down") {
    await apiAction({
      action: "reorder_section",
      section_id: section.id,
      direction,
    });
  }

  function handleRequestDeleteSection(section: Section) {
    if (!activeProject || projectSections.length <= 1) return;
    const tasksInSection = data!.tasks.filter((t) => t.section_id === section.id);
    const isMapped =
      activeProject.in_progress_section_id === section.id ||
      activeProject.completed_section_id === section.id;

    if (tasksInSection.length === 0 && !isMapped) {
      apiAction({ action: "delete_section", section_id: section.id }).then((res) => {
        if (res) triggerToast(`Deleted section "${section.name}"`);
      });
      return;
    }

    const fallbackTarget = projectSections.find((s) => s.id !== section.id);
    setReassignTargetSectionId(fallbackTarget?.id || "");
    setSectionToDelete(section);
  }

  async function handleConfirmDeleteSection(e: React.FormEvent) {
    e.preventDefault();
    if (!sectionToDelete) return;
    const deletedName = sectionToDelete.name;
    const targetId = reassignTargetSectionId;
    setSectionToDelete(null);
    const res = await apiAction({
      action: "delete_section",
      section_id: sectionToDelete.id,
      reassign_to_section_id: targetId || undefined,
    });
    if (res) {
      triggerToast(`Deleted section "${deletedName}"`);
    }
  }

  async function handleUpdateAutomations(
    nextInProgressId: string | null,
    nextCompletedId: string | null
  ) {
    if (!activeProject) return;
    if (nextInProgressId && nextCompletedId && nextInProgressId === nextCompletedId) {
      setAutomationError("Timer (In Progress) and Completed automations cannot use the same section.");
      return;
    }
    setAutomationError(null);
    const res = await apiAction({
      action: "update_project_automations",
      project_id: activeProject.id,
      in_progress_section_id: nextInProgressId,
      completed_section_id: nextCompletedId,
    });
    if (res) {
      triggerToast("Updated Automation Settings");
    }
  }

  async function handleAddCustomField(e: React.FormEvent) {
    e.preventDefault();
    if (!activeProject || !newFieldName.trim()) return;

    const palette = ["#E06C75", "#477998", "#C4D6B0", "#D19A66", "#98C379"];
    const options =
      newFieldType === "single_select"
        ? newFieldOptions
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((label, idx) => ({ label, color: palette[idx % palette.length] }))
        : [];

    await apiAction({
      action: "add_custom_field",
      project_id: activeProject.id,
      name: newFieldName.trim(),
      field_type: newFieldType,
      options,
    });
    setNewFieldName("");
    triggerToast(`Added custom Task Field "${newFieldName.trim()}"`);
  }

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    const updated = await apiAction({
      action: "create_project",
      name: newProjectName.trim(),
      description: newProjectDesc.trim(),
    });
    setNewProjectName("");
    setNewProjectDesc("");
    setShowNewProjectModal(false);
    if (updated?.projects?.length) {
      setActiveView(updated.projects[updated.projects.length - 1].id);
    }
    triggerToast(`Created project "${newProjectName.trim()}" with default Task Fields`);
  }

  async function handleBackupDb() {
    const res = await apiAction({ action: "backup_db" });
    if (res?.backupFile) {
      triggerToast(`Snapshot saved to: ${res.backupFile}`);
    }
  }

  return (
    <div className="min-h-screen flex bg-bcb-canvas text-stone-100">
      {/* Left Sidebar (Dark Coffee Bean) */}
      <aside className="w-64 bg-bcb-coffee border-r border-bcb-border flex flex-col justify-between shrink-0">
        <div>
          {/* Brand Header */}
          <div className="p-4 border-b border-bcb-border flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-bcb-cerulean flex items-center justify-center font-bold text-white shadow-sm">
                B
              </div>
              <div>
                <h1 className="font-bold text-sm tracking-wide text-white leading-none">
                  BANG CLICK BOOM
                </h1>
                <span className="text-[11px] text-bcb-tea font-medium">
                  Human + Gemini Hub
                </span>
              </div>
            </div>
          </div>

          {/* Primary Nav */}
          <nav className="p-3 space-y-1">
            <button
              onClick={() => setActiveView("dashboard")}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition ${
                activeView === "dashboard"
                  ? "bg-bcb-cerulean text-white"
                  : "text-stone-300 hover:bg-bcb-surface"
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              Analytics Dashboard
            </button>

            <button
              onClick={() => setActiveView("portfolio")}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition ${
                activeView === "portfolio"
                  ? "bg-bcb-cerulean text-white"
                  : "text-stone-300 hover:bg-bcb-surface"
              }`}
            >
              <Briefcase className="w-4 h-4" />
              Portfolios
            </button>
          </nav>

          {/* Projects Section */}
          <div className="px-3 mt-4">
            <div className="flex items-center justify-between px-2 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-stone-400">
                Projects
              </span>
              <button
                onClick={() => setShowNewProjectModal(true)}
                className="p-1 rounded hover:bg-bcb-surface text-bcb-tea transition"
                title="Create New Project"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-1">
              {activeProjects.map((proj) => {
                const isMenuOpen = openProjectMenuId === proj.id;
                const openTaskCount = data.tasks.filter((t) => t.project_id === proj.id && !t.completed).length;

                return (
                  <div key={proj.id} className="relative group">
                    <div
                      onClick={() => {
                        setActiveView(proj.id);
                        setOpenProjectMenuId(null);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition cursor-pointer ${
                        activeView === proj.id
                          ? "bg-bcb-cerulean text-white"
                          : "text-stone-300 hover:bg-bcb-surface"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        {proj.icon === "Rocket" ? (
                          <Rocket className="w-4 h-4 shrink-0 text-bcb-tea" />
                        ) : (
                          <FolderKanban className="w-4 h-4 shrink-0 text-bcb-cerulean-light" />
                        )}
                        <span className="truncate">{proj.name}</span>
                      </div>

                      {/* Task Pill switches to Hamburger Menu on hover */}
                      <div className="shrink-0 ml-2 flex items-center">
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded bg-black/25 text-stone-300 ${
                            isMenuOpen ? "hidden" : "group-hover:hidden"
                          }`}
                        >
                          {openTaskCount}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenProjectMenuId(isMenuOpen ? null : proj.id);
                          }}
                          className={`p-1 rounded hover:bg-black/30 text-stone-200 ${
                            isMenuOpen ? "inline-flex" : "hidden group-hover:inline-flex"
                          }`}
                          title="Project Options"
                        >
                          <Menu className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {isMenuOpen && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="absolute right-2 top-9 z-40 w-44 bg-bcb-canvas border border-bcb-border rounded-lg shadow-xl py-1 text-xs"
                      >
                        <button
                          onClick={async () => {
                            setOpenProjectMenuId(null);
                            await apiAction({
                              action: "archive_project",
                              project_id: proj.id,
                              is_archived: true,
                            });
                            if (activeView === proj.id) setActiveView("dashboard");
                            triggerToast(`Archived "${proj.name}"`);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left text-stone-200 hover:bg-bcb-surface transition"
                        >
                          <Archive className="w-3.5 h-3.5 text-bcb-tea" />
                          Archive Project
                        </button>
                        <button
                          onClick={() => {
                            setOpenProjectMenuId(null);
                            setProjectToDelete(proj);
                            setDeleteConfirmText("");
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left text-red-400 hover:bg-red-950/50 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete Project
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Archived Projects Section */}
          <div className="px-3 mt-5">
            <button
              onClick={() => setShowArchivedProjects(!showArchivedProjects)}
              className="w-full flex items-center justify-between px-2 mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400 hover:text-stone-200 transition"
            >
              <span className="flex items-center gap-1.5">
                {showArchivedProjects ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
                Archived Projects
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-bcb-surface text-stone-400">
                {archivedProjects.length}
              </span>
            </button>

            {showArchivedProjects && (
              <div className="space-y-1">
                {archivedProjects.length === 0 ? (
                  <p className="px-3 py-1.5 text-[11px] text-stone-500 italic">
                    No archived projects
                  </p>
                ) : (
                  archivedProjects.map((proj) => {
                    const isMenuOpen = openProjectMenuId === proj.id;
                    const openTaskCount = data.tasks.filter((t) => t.project_id === proj.id && !t.completed).length;

                    return (
                      <div key={proj.id} className="relative group">
                        <div
                          onClick={() => {
                            setActiveView(proj.id);
                            setOpenProjectMenuId(null);
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition cursor-pointer ${
                            activeView === proj.id
                              ? "bg-bcb-cerulean text-white"
                              : "text-stone-400 hover:bg-bcb-surface hover:text-stone-200"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 truncate">
                            <Archive className="w-4 h-4 shrink-0 text-stone-500" />
                            <span className="truncate">{proj.name}</span>
                          </div>

                          <div className="shrink-0 ml-2 flex items-center">
                            <span
                              className={`text-xs px-1.5 py-0.5 rounded bg-black/25 text-stone-400 ${
                                isMenuOpen ? "hidden" : "group-hover:hidden"
                              }`}
                            >
                              {openTaskCount}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenProjectMenuId(isMenuOpen ? null : proj.id);
                              }}
                              className={`p-1 rounded hover:bg-black/30 text-stone-200 ${
                                isMenuOpen ? "inline-flex" : "hidden group-hover:inline-flex"
                              }`}
                              title="Project Options"
                            >
                              <Menu className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {isMenuOpen && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute right-2 top-9 z-40 w-44 bg-bcb-canvas border border-bcb-border rounded-lg shadow-xl py-1 text-xs"
                          >
                            <button
                              onClick={async () => {
                                setOpenProjectMenuId(null);
                                await apiAction({
                                  action: "archive_project",
                                  project_id: proj.id,
                                  is_archived: false,
                                });
                                triggerToast(`Restored "${proj.name}" to Projects`);
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-left text-stone-200 hover:bg-bcb-surface transition"
                            >
                              <ArchiveRestore className="w-3.5 h-3.5 text-bcb-tea" />
                              Restore Project
                            </button>
                            <button
                              onClick={() => {
                                setOpenProjectMenuId(null);
                                setProjectToDelete(proj);
                                setDeleteConfirmText("");
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-left text-red-400 hover:bg-red-950/50 transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete Project
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer / DB Snapshot */}
        <div className="p-3 border-t border-bcb-border space-y-2">
          <button
            onClick={handleBackupDb}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-bcb-surface hover:bg-bcb-border text-bcb-tea border border-bcb-border transition"
          >
            <Save className="w-3.5 h-3.5" />
            Save Database Snapshot
          </button>
          <div className="flex items-center justify-between text-[11px] text-stone-400 px-1">
            <span>Palette: Coffee / Cerulean / Tea</span>
            <span className="w-2 h-2 rounded-full bg-bcb-tea" title="SQLite Live Connected" />
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {toastMessage && (
          <div className="fixed bottom-5 right-5 z-50 bg-bcb-cerulean text-white px-4 py-2.5 rounded-lg shadow-lg border border-bcb-tea/40 flex items-center gap-2 text-sm font-medium">
            <Sparkles className="w-4 h-4 text-bcb-tea" />
            {toastMessage}
          </div>
        )}

        {/* VIEW 1: BARE-BONES ANALYTICS DASHBOARD */}
        {activeView === "dashboard" && (
          <div className="flex-1 overflow-y-auto p-8 space-y-8">
            <div className="flex items-center justify-between border-b border-bcb-border pb-5">
              <div>
                <h2 className="text-2xl font-bold text-white">Analytics Dashboard</h2>
                <p className="text-sm text-stone-400 mt-1">
                  Overview of tasks, Custom Field rollups, and You vs. Gemini progress.
                </p>
              </div>
              <span className="px-3 py-1 rounded-full text-xs font-medium bg-bcb-coffee border border-bcb-border text-bcb-tea">
                Live SQLite Sync
              </span>
            </div>

            {/* Note: yourTasks / geminiTasks Co-Working Split metrics are retained in state for future reuse */}
            {/* Project Task Completion Widget */}
            <div className="bg-bcb-coffee border border-bcb-border rounded-xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-bcb-border pb-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-bcb-tea" />
                  <h3 className="font-semibold text-white text-sm uppercase tracking-wider">
                    Project Task Completion
                  </h3>
                </div>

                {/* Total Summary Section */}
                <div className="flex items-center gap-5 bg-bcb-canvas px-4 py-2 rounded-lg border border-bcb-border text-xs">
                  <div>
                    <span className="text-stone-400 uppercase font-semibold mr-2">Total Incomplete:</span>
                    <span className="text-sm font-bold text-white">{totalTasks - completedTasks}</span>
                  </div>
                  <div className="h-4 w-px bg-bcb-border" />
                  <div>
                    <span className="text-stone-400 uppercase font-semibold mr-2">Total Complete:</span>
                    <span className="text-sm font-bold text-bcb-tea">{completedTasks}</span>
                  </div>
                  <div className="h-4 w-px bg-bcb-border" />
                  <div>
                    <span className="text-stone-400 uppercase font-semibold mr-2">Overall:</span>
                    <span className="text-sm font-bold text-bcb-cerulean-light">
                      {totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0}%
                    </span>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-bcb-border text-[11px] uppercase tracking-wider text-stone-400">
                      <th className="py-2.5 pr-4">Project</th>
                      <th className="py-2.5 px-4 w-36">Incomplete Tasks</th>
                      <th className="py-2.5 px-4 w-36">Complete Tasks</th>
                      <th className="py-2.5 pl-4 min-w-[240px]">Progress Bar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bcb-border">
                    {activeProjects.map((proj) => {
                      const pTasks = data.tasks.filter((t) => t.project_id === proj.id);
                      const pComplete = pTasks.filter((t) => t.completed === 1).length;
                      const pIncomplete = pTasks.length - pComplete;
                      const pct = pTasks.length > 0 ? Math.round((pComplete / pTasks.length) * 100) : 0;

                      return (
                        <tr
                          key={proj.id}
                          onClick={() => setActiveView(proj.id)}
                          className="hover:bg-bcb-surface/70 cursor-pointer transition"
                        >
                          <td className="py-3 pr-4 font-medium text-white">{proj.name}</td>
                          <td className="py-3 px-4 text-stone-200 font-semibold">{pIncomplete}</td>
                          <td className="py-3 px-4 text-bcb-tea font-semibold">{pComplete}</td>
                          <td className="py-3 pl-4">
                            <div className="flex items-center gap-3">
                              <div className="flex-1 h-2.5 rounded-full bg-bcb-canvas overflow-hidden border border-bcb-border/60">
                                <div
                                  className="h-full bg-bcb-tea transition-all"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-xs font-semibold w-12 text-right text-bcb-tea">
                                {pct}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Project Time Breakdown Widget (Actual vs Estimated) */}
            <div className="bg-bcb-coffee border border-bcb-border rounded-xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-bcb-border pb-4">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-bcb-cerulean-light" />
                  <h3 className="font-semibold text-white text-sm uppercase tracking-wider">
                    Project Time Breakdown (Actual vs. Estimated)
                  </h3>
                </div>

                {/* Total Summary Section */}
                <div className="flex items-center gap-5 bg-bcb-canvas px-4 py-2 rounded-lg border border-bcb-border text-xs">
                  <div>
                    <span className="text-stone-400 uppercase font-semibold mr-2">Total Actual:</span>
                    <span className="text-sm font-bold text-white">{totalActualHours.toFixed(2)}h</span>
                  </div>
                  <div className="h-4 w-px bg-bcb-border" />
                  <div>
                    <span className="text-stone-400 uppercase font-semibold mr-2">Total Estimate:</span>
                    <span className="text-sm font-bold text-bcb-tea">{totalEstHours.toFixed(2)}h</span>
                  </div>
                  <div className="h-4 w-px bg-bcb-border" />
                  <div>
                    <span className="text-stone-400 uppercase font-semibold mr-2">Overall:</span>
                    <span className="text-sm font-bold text-bcb-cerulean-light">
                      {totalEstHours > 0 ? Math.round((totalActualHours / totalEstHours) * 100) : 0}%
                    </span>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-bcb-border text-[11px] uppercase tracking-wider text-stone-400">
                      <th className="py-2.5 pr-4">Project</th>
                      <th className="py-2.5 px-4 w-32">Actual Time</th>
                      <th className="py-2.5 px-4 w-32">Estimate Time</th>
                      <th className="py-2.5 pl-4 min-w-[240px]">Actual / Estimate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bcb-border">
                    {activeProjects.map((proj) => {
                      const pTasks = data.tasks.filter((t) => t.project_id === proj.id);
                      const pFields = data.customFields.filter((f) => f.project_id === proj.id);
                      let projEst = 0;
                      let projActual = 0;

                      for (const t of pTasks) {
                        for (const f of pFields) {
                          const val = Number(t.field_values[f.id] || 0);
                          if (!isNaN(val)) {
                            if (f.name.toLowerCase().includes("estimated")) projEst += val;
                            if (f.name.toLowerCase().includes("actual")) projActual += val;
                          }
                        }
                      }

                      const ratio = projEst > 0 ? (projActual / projEst) * 100 : projActual > 0 ? 100 : 0;
                      const barWidth = Math.min(100, Math.round(ratio));
                      const isOver = projEst > 0 && projActual > projEst;

                      return (
                        <tr
                          key={proj.id}
                          onClick={() => setActiveView(proj.id)}
                          className="hover:bg-bcb-surface/70 cursor-pointer transition"
                        >
                          <td className="py-3 pr-4 font-medium text-white">{proj.name}</td>
                          <td className="py-3 px-4 text-stone-200 font-semibold">{projActual.toFixed(2)}h</td>
                          <td className="py-3 px-4 text-bcb-tea font-semibold">{projEst.toFixed(2)}h</td>
                          <td className="py-3 pl-4">
                            <div className="flex items-center gap-3">
                              <div className="flex-1 h-2.5 rounded-full bg-bcb-canvas overflow-hidden border border-bcb-border/60">
                                <div
                                  className={`h-full transition-all ${
                                    isOver ? "bg-[#E06C75]" : "bg-bcb-cerulean"
                                  }`}
                                  style={{ width: `${barWidth}%` }}
                                />
                              </div>
                              <span
                                className={`text-xs font-semibold w-12 text-right ${
                                  isOver ? "text-[#E06C75]" : "text-bcb-tea"
                                }`}
                              >
                                {Math.round(ratio)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Task Completion Burnup Chart */}
            <BurnupChart
              tasks={data.tasks.map((t) => ({
                ...t,
                is_archived: !activeProjectIds.has(t.project_id),
              }))}
              title="Task Completion Burnup"
            />

            {/* Recent Co-Working Activity Feed */}
            <div className="bg-bcb-coffee border border-bcb-border rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <Activity className="w-4 h-4 text-bcb-cerulean-light" />
                <h3 className="font-semibold text-white text-sm uppercase tracking-wider">
                  Recent Activity (You & Gemini)
                </h3>
              </div>
              <div className="divide-y divide-bcb-border">
                {data.activity.map((item) => (
                  <div key={item.id} className="py-3 flex items-center justify-between text-sm">
                    <div className="flex items-center gap-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          item.actor === "Gemini"
                            ? "bg-bcb-cerulean text-white"
                            : "bg-bcb-tea text-bcb-coffee"
                        }`}
                      >
                        {item.actor}
                      </span>
                      <span className="text-stone-300">{item.action}:</span>
                      <span className="font-medium text-white">{item.task_title}</span>
                    </div>
                    <span className="text-xs text-stone-400">
                      {new Date(item.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* VIEW 2: PORTFOLIOS OVERVIEW */}
        {activeView === "portfolio" && (
          <div className="flex-1 overflow-y-auto p-8 space-y-6">
            <div className="flex items-center justify-between border-b border-bcb-border pb-5">
              <div>
                <h2 className="text-2xl font-bold text-white">Portfolios</h2>
                <p className="text-sm text-stone-400 mt-1">
                  High-level executive view grouping your projects and their progress.
                </p>
              </div>
              <button
                onClick={() => setShowNewProjectModal(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-bcb-cerulean hover:bg-bcb-cerulean-light text-white text-sm font-medium transition"
              >
                <Plus className="w-4 h-4" />
                New Project
              </button>
            </div>

            {data.portfolios.map((port) => (
              <div key={port.id} className="bg-bcb-coffee border border-bcb-border rounded-xl overflow-hidden">
                <div className="p-5 border-b border-bcb-border flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-white">{port.name}</h3>
                    <p className="text-xs text-stone-400 mt-0.5">{port.description}</p>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-bcb-surface text-bcb-tea border border-bcb-border">
                    {activeProjects.filter((p) => p.portfolio_id === port.id).length} Projects
                  </span>
                </div>

                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-bcb-border text-xs uppercase text-stone-400 bg-bcb-canvas/40">
                      <th className="py-3 px-5">Project Name</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Task Progress</th>
                      <th className="py-3 px-4">Custom Fields</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bcb-border">
                    {activeProjects
                      .filter((p) => p.portfolio_id === port.id)
                      .map((proj) => {
                        const pTasks = data.tasks.filter((t) => t.project_id === proj.id);
                        const pDone = pTasks.filter((t) => t.completed === 1).length;
                        const pct = pTasks.length > 0 ? Math.round((pDone / pTasks.length) * 100) : 0;
                        const pFields = data.customFields.filter((f) => f.project_id === proj.id);
                        return (
                          <tr
                            key={proj.id}
                            onClick={() => setActiveView(proj.id)}
                            className="hover:bg-bcb-surface cursor-pointer transition"
                          >
                            <td className="py-4 px-5 font-semibold text-white">{proj.name}</td>
                            <td className="py-4 px-4">
                              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-bcb-tea/20 text-bcb-tea border border-bcb-tea/40">
                                {proj.status}
                              </span>
                            </td>
                            <td className="py-4 px-4">
                              <div className="flex items-center gap-3">
                                <div className="w-32 h-2 bg-bcb-canvas rounded-full overflow-hidden">
                                  <div className="h-full bg-bcb-cerulean" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-xs text-stone-300">
                                  {pDone}/{pTasks.length} ({pct}%)
                                </span>
                              </div>
                            </td>
                            <td className="py-4 px-4 text-xs text-stone-400">
                              {pFields.map((f) => f.name).join(", ")}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        {/* VIEW 3: PROJECT LIST VIEW WITH DYNAMIC CUSTOM FIELDS */}
        {activeProject && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Project Header */}
            <header className="px-8 py-5 bg-bcb-coffee border-b border-bcb-border flex items-center justify-between shrink-0">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold text-white">{activeProject.name}</h2>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-bcb-tea/20 text-bcb-tea border border-bcb-tea/40">
                    {activeProject.status}
                  </span>
                </div>
                <p className="text-xs text-stone-400 mt-1">{activeProject.description}</p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setAutomationError(null);
                    setShowAutomationModal(true);
                  }}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold bg-bcb-surface hover:bg-bcb-border text-bcb-tea border border-bcb-border transition"
                >
                  <Settings className="w-4 h-4 text-bcb-cerulean-light" />
                  Automation Settings
                </button>
                <button
                  onClick={() => setShowCustomizeModal(true)}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold bg-bcb-surface hover:bg-bcb-border text-bcb-tea border border-bcb-border transition"
                >
                  <SlidersHorizontal className="w-4 h-4 text-bcb-cerulean-light" />
                  Customize Task Fields ({visibleProjectFields.length})
                </button>
              </div>
            </header>

            {/* Spreadsheet-style List View */}
            <div className="flex-1 overflow-auto p-6">
              <div className="bg-bcb-coffee border border-bcb-border rounded-xl overflow-x-auto shadow-lg">
                <table className="w-full text-left border-collapse text-sm min-w-[850px]">
                  <thead>
                    <tr className="border-b border-bcb-border text-[11px] font-semibold uppercase tracking-wider text-stone-400 bg-bcb-canvas/50">
                      <th className="py-3 px-4 min-w-[300px]">Task Name</th>
                      <th className="py-3 px-3 w-36">Assigned To</th>
                      <th className="py-3 px-3 w-36">Due Date</th>
                      {visibleProjectFields.map((field) => (
                        <th key={field.id} className={`py-3 px-3 ${isActualTimeField(field) ? "w-44" : "w-36"}`}>
                          <div className="flex items-center gap-1.5 text-bcb-tea">
                            <span>{field.name}</span>
                          </div>
                        </th>
                      ))}
                      <th className="py-3 px-3 w-12 text-right">
                        <button
                          onClick={() => setShowCustomizeModal(true)}
                          title="Add or Customize Task Fields"
                          className="p-1 rounded hover:bg-bcb-surface text-bcb-tea"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </th>
                    </tr>
                  </thead>

                  <tbody
                    className="divide-y divide-bcb-border"
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setDragOverSectionId(null);
                      }
                    }}
                  >
                    {projectSections.map((section, sectionIndex) => {
                      const sectionTasks = data.tasks.filter(
                        (t) => t.project_id === activeProject.id && t.section_id === section.id
                      );
                      const isCollapsed = !!collapsedSections[section.id];
                      const isInProgressTarget = activeProject.in_progress_section_id === section.id;
                      const isCompletedTarget = activeProject.completed_section_id === section.id;
                      const isEditingThisSection = editingSectionId === section.id;
                      const draggedTask = draggedTaskId
                        ? data.tasks.find((t) => t.id === draggedTaskId)
                        : null;
                      const isDropTarget = Boolean(
                        draggedTask &&
                          dragOverSectionId === section.id &&
                          draggedTask.section_id !== section.id
                      );

                      const handleSectionDragOver = (e: React.DragEvent) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (dragOverSectionId !== section.id) {
                          setDragOverSectionId(section.id);
                        }
                      };

                      const handleSectionDrop = (e: React.DragEvent) => {
                        e.preventDefault();
                        const taskId = draggedTaskId || e.dataTransfer.getData("text/plain");
                        setDraggedTaskId(null);
                        setDragOverSectionId(null);
                        if (!taskId) return;
                        const droppedTask = data.tasks.find((t) => t.id === taskId);
                        if (droppedTask && droppedTask.section_id !== section.id) {
                          handleMoveTaskToSection(droppedTask, section);
                        }
                      };

                      return (
                        <React.Fragment key={section.id}>
                          {/* Section Header Row */}
                          <tr
                            onDragOver={handleSectionDragOver}
                            onDrop={handleSectionDrop}
                            className={`group/sec transition ${
                              isDropTarget
                                ? "bg-bcb-cerulean/25 ring-1 ring-inset ring-bcb-cerulean"
                                : "bg-bcb-canvas/70"
                            }`}
                          >
                            <td
                              colSpan={4 + visibleProjectFields.length}
                              className="py-2.5 px-4 font-bold text-xs uppercase tracking-wider text-bcb-tea"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 min-w-0">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setCollapsedSections({
                                        ...collapsedSections,
                                        [section.id]: !isCollapsed,
                                      })
                                    }
                                    className="p-0.5 rounded hover:bg-bcb-surface hover:text-white transition shrink-0"
                                    title={isCollapsed ? "Expand section" : "Collapse section"}
                                  >
                                    {isCollapsed ? (
                                      <ChevronRight className="w-4 h-4" />
                                    ) : (
                                      <ChevronDown className="w-4 h-4" />
                                    )}
                                  </button>

                                  {isEditingThisSection ? (
                                    <input
                                      type="text"
                                      autoFocus
                                      value={editingSectionName}
                                      onChange={(e) => setEditingSectionName(e.target.value)}
                                      onBlur={() => handleRenameSection(section)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          handleRenameSection(section);
                                        } else if (e.key === "Escape") {
                                          setEditingSectionId(null);
                                          setEditingSectionName("");
                                        }
                                      }}
                                      className="bg-bcb-coffee border border-bcb-cerulean rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-white focus:outline-none w-56"
                                    />
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingSectionId(section.id);
                                        setEditingSectionName(section.name);
                                      }}
                                      title="Click to rename section"
                                      className="flex items-center gap-1.5 hover:text-white transition truncate text-left"
                                    >
                                      <span className="truncate">{section.name}</span>
                                      <Pencil className="w-3 h-3 opacity-0 group-hover/sec:opacity-70 shrink-0" />
                                    </button>
                                  )}

                                  <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded bg-bcb-surface text-stone-300 shrink-0">
                                    {sectionTasks.length}
                                  </span>

                                  {isInProgressTarget && (
                                    <span
                                      title="Tasks move here automatically when their timer starts"
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold normal-case tracking-normal bg-bcb-cerulean/25 text-bcb-cerulean-light border border-bcb-cerulean/40 shrink-0"
                                    >
                                      <Play className="w-2.5 h-2.5 fill-current" />
                                      Timer Target
                                    </span>
                                  )}
                                  {isCompletedTarget && (
                                    <span
                                      title="Tasks move here automatically when marked complete"
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold normal-case tracking-normal bg-bcb-tea/15 text-bcb-tea border border-bcb-tea/35 shrink-0"
                                    >
                                      <CheckCircle2 className="w-2.5 h-2.5" />
                                      Completed Target
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                  {isDropTarget ? (
                                    <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-bcb-cerulean text-white">
                                      Drop to move here
                                    </span>
                                  ) : (
                                    <div className="flex items-center gap-0.5 opacity-0 group-hover/sec:opacity-100 transition">
                                      <button
                                        type="button"
                                        disabled={sectionIndex === 0}
                                        onClick={() => handleReorderSection(section, "up")}
                                        title="Move section up"
                                        className="p-1 rounded hover:bg-bcb-surface text-stone-400 hover:text-white disabled:opacity-25 disabled:pointer-events-none transition"
                                      >
                                        <ChevronUp className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={sectionIndex === projectSections.length - 1}
                                        onClick={() => handleReorderSection(section, "down")}
                                        title="Move section down"
                                        className="p-1 rounded hover:bg-bcb-surface text-stone-400 hover:text-white disabled:opacity-25 disabled:pointer-events-none transition"
                                      >
                                        <ChevronDown className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={projectSections.length <= 1}
                                        onClick={() => handleRequestDeleteSection(section)}
                                        title={
                                          projectSections.length <= 1
                                            ? "Cannot delete the last remaining section"
                                            : "Delete section"
                                        }
                                        className="p-1 rounded hover:bg-red-950/60 text-stone-400 hover:text-red-400 disabled:opacity-25 disabled:pointer-events-none transition"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>

                          {/* Tasks in Section */}
                          {!isCollapsed &&
                            sectionTasks.map((task) => {
                              const isTimerRunning = Boolean(task.timer_started_at);
                              const liveElapsedSec = getElapsedSeconds(task.timer_started_at, nowMs);

                              return (
                                <tr
                                  key={task.id}
                                  draggable
                                  onDragStart={(e) => {
                                    if ((e.target as HTMLElement)?.closest("input, select, textarea, label")) {
                                      e.preventDefault();
                                      return;
                                    }
                                    setDraggedTaskId(task.id);
                                    e.dataTransfer.effectAllowed = "move";
                                    e.dataTransfer.setData("text/plain", task.id);
                                  }}
                                  onDragEnd={() => {
                                    setDraggedTaskId(null);
                                    setDragOverSectionId(null);
                                  }}
                                  onDragOver={handleSectionDragOver}
                                  onDrop={handleSectionDrop}
                                  className={`group hover:bg-bcb-surface/80 transition ${
                                    selectedTask?.id === task.id ? "bg-bcb-surface" : ""
                                  } ${isDropTarget ? "bg-bcb-cerulean/5" : ""} ${
                                    draggedTaskId === task.id ? "opacity-40" : ""
                                  }`}
                                >
                                  {/* Task Title + Drag Handle + Complete Toggle */}
                                  <td className="py-2.5 px-4">
                                    <div className="flex items-center gap-2.5">
                                      <GripVertical
                                        className="w-4 h-4 shrink-0 text-stone-600 group-hover:text-stone-400 cursor-grab active:cursor-grabbing"
                                        aria-hidden="true"
                                      />
                                      <button
                                        onClick={() =>
                                          apiAction({
                                            action: "update_task",
                                            id: task.id,
                                            completed: task.completed === 0,
                                          })
                                        }
                                        className="shrink-0"
                                      >
                                        {task.completed ? (
                                          <CheckCircle2 className="w-5 h-5 text-bcb-tea" />
                                        ) : (
                                          <Circle className="w-5 h-5 text-stone-400 hover:text-bcb-cerulean-light" />
                                        )}
                                      </button>
                                      <button
                                        onClick={() => setSelectedTaskId(task.id)}
                                        className={`text-left font-medium hover:underline truncate ${
                                          task.completed ? "line-through text-stone-500" : "text-stone-100"
                                        }`}
                                      >
                                        {task.title}
                                      </button>
                                    </div>
                                  </td>

                                  {/* Assigned To Dropdown */}
                                  <td className="py-2 px-3">
                                    <select
                                      value={task.assignee}
                                      onChange={(e) =>
                                        apiAction({
                                          action: "update_task",
                                          id: task.id,
                                          assignee: e.target.value,
                                        })
                                      }
                                      className={`text-xs font-semibold px-2.5 py-1 rounded-full border cursor-pointer focus:outline-none ${
                                        task.assignee === "Gemini"
                                          ? "bg-bcb-cerulean text-white border-bcb-cerulean-light"
                                          : "bg-bcb-canvas text-bcb-tea border-bcb-border"
                                      }`}
                                    >
                                      <option value="You">👤 You</option>
                                      <option value="Gemini">✨ Gemini</option>
                                      <option value="Unassigned">Unassigned</option>
                                    </select>
                                  </td>

                                  {/* Due Date Pill (Blank space + Calendar icon when empty) */}
                                  <td className="py-2 px-3">
                                    <label className="relative inline-flex items-center justify-between w-28 px-2.5 py-1 rounded-full border border-bcb-border bg-bcb-canvas hover:border-bcb-cerulean text-xs cursor-pointer transition">
                                      <span className={task.due_date ? "text-stone-200 font-medium" : "text-transparent select-none"}>
                                        {task.due_date
                                          ? `${task.due_date.slice(5, 7)}/${task.due_date.slice(8, 10)}/${task.due_date.slice(2, 4)}`
                                          : "\u00A0"}
                                      </span>
                                      <Calendar className={`w-3.5 h-3.5 shrink-0 ${task.due_date ? "text-bcb-tea" : "text-stone-400"}`} />
                                      <input
                                        type="date"
                                        value={task.due_date || ""}
                                        onClick={(e) => {
                                          try {
                                            (e.currentTarget as HTMLInputElement).showPicker?.();
                                          } catch {}
                                        }}
                                        onChange={(e) =>
                                          apiAction({
                                            action: "update_task",
                                            id: task.id,
                                            due_date: e.target.value || null,
                                          })
                                        }
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                      />
                                    </label>
                                  </td>

                                  {/* Dynamic Custom Task Fields */}
                                  {visibleProjectFields.map((field) => {
                                    const rawVal = task.field_values[field.id] ?? "";
                                    if (field.field_type === "single_select") {
                                      let opts: { label: string; color: string }[] = [];
                                      try {
                                        opts = JSON.parse(field.options_json || "[]");
                                      } catch {}
                                      const activeOpt = opts.find((o) => o.label === rawVal);

                                      return (
                                        <td key={field.id} className="py-2 px-3">
                                          <select
                                            value={String(rawVal)}
                                            onChange={(e) =>
                                              apiAction({
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
                                            className="text-xs font-semibold px-2.5 py-1 rounded-full border cursor-pointer focus:outline-none"
                                          >
                                            <option value="">—</option>
                                            {opts.map((o) => (
                                              <option key={o.label} value={o.label} className="bg-bcb-coffee text-white">
                                                {o.label}
                                              </option>
                                            ))}
                                          </select>
                                        </td>
                                      );
                                    }

                                    if (isActualTimeField(field)) {
                                      const storedHours = Number(rawVal || 0) || 0;
                                      const liveTotalSec = Math.round(storedHours * 3600) + liveElapsedSec;

                                      return (
                                        <td key={field.id} className="py-2 px-3">
                                          {isTimerRunning ? (
                                            <div className="flex items-center gap-2">
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleStopTimer(task);
                                                }}
                                                title="Stop timer & log elapsed time"
                                                className="p-1.5 rounded-md bg-red-500/20 text-red-300 border border-red-500/50 hover:bg-red-500 hover:text-white transition animate-pulse"
                                              >
                                                <Square className="w-3 h-3 fill-current" />
                                              </button>
                                              <span className="px-2 py-0.5 rounded bg-bcb-canvas border border-bcb-cerulean/60 text-bcb-tea font-mono text-xs font-semibold">
                                                {formatDurationHMS(liveTotalSec)}
                                              </span>
                                            </div>
                                          ) : (
                                            <div className="flex items-center gap-1.5">
                                              <InlineFieldInput
                                                value={rawVal}
                                                isNumeric
                                                step="0.25"
                                                min="0"
                                                placeholder="—"
                                                formatDisplay={formatHoursForInput}
                                                onCommit={(nextVal) =>
                                                  apiAction({
                                                    action: "update_task",
                                                    id: task.id,
                                                    is_numeric_field: true,
                                                    field_values: { [field.id]: nextVal },
                                                  })
                                                }
                                                className="w-16 bg-transparent border border-transparent hover:border-bcb-border focus:border-bcb-cerulean rounded px-1.5 py-1 text-xs text-stone-200 focus:outline-none"
                                              />
                                              <span className="text-[11px] text-stone-400">h</span>
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleStartTimer(task);
                                                }}
                                                title={
                                                  activeInProgressSection
                                                    ? `Start timer (moves to "${activeInProgressSection.name}")`
                                                    : "Start timer"
                                                }
                                                className="p-1.5 rounded-md bg-bcb-canvas border border-bcb-border text-bcb-cerulean-light hover:bg-bcb-cerulean hover:text-white hover:border-bcb-cerulean transition"
                                              >
                                                <Play className="w-3 h-3 fill-current" />
                                              </button>
                                            </div>
                                          )}
                                        </td>
                                      );
                                    }

                                    const isNumeric =
                                      field.field_type === "time_hours" ||
                                      field.field_type === "number" ||
                                      field.field_type === "percent";

                                    return (
                                      <td key={field.id} className="py-2 px-3">
                                        <div className="flex items-center gap-1">
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
                                              apiAction({
                                                action: "update_task",
                                                id: task.id,
                                                is_numeric_field: isNumeric,
                                                field_values: { [field.id]: nextVal },
                                              })
                                            }
                                            className="w-20 bg-transparent border border-transparent hover:border-bcb-border focus:border-bcb-cerulean rounded px-1.5 py-1 text-xs text-stone-200 focus:outline-none"
                                          />
                                          {field.field_type === "time_hours" && (
                                            <span className="text-[11px] text-stone-400">h</span>
                                          )}
                                          {field.field_type === "percent" && (
                                            <span className="text-[11px] text-stone-400">%</span>
                                          )}
                                        </div>
                                      </td>
                                    );
                                  })}

                                  {/* Delete Action */}
                                  <td className="py-2 px-3 text-right">
                                    <button
                                      onClick={() => apiAction({ action: "delete_task", id: task.id })}
                                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-950/60 text-stone-400 hover:text-red-400 transition"
                                      title="Delete task"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}

                          {/* Quick Add Task Row */}
                          {!isCollapsed && (
                            <tr
                              onDragOver={handleSectionDragOver}
                              onDrop={handleSectionDrop}
                              className={`transition ${
                                isDropTarget ? "bg-bcb-cerulean/10" : "bg-bcb-coffee/40"
                              }`}
                            >
                              <td colSpan={4 + visibleProjectFields.length} className="py-2 px-4">
                                <div className="flex items-center gap-3">
                                  <Plus className="w-4 h-4 text-stone-400" />
                                  <input
                                    type="text"
                                    value={newTaskTitle[section.id] || ""}
                                    onChange={(e) =>
                                      setNewTaskTitle({ ...newTaskTitle, [section.id]: e.target.value })
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        handleQuickAddTask(section.id, activeProject.id);
                                      }
                                    }}
                                    placeholder={`+ Add task to "${section.name}" (press Enter)...`}
                                    className="bg-transparent text-xs text-stone-200 placeholder:text-stone-500 focus:outline-none w-72"
                                  />
                                  <select
                                    value={newTaskAssignee[section.id] || "You"}
                                    onChange={(e) =>
                                      setNewTaskAssignee({
                                        ...newTaskAssignee,
                                        [section.id]: e.target.value as "You" | "Gemini",
                                      })
                                    }
                                    className="bg-bcb-canvas text-[11px] text-stone-300 border border-bcb-border rounded px-2 py-0.5"
                                  >
                                    <option value="You">Assign: You</option>
                                    <option value="Gemini">Assign: Gemini</option>
                                  </select>
                                  {newTaskTitle[section.id]?.trim() && (
                                    <button
                                      onClick={() => handleQuickAddTask(section.id, activeProject.id)}
                                      className="px-2.5 py-1 rounded text-xs font-medium bg-bcb-cerulean text-white"
                                    >
                                      Add
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}

                    {/* Bottom "+ Add Section" Cerulean Bar */}
                    <tr className="bg-bcb-cerulean hover:bg-bcb-cerulean-light transition">
                      <td
                        colSpan={4 + visibleProjectFields.length}
                        className="py-2.5 px-4 font-bold text-xs uppercase tracking-wider text-white"
                      >
                        {isAddingSection ? (
                          <div className="flex items-center gap-2">
                            <Plus className="w-4 h-4 shrink-0 text-white" />
                            <input
                              type="text"
                              autoFocus
                              value={newSectionName}
                              onChange={(e) => setNewSectionName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleCreateSection();
                                } else if (e.key === "Escape") {
                                  setIsAddingSection(false);
                                  setNewSectionName("");
                                }
                              }}
                              onBlur={() => {
                                if (newSectionName.trim()) {
                                  handleCreateSection();
                                } else {
                                  setIsAddingSection(false);
                                }
                              }}
                              placeholder="Enter new section name and press Enter..."
                              className="flex-1 bg-black/20 border border-white/40 rounded px-2.5 py-0.5 text-xs font-semibold normal-case tracking-normal text-white placeholder:text-white/75 focus:outline-none focus:border-white"
                            />
                            <span className="text-[10px] font-medium normal-case tracking-normal text-white/80 shrink-0">
                              Enter to add · Esc to cancel
                            </span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setNewSectionName("");
                              setIsAddingSection(true);
                            }}
                            className="w-full flex items-center gap-2 text-left text-white cursor-pointer"
                          >
                            <Plus className="w-4 h-4 shrink-0" />
                            <span>Add Section</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Slide-Over Task Detail Drawer */}
      {selectedTask && (() => {
        const taskProj = data.projects.find((p) => p.id === selectedTask.project_id);
        const taskSections = data.sections.filter((s) => s.project_id === selectedTask.project_id);
        const taskInProgSec = taskProj?.in_progress_section_id
          ? taskSections.find((s) => s.id === taskProj.in_progress_section_id) || null
          : null;
        return (
          <TaskDetailDrawer
            task={selectedTask}
            projectFields={data.customFields.filter((f) => f.project_id === selectedTask.project_id)}
            projectSections={taskSections}
            inProgressSectionName={taskInProgSec?.name ?? null}
            nowMs={nowMs}
            onClose={() => setSelectedTaskId(null)}
            onUpdateTask={apiAction}
            onMoveSection={handleMoveTaskToSection}
            onDeleteTask={(taskId) => apiAction({ action: "delete_task", id: taskId })}
            onStartTimer={handleStartTimer}
            onStopTimer={handleStopTimer}
            onOpenCustomize={() => {
              setActiveView(selectedTask.project_id);
              setShowCustomizeModal(true);
            }}
          />
        );
      })()}

      {/* Modal: Automation Settings */}
      {showAutomationModal && activeProject && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-bcb-coffee border border-bcb-border rounded-xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-bcb-border pb-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Settings className="w-5 h-5 text-bcb-cerulean-light" />
                  Automation Settings — {activeProject.name}
                </h3>
                <p className="text-xs text-stone-400 mt-0.5">
                  Configure how tasks automatically move between sections in this project.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAutomationModal(false)}
                className="p-1 rounded hover:bg-bcb-surface text-stone-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {automationError && (
              <div className="px-3 py-2 rounded-lg bg-red-950/60 border border-red-500/40 text-xs text-red-300">
                {automationError}
              </div>
            )}

            <div className="space-y-4">
              {/* Rule 1: Timer Started */}
              <div className="p-4 rounded-lg bg-bcb-canvas border border-bcb-border space-y-2.5">
                <div className="flex items-center gap-2">
                  <Play className="w-4 h-4 text-bcb-cerulean-light fill-current" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                    When Task Timer Starts
                  </h4>
                </div>
                <p className="text-xs text-stone-400">
                  Automatically move the task to this section when its live timer is started.
                </p>
                <select
                  value={activeProject.in_progress_section_id || ""}
                  onChange={(e) =>
                    handleUpdateAutomations(
                      e.target.value || null,
                      activeProject.completed_section_id || null
                    )
                  }
                  className="w-full bg-bcb-coffee border border-bcb-border rounded-lg px-3 py-2 text-xs text-white focus:border-bcb-cerulean focus:outline-none"
                >
                  <option value="">None (don&apos;t auto-move)</option>
                  {projectSections.map((sec) => {
                    const isUsedByCompleted = activeProject.completed_section_id === sec.id;
                    return (
                      <option key={sec.id} value={sec.id} disabled={isUsedByCompleted}>
                        {sec.name}
                        {isUsedByCompleted ? " (used by Completed)" : ""}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Rule 2: Task Completed */}
              <div className="p-4 rounded-lg bg-bcb-canvas border border-bcb-border space-y-2.5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-bcb-tea" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                    When Task Is Marked Complete
                  </h4>
                </div>
                <p className="text-xs text-stone-400">
                  Automatically move completed tasks to this section. Dragging a task into this section also marks it
                  complete and stops any running timer.
                </p>
                <select
                  value={activeProject.completed_section_id || ""}
                  onChange={(e) =>
                    handleUpdateAutomations(
                      activeProject.in_progress_section_id || null,
                      e.target.value || null
                    )
                  }
                  className="w-full bg-bcb-coffee border border-bcb-border rounded-lg px-3 py-2 text-xs text-white focus:border-bcb-cerulean focus:outline-none"
                >
                  <option value="">None (don&apos;t auto-move)</option>
                  {projectSections.map((sec) => {
                    const isUsedByTimer = activeProject.in_progress_section_id === sec.id;
                    return (
                      <option key={sec.id} value={sec.id} disabled={isUsedByTimer}>
                        {sec.name}
                        {isUsedByTimer ? " (used by Timer)" : ""}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-bcb-border">
              <button
                type="button"
                onClick={() => setShowAutomationModal(false)}
                className="px-4 py-2 rounded-lg bg-bcb-cerulean hover:bg-bcb-cerulean-light text-white text-xs font-semibold transition"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Safe Delete Section */}
      {sectionToDelete && activeProject && (() => {
        const tasksInSection = data.tasks.filter((t) => t.section_id === sectionToDelete.id);
        const otherSections = projectSections.filter((s) => s.id !== sectionToDelete.id);
        const clearsTimer = activeProject.in_progress_section_id === sectionToDelete.id;
        const clearsCompleted = activeProject.completed_section_id === sectionToDelete.id;

        return (
          <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
            <form
              onSubmit={handleConfirmDeleteSection}
              className="bg-bcb-coffee border border-bcb-border rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-bcb-border pb-3">
                <h3 className="text-lg font-bold text-red-400 flex items-center gap-2">
                  <Trash2 className="w-5 h-5" />
                  Delete Section
                </h3>
                <button
                  type="button"
                  onClick={() => setSectionToDelete(null)}
                  className="text-stone-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-xs text-stone-300 leading-relaxed">
                Are you sure you want to delete <strong className="text-white">{sectionToDelete.name}</strong>?
              </p>

              {tasksInSection.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs text-stone-300 font-medium block">
                    Move its <strong className="text-bcb-tea">{tasksInSection.length}</strong>{" "}
                    {tasksInSection.length === 1 ? "task" : "tasks"} to:
                  </label>
                  <select
                    required
                    value={reassignTargetSectionId}
                    onChange={(e) => setReassignTargetSectionId(e.target.value)}
                    className="w-full bg-bcb-canvas border border-bcb-border rounded-lg px-3 py-2 text-xs text-white focus:border-bcb-cerulean focus:outline-none"
                  >
                    {otherSections.map((sec) => (
                      <option key={sec.id} value={sec.id}>
                        {sec.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {(clearsTimer || clearsCompleted) && (
                <div className="px-3 py-2 rounded-lg bg-amber-950/40 border border-amber-500/40 text-xs text-amber-200">
                  Deleting this section will reset the{" "}
                  <strong>
                    {clearsTimer ? "Timer Started" : "Task Completed"}
                  </strong>{" "}
                  automation to <em>None</em>.
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSectionToDelete(null)}
                  className="px-4 py-2 rounded-lg bg-bcb-surface hover:bg-bcb-border text-xs font-semibold text-stone-200 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold transition"
                >
                  {tasksInSection.length > 0 ? "Move Tasks & Delete" : "Delete Section"}
                </button>
              </div>
            </form>
          </div>
        );
      })()}

      {/* Modal: Customize Task Fields */}
      {showCustomizeModal && activeProject && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-bcb-coffee border border-bcb-border rounded-xl max-w-lg w-full p-6 space-y-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-bcb-border pb-4">
              <div>
                <h3 className="text-lg font-bold text-white">
                  Customize Task Fields — {activeProject.name}
                </h3>
                <p className="text-xs text-stone-400">
                  Add, toggle visibility, or remove custom properties for this project.
                </p>
              </div>
              <button
                onClick={() => setShowCustomizeModal(false)}
                className="p-1 rounded hover:bg-bcb-surface text-stone-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Existing Fields */}
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {projectFields.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-bcb-canvas border border-bcb-border"
                >
                  <div>
                    <span className="text-sm font-semibold text-white">{f.name}</span>
                    <span className="ml-2 text-[11px] px-2 py-0.5 rounded bg-bcb-surface text-bcb-tea">
                      {f.field_type}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        apiAction({
                          action: "toggle_custom_field",
                          field_id: f.id,
                          is_visible: f.is_visible === 0,
                        })
                      }
                      className="p-1.5 rounded hover:bg-bcb-surface text-stone-300"
                      title={f.is_visible ? "Hide Column" : "Show Column"}
                    >
                      {f.is_visible ? (
                        <Eye className="w-4 h-4 text-bcb-tea" />
                      ) : (
                        <EyeOff className="w-4 h-4 text-stone-500" />
                      )}
                    </button>
                    <button
                      onClick={() =>
                        apiAction({
                          action: "delete_custom_field",
                          field_id: f.id,
                        })
                      }
                      className="p-1.5 rounded hover:bg-red-950/60 text-stone-400 hover:text-red-400"
                      title="Delete Field"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add New Field Form */}
            <form onSubmit={handleAddCustomField} className="space-y-3 border-t border-bcb-border pt-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-bcb-tea">
                + Add New Task Field
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  value={newFieldName}
                  onChange={(e) => setNewFieldName(e.target.value)}
                  placeholder="Field name (e.g. Sprint, Stage)"
                  className="bg-bcb-canvas border border-bcb-border rounded-lg px-3 py-2 text-xs text-white focus:border-bcb-cerulean focus:outline-none"
                />
                <select
                  value={newFieldType}
                  onChange={(e) => setNewFieldType(e.target.value as any)}
                  className="bg-bcb-canvas border border-bcb-border rounded-lg px-3 py-2 text-xs text-white"
                >
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="time_hours">Time (Hours)</option>
                  <option value="percent">Percent (%)</option>
                  <option value="single_select">Single-Select Dropdown</option>
                </select>
              </div>
              {newFieldType === "single_select" && (
                <div>
                  <label className="text-[11px] text-stone-400">
                    Dropdown Options (comma-separated):
                  </label>
                  <input
                    type="text"
                    value={newFieldOptions}
                    onChange={(e) => setNewFieldOptions(e.target.value)}
                    className="w-full mt-1 bg-bcb-canvas border border-bcb-border rounded-lg px-3 py-2 text-xs text-white"
                  />
                </div>
              )}
              <button
                type="submit"
                className="w-full py-2 rounded-lg bg-bcb-cerulean hover:bg-bcb-cerulean-light text-white text-xs font-semibold transition"
              >
                Add Field to Project
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal: New Project */}
      {showNewProjectModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateProject}
            className="bg-bcb-coffee border border-bcb-border rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-bcb-border pb-3">
              <h3 className="text-lg font-bold text-white">Create New Project</h3>
              <button
                type="button"
                onClick={() => setShowNewProjectModal(false)}
                className="text-stone-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div>
              <label className="text-xs text-stone-300 font-medium">Project Name</label>
              <input
                type="text"
                required
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="e.g. Q4 Home Renovation"
                className="w-full mt-1 bg-bcb-canvas border border-bcb-border rounded-lg px-3 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label className="text-xs text-stone-300 font-medium">Description</label>
              <input
                type="text"
                value={newProjectDesc}
                onChange={(e) => setNewProjectDesc(e.target.value)}
                placeholder="Brief goal of this project..."
                className="w-full mt-1 bg-bcb-canvas border border-bcb-border rounded-lg px-3 py-2 text-sm text-white"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 rounded-lg bg-bcb-cerulean hover:bg-bcb-cerulean-light text-white text-sm font-semibold transition"
            >
              Create Project (with Default Task Fields)
            </button>
          </form>
        </div>
      )}

      {/* Modal: Confirm Permanent Project Deletion */}
      {projectToDelete && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const expected = `Delete ${projectToDelete.name}`;
              if (deleteConfirmText !== expected) return;
              const deletedName = projectToDelete.name;
              const deletedId = projectToDelete.id;
              setProjectToDelete(null);
              setDeleteConfirmText("");
              await apiAction({ action: "delete_project", project_id: deletedId });
              if (activeView === deletedId) setActiveView("dashboard");
              triggerToast(`Permanently deleted "${deletedName}"`);
            }}
            className="bg-bcb-coffee border border-red-900/70 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-bcb-border pb-3">
              <h3 className="text-lg font-bold text-red-400 flex items-center gap-2">
                <Trash2 className="w-5 h-5" />
                Delete Project
              </h3>
              <button
                type="button"
                onClick={() => setProjectToDelete(null)}
                className="text-stone-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-stone-300 leading-relaxed">
              This will permanently remove <strong className="text-white">{projectToDelete.name}</strong> and all of
              its sections, tasks, and custom field values from the database. This cannot be undone.
            </p>
            <div>
              <label className="text-xs text-stone-300 font-medium block mb-1.5">
                Type <span className="font-mono text-bcb-tea bg-bcb-canvas px-1.5 py-0.5 rounded">Delete {projectToDelete.name}</span> to confirm:
              </label>
              <input
                type="text"
                autoFocus
                required
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={`Delete ${projectToDelete.name}`}
                className="w-full bg-bcb-canvas border border-bcb-border rounded-lg px-3 py-2 text-sm text-white focus:border-red-500 focus:outline-none"
              />
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setProjectToDelete(null)}
                className="px-4 py-2 rounded-lg bg-bcb-surface hover:bg-bcb-border text-xs font-semibold text-stone-200 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={deleteConfirmText !== `Delete ${projectToDelete.name}`}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition"
              >
                Permanently Delete
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
