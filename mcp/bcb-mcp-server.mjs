import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DB_PATH = path.resolve(__dirname, "..", "data", "bcb.db");
const DB_PATH = process.env.BCB_DB_PATH ? path.resolve(process.env.BCB_DB_PATH) : DEFAULT_DB_PATH;

let dbInstance = null;

function getDb() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(
      `BCB database not found at ${DB_PATH}. Start Bang Click Boom once to initialize it, or set BCB_DB_PATH.`
    );
  }
  if (!dbInstance) {
    dbInstance = new DatabaseSync(DB_PATH);
    dbInstance.exec("PRAGMA journal_mode = WAL;");
    dbInstance.exec("PRAGMA busy_timeout = 5000;");
    dbInstance.exec("PRAGMA foreign_keys = ON;");
    ensureSchemaColumns(dbInstance);
  }
  return dbInstance;
}

function ensureSchemaColumns(db) {
  const taskCols = db.prepare("PRAGMA table_info(tasks)").all().map((c) => c.name);
  if (!taskCols.includes("completed_at")) {
    db.exec("ALTER TABLE tasks ADD COLUMN completed_at TEXT;");
  }
  if (!taskCols.includes("timer_started_at")) {
    db.exec("ALTER TABLE tasks ADD COLUMN timer_started_at TEXT;");
  }
  const projCols = db.prepare("PRAGMA table_info(projects)").all().map((c) => c.name);
  if (!projCols.includes("is_archived")) {
    db.exec("ALTER TABLE projects ADD COLUMN is_archived INTEGER DEFAULT 0;");
  }

  let addedInProgressCol = false;
  let addedCompletedCol = false;
  if (!projCols.includes("in_progress_section_id")) {
    db.exec("ALTER TABLE projects ADD COLUMN in_progress_section_id TEXT;");
    addedInProgressCol = true;
  }
  if (!projCols.includes("completed_section_id")) {
    db.exec("ALTER TABLE projects ADD COLUMN completed_section_id TEXT;");
    addedCompletedCol = true;
  }

  if (addedInProgressCol || addedCompletedCol) {
    const projects = db.prepare("SELECT id FROM projects").all();
    for (const proj of projects) {
      if (addedInProgressCol) {
        const inProgSec = db
          .prepare(
            "SELECT id FROM sections WHERE project_id = ? AND LOWER(TRIM(name)) IN ('in progress', 'in-progress', 'doing') ORDER BY sort_order ASC LIMIT 1"
          )
          .get(proj.id);
        if (inProgSec) {
          db.prepare("UPDATE projects SET in_progress_section_id = ? WHERE id = ?").run(inProgSec.id, proj.id);
        }
      }
      if (addedCompletedCol) {
        const doneSec = db
          .prepare(
            "SELECT id FROM sections WHERE project_id = ? AND LOWER(TRIM(name)) IN ('completed', 'done', 'complete') ORDER BY sort_order DESC LIMIT 1"
          )
          .get(proj.id);
        if (doneSec) {
          db.prepare("UPDATE projects SET completed_section_id = ? WHERE id = ?").run(doneSec.id, proj.id);
        }
      }
    }
  }
}

function getProjectAutomationSections(db, projectId) {
  const proj = db
    .prepare("SELECT in_progress_section_id, completed_section_id FROM projects WHERE id = ?")
    .get(projectId);
  if (!proj) {
    return { inProgressSection: null, completedSection: null };
  }
  const inProgressSection = proj.in_progress_section_id
    ? db
        .prepare("SELECT id, name FROM sections WHERE id = ? AND project_id = ?")
        .get(proj.in_progress_section_id, projectId) || null
    : null;
  const completedSection = proj.completed_section_id
    ? db
        .prepare("SELECT id, name FROM sections WHERE id = ? AND project_id = ?")
        .get(proj.completed_section_id, projectId) || null
    : null;
  return { inProgressSection, completedSection };
}

