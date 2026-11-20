import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
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
  console.log(`PASS 1/11: All ${EXPECTED_TOOLS.length} tools listed.`);

  // 2. bcb_list_workspace
  const ws = parseToolResult(await client.callTool({ name: "bcb_list_workspace", arguments: {} }));
  assert.ok(ws.portfolios.length >= 1, "Expected at least 1 portfolio");
  assert.ok(ws.projects.length >= 1, "Expected at least 1 active project");
  const targetProject = ws.projects[0];
  console.log(`PASS 2/11: bcb_list_workspace returned ${ws.projects.length} active project(s).`);

  // 3. bcb_list_tasks excludes archived projects by default
  const openList = parseToolResult(await client.callTool({ name: "bcb_list_tasks", arguments: {} }));
  assert.ok(openList.tasks.every((t) => !t.project_is_archived), "Archived tasks leaked into default list");
  console.log(`PASS 3/11: bcb_list_tasks excluded archived projects (${openList.count} active tasks).`);

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
  console.log("PASS 4/11: Rejected negative Estimated Time cleanly.");

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
  console.log(`PASS 5/11: Created task ${taskId} with named custom fields.`);

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

  // 11. Delete test task
  const delRes = parseToolResult(await client.callTool({ name: "bcb_delete_task", arguments: { task_id: taskId } }));
  assert.equal(delRes.deleted, true);
  console.log("PASS 11/11: bcb_delete_task cleaned up test task.");

  console.log("\nALL 11 MCP INTEGRATION TESTS PASSED!");
} finally {
  await client.close().catch(() => {});
  fs.rmSync(tempDir, { recursive: true, force: true });
}
