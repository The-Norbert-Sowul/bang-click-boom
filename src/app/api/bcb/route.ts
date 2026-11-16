import { NextRequest, NextResponse } from "next/server";
import { getDb, getFullWorkspaceData, createSnapshotBackup } from "@/lib/db";
import crypto from "node:crypto";

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

      const newTitle = title !== undefined ? title : existing.title;
      const newDesc = description !== undefined ? description : existing.description;
      const newCompleted = completed !== undefined ? (completed ? 1 : 0) : existing.completed;
      const newAssignee = assignee !== undefined ? assignee : existing.assignee;
      const newDueDate = due_date !== undefined ? due_date : existing.due_date;
      const newCompletedAt =
        completed !== undefined ? (newCompleted === 1 ? now : null) : existing.completed_at;

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
        SET title = ?, description = ?, completed = ?, assignee = ?, due_date = ?, section_id = ?, updated_at = ?, completed_at = ?, updated_by = ?
        WHERE id = ?
      `).run(newTitle, newDesc, newCompleted, newAssignee, newDueDate, newSectionId, now, newCompletedAt, actor, id);

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