function formatDurationCompact(totalSeconds) {
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

function resolveProject(db, { project_id, project_name }) {
  const projects = db.prepare("SELECT * FROM projects").all();
  if (project_id) {
    const exact = projects.find((p) => p.id === project_id);
    if (!exact) throw new Error(`Project not found for project_id="${project_id}".`);
    return exact;
  }
  if (project_name) {
    const needle = project_name.trim().toLowerCase();
    const exactName = projects.find((p) => p.name.trim().toLowerCase() === needle);
    if (exactName) return exactName;

    const partial = projects.filter((p) => p.name.toLowerCase().includes(needle));
    if (partial.length === 1) return partial[0];
    if (partial.length > 1) {
      throw new Error(
        `Multiple projects match "${project_name}": ${partial.map((p) => `${p.name} (${p.id})`).join(", ")}. Specify project_id.`
      );
    }
    throw new Error(`Project not found for project_name="${project_name}".`);
  }
  throw new Error("Provide either project_id or project_name.");
}

function resolveSection(db, projectId, { section_id, section_name, allowDefault = true }) {
  const sections = db
    .prepare("SELECT * FROM sections WHERE project_id = ? ORDER BY sort_order ASC")
    .all(projectId);

  if (sections.length === 0) {
    throw new Error(`No sections found for project "${projectId}".`);
  }

  if (section_id) {
    const sec = sections.find((s) => s.id === section_id);
    if (!sec) {
      throw new Error(
        `Section "${section_id}" not found in project "${projectId}". Available sections: ${sections
          .map((s) => `${s.name} (${s.id})`)
          .join(", ")}.`
      );
    }
    return sec;
  }

  if (section_name) {
    const needle = section_name.trim().toLowerCase();
    const exact = sections.find((s) => s.name.trim().toLowerCase() === needle);
    if (exact) return exact;

    const partial = sections.filter((s) => s.name.toLowerCase().includes(needle));
    if (partial.length === 1) return partial[0];
    throw new Error(
      `Section "${section_name}" not found in project "${projectId}". Available sections: ${sections
        .map((s) => s.name)
        .join(", ")}.`
    );
  }

  if (!allowDefault) {
    throw new Error("Provide either section_id or section_name.");
  }

  return sections[0];
}

function accumulateRunningTimer(db, existingTask, now) {
  if (!existingTask.timer_started_at) return null;

  const startMs = new Date(existingTask.timer_started_at).getTime();
  const nowMs = new Date(now).getTime();
  const elapsedMs = Number.isNaN(startMs) ? 0 : Math.max(0, nowMs - startMs);
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const elapsedHours = elapsedMs / 3600000;

  let actualField = db
    .prepare(
      "SELECT id FROM custom_field_defs WHERE project_id = ? AND field_type = 'time_hours' AND LOWER(name) LIKE '%actual%' ORDER BY sort_order ASC LIMIT 1"
    )
    .get(existingTask.project_id);

  if (!actualField) {
    actualField = db
      .prepare(
        "SELECT id FROM custom_field_defs WHERE project_id = ? AND LOWER(name) LIKE '%actual%' ORDER BY sort_order ASC LIMIT 1"
      )
      .get(existingTask.project_id);
  }

  let newActualHours = Math.round(elapsedHours * 10000) / 10000;

  if (actualField) {
    const currentRow = db
      .prepare("SELECT value_number, value_text FROM task_field_values WHERE task_id = ? AND field_id = ?")
      .get(existingTask.id, actualField.id);

    const currentVal =
      currentRow?.value_number !== null && currentRow?.value_number !== undefined
        ? Number(currentRow.value_number)
        : Number(currentRow?.value_text || 0) || 0;

    newActualHours = Math.round((currentVal + elapsedHours) * 10000) / 10000;

    db.prepare(
      "INSERT OR REPLACE INTO task_field_values (task_id, field_id, value_text, value_number) VALUES (?, ?, NULL, ?)"
    ).run(existingTask.id, actualField.id, newActualHours);
  }

  return {
    elapsed_seconds: elapsedSeconds,
    elapsed_compact: formatDurationCompact(elapsedSeconds),
    added_hours: Math.round(elapsedHours * 10000) / 10000,
    new_actual_hours: newActualHours,
  };
}

function resolveAndValidateCustomFields(db, projectId, customFields) {
  if (!customFields || typeof customFields !== "object") return [];

  const defs = db
    .prepare("SELECT * FROM custom_field_defs WHERE project_id = ? ORDER BY sort_order ASC")
    .all(projectId);

  const writes = [];
  for (const [rawKey, rawVal] of Object.entries(customFields)) {
    const keyLower = rawKey.trim().toLowerCase();
    const fieldDef =
      defs.find((d) => d.id === rawKey) || defs.find((d) => d.name.trim().toLowerCase() === keyLower);

    if (!fieldDef) {
      throw new Error(
        `Unknown custom field "${rawKey}" for project "${projectId}". Available fields: ${defs
          .map((d) => `${d.name} (${d.field_type})`)
          .join(", ")}.`
      );
    }

    if (rawVal === null || rawVal === "") {
      writes.push({ field_id: fieldDef.id, delete: true, value_text: null, value_number: null });
      continue;
    }

    if (fieldDef.field_type === "time_hours") {
      const num = Number(rawVal);
      if (Number.isNaN(num) || num < 0) {
        throw new Error(`"${fieldDef.name}" cannot be negative or non-numeric (received ${JSON.stringify(rawVal)}).`);
      }
      writes.push({ field_id: fieldDef.id, delete: false, value_text: null, value_number: num });
    } else if (fieldDef.field_type === "number" || fieldDef.field_type === "percent") {
      const num = Number(rawVal);
      if (Number.isNaN(num)) {
        throw new Error(`"${fieldDef.name}" must be a valid number (received ${JSON.stringify(rawVal)}).`);
      }
      writes.push({ field_id: fieldDef.id, delete: false, value_text: null, value_number: num });
    } else if (fieldDef.field_type === "single_select") {
      let opts = [];
      try {
        opts = JSON.parse(fieldDef.options_json || "[]");
      } catch {}
      const valStr = String(rawVal).trim();
      const matchedOpt = opts.find((o) => String(o.label).trim().toLowerCase() === valStr.toLowerCase());
      if (opts.length > 0 && !matchedOpt) {
        throw new Error(
          `Invalid option "${valStr}" for "${fieldDef.name}". Valid options: ${opts.map((o) => o.label).join(", ")}.`
        );
      }
      writes.push({
        field_id: fieldDef.id,
        delete: false,
        value_text: matchedOpt ? matchedOpt.label : valStr,
        value_number: null,
      });
    } else {
      writes.push({
        field_id: fieldDef.id,
        delete: false,
        value_text: String(rawVal),
        value_number: null,
      });
    }
  }
  return writes;
}

function applyCustomFieldWrites(db, taskId, writes) {
  const delStmt = db.prepare("DELETE FROM task_field_values WHERE task_id = ? AND field_id = ?");
  const upsertStmt = db.prepare(
    "INSERT OR REPLACE INTO task_field_values (task_id, field_id, value_text, value_number) VALUES (?, ?, ?, ?)"
  );
  for (const w of writes) {
    if (w.delete) {
      delStmt.run(taskId, w.field_id);
    } else {
      upsertStmt.run(taskId, w.field_id, w.value_text, w.value_number);
    }
  }
}

function hydrateTasks(db, rawTasks) {
  if (rawTasks.length === 0) return [];

  const projects = db.prepare("SELECT * FROM projects").all();
  const sections = db.prepare("SELECT * FROM sections").all();
  const fieldDefs = db.prepare("SELECT * FROM custom_field_defs ORDER BY sort_order ASC").all();
  const allValues = db.prepare("SELECT * FROM task_field_values").all();

  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const sectionMap = new Map(sections.map((s) => [s.id, s]));
  const fieldDefMap = new Map(fieldDefs.map((f) => [f.id, f]));

  const valuesByTask = new Map();
  for (const v of allValues) {
    if (!valuesByTask.has(v.task_id)) valuesByTask.set(v.task_id, []);
    valuesByTask.get(v.task_id).push(v);
  }

  const nowMs = Date.now();

  return rawTasks.map((t) => {
    const proj = projectMap.get(t.project_id);
    const sec = sectionMap.get(t.section_id);
    const fieldValues = {};
    const namedFields = {};

    for (const v of valuesByTask.get(t.id) || []) {
      const val = v.value_number !== null && v.value_number !== undefined ? v.value_number : v.value_text;
      fieldValues[v.field_id] = val;
      const def = fieldDefMap.get(v.field_id);
      if (def) {
        namedFields[def.name] = val;
      }
    }

    let elapsedSeconds = 0;
    if (t.timer_started_at) {
      const startMs = new Date(t.timer_started_at).getTime();
      if (!Number.isNaN(startMs)) {
        elapsedSeconds = Math.max(0, Math.floor((nowMs - startMs) / 1000));
      }
    }

    return {
      id: t.id,
      project_id: t.project_id,
      project_name: proj?.name ?? null,
      project_is_archived: Boolean(proj?.is_archived),
      section_id: t.section_id,
      section_name: sec?.name ?? null,
      title: t.title,
      description: t.description ?? "",
      completed: Boolean(t.completed),
      assignee: t.assignee,
      due_date: t.due_date ?? null,
      created_at: t.created_at,
      updated_at: t.updated_at,
      completed_at: t.completed_at ?? null,
      timer_started_at: t.timer_started_at ?? null,
      timer_running: Boolean(t.timer_started_at),
      timer_elapsed_seconds: elapsedSeconds,
      updated_by: t.updated_by,
      fields: namedFields,
      field_values: fieldValues,
    };
  });
}

function getHydratedTaskById(db, taskId) {
  const raw = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!raw) return null;
  return hydrateTasks(db, [raw])[0];
}

