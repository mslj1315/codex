import type { ObjectStorage, StoredObjectInput } from "../../src/storage/object-storage.js";

export class FakeObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, StoredObjectInput>();
  putFailure: Error | null = null;
  readonly deleteFailures = new Set<string>();

  async putObject(input: StoredObjectInput): Promise<void> {
    if (this.putFailure) throw this.putFailure;
    this.objects.set(input.key, { ...input, bytes: Buffer.from(input.bytes) });
  }

  async deleteObject(key: string): Promise<"deleted" | "missing"> {
    if (this.deleteFailures.has(key)) throw new Error("delete failed");
    return this.objects.delete(key) ? "deleted" : "missing";
  }
}
