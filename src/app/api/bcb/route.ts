import { NextRequest, NextResponse } from "next/server";
import { getDb, getFullWorkspaceData, createSnapshotBackup } from "@/lib/db";
import { formatDurationCompact } from "@/lib/timeUtils";
import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";

function isCompletionSectionName(name: string): boolean {
  return ["completed", "done", "complete"].includes(name.trim().toLowerCase());
}

function validateNonNegativeTimeFields(
  db: DatabaseSync,
  fieldValues: Record<string, any> | undefined
): string | null {
  if (!fieldValues || typeof fieldValues !== "object") return null;
  const lookup = db.prepare("SELECT name, field_type FROM custom_field_defs WHERE id = ?");
  for (const [fid, val] of Object.entries(fieldValues)) {
    if (val === "" || val === null || val === undefined) continue;
    const fieldDef = lookup.get(fid) as { name: string; field_type: string } | undefined;
    if (fieldDef?.field_type === "time_hours") {
      const num = Number(val);
      if (Number.isNaN(num) || num < 0) {
        return `"${fieldDef.name}" cannot be negative.`;
      }
    }
  }
  return null;
}

function accumulateRunningTimer(db: DatabaseSync, existingTask: any, now: string) {
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
    .get(existingTask.project_id) as { id: string } | undefined;

  if (!actualField) {
    actualField = db
      .prepare(
        "SELECT id FROM custom_field_defs WHERE project_id = ? AND LOWER(name) LIKE '%actual%' ORDER BY sort_order ASC LIMIT 1"
      )
      .get(existingTask.project_id) as { id: string } | undefined;
  }

  let newActualHours = Math.round(elapsedHours * 10000) / 10000;

  if (actualField) {
    const currentRow = db
      .prepare("SELECT value_number, value_text FROM task_field_values WHERE task_id = ? AND field_id = ?")
      .get(existingTask.id, actualField.id) as
      | { value_number: number | null; value_text: string | null }
      | undefined;

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
    elapsedSeconds,
    addedHours: Math.round(elapsedHours * 10000) / 10000,
    newActualHours,
  };
}

function findOrCreateInProgressSection(db: DatabaseSync, projectId: string): { id: string; name: string } {
  const existing = db
    .prepare(
      "SELECT id, name FROM sections WHERE project_id = ? AND LOWER(TRIM(name)) IN ('in progress', 'in-progress', 'doing') ORDER BY sort_order ASC LIMIT 1"
    )
    .get(projectId) as { id: string; name: string } | undefined;

  if (existing) return existing;

  const doneSec = db
    .prepare(
      "SELECT id, sort_order FROM sections WHERE project_id = ? AND LOWER(TRIM(name)) IN ('completed', 'done', 'complete') ORDER BY sort_order ASC LIMIT 1"
    )
    .get(projectId) as { id: string; sort_order: number } | undefined;

  const newId = `sec-${crypto.randomUUID().slice(0, 8)}`;

  if (doneSec) {
    db.prepare("UPDATE sections SET sort_order = sort_order + 1 WHERE project_id = ? AND sort_order >= ?").run(
      projectId,
      doneSec.sort_order
    );
    db.prepare("INSERT INTO sections (id, project_id, name, sort_order) VALUES (?, ?, 'In Progress', ?)").run(
      newId,
      projectId,
      doneSec.sort_order
    );
  } else {
    const maxRow = db
      .prepare("SELECT COALESCE(MAX(sort_order), 0) as max_order FROM sections WHERE project_id = ?")
      .get(projectId) as { max_order: number };
    db.prepare("INSERT INTO sections (id, project_id, name, sort_order) VALUES (?, ?, 'In Progress', ?)").run(
      newId,
      projectId,
      maxRow.max_order + 1
    );
  }

  return { id: newId, name: "In Progress" };
}

