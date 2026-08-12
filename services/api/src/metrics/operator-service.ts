import type { MetricCatalog, MetricDefinition } from "./repository.js";
import { MetricCatalogRepository } from "./repository.js";

/** Explicitly injected only; the store HTTP server never registers operator mutations. */
export class MetricCatalogOperatorService {
  constructor(private readonly catalogs: MetricCatalogRepository) {}
  createDraftFromPublished(): Promise<MetricCatalog> { return this.catalogs.createDraftFromPublished(); }
  upsertDraftDefinition(catalogId: string, definition: MetricDefinition): Promise<void> { return this.catalogs.upsertDraftDefinition(catalogId, definition); }
  publishDraft(catalogId: string): Promise<void> { return this.catalogs.publishDraft(catalogId); }
}