function logActivity(db, actor, action, taskTitle, now) {
  db.prepare("INSERT INTO activity_log (id, actor, action, task_title, created_at) VALUES (?, ?, ?, ?, ?)").run(
    crypto.randomUUID(),
    actor,
    action,
    taskTitle,
    now
  );
}

function ok(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function fail(err) {
  return {
    isError: true,
    content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
  };
}

const server = new McpServer({
  name: "bang-click-boom",
  version: "1.0.0",
});

// 1. bcb_list_workspace
server.registerTool(
  "bcb_list_workspace",
  {
    title: "List BCB Workspace",
    description:
      "List Bang Click Boom portfolios, projects, ordered sections, and custom field definitions. Call this first when looking up project/section IDs or valid custom field options.",
    inputSchema: {
      include_archived: z.boolean().optional().describe("Include archived projects (default: false)."),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ include_archived = false } = {}) => {
    try {
      const db = getDb();
      const portfolios = db.prepare("SELECT * FROM portfolios").all();
      const projects = db
        .prepare(
          include_archived
            ? "SELECT * FROM projects ORDER BY COALESCE(is_archived, 0) ASC, name ASC"
            : "SELECT * FROM projects WHERE COALESCE(is_archived, 0) = 0 ORDER BY name ASC"
        )
        .all();
      const sections = db.prepare("SELECT * FROM sections ORDER BY sort_order ASC").all();
      const customFields = db.prepare("SELECT * FROM custom_field_defs ORDER BY sort_order ASC").all();

      const enrichedProjects = projects.map((p) => ({
        ...p,
        is_archived: Boolean(p.is_archived),
        in_progress_section_id: p.in_progress_section_id ?? null,
        completed_section_id: p.completed_section_id ?? null,
        sections: sections
          .filter((s) => s.project_id === p.id)
          .map((s) => ({
            ...s,
            automation_role:
              p.in_progress_section_id === s.id
                ? "in_progress"
                : p.completed_section_id === s.id
                  ? "completed"
                  : null,
          })),
        custom_fields: customFields
          .filter((f) => f.project_id === p.id)
          .map((f) => {
            let options = [];
            try {
              options = JSON.parse(f.options_json || "[]");
            } catch {}
            return {
              id: f.id,
              name: f.name,
              field_type: f.field_type,
              is_visible: Boolean(f.is_visible),
              options,
            };
          }),
      }));

      return ok({
        db_path: DB_PATH,
        portfolios,
        projects: enrichedProjects,
      });
    } catch (err) {
      return fail(err);
    }
  }
);

// 2. bcb_list_tasks
server.registerTool(
  "bcb_list_tasks",
  {
    title: "List BCB Tasks",
    description:
      "List and filter tasks in Bang Click Boom. Excludes archived projects by default unless include_archived is true or an archived project is explicitly targeted.",
    inputSchema: {
      project_id: z.string().optional().describe("Filter by exact project ID."),
      project_name: z.string().optional().describe("Filter by project name (exact or partial match)."),
      section_name: z.string().optional().describe("Filter by section name (e.g. 'To Do', 'In Progress', 'Completed')."),
      assignee: z.enum(["You", "Gemini", "Unassigned"]).optional().describe("Filter by assignee."),
      completed: z.boolean().optional().describe("Filter by completion state (true/false)."),
      timer_running: z.boolean().optional().describe("Filter by whether a live timer is running."),
      search: z.string().optional().describe("Case-insensitive substring match against task title or notes."),
      include_archived: z
        .boolean()
        .optional()
        .describe("Include tasks from archived projects (default: false unless project_id/project_name targets an archived project)."),
    },
    annotations: { readOnlyHint: true },
  },
  async (args = {}) => {
    try {
      const db = getDb();
      const { project_id, project_name, section_name, assignee, completed, timer_running, search, include_archived } =
        args;

      const clauses = [];
      const params = [];

      if (project_id || project_name) {
        const proj = resolveProject(db, { project_id, project_name });
        clauses.push("t.project_id = ?");
        params.push(proj.id);
      } else if (!include_archived) {
        clauses.push("COALESCE(p.is_archived, 0) = 0");
      }

      if (section_name) {
        clauses.push("LOWER(TRIM(s.name)) = LOWER(TRIM(?))");
        params.push(section_name);
      }

      if (assignee !== undefined) {
        clauses.push("t.assignee = ?");
        params.push(assignee);
      }

      if (completed !== undefined) {
        clauses.push("t.completed = ?");
        params.push(completed ? 1 : 0);
      }

      if (timer_running !== undefined) {
        clauses.push(timer_running ? "t.timer_started_at IS NOT NULL" : "t.timer_started_at IS NULL");
      }

      if (search && search.trim()) {
        const pattern = `%${search.trim().toLowerCase()}%`;
        clauses.push("(LOWER(t.title) LIKE ? OR LOWER(COALESCE(t.description, '')) LIKE ?)");
        params.push(pattern, pattern);
      }

      const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const rawTasks = db
        .prepare(
          `SELECT t.*
           FROM tasks t
           JOIN projects p ON p.id = t.project_id
           JOIN sections s ON s.id = t.section_id
           ${whereSql}
           ORDER BY t.completed ASC, t.created_at ASC`
        )
        .all(...params);

      const tasks = hydrateTasks(db, rawTasks);
      return ok({ count: tasks.length, tasks });
    } catch (err) {
      return fail(err);
    }
  }
);

// 3. bcb_create_task
server.registerTool(
  "bcb_create_task",
  {
    title: "Create BCB Task",
    description:
      "Create a new task in Bang Click Boom with optional notes, assignee, due date, section, and custom fields (e.g. Priority, Estimated Time, Actual Time).",
    inputSchema: {
      project_id: z.string().optional().describe("Target project ID (or provide project_name)."),
      project_name: z.string().optional().describe("Target project name (or provide project_id)."),
      section_id: z.string().optional().describe("Target section ID (defaults to first section in project)."),
      section_name: z.string().optional().describe("Target section name (e.g. 'To Do', 'In Progress')."),
      title: z.string().min(1).describe("Task title."),
      description: z.string().optional().describe("Task notes / instructions."),
      assignee: z.enum(["You", "Gemini", "Unassigned"]).optional().describe("Task assignee (default: 'You')."),
      due_date: z.string().nullable().optional().describe("Due date in YYYY-MM-DD format, or null."),
      custom_fields: z
        .record(z.string(), z.union([z.string(), z.number(), z.null()]))
        .optional()
        .describe("Custom field values keyed by field name or field ID (e.g. { Priority: 'High', 'Estimated Time': 1.5 })."),
      actor: z.enum(["You", "Gemini"]).optional().describe("Actor recorded in activity log (default: 'Gemini')."),
    },
    annotations: { idempotentHint: false },
  },
  async (args = {}) => {
    try {
      const db = getDb();
      const now = new Date().toISOString();
      const actor = args.actor || "Gemini";
      const proj = resolveProject(db, { project_id: args.project_id, project_name: args.project_name });
      const section = resolveSection(db, proj.id, {
        section_id: args.section_id,
        section_name: args.section_name,
        allowDefault: true,
      });

      const title = args.title.trim();
      if (!title) throw new Error("Task title cannot be empty.");

      let normalizedDueDate = null;
      if (args.due_date !== undefined && args.due_date !== null && args.due_date !== "") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(args.due_date)) {
          throw new Error(`due_date must be YYYY-MM-DD or null (received "${args.due_date}").`);
        }
        normalizedDueDate = args.due_date;
      }

      const writes = resolveAndValidateCustomFields(db, proj.id, args.custom_fields);

      const id = `task-${crypto.randomUUID().slice(0, 8)}`;
      const { completedSection } = getProjectAutomationSections(db, proj.id);
      const isDoneSection = Boolean(completedSection && completedSection.id === section.id);

      db.prepare(`
        INSERT INTO tasks (id, project_id, section_id, title, description, completed, assignee, due_date, created_at, updated_at, completed_at, timer_started_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      `).run(
        id,
        proj.id,
        section.id,
        title,
        args.description ?? "",
        isDoneSection ? 1 : 0,
        args.assignee || "You",
        normalizedDueDate,
        now,
        now,
        isDoneSection ? now : null,
        actor
      );

      applyCustomFieldWrites(db, id, writes);
      logActivity(db, actor, "Created task", title, now);

      return ok({ created: true, task: getHydratedTaskById(db, id) });
    } catch (err) {
      return fail(err);
    }
  }
);