export async function GET() {
  try {
    const data = getFullWorkspaceData();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const db = getDb();
    const now = new Date().toISOString();
    const actor = body.actor || "You";

    if (body.action === "create_task") {
      const id = `task-${crypto.randomUUID().slice(0, 8)}`;
      const { project_id, section_id, title, description = "", assignee = "You", due_date = null, field_values = {} } = body;

      const timeValidationError = validateNonNegativeTimeFields(db, field_values);
      if (timeValidationError) {
        return NextResponse.json({ error: timeValidationError }, { status: 400 });
      }

      db.prepare(`
        INSERT INTO tasks (id, project_id, section_id, title, description, completed, assignee, due_date, created_at, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
      `).run(id, project_id, section_id, title, description, assignee, due_date, now, now, actor);

      const upsertVal = db.prepare(`
        INSERT OR REPLACE INTO task_field_values (task_id, field_id, value_text, value_number)
        VALUES (?, ?, ?, ?)
      `);
      for (const [fid, val] of Object.entries(field_values)) {
        if (val === null || val === undefined || val === "") continue;
        if (typeof val === "number") {
          upsertVal.run(id, fid, null, val);
        } else {
          upsertVal.run(id, fid, String(val), null);
        }
      }

      db.prepare("INSERT INTO activity_log (id, actor, action, task_title, created_at) VALUES (?, ?, ?, ?, ?)").run(
        crypto.randomUUID(),
        actor,
        "Created task",
        title,
        now
      );

      return NextResponse.json(getFullWorkspaceData());
    }

    if (body.action === "update_task") {
      const { id, title, description, completed, assignee, due_date, section_id, field_values } = body;
      const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as any;
      if (!existing) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }

      const timeValidationError = validateNonNegativeTimeFields(db, field_values);
      if (timeValidationError) {
        return NextResponse.json({ error: timeValidationError }, { status: 400 });
      }

      const newTitle = title !== undefined ? title : existing.title;
      const newDesc = description !== undefined ? description : existing.description;
      const newCompleted = completed !== undefined ? (completed ? 1 : 0) : existing.completed;
      const newAssignee = assignee !== undefined ? assignee : existing.assignee;
      const newDueDate = due_date !== undefined ? due_date : existing.due_date;
      const newCompletedAt =
        completed !== undefined ? (newCompleted === 1 ? now : null) : existing.completed_at;

      let newTimerStartedAt: string | null = existing.timer_started_at ?? null;
      if (completed !== undefined && newCompleted === 1 && existing.timer_started_at) {
        accumulateRunningTimer(db, existing, now);
        newTimerStartedAt = null;
      }

      // Automatically move task to "Completed"/"Done" section when marked complete,
      // or back to the first section ("To Do") when reopened if no explicit section_id was passed
      let newSectionId = section_id !== undefined ? section_id : existing.section_id;
      if (completed !== undefined && section_id === undefined) {
        if (newCompleted === 1) {
          const doneSec = db
            .prepare(
              "SELECT id FROM sections WHERE project_id = ? AND LOWER(name) IN ('completed', 'done', 'complete') ORDER BY sort_order DESC LIMIT 1"
            )
            .get(existing.project_id) as { id: string } | undefined;
          if (doneSec) newSectionId = doneSec.id;
        } else {
          const todoSec = db
            .prepare("SELECT id FROM sections WHERE project_id = ? ORDER BY sort_order ASC LIMIT 1")
            .get(existing.project_id) as { id: string } | undefined;
          if (todoSec) newSectionId = todoSec.id;
        }
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
        id
      );

      if (field_values && typeof field_values === "object") {
        const upsertVal = db.prepare(`
          INSERT OR REPLACE INTO task_field_values (task_id, field_id, value_text, value_number)
          VALUES (?, ?, ?, ?)
        `);
        for (const [fid, val] of Object.entries(field_values)) {
          if (val === "" || val === null) {
            db.prepare("DELETE FROM task_field_values WHERE task_id = ? AND field_id = ?").run(id, fid);
          } else if (typeof val === "number" || (!isNaN(Number(val)) && String(val).trim() !== "" && body.is_numeric_field)) {
            upsertVal.run(id, fid, null, Number(val));
          } else {
            upsertVal.run(id, fid, String(val), null);
          }
        }
      }

      const actionDesc =
        completed !== undefined
          ? newCompleted
            ? "Marked complete"
            : "Reopened task"
          : "Updated task properties";

      db.prepare("INSERT INTO activity_log (id, actor, action, task_title, created_at) VALUES (?, ?, ?, ?, ?)").run(
        crypto.randomUUID(),
        actor,
        actionDesc,
        newTitle,
        now
      );

      return NextResponse.json(getFullWorkspaceData());
    }

    if (body.action === "start_timer") {
      const { id } = body;
      const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as any;
      if (!existing) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }
      if (existing.timer_started_at) {
        return NextResponse.json(getFullWorkspaceData());
      }

      const inProgressSec = findOrCreateInProgressSection(db, existing.project_id);
      const moved = existing.section_id !== inProgressSec.id;

      db.prepare(`
        UPDATE tasks
        SET timer_started_at = ?, section_id = ?, completed = 0, completed_at = NULL, updated_at = ?, updated_by = ?
        WHERE id = ?
      `).run(now, inProgressSec.id, now, actor, id);

      db.prepare("INSERT INTO activity_log (id, actor, action, task_title, created_at) VALUES (?, ?, ?, ?, ?)").run(
        crypto.randomUUID(),
        actor,
        moved ? `Started timer & moved to "${inProgressSec.name}"` : "Started timer",
        existing.title,
        now
      );

      return NextResponse.json({
        movedToSection: moved ? inProgressSec.name : null,
        ...getFullWorkspaceData(),
      });
    }

    if (body.action === "stop_timer") {
      const { id } = body;
      const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as any;
      if (!existing) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }
      if (!existing.timer_started_at) {
        return NextResponse.json(getFullWorkspaceData());
      }

      const summary = accumulateRunningTimer(db, existing, now);

      db.prepare("UPDATE tasks SET timer_started_at = NULL, updated_at = ?, updated_by = ? WHERE id = ?").run(
        now,
        actor,
        id
      );

      const compactDuration = summary ? formatDurationCompact(summary.elapsedSeconds) : "0s";
      db.prepare("INSERT INTO activity_log (id, actor, action, task_title, created_at) VALUES (?, ?, ?, ?, ?)").run(
        crypto.randomUUID(),
        actor,
        `Stopped timer (+${compactDuration})`,
        existing.title,
        now
      );

      return NextResponse.json({
        timerSummary: summary,
        ...getFullWorkspaceData(),
      });
    }

    if (body.action === "move_task_section") {
      const { id, section_id } = body;
      const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as any;
      if (!existing) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }

      const targetSec = db.prepare("SELECT id, project_id, name FROM sections WHERE id = ?").get(section_id) as
        | { id: string; project_id: string; name: string }
        | undefined;
      if (!targetSec || targetSec.project_id !== existing.project_id) {
        return NextResponse.json({ error: "Target section not found in task's project" }, { status: 404 });
      }

      const isTargetDone = isCompletionSectionName(targetSec.name);
      let newCompleted = existing.completed;
      let newCompletedAt = existing.completed_at;
      let newTimerStartedAt: string | null = existing.timer_started_at ?? null;

      if (isTargetDone) {
        newCompleted = 1;
        newCompletedAt = existing.completed ? existing.completed_at || now : now;
        if (existing.timer_started_at) {
          accumulateRunningTimer(db, existing, now);
          newTimerStartedAt = null;
        }
      } else if (existing.completed === 1) {
        newCompleted = 0;
        newCompletedAt = null;
      }

      db.prepare(`
        UPDATE tasks
        SET section_id = ?, completed = ?, completed_at = ?, timer_started_at = ?, updated_at = ?, updated_by = ?
        WHERE id = ?
      `).run(targetSec.id, newCompleted, newCompletedAt, newTimerStartedAt, now, actor, id);

      db.prepare("INSERT INTO activity_log (id, actor, action, task_title, created_at) VALUES (?, ?, ?, ?, ?)").run(
        crypto.randomUUID(),
        actor,
        `Moved to "${targetSec.name}"`,
        existing.title,
        now
      );

      return NextResponse.json(getFullWorkspaceData());
    }

    if (body.action === "delete_task") {
      const existing = db.prepare("SELECT title FROM tasks WHERE id = ?").get(body.id) as any;
      db.prepare("DELETE FROM tasks WHERE id = ?").run(body.id);
      if (existing) {
        db.prepare("INSERT INTO activity_log (id, actor, action, task_title, created_at) VALUES (?, ?, ?, ?, ?)").run(
          crypto.randomUUID(),
          actor,
          "Deleted task",
          existing.title,
          now
        );
      }
      return NextResponse.json(getFullWorkspaceData());
    }

    if (body.action === "add_custom_field") {
      const { project_id, name, field_type, options = [] } = body;
      const id = `fld-${crypto.randomUUID().slice(0, 8)}`;
      const maxOrderRow = db
        .prepare("SELECT COALESCE(MAX(sort_order), 0) as max_order FROM custom_field_defs WHERE project_id = ?")
        .get(project_id) as { max_order: number };

      db.prepare(`
        INSERT INTO custom_field_defs (id, project_id, name, field_type, options_json, sort_order, is_visible)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(id, project_id, name, field_type, JSON.stringify(options), maxOrderRow.max_order + 1);

      db.prepare("INSERT INTO activity_log (id, actor, action, task_title, created_at) VALUES (?, ?, ?, ?, ?)").run(
        crypto.randomUUID(),
        actor,
        `Added custom Task Field "${name}" (${field_type})`,
        project_id,
        now
      );

      return NextResponse.json(getFullWorkspaceData());
    }

    if (body.action === "toggle_custom_field") {
      const { field_id, is_visible } = body;
      db.prepare("UPDATE custom_field_defs SET is_visible = ? WHERE id = ?").run(is_visible ? 1 : 0, field_id);
      return NextResponse.json(getFullWorkspaceData());
    }

    if (body.action === "delete_custom_field") {
      const { field_id } = body;
      db.prepare("DELETE FROM custom_field_defs WHERE id = ?").run(field_id);
      return NextResponse.json(getFullWorkspaceData());
    }

    if (body.action === "create_project") {
      const { portfolio_id = "port-1", name, description = "" } = body;
      const id = `proj-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare("INSERT INTO projects (id, portfolio_id, name, description, status, icon) VALUES (?, ?, ?, ?, 'On Track', 'FolderKanban')").run(
        id,
        portfolio_id,
        name,
        description
      );

      db.prepare("INSERT INTO sections (id, project_id, name, sort_order) VALUES (?, ?, 'To Do', 1)").run(`sec-${id}-1`, id);
      db.prepare("INSERT INTO sections (id, project_id, name, sort_order) VALUES (?, ?, 'In Progress', 2)").run(`sec-${id}-2`, id);
      db.prepare("INSERT INTO sections (id, project_id, name, sort_order) VALUES (?, ?, 'Completed', 3)").run(`sec-${id}-3`, id);

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

      return NextResponse.json(getFullWorkspaceData());
    }

    if (body.action === "archive_project") {
      const { project_id, is_archived = true } = body;
      const existing = db.prepare("SELECT name FROM projects WHERE id = ?").get(project_id) as { name: string } | undefined;
      if (!existing) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
      const archivedVal = is_archived ? 1 : 0;
      db.prepare("UPDATE projects SET is_archived = ? WHERE id = ?").run(archivedVal, project_id);
      db.prepare("INSERT INTO activity_log (id, actor, action, task_title, created_at) VALUES (?, ?, ?, ?, ?)").run(
        crypto.randomUUID(),
        actor,
        archivedVal ? "Archived project" : "Restored project from archive",
        existing.name,
        now
      );
      return NextResponse.json(getFullWorkspaceData());
    }

    if (body.action === "delete_project") {
      const { project_id } = body;
      const existing = db.prepare("SELECT name FROM projects WHERE id = ?").get(project_id) as { name: string } | undefined;
      if (!existing) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
      db.prepare("DELETE FROM projects WHERE id = ?").run(project_id);
      db.prepare("INSERT INTO activity_log (id, actor, action, task_title, created_at) VALUES (?, ?, ?, ?, ?)").run(
        crypto.randomUUID(),
        actor,
        "Deleted project",
        existing.name,
        now
      );
      return NextResponse.json(getFullWorkspaceData());
    }

    if (body.action === "backup_db") {
      const backupFile = createSnapshotBackup();
      return NextResponse.json({ backupFile, ...getFullWorkspaceData() });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
