export interface ClaimedArtifact { id: string; objectKey: string; }
export interface ArtifactCleanupRepository { claimDue(): Promise<ClaimedArtifact | undefined>; markDeleted(id: string): Promise<void>; retry(id: string): Promise<void>; }
export interface ArtifactProtectedStorage { deleteProtected(key: string): Promise<void>; }
export class RenderArtifactCleanupRunner {
  constructor(private readonly repository: ArtifactCleanupRepository, private readonly storage: ArtifactProtectedStorage) {}
  async runOnce(): Promise<boolean> { const artifact = await this.repository.claimDue(); if (!artifact) return false; try { await this.storage.deleteProtected(artifact.objectKey); await this.repository.markDeleted(artifact.id); } catch { await this.repository.retry(artifact.id); } return true; }
}
