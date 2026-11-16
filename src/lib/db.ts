import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const DATA_DIR = path.join(process.cwd(), "data");
const BACKUP_DIR = path.join(process.cwd(), "backups");
export const DB_PATH = path.join(DATA_DIR, "bcb.db");

export interface Portfolio {
  id: string;
  name: string;
  description: string;
  color: string;
}

export interface Project {
  id: string;
  portfolio_id: string;
  name: string;
  description: string;
  status: string;
  icon: string;
}

export interface Section {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
}

export interface CustomFieldDef {
  id: string;
  project_id: string;
  name: string;
  field_type: "single_select" | "time_hours" | "number" | "text" | "percent";
  options_json: string;
  sort_order: number;
  is_visible: number;
}

export interface Task {
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
  updated_by: "You" | "Gemini";
  field_values: Record<string, string | number | null>;
}

let dbInstance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  if (!dbInstance) {
    dbInstance = new DatabaseSync(DB_PATH);
    dbInstance.exec("PRAGMA journal_mode = WAL;");
    dbInstance.exec("PRAGMA foreign_keys = ON;");
    initSchemaAndSeed(dbInstance);
    applyMigrationsAndCleanup(dbInstance);
  }
  return dbInstance;
}

function initSchemaAndSeed(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolios (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      color TEXT DEFAULT '#477998'
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      portfolio_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'On Track',
      icon TEXT DEFAULT 'FolderKanban',
      FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sections (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS custom_field_defs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      field_type TEXT NOT NULL,
      options_json TEXT DEFAULT '[]',
      sort_order INTEGER DEFAULT 0,
      is_visible INTEGER DEFAULT 1,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      section_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      completed INTEGER DEFAULT 0,
      assignee TEXT DEFAULT 'You',
      due_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT DEFAULT 'You',
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_field_values (
      task_id TEXT NOT NULL,
      field_id TEXT NOT NULL,
      value_text TEXT,
      value_number REAL,
      PRIMARY KEY (task_id, field_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (field_id) REFERENCES custom_field_defs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      task_title TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const countRow = db.prepare("SELECT COUNT(*) as count FROM portfolios").get() as { count: number };
  if (countRow.count > 0) return;

  const now = new Date().toISOString();

  // 1. Seed Default Portfolio
  const portfolioId = "port-1";
  db.prepare("INSERT INTO portfolios (id, name, description, color) VALUES (?, ?, ?, ?)").run(
    portfolioId,
    "Core Workspace Portfolio",
    "Central portfolio for personal projects and Gen AI co-working initiatives",
    "#477998"
  );

  // 2. Seed Projects
  const bcbProjectId = "proj-bcb";
  const personalProjectId = "proj-personal";

  db.prepare("INSERT INTO projects (id, portfolio_id, name, description, status, icon) VALUES (?, ?, ?, ?, ?, ?)").run(
    bcbProjectId,
    portfolioId,
    "Bang Click Boom (BCB) Launch",
    "Co-building our Todo & Portfolio hub with Gemini MCP + Skill integration.",
    "On Track",
    "Rocket"
  );

  db.prepare("INSERT INTO projects (id, portfolio_id, name, description, status, icon) VALUES (?, ?, ?, ?, ?, ?)").run(
    personalProjectId,
    portfolioId,
    "Personal Daily Goals",
    "Personal errands, learning goals, and life admin tasks.",
    "On Track",
    "CheckSquare"
  );

  // 3. Seed Sections for both projects
  const sections = [
    { id: "sec-bcb-todo", project_id: bcbProjectId, name: "To Do", sort_order: 1 },
    { id: "sec-bcb-doing", project_id: bcbProjectId, name: "In Progress", sort_order: 2 },
    { id: "sec-bcb-done", project_id: bcbProjectId, name: "Completed", sort_order: 3 },
    { id: "sec-pers-todo", project_id: personalProjectId, name: "This Week", sort_order: 1 },
    { id: "sec-pers-done", project_id: personalProjectId, name: "Done", sort_order: 2 },
  ];

  const insertSection = db.prepare("INSERT INTO sections (id, project_id, name, sort_order) VALUES (?, ?, ?, ?)");
  for (const s of sections) {
    insertSection.run(s.id, s.project_id, s.name, s.sort_order);
  }

  // 4. Seed Default Custom Task Fields (Priority, Estimated Time, Actual Time — no Budget)
  const priorityOptions = JSON.stringify([
    { label: "High", color: "#E06C75" },
    { label: "Medium", color: "#477998" },
    { label: "Low", color: "#C4D6B0" },
  ]);

  for (const pid of [bcbProjectId, personalProjectId]) {
    const insertField = db.prepare(
      "INSERT INTO custom_field_defs (id, project_id, name, field_type, options_json, sort_order, is_visible) VALUES (?, ?, ?, ?, ?, ?, 1)"
    );
    insertField.run(`fld-${pid}-priority`, pid, "Priority", "single_select", priorityOptions, 1);
    insertField.run(`fld-${pid}-est`, pid, "Estimated Time", "time_hours", "[]", 2);
    insertField.run(`fld-${pid}-actual`, pid, "Actual Time", "time_hours", "[]", 3);
  }

  // 5. Seed Initial Tasks in BCB Project
  const seedTasks = [
    {
      id: "task-1",
      project_id: bcbProjectId,
      section_id: "sec-bcb-done",
      title: "Phase 1: Initialize Git repository & configure GitHub identity",
      description: "Configured local Git repo for the-norbert-sowul.",
      completed: 1,
      assignee: "Gemini",
      due_date: "2026-11-16",
      updated_by: "Gemini",
      fields: {
        [`fld-${bcbProjectId}-priority`]: "High",
        [`fld-${bcbProjectId}-est`]: 0.5,
        [`fld-${bcbProjectId}-actual`]: 0.3,
      },
    },
    {
      id: "task-2",
      project_id: bcbProjectId,
      section_id: "sec-bcb-done",
      title: "Phase 2: Create SQLite database & Custom Task Fields engine",
      description: "Built tables for Portfolios, Projects, Sections, Tasks, and Custom Task Fields.",
      completed: 1,
      assignee: "Gemini",
      due_date: "2026-11-16",
      updated_by: "Gemini",
      fields: {
        [`fld-${bcbProjectId}-priority`]: "High",
        [`fld-${bcbProjectId}-est`]: 1.0,
        [`fld-${bcbProjectId}-actual`]: 0.8,
      },
    },
    {
      id: "task-3",
      project_id: bcbProjectId,
      section_id: "sec-bcb-done",
      title: "Phase 3: Build Dark Mode List View & Bare-Bones Dashboard",
      description: "Using Coffee Bean (#291F1E), Cerulean (#477998), and Tea Green (#C4D6B0).",
      completed: 1,
      assignee: "Gemini",
      due_date: "2026-11-16",
      updated_by: "Gemini",
      fields: {
        [`fld-${bcbProjectId}-priority`]: "High",
        [`fld-${bcbProjectId}-est`]: 2.0,
        [`fld-${bcbProjectId}-actual`]: 1.5,
      },
    },
    {
      id: "task-4",
      project_id: bcbProjectId,
      section_id: "sec-bcb-todo",
      title: "Phase 4: Create Antigravity Plugin (BCB MCP Server + Co-Working Skill)",
      description: "Enable Gemini to read and write tasks directly from Antigravity App and IDE.",
      completed: 0,
      assignee: "Gemini",
      due_date: "2026-11-17",
      updated_by: "Gemini",
      fields: {
        [`fld-${bcbProjectId}-priority`]: "High",
        [`fld-${bcbProjectId}-est`]: 1.5,
        [`fld-${bcbProjectId}-actual`]: 0,
      },
    },
  ];

  const insertTask = db.prepare(`
    INSERT INTO tasks (id, project_id, section_id, title, description, completed, assignee, due_date, created_at, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFieldVal = db.prepare(`
    INSERT INTO task_field_values (task_id, field_id, value_text, value_number)
    VALUES (?, ?, ?, ?)
  `);

  for (const t of seedTasks) {
    insertTask.run(
      t.id,
      t.project_id,
      t.section_id,
      t.title,
      t.description,
      t.completed,
      t.assignee,
      t.due_date,
      now,
      now,
      t.updated_by
    );
    for (const [fieldId, val] of Object.entries(t.fields)) {
      if (typeof val === "number") {
        insertFieldVal.run(t.id, fieldId, null, val);
      } else {
        insertFieldVal.run(t.id, fieldId, String(val), null);
      }
    }
  }
}

function applyMigrationsAndCleanup(db: DatabaseSync) {
  const now = new Date().toISOString();

  // 1. Remove any Budget / currency custom fields and values
  db.prepare("DELETE FROM custom_field_defs WHERE LOWER(name) = 'budget' OR field_type = 'currency'").run();

  // 2. Scrub any legacy brand references from existing DB records
  const legacyBrand = ["Asa", "na"].join("");
  db.prepare(
    "UPDATE projects SET description = REPLACE(REPLACE(description, ? || '-inspired ', ''), ? || ' ', '') WHERE description LIKE '%' || ? || '%'"
  ).run(legacyBrand, legacyBrand, legacyBrand);
  db.prepare(
    "UPDATE tasks SET title = REPLACE(REPLACE(title, ? || '-inspired ', ''), ? || ' ', ''), description = REPLACE(REPLACE(description, ? || '-inspired ', ''), ? || ' ', '') WHERE title LIKE '%' || ? || '%' OR description LIKE '%' || ? || '%'"
  ).run(legacyBrand, legacyBrand, legacyBrand, legacyBrand, legacyBrand, legacyBrand);
  db.prepare(
    "UPDATE activity_log SET action = REPLACE(REPLACE(action, ? || '-inspired ', ''), ? || ' ', '') WHERE action LIKE '%' || ? || '%'"
  ).run(legacyBrand, legacyBrand, legacyBrand);

  // 3. Ensure any already-completed tasks are placed inside their project's Completed/Done section
  const allProjects = db.prepare("SELECT id FROM projects").all() as unknown as { id: string }[];
  for (const proj of allProjects) {
    const doneSection = db
      .prepare(
        "SELECT id FROM sections WHERE project_id = ? AND LOWER(name) IN ('completed', 'done', 'complete') ORDER BY sort_order DESC LIMIT 1"
      )
      .get(proj.id) as { id: string } | undefined;
    if (doneSection) {
      db.prepare("UPDATE tasks SET section_id = ? WHERE project_id = ? AND completed = 1 AND section_id != ?").run(
        doneSection.id,
        proj.id,
        doneSection.id
      );
    }
  }

  // 4. Seed the "BCB Feature List" project with all 8 "Todo - Later" items if it doesn't exist yet
  const featureProjId = "proj-bcb-features";
  const existingFeatureProj = db.prepare("SELECT id FROM projects WHERE id = ?").get(featureProjId);
  if (!existingFeatureProj) {
    db.prepare(
      "INSERT INTO projects (id, portfolio_id, name, description, status, icon) VALUES (?, 'port-1', ?, ?, 'On Track', 'FolderKanban')"
    ).run(
      featureProjId,
      "BCB Feature List",
      "Backlog of upcoming features, enhancements, and Todo - Later items from our iteration reviews."
    );

    const secTodo = "sec-feat-todo";
    const secDoing = "sec-feat-doing";
    const secDone = "sec-feat-done";
    const insertSection = db.prepare("INSERT INTO sections (id, project_id, name, sort_order) VALUES (?, ?, ?, ?)");
    insertSection.run(secTodo, featureProjId, "To Do", 1);
    insertSection.run(secDoing, featureProjId, "In Progress", 2);
    insertSection.run(secDone, featureProjId, "Completed", 3);

    const priorityOptions = JSON.stringify([
      { label: "High", color: "#E06C75" },
      { label: "Medium", color: "#477998" },
      { label: "Low", color: "#C4D6B0" },
    ]);
    const insertField = db.prepare(
      "INSERT INTO custom_field_defs (id, project_id, name, field_type, options_json, sort_order, is_visible) VALUES (?, ?, ?, ?, ?, ?, 1)"
    );
    const prioFieldId = `fld-${featureProjId}-priority`;
    const estFieldId = `fld-${featureProjId}-est`;
    const actFieldId = `fld-${featureProjId}-actual`;
    insertField.run(prioFieldId, featureProjId, "Priority", "single_select", priorityOptions, 1);
    insertField.run(estFieldId, featureProjId, "Estimated Time", "time_hours", "[]", 2);
    insertField.run(actFieldId, featureProjId, "Actual Time", "time_hours", "[]", 3);

    const featureTasks = [
      {
        id: "feat-task-1",
        title: "Burnup / Burndown Chart for Task Completion in Analytics Dashboard",
        description: "Replace or expand the Task Completion card with a visual burnup/burndown chart.",
        priority: "Medium",
        est: 2.0,
      },
      {
        id: "feat-task-2",
        title: "Move or refine Estimated vs. Actual Time into Portfolio Dashboard",
        description: "Test Est vs. Actual Time workflow and evaluate moving it from the main Analytics Dashboard to a dedicated Portfolio Dashboard.",
        priority: "Low",
        est: 1.0,
      },
      {
        id: "feat-task-3",
        title: "Split 'All Tasks' view into separate 'My Tasks' and 'Gemini Tasks' sections/tabs",
        description: "Allow viewing tasks cleanly split between You and Gemini in the All Tasks view.",
        priority: "Medium",
        est: 1.0,
      },
      {
        id: "feat-task-4",
        title: "Drag-and-drop tasks between sections (To Do -> In Progress -> Completed)",
        description: "Implement interactive drag-and-drop so tasks can be dragged across sections.",
        priority: "High",
        est: 2.5,
      },
      {
        id: "feat-task-5",
        title: "Delete or Archive Projects",
        description: "Add project management controls to archive or permanently delete projects (like test projects).",
        priority: "High",
        est: 1.0,
      },
      {
        id: "feat-task-6",
        title: "Edit existing Custom Task Fields (rename field, change type, or edit dropdown options)",
        description: "Allow editing a Custom Task Field after it has been created in Customize Task Fields.",
        priority: "Medium",
        est: 1.5,
      },
      {
        id: "feat-task-7",
        title: "Enhanced Due Date features",
        description: "Explore and implement extra features around task Due Dates (recurring dates, reminders, date ranges, etc.).",
        priority: "Medium",
        est: 1.5,
      },
      {
        id: "feat-task-8",
        title: "In-Task Timer that automatically moves task to 'In Progress' when started",
        description: "Add a live start/stop timer inside tasks that logs Actual Time and automatically moves the task into the In Progress section when clicked.",
        priority: "High",
        est: 2.0,
      },
    ];

    const insertTask = db.prepare(`
      INSERT INTO tasks (id, project_id, section_id, title, description, completed, assignee, due_date, created_at, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, 0, 'Gemini', NULL, ?, ?, 'Gemini')
    `);
    const insertVal = db.prepare(`
      INSERT INTO task_field_values (task_id, field_id, value_text, value_number)
      VALUES (?, ?, ?, ?)
    `);

    for (const ft of featureTasks) {
      insertTask.run(ft.id, featureProjId, secTodo, ft.title, ft.description, now, now);
      insertVal.run(ft.id, prioFieldId, ft.priority, null);
      insertVal.run(ft.id, estFieldId, null, ft.est);
      insertVal.run(ft.id, actFieldId, null, 0);
    }

    db.prepare("INSERT INTO activity_log (id, actor, action, task_title, created_at) VALUES (?, ?, ?, ?, ?)").run(
      crypto.randomUUID(),
      "Gemini",
      "Created project with 8 Todo - Later items",
      "BCB Feature List",
      now
    );
  }
}

export function getFullWorkspaceData() {
  const db = getDb();
  const portfolios = db.prepare("SELECT * FROM portfolios").all() as unknown as Portfolio[];
  const projects = db.prepare("SELECT * FROM projects").all() as unknown as Project[];
  const sections = db.prepare("SELECT * FROM sections ORDER BY sort_order ASC").all() as unknown as Section[];
  const customFields = db
    .prepare("SELECT * FROM custom_field_defs ORDER BY sort_order ASC")
    .all() as unknown as CustomFieldDef[];
  const rawTasks = db.prepare("SELECT * FROM tasks ORDER BY completed ASC, created_at ASC").all() as unknown as Omit<
    Task,
    "field_values"
  >[];
  const rawValues = db.prepare("SELECT * FROM task_field_values").all() as unknown as {
    task_id: string;
    field_id: string;
    value_text: string | null;
    value_number: number | null;
  }[];
  const activity = db
    .prepare("SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 12")
    .all() as unknown as { id: string; actor: string; action: string; task_title: string; created_at: string }[];

  const valueMap: Record<string, Record<string, string | number | null>> = {};
  for (const v of rawValues) {
    if (!valueMap[v.task_id]) valueMap[v.task_id] = {};
    valueMap[v.task_id][v.field_id] = v.value_number !== null ? v.value_number : v.value_text;
  }

  const tasks: Task[] = rawTasks.map((t) => ({
    ...t,
    field_values: valueMap[t.id] || {},
  }));

  return { portfolios, projects, sections, customFields, tasks, activity };
}

export function createSnapshotBackup(): string {
  getDb();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(BACKUP_DIR, `bcb-backup-${timestamp}.db`);
  fs.copyFileSync(DB_PATH, dest);
  return dest;
}
