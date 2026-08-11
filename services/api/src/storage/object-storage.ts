export interface StoredObjectInput {
  key: string;
  bytes: Buffer;
  contentType: string;
}

export interface ObjectStorage {
  putObject(input: StoredObjectInput): Promise<void>;
  deleteObject(key: string): Promise<"deleted" | "missing">;
}

export class ObjectStorageError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ObjectStorageError";
    this.cause = cause;
  }
}

export const unavailableObjectStorage: ObjectStorage = {
  async putObject(): Promise<void> {
    throw new ObjectStorageError("Unable to store import file");
  },
  async deleteObject(): Promise<"deleted" | "missing"> {
    throw new ObjectStorageError("Unable to delete import file");
  }
};

export function isUnavailableObjectStorage(storage: ObjectStorage): boolean {
  return storage === unavailableObjectStorage;
}
