import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const SOURCE_DB = path.join(ROOT_DIR, "data", "bcb.db");
const SERVER_PATH = path.join(__dirname, "bcb-mcp-server.mjs");

assert.ok(fs.existsSync(SOURCE_DB), `Source DB not found at ${SOURCE_DB}`);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bcb-mcp-test-"));
const tempDbPath = path.join(tempDir, "bcb-test.db");
for (const suffix of ["", "-wal", "-shm"]) {
  if (fs.existsSync(SOURCE_DB + suffix)) {
    fs.copyFileSync(SOURCE_DB + suffix, tempDbPath + suffix);
  }
}

const EXPECTED_TOOLS = [
  "bcb_list_workspace",
  "bcb_list_tasks",
  "bcb_create_task",
  "bcb_update_task",
  "bcb_delete_task",
  "bcb_start_timer",
  "bcb_stop_timer",
  "bcb_create_project",
  "bcb_archive_project",
  "bcb_get_analytics",
];

function parseToolResult(res) {
  assert.ok(!res.isError, `Expected success but got MCP error: ${res.content?.[0]?.text}`);
  return JSON.parse(res.content[0].text);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--no-warnings", SERVER_PATH],
  env: {
    ...process.env,
    BCB_DB_PATH: tempDbPath,
  },
  stderr: "pipe",
});

const client = new Client({ name: "bcb-mcp-test-client", version: "1.0.0" });

