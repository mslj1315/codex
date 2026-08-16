import type { ModelGenerationService } from "../model-providers/generation.js";

export function requireGenerationService(service: ModelGenerationService | undefined): ModelGenerationService {
  if (!service) throw new Error("Generation is unavailable");
  return service;
}
