import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.REAL_POSTGRES_TEST_URL;

describe.skipIf(!url)("model token pricing PostgreSQL lifecycle", () => {
  const schema = `model_pricing_${randomUUID().replace(/-/g, "")}`;
  let admin: Pool;
  let pool: Pool;

  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
    for (const file of ["018_content_planning_workflow.sql", "028_model_token_pricing.sql"]) await pool.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }, 30_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.end();
  });

  it("allows a draft to publish, then permits only retirement with an effective end", async () => {
    await pool.query("INSERT INTO model_token_price_versions(id,provider,model,input_cny_per_million_tokens,output_cny_per_million_tokens,effective_from,status) VALUES('draft','provider','model',1,2,'2020-01-01T00:00:00Z','draft')");
    await pool.query("UPDATE model_token_price_versions SET input_cny_per_million_tokens=3 WHERE id='draft'");
    await pool.query("UPDATE model_token_price_versions SET status='published' WHERE id='draft'");
    await expect(pool.query("UPDATE model_token_price_versions SET input_cny_per_million_tokens=4 WHERE id='draft'")).rejects.toThrow("model token price history is immutable");
    await pool.query("UPDATE model_token_price_versions SET status='retired',effective_to='2020-02-01T00:00:00Z' WHERE id='draft'");
    await expect(pool.query("UPDATE model_token_price_versions SET effective_to='2020-03-01T00:00:00Z' WHERE id='draft'")).rejects.toThrow("model token price history is immutable");
  });
});