// 4. bcb_update_task
server.registerTool(
  "bcb_update_task",
  {
    title: "Update BCB Task",
    description:
      "Update a task's title, notes, assignee, due date, completion status, section, or custom fields. Moving into Completed/Done automatically marks complete and stops/logs any running timer.",
    inputSchema: {
      task_id: z.string().describe("Task ID to update."),
      title: z.string().optional().describe("Updated title."),
      description: z.string().optional().describe("Updated task notes."),
      assignee: z.enum(["You", "Gemini", "Unassigned"]).optional().describe("Updated assignee."),
      due_date: z.string().nullable().optional().describe("Updated due date (YYYY-MM-DD) or null to clear."),
      completed: z.boolean().optional().describe("Mark task complete (true) or reopen (false)."),
      section_id: z.string().optional().describe("Move task to target section ID in the same project."),
      section_name: z.string().optional().describe("Move task to target section name in the same project."),
      custom_fields: z
        .record(z.string(), z.union([z.string(), z.number(), z.null()]))
        .optional()
        .describe("Custom field updates keyed by field name or ID (pass null or '' to clear a field)."),
      actor: z.enum(["You", "Gemini"]).optional().describe("Actor recorded in activity log (default: 'Gemini')."),
    },
    annotations: { idempotentHint: false },
  },
  async (args = {}) => {
    try {
      const db = getDb();
      const now = new Date().toISOString();
      const actor = args.actor || "Gemini";

      const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(args.task_id);
      if (!existing) {
        throw new Error(`Task not found: "${args.task_id}".`);
      }

      const writes = resolveAndValidateCustomFields(db, existing.project_id, args.custom_fields);

      const newTitle = args.title !== undefined ? args.title.trim() : existing.title;
      if (!newTitle) throw new Error("Task title cannot be empty.");
      const newDesc = args.description !== undefined ? args.description : existing.description;
      const newAssignee = args.assignee !== undefined ? args.assignee : existing.assignee;

      let newDueDate = existing.due_date;
      if (args.due_date !== undefined) {
        if (args.due_date === null || args.due_date === "") {
          newDueDate = null;
        } else if (!/^\d{4}-\d{2}-\d{2}$/.test(args.due_date)) {
          throw new Error(`due_date must be YYYY-MM-DD or null (received "${args.due_date}").`);
        } else {
          newDueDate = args.due_date;
        }
      }

      let newCompleted = existing.completed;
      let newCompletedAt = existing.completed_at;
      let newTimerStartedAt = existing.timer_started_at ?? null;
      let newSectionId = existing.section_id;
      let timerSummary = null;
      let movedToSectionName = null;

      const { completedSection } = getProjectAutomationSections(db, existing.project_id);
      const hasExplicitSection = args.section_id !== undefined || args.section_name !== undefined;
      if (hasExplicitSection) {
        const targetSec = resolveSection(db, existing.project_id, {
          section_id: args.section_id,
          section_name: args.section_name,
          allowDefault: false,
        });
        newSectionId = targetSec.id;
        movedToSectionName = targetSec.name;
        const isTargetDone = Boolean(completedSection && completedSection.id === targetSec.id);

        if (args.completed !== undefined) {
          newCompleted = args.completed ? 1 : 0;
          newCompletedAt = newCompleted === 1 ? (existing.completed ? existing.completed_at || now : now) : null;
        } else if (isTargetDone) {
          newCompleted = 1;
          newCompletedAt = existing.completed ? existing.completed_at || now : now;
        } else if (existing.completed === 1) {
          newCompleted = 0;
          newCompletedAt = null;
        }
      } else if (args.completed !== undefined) {
        newCompleted = args.completed ? 1 : 0;
        newCompletedAt = newCompleted === 1 ? now : null;
        if (newCompleted === 1 && completedSection) {
          newSectionId = completedSection.id;
        }
      }

      if (newCompleted === 1 && existing.timer_started_at) {
        timerSummary = accumulateRunningTimer(db, existing, now);
        newTimerStartedAt = null;
      }

      db.prepare(`
        UPDATE tasks
        SET title = ?, description = ?, completed = ?, assignee = ?, due_date = ?, section_id = ?, updated_at = ?, completed_at = ?, timer_started_at = ?, updated_by = ?
        WHERE id = ?
      `).run(
        newTitle,
        newDesc,
        newCompleted,
        newAssignee,
        newDueDate,
        newSectionId,
        now,
        newCompletedAt,
        newTimerStartedAt,
        actor,
        existing.id
      );

      applyCustomFieldWrites(db, existing.id, writes);

      let actionDesc = "Updated task properties";
      if (movedToSectionName && newSectionId !== existing.section_id) {
        actionDesc = `Moved to "${movedToSectionName}"`;
      } else if (args.completed !== undefined) {
        actionDesc = newCompleted ? "Marked complete" : "Reopened task";
      }
      logActivity(db, actor, actionDesc, newTitle, now);

      return ok({
        updated: true,
        timer_summary: timerSummary,
        task: getHydratedTaskById(db, existing.id),
      });
    } catch (err) {
      return fail(err);
    }
  }
);

