import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

export interface Queryable {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<Row>>;
}

export interface Database extends Queryable {
  connect(): Promise<PoolClient>;
}

export function createDatabase(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl });
}