try {
  await client.connect(transport);

  // 1. Verify all 10 tools are registered
  const { tools } = await client.listTools();
  const toolNames = tools.map((t) => t.name);
  for (const name of EXPECTED_TOOLS) {
    assert.ok(toolNames.includes(name), `Missing expected MCP tool: ${name}`);
  }
  console.log(`PASS 1/14: All ${EXPECTED_TOOLS.length} tools listed.`);

  // 2. bcb_list_workspace
  const ws = parseToolResult(await client.callTool({ name: "bcb_list_workspace", arguments: {} }));
  assert.ok(ws.portfolios.length >= 1, "Expected at least 1 portfolio");
  assert.ok(ws.projects.length >= 1, "Expected at least 1 active project");
  const targetProject =
    ws.projects.find((p) => p.in_progress_section_id && p.completed_section_id) || ws.projects[0];
  assert.ok("in_progress_section_id" in targetProject, "Expected in_progress_section_id on project");
  assert.ok("completed_section_id" in targetProject, "Expected completed_section_id on project");
  assert.ok(
    targetProject.sections.some((s) => s.automation_role === "completed"),
    "Expected at least one section with automation_role='completed'"
  );
  console.log(`PASS 2/14: bcb_list_workspace returned ${ws.projects.length} active project(s) with automation roles.`);

  // 3. bcb_list_tasks excludes archived projects by default
  const openList = parseToolResult(await client.callTool({ name: "bcb_list_tasks", arguments: {} }));
  assert.ok(openList.tasks.every((t) => !t.project_is_archived), "Archived tasks leaked into default list");
  console.log(`PASS 3/14: bcb_list_tasks excluded archived projects (${openList.count} active tasks).`);

  // 4. Negative time rejection
  const negRes = await client.callTool({
    name: "bcb_create_task",
    arguments: {
      project_id: targetProject.id,
      title: "Should fail negative time",
      custom_fields: { "Estimated Time": -2 },
    },
  });
  assert.ok(negRes.isError, "Expected negative Estimated Time to be rejected");
  assert.match(negRes.content[0].text, /negative/i);
  console.log("PASS 4/14: Rejected negative Estimated Time cleanly.");

  // 5. Create task with named custom fields
  const createdRes = parseToolResult(
    await client.callTool({
      name: "bcb_create_task",
      arguments: {
        project_id: targetProject.id,
        title: "MCP Test Integration Task",
        description: "Created by automated test suite",
        assignee: "Gemini",
        due_date: "2026-12-01",
        custom_fields: {
          Priority: "high",
          "Estimated Time": 1.5,
          "Actual Time": 0.25,
        },
      },
    })
  );
  const taskId = createdRes.task.id;
  assert.equal(createdRes.task.fields.Priority, "High");
  assert.equal(createdRes.task.fields["Estimated Time"], 1.5);
  assert.equal(createdRes.task.fields["Actual Time"], 0.25);
  console.log(`PASS 5/14: Created task ${taskId} with named custom fields.`);

  // 6. Start timer -> auto-moves to In Progress
  const startRes = parseToolResult(await client.callTool({ name: "bcb_start_timer", arguments: { task_id: taskId } }));
  assert.equal(startRes.started, true);
  assert.equal(startRes.task.timer_running, true);
  assert.match(startRes.task.section_name.toLowerCase(), /in progress|doing/);
  console.log(`PASS 6/11: bcb_start_timer started timer and placed task in "${startRes.task.section_name}".`);

  // 7. Wait ~1.2s -> stop timer -> Actual Time increases
  await new Promise((r) => setTimeout(r, 1200));
  const stopRes = parseToolResult(await client.callTool({ name: "bcb_stop_timer", arguments: { task_id: taskId } }));
  assert.equal(stopRes.stopped, true);
  assert.equal(stopRes.task.timer_running, false);
  assert.ok(stopRes.timer_summary.elapsed_seconds >= 1, "Expected >= 1s elapsed");
  assert.ok(
    Number(stopRes.task.fields["Actual Time"]) > 0.25,
    `Expected Actual Time > 0.25, got ${stopRes.task.fields["Actual Time"]}`
  );
  console.log(
    `PASS 7/11: bcb_stop_timer logged +${stopRes.timer_summary.elapsed_compact} (Actual Time now ${stopRes.task.fields["Actual Time"]}h).`
  );

  // 8. Start timer again, then move to Completed -> auto-completes AND stops timer
  await client.callTool({ name: "bcb_start_timer", arguments: { task_id: taskId } });
  await new Promise((r) => setTimeout(r, 1100));
  const doneSec = targetProject.sections.find((s) => /completed|done/i.test(s.name));
  const moveDoneRes = parseToolResult(
    await client.callTool({
      name: "bcb_update_task",
      arguments: { task_id: taskId, section_name: doneSec ? doneSec.name : "Completed" },
    })
  );
  assert.equal(moveDoneRes.task.completed, true);
  assert.equal(moveDoneRes.task.timer_running, false);
  assert.ok(moveDoneRes.timer_summary !== null, "Expected running timer to stop automatically on completion");
  console.log("PASS 8/11: Moving task to Completed auto-completed task and stopped running timer.");

  // 9. Move back to first section -> reopens task
  const todoSec = targetProject.sections[0];
  const reopenRes = parseToolResult(
    await client.callTool({
      name: "bcb_update_task",
      arguments: { task_id: taskId, section_id: todoSec.id },
    })
  );
  assert.equal(reopenRes.task.completed, false);
  console.log(`PASS 9/11: Moving task back to "${todoSec.name}" reopened task.`);

  // 10. Analytics rollup
  const analytics = parseToolResult(await client.callTool({ name: "bcb_get_analytics", arguments: {} }));
  assert.ok(analytics.summary.total_tasks >= 1);
  assert.ok(Array.isArray(analytics.projects) && analytics.projects.length >= 1);
  assert.ok(Array.isArray(analytics.recent_activity) && analytics.recent_activity.length >= 1);
  console.log("PASS 10/11: bcb_get_analytics returned valid summary, project rollups, and recent activity.");

  // 11. Rename mapped sections in temp DB and verify ID-based automations still work without duplicates
  const testDb = new DatabaseSync(tempDbPath);
  const sectionCountBefore = testDb
    .prepare("SELECT COUNT(*) as c FROM sections WHERE project_id = ?")
    .get(targetProject.id).c;
  if (targetProject.in_progress_section_id) {
    testDb.prepare("UPDATE sections SET name = 'Active Work' WHERE id = ?").run(targetProject.in_progress_section_id);
  }
  if (targetProject.completed_section_id) {
    testDb.prepare("UPDATE sections SET name = 'Shipped' WHERE id = ?").run(targetProject.completed_section_id);
  }

  const renamedStartRes = parseToolResult(
    await client.callTool({ name: "bcb_start_timer", arguments: { task_id: taskId } })
  );
  if (targetProject.in_progress_section_id) {
    assert.equal(renamedStartRes.task.section_id, targetProject.in_progress_section_id);
    assert.equal(renamedStartRes.task.section_name, "Active Work");
  }
  const sectionCountAfter = testDb
    .prepare("SELECT COUNT(*) as c FROM sections WHERE project_id = ?")
    .get(targetProject.id).c;
  assert.equal(sectionCountAfter, sectionCountBefore, "Starting timer on renamed section should not create a duplicate");

  const renamedDoneRes = parseToolResult(
    await client.callTool({ name: "bcb_update_task", arguments: { task_id: taskId, completed: true } })
  );
  assert.equal(renamedDoneRes.task.completed, true);
  if (targetProject.completed_section_id) {
    assert.equal(renamedDoneRes.task.section_id, targetProject.completed_section_id);
    assert.equal(renamedDoneRes.task.section_name, "Shipped");
  }
  console.log("PASS 11/14: ID-based timer & completion automations worked after renaming sections.");

  // 12. Reopening a completed task leaves it in its current section
  const reopenInPlaceRes = parseToolResult(
    await client.callTool({ name: "bcb_update_task", arguments: { task_id: taskId, completed: false } })
  );
  assert.equal(reopenInPlaceRes.task.completed, false);
  assert.equal(
    reopenInPlaceRes.task.section_id,
    renamedDoneRes.task.section_id,
    "Reopening a task without explicit section should leave it in its current section"
  );
  console.log("PASS 12/14: Reopening completed task preserved its current section.");

  // 13. Setting in_progress_section_id = NULL starts timer without moving task
  testDb.prepare("UPDATE projects SET in_progress_section_id = NULL WHERE id = ?").run(targetProject.id);
  const noMoveStartRes = parseToolResult(
    await client.callTool({ name: "bcb_start_timer", arguments: { task_id: taskId } })
  );
  assert.equal(noMoveStartRes.task.timer_running, true);
  assert.equal(noMoveStartRes.moved_to_section, null);
  assert.equal(noMoveStartRes.task.section_id, reopenInPlaceRes.task.section_id);
  testDb.close();
  console.log("PASS 13/14: Starting timer with in_progress_section_id=NULL did not move task.");

  // 14. Delete test task
  const delRes = parseToolResult(await client.callTool({ name: "bcb_delete_task", arguments: { task_id: taskId } }));
  assert.equal(delRes.deleted, true);
  console.log("PASS 14/14: bcb_delete_task cleaned up test task.");

  console.log("\nALL 14 MCP INTEGRATION TESTS PASSED!");
} finally {
  await client.close().catch(() => {});
  fs.rmSync(tempDir, { recursive: true, force: true });
}