// 5. bcb_delete_task
server.registerTool(
  "bcb_delete_task",
  {
    title: "Delete BCB Task",
    description: "Permanently delete a task by ID. Confirm with the user before calling this tool.",
    inputSchema: {
      task_id: z.string().describe("Task ID to delete."),
      actor: z.enum(["You", "Gemini"]).optional().describe("Actor recorded in activity log (default: 'Gemini')."),
    },
    annotations: { destructiveHint: true },
  },
  async ({ task_id, actor = "Gemini" } = {}) => {
    try {
      const db = getDb();
      const existing = db.prepare("SELECT id, title FROM tasks WHERE id = ?").get(task_id);
      if (!existing) {
        throw new Error(`Task not found: "${task_id}".`);
      }

      const now = new Date().toISOString();
      db.prepare("DELETE FROM tasks WHERE id = ?").run(task_id);
      logActivity(db, actor, "Deleted task", existing.title, now);

      return ok({ deleted: true, id: existing.id, title: existing.title });
    } catch (err) {
      return fail(err);
    }
  }
);

// 6. bcb_start_timer
server.registerTool(
  "bcb_start_timer",
  {
    title: "Start BCB Task Timer",
    description:
      "Start the live in-task timer for a task. Automatically moves the task into the project's 'In Progress' section (creating it if absent) and reopens completion if needed.",
    inputSchema: {
      task_id: z.string().describe("Task ID to start timing."),
      actor: z.enum(["You", "Gemini"]).optional().describe("Actor recorded in activity log (default: 'Gemini')."),
    },
    annotations: { idempotentHint: false },
  },
  async ({ task_id, actor = "Gemini" } = {}) => {
    try {
      const db = getDb();
      const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(task_id);
      if (!existing) {
        throw new Error(`Task not found: "${task_id}".`);
      }

      if (existing.timer_started_at) {
        return ok({
          already_running: true,
          task: getHydratedTaskById(db, task_id),
        });
      }

      const now = new Date().toISOString();
      const { inProgressSection } = getProjectAutomationSections(db, existing.project_id);
      const targetSectionId = inProgressSection ? inProgressSection.id : existing.section_id;
      const moved = Boolean(inProgressSection && existing.section_id !== inProgressSection.id);

      db.prepare(`
        UPDATE tasks
        SET timer_started_at = ?, section_id = ?, completed = 0, completed_at = NULL, updated_at = ?, updated_by = ?
        WHERE id = ?
      `).run(now, targetSectionId, now, actor, task_id);

      logActivity(
        db,
        actor,
        moved && inProgressSection ? `Started timer & moved to "${inProgressSection.name}"` : "Started timer",
        existing.title,
        now
      );

      return ok({
        started: true,
        moved_to_section: moved && inProgressSection ? inProgressSection.name : null,
        task: getHydratedTaskById(db, task_id),
      });
    } catch (err) {
      return fail(err);
    }
  }
);

