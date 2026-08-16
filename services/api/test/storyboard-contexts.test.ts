import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DataType, newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import type { Database } from "../src/db.js";

const scope = { enterpriseId: "context-ent", storeId: "context-store", actorId: "context-customer" };

describe("customer storyboard contexts", () => {
  let database: Database;
  let app: ReturnType<typeof buildServer>;

  beforeEach(async () => {
    const memory = newDb({ noAstCoverageCheck: true });
    memory.public.registerFunction({ name: "jsonb_typeof", args: [DataType.jsonb], returns: DataType.text, implementation: value => Array.isArray(value) ? "array" : typeof value === "object" && value !== null ? "object" : typeof value });
    const { Pool } = memory.adapters.createPg(); database = new Pool();
    for (const file of ["018_content_planning_workflow.sql", "021_storyboard_projects.sql"]) {
      const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
      await database.query(sql.replace(/CREATE OR REPLACE FUNCTION[\s\S]*$/, ""));
    }
    await seedEligibleContext(database);
    app = buildServer({ database, trustedContextResolver: async () => scope });
  });

  afterEach(async () => { await app?.close(); });

  it("lists only this customer's confirmed storyboard contexts without draft or media fields", async () => {
    const response = await app.inject({ method: "GET", url: `/v1/stores/${scope.storeId}/storyboard-contexts` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ contexts: [{ taskId: "eligible-task", shotListId: "eligible-shots", title: "Eligible title", project: { id: "eligible-project", version: 2, status: "final" } }] });
    expect(response.body).not.toContain("Confirmed copy body");
    expect(response.body).not.toContain("draft-task");
    expect(response.body).not.toContain("other-customer-task");
    expect(response.body).not.toContain("object_key");
  });

  it("denies provider and operator in onRequest, and returns no records for another customer", async () => {
    for (const actorRole of ["provider", "operator_editor"] as const) {
      const privileged = buildServer({ database, trustedContextResolver: async () => ({ ...scope, actorRole }) });
      expect((await privileged.inject({ method: "GET", url: `/v1/stores/${scope.storeId}/storyboard-contexts` })).statusCode).toBe(403);
      await privileged.close();
    }
    const otherCustomer = buildServer({ database, trustedContextResolver: async () => ({ ...scope, actorId: "another-customer" }) });
    expect((await otherCustomer.inject({ method: "GET", url: `/v1/stores/${scope.storeId}/storyboard-contexts` })).json()).toEqual({ contexts: [] });
    await otherCustomer.close();
  });
});

async function seedEligibleContext(database: Database) {
  await insertSource(database, { taskId: "eligible-task", shotListId: "eligible-shots", copyId: "eligible-copy", actorId: scope.actorId, title: "Eligible title" });
  await database.query("INSERT INTO storyboard_projects(id,enterprise_id,store_id,task_id,shot_list_id,actor_id) VALUES('eligible-project',$1,$2,'eligible-task','eligible-shots',$3)", [scope.enterpriseId, scope.storeId, scope.actorId]);
  await database.query("INSERT INTO storyboard_project_versions(id,project_id,version,status,slots_json,cover_title) VALUES($1,'eligible-project',1,'draft','[]',''),($2,'eligible-project',2,'final','[]','')", [randomUUID(), randomUUID()]);
  await insertSource(database, { taskId: "draft-task", shotListId: "draft-shots", copyId: "draft-copy", actorId: scope.actorId, title: "Draft title", taskStatus: "copy_draft", copyStatus: "draft" });
  await insertSource(database, { taskId: "other-customer-task", shotListId: "other-customer-shots", copyId: "other-customer-copy", actorId: "different-customer", title: "Other customer title" });
}

async function insertSource(database: Database, input: { taskId: string; shotListId: string; copyId: string; actorId: string; title: string; taskStatus?: string; copyStatus?: string }) {
  const topicId = randomUUID();
  await database.query("INSERT INTO content_tasks(id,enterprise_id,store_id,actor_id,profile_version,profile_snapshot_json,stage_snapshot_json,template_snapshot_json,persona,content_type,style,commercial_level,status,confirmed_copy_id) VALUES($1,$2,$3,$4,1,'{}','{}','[]','owner','story','sincere',1,$5,$6)", [input.taskId, scope.enterpriseId, scope.storeId, input.actorId, input.taskStatus ?? "copy_confirmed", input.copyId]);
  await database.query("INSERT INTO content_task_topics(id,task_id,position,title,angle,product_reference,goal_reference,commercial_level) VALUES($1,$2,1,'topic','angle','product','goal',1)", [topicId, input.taskId]);
  await database.query("INSERT INTO content_task_copies(id,task_id,topic_id,position,title,body,strategy,product_reference,goal_reference,commercial_level,status) VALUES($1,$2,$3,1,$4,'Confirmed copy body','strategy','product','goal',1,$5)", [input.copyId, input.taskId, topicId, input.title, input.copyStatus ?? "confirmed"]);
  await database.query("INSERT INTO content_task_shot_lists(id,task_id,copy_id,shots_json) VALUES($1,$2,$3,'[]')", [input.shotListId, input.taskId, input.copyId]);
}
