import type { Database } from "../db.js";
import type { TrustedContext } from "../imports/service.js";

type Row = Record<string, unknown>;

export class StoryboardContextRepository {
  constructor(private readonly database: Database) {}

  async list(context: TrustedContext) {
    const result = await this.database.query<Row>(
      `SELECT t.id AS task_id,s.id AS shot_list_id,c.title,p.id AS project_id
       FROM content_tasks t
       JOIN content_task_copies c ON c.id=t.confirmed_copy_id AND c.task_id=t.id AND c.status='confirmed'
       JOIN content_task_shot_lists s ON s.task_id=t.id AND s.copy_id=t.confirmed_copy_id
       LEFT JOIN storyboard_projects p ON p.enterprise_id=t.enterprise_id AND p.store_id=t.store_id AND p.task_id=t.id AND p.shot_list_id=s.id AND p.actor_id=t.actor_id
       WHERE t.enterprise_id=$1 AND t.store_id=$2 AND t.actor_id=$3 AND t.status='copy_confirmed'
       ORDER BY t.created_at DESC,s.created_at DESC`,
      [context.enterpriseId, context.storeId, context.actorId]
    );
    return Promise.all(result.rows.map(async row => {
      const projectId = row.project_id ? String(row.project_id) : undefined;
      const version = projectId ? await this.database.query<Row>("SELECT version,status FROM storyboard_project_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1", [projectId]) : undefined;
      return {
        taskId: String(row.task_id),
        shotListId: String(row.shot_list_id),
        title: String(row.title),
        ...(projectId && version?.rowCount ? { project: { id: projectId, version: Number(version.rows[0].version), status: String(version.rows[0].status) } } : {})
      };
    }));
  }
}