// 7. bcb_stop_timer
server.registerTool(
  "bcb_stop_timer",
  {
    title: "Stop BCB Task Timer",
    description:
      "Stop a task's running timer and accumulate elapsed hours into the project's Actual Time custom field.",
    inputSchema: {
      task_id: z.string().describe("Task ID whose timer should be stopped."),
      actor: z.enum(["You", "Gemini"]).optional().describe("Actor recorded in activity log (default: 'Gemini')."),
    },
    annotations: { idempotentHint: false },
  },
  async ({ task_id, actor = "Gemini" } = {}) => {
    try {
      const db = getDb();
      const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(task_id);
      if (!existing) {
        throw new Error(`Task not found: "${task_id}".`);
      }

      if (!existing.timer_started_at) {
        return ok({
          already_stopped: true,
          task: getHydratedTaskById(db, task_id),
        });
      }

      const now = new Date().toISOString();
      const summary = accumulateRunningTimer(db, existing, now);

      db.prepare("UPDATE tasks SET timer_started_at = NULL, updated_at = ?, updated_by = ? WHERE id = ?").run(
        now,
        actor,
        task_id
      );

      const compact = summary ? summary.elapsed_compact : "0s";
      logActivity(db, actor, `Stopped timer (+${compact})`, existing.title, now);

      return ok({
        stopped: true,
        timer_summary: summary,
        task: getHydratedTaskById(db, task_id),
      });
    } catch (err) {
      return fail(err);
    }
  }
);

// 8. bcb_create_project
server.registerTool(
  "bcb_create_project",
  {
    title: "Create BCB Project",
    description:
      "Create a new project in Bang Click Boom with default sections (To Do, In Progress, Completed) and default custom fields (Priority, Estimated Time, Actual Time).",
    inputSchema: {
      name: z.string().min(1).describe("Project name."),
      description: z.string().optional().describe("Brief project description."),
      portfolio_id: z.string().optional().describe("Portfolio ID (defaults to 'port-1' or first available portfolio)."),
      actor: z.enum(["You", "Gemini"]).optional().describe("Actor recorded in activity log (default: 'Gemini')."),
    },
    annotations: { idempotentHint: false },
  },
  async (args = {}) => {
    try {
      const db = getDb();
      const now = new Date().toISOString();
      const actor = args.actor || "Gemini";
      const name = args.name.trim();
      if (!name) throw new Error("Project name cannot be empty.");

      let portfolioId = args.portfolio_id;
      if (!portfolioId) {
        const defaultPort =
          db.prepare("SELECT id FROM portfolios WHERE id = 'port-1'").get() ||
          db.prepare("SELECT id FROM portfolios LIMIT 1").get();
        if (!defaultPort) throw new Error("No portfolios exist in database.");
        portfolioId = defaultPort.id;
      } else {
        const portExists = db.prepare("SELECT id FROM portfolios WHERE id = ?").get(portfolioId);
        if (!portExists) throw new Error(`Portfolio not found: "${portfolioId}".`);
      }

      const id = `proj-${crypto.randomUUID().slice(0, 8)}`;
      const secTodoId = `sec-${id}-1`;
      const secDoingId = `sec-${id}-2`;
      const secDoneId = `sec-${id}-3`;

      db.prepare(
        "INSERT INTO projects (id, portfolio_id, name, description, status, icon, is_archived, in_progress_section_id, completed_section_id) VALUES (?, ?, ?, ?, 'On Track', 'FolderKanban', 0, ?, ?)"
      ).run(id, portfolioId, name, args.description ?? "", secDoingId, secDoneId);

      db.prepare("INSERT INTO sections (id, project_id, name, sort_order) VALUES (?, ?, 'To Do', 1)").run(secTodoId, id);
      db.prepare("INSERT INTO sections (id, project_id, name, sort_order) VALUES (?, ?, 'In Progress', 2)").run(
        secDoingId,
        id
      );
      db.prepare("INSERT INTO sections (id, project_id, name, sort_order) VALUES (?, ?, 'Completed', 3)").run(
        secDoneId,
        id
      );

      const priorityOptions = JSON.stringify([
        { label: "High", color: "#E06C75" },
        { label: "Medium", color: "#477998" },
        { label: "Low", color: "#C4D6B0" },
      ]);
      const insertField = db.prepare(
        "INSERT INTO custom_field_defs (id, project_id, name, field_type, options_json, sort_order, is_visible) VALUES (?, ?, ?, ?, ?, ?, 1)"
      );
      insertField.run(`fld-${id}-priority`, id, "Priority", "single_select", priorityOptions, 1);
      insertField.run(`fld-${id}-est`, id, "Estimated Time", "time_hours", "[]", 2);
      insertField.run(`fld-${id}-actual`, id, "Actual Time", "time_hours", "[]", 3);

      logActivity(db, actor, "Created project", name, now);

      const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
      const sections = db.prepare("SELECT * FROM sections WHERE project_id = ? ORDER BY sort_order ASC").all(id);
      const custom_fields = db
        .prepare("SELECT * FROM custom_field_defs WHERE project_id = ? ORDER BY sort_order ASC")
        .all(id);

      return ok({ created: true, project, sections, custom_fields });
    } catch (err) {
      return fail(err);
    }
  }
);

// 9. bcb_archive_project
server.registerTool(
  "bcb_archive_project",
  {
    title: "Archive or Restore BCB Project",
    description:
      "Archive a project (is_archived: true) or restore it from archive (is_archived: false). Permanent project deletion is restricted to the UI for safety.",
    inputSchema: {
      project_id: z.string().optional().describe("Project ID (or provide project_name)."),
      project_name: z.string().optional().describe("Project name (or provide project_id)."),
      is_archived: z.boolean().describe("True to archive, false to restore."),
      actor: z.enum(["You", "Gemini"]).optional().describe("Actor recorded in activity log (default: 'Gemini')."),
    },
    annotations: { idempotentHint: true },
  },
  async (args = {}) => {
    try {
      const db = getDb();
      const now = new Date().toISOString();
      const actor = args.actor || "Gemini";
      const proj = resolveProject(db, { project_id: args.project_id, project_name: args.project_name });
      const archivedVal = args.is_archived ? 1 : 0;

      db.prepare("UPDATE projects SET is_archived = ? WHERE id = ?").run(archivedVal, proj.id);
      logActivity(db, actor, archivedVal ? "Archived project" : "Restored project from archive", proj.name, now);

      const updated = db.prepare("SELECT * FROM projects WHERE id = ?").get(proj.id);
      return ok({
        updated: true,
        project: { ...updated, is_archived: Boolean(updated.is_archived) },
      });
    } catch (err) {
      return fail(err);
    }
  }
);

// 10. bcb_get_analytics
server.registerTool(
  "bcb_get_analytics",
  {
    title: "Get BCB Analytics",
    description:
      "Retrieve task completion progress, Estimated vs. Actual time rollups per project, active timers, and recent co-working activity.",
    inputSchema: {
      project_id: z.string().optional().describe("Optional project ID to scope analytics."),
      project_name: z.string().optional().describe("Optional project name to scope analytics."),
      include_archived: z
        .boolean()
        .optional()
        .describe("Include archived projects in rollup summary (default: false unless a specific archived project is requested)."),
    },
    annotations: { readOnlyHint: true },
  },
  async (args = {}) => {
    try {
      const db = getDb();
      let scopedProjects;
      if (args.project_id || args.project_name) {
        scopedProjects = [resolveProject(db, { project_id: args.project_id, project_name: args.project_name })];
      } else {
        scopedProjects = db
          .prepare(
            args.include_archived
              ? "SELECT * FROM projects ORDER BY COALESCE(is_archived, 0) ASC, name ASC"
              : "SELECT * FROM projects WHERE COALESCE(is_archived, 0) = 0 ORDER BY name ASC"
          )
          .all();
      }

      const rawTasks = db.prepare("SELECT * FROM tasks").all();
      const fields = db.prepare("SELECT * FROM custom_field_defs").all();
      const values = db.prepare("SELECT * FROM task_field_values").all();
      const recent_activity = db.prepare("SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 12").all();

      const valMap = new Map();
      for (const v of values) {
        if (!valMap.has(v.task_id)) valMap.set(v.task_id, {});
        valMap.get(v.task_id)[v.field_id] = v.value_number !== null ? v.value_number : Number(v.value_text || 0);
      }

      let totalTasks = 0;
      let completedTasks = 0;
      let totalEstimatedHours = 0;
      let totalActualHours = 0;
      let yourTasks = 0;
      let geminiTasks = 0;
      let runningTimers = 0;

      const projectBreakdown = scopedProjects.map((proj) => {
        const pTasks = rawTasks.filter((t) => t.project_id === proj.id);
        const pFields = fields.filter((f) => f.project_id === proj.id);
        const pComplete = pTasks.filter((t) => t.completed === 1).length;
        const pIncomplete = pTasks.length - pComplete;
        let pEst = 0;
        let pActual = 0;
        let pRunning = 0;

        for (const t of pTasks) {
          if (t.assignee === "You") yourTasks += 1;
          if (t.assignee === "Gemini") geminiTasks += 1;
          if (t.timer_started_at) pRunning += 1;

          const tv = valMap.get(t.id) || {};
          for (const f of pFields) {
            const num = Number(tv[f.id] || 0);
            if (!Number.isNaN(num)) {
              const lower = f.name.toLowerCase();
              if (lower.includes("estimated")) pEst += num;
              if (lower.includes("actual")) pActual += num;
            }
          }
        }

        totalTasks += pTasks.length;
        completedTasks += pComplete;
        totalEstimatedHours += pEst;
        totalActualHours += pActual;
        runningTimers += pRunning;

        return {
          id: proj.id,
          name: proj.name,
          status: proj.status,
          is_archived: Boolean(proj.is_archived),
          total_tasks: pTasks.length,
          completed_tasks: pComplete,
          incomplete_tasks: pIncomplete,
          completion_pct: pTasks.length > 0 ? Math.round((pComplete / pTasks.length) * 100) : 0,
          estimated_hours: Math.round(pEst * 100) / 100,
          actual_hours: Math.round(pActual * 100) / 100,
          running_timers: pRunning,
        };
      });

      return ok({
        summary: {
          total_tasks: totalTasks,
          completed_tasks: completedTasks,
          incomplete_tasks: totalTasks - completedTasks,
          completion_pct: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
          total_estimated_hours: Math.round(totalEstimatedHours * 100) / 100,
          total_actual_hours: Math.round(totalActualHours * 100) / 100,
          your_tasks: yourTasks,
          gemini_tasks: geminiTasks,
          running_timers: runningTimers,
        },
        projects: projectBreakdown,
        recent_activity,
      });
    } catch (err) {
      return fail(err);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
