import { describe, expect, it } from "vitest";
import {
  MinioObjectStorage,
  type MinioClient
} from "../src/storage/minio-object-storage.js";
import { ObjectStorageError } from "../src/storage/object-storage.js";

class FakeMinioClient implements MinioClient {
  bucketExistsCalls: string[] = [];
  makeBucketCalls: string[] = [];
  putCalls: Array<{ bucket: string; key: string; bytes: Buffer; size: number; metadata: Record<string, string> }> = [];
  statCalls: Array<{ bucket: string; key: string }> = [];
  removeCalls: Array<{ bucket: string; key: string }> = [];
  bucketExistsResult = true;
  bucketExistsFailures: Error[] = [];
  makeBucketFailure: Error | null = null;
  putFailure: Error | null = null;
  statFailure: Error | null = null;
  removeFailure: Error | null = null;

  async bucketExists(bucket: string): Promise<boolean> {
    this.bucketExistsCalls.push(bucket);
    const failure = this.bucketExistsFailures.shift();
    if (failure) throw failure;
    return this.bucketExistsResult;
  }

  async makeBucket(bucket: string): Promise<void> {
    this.makeBucketCalls.push(bucket);
    if (this.makeBucketFailure) throw this.makeBucketFailure;
  }

  async putObject(bucket: string, key: string, bytes: Buffer, size: number, metadata: Record<string, string>): Promise<unknown> {
    if (this.putFailure) throw this.putFailure;
    this.putCalls.push({ bucket, key, bytes, size, metadata });
    return {};
  }

  async statObject(bucket: string, key: string): Promise<unknown> {
    this.statCalls.push({ bucket, key });
    if (this.statFailure) throw this.statFailure;
    return {};
  }

  async removeObject(bucket: string, key: string): Promise<void> {
    this.removeCalls.push({ bucket, key });
    if (this.removeFailure) throw this.removeFailure;
  }
}

class RacingMinioClient extends FakeMinioClient {
  constructor(
    private readonly race: BucketCreationRace,
    private readonly makeFailure: Error | null
  ) {
    super();
    this.bucketExistsResult = false;
  }

  override async makeBucket(bucket: string): Promise<void> {
    this.makeBucketCalls.push(bucket);
    await this.race.arrive();
    if (this.makeFailure) throw this.makeFailure;
  }
}

class BucketCreationRace {
  private arrivals = 0;
  private release!: () => void;
  private readonly bothArrived = new Promise<void>((resolve) => { this.release = resolve; });

  async arrive(): Promise<void> {
    this.arrivals += 1;
    if (this.arrivals === 2) this.release();
    await this.bothArrived;
  }
}

describe("MinioObjectStorage", () => {
  it("initializes an existing bucket once and preserves put metadata", async () => {
    const client = new FakeMinioClient();
    const storage = new MinioObjectStorage(client, "imports");
    const first = Buffer.from("first");
    const second = Buffer.from("second");

    await Promise.all([
      storage.putObject({ key: "one.csv", bytes: first, contentType: "text/csv" }),
      storage.putObject({ key: "two.xlsx", bytes: second, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
    ]);

    expect(client.bucketExistsCalls).toEqual(["imports"]);
    expect(client.makeBucketCalls).toEqual([]);
    expect(client.putCalls).toEqual([
      { bucket: "imports", key: "one.csv", bytes: first, size: first.length, metadata: { "Content-Type": "text/csv" } },
      { bucket: "imports", key: "two.xlsx", bytes: second, size: second.length, metadata: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } }
    ]);
  });

  it("creates a missing bucket only once", async () => {
    const client = new FakeMinioClient();
    client.bucketExistsResult = false;
    const storage = new MinioObjectStorage(client, "imports");

    await storage.putObject({ key: "one.csv", bytes: Buffer.from("one"), contentType: "text/csv" });
    await storage.putObject({ key: "two.csv", bytes: Buffer.from("two"), contentType: "text/csv" });

    expect(client.bucketExistsCalls).toEqual(["imports"]);
    expect(client.makeBucketCalls).toEqual(["imports"]);
  });

  it("treats a cross-adapter BucketAlreadyOwnedByYou race as idempotent success", async () => {
    const race = new BucketCreationRace();
    const owner = new RacingMinioClient(race, null);
    const follower = new RacingMinioClient(
      race,
      Object.assign(new Error("bucket was created concurrently"), { code: "BucketAlreadyOwnedByYou" })
    );
    const ownerStorage = new MinioObjectStorage(owner, "imports");
    const followerStorage = new MinioObjectStorage(follower, "imports");

    const results = await Promise.allSettled([
      ownerStorage.putObject({ key: "owner.csv", bytes: Buffer.from("owner"), contentType: "text/csv" }),
      followerStorage.putObject({ key: "follower.csv", bytes: Buffer.from("follower"), contentType: "text/csv" })
    ]);

    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(owner.putCalls.map((call) => call.key)).toEqual(["owner.csv"]);
    expect(follower.putCalls.map((call) => call.key)).toEqual(["follower.csv"]);
  });

  it("does not swallow BucketAlreadyExists from a bucket owned by another account", async () => {
    const client = new FakeMinioClient();
    client.bucketExistsResult = false;
    const conflict = Object.assign(new Error("bucket belongs to another account"), { code: "BucketAlreadyExists" });
    client.makeBucketFailure = conflict;
    const storage = new MinioObjectStorage(client, "imports");

    await expect(storage.putObject({ key: "one.csv", bytes: Buffer.from("one"), contentType: "text/csv" }))
      .rejects.toEqual(expect.objectContaining({
        name: "ObjectStorageError",
        message: "Unable to store import file",
        cause: conflict
      }));
    expect(client.putCalls).toEqual([]);
  });

  it("clears a rejected bucket initialization so a later operation can retry", async () => {
    const client = new FakeMinioClient();
    const transient = new Error("temporary bucket outage");
    client.bucketExistsFailures.push(transient);
    const storage = new MinioObjectStorage(client, "imports");

    await expect(storage.putObject({ key: "one.csv", bytes: Buffer.from("one"), contentType: "text/csv" }))
      .rejects.toMatchObject({ name: "ObjectStorageError", message: "Unable to store import file", cause: transient });
    await storage.putObject({ key: "two.csv", bytes: Buffer.from("two"), contentType: "text/csv" });

    expect(client.bucketExistsCalls).toEqual(["imports", "imports"]);
    expect(client.putCalls.map((call) => call.key)).toEqual(["two.csv"]);
  });

  it("wraps bucket creation and put failures at the storage boundary", async () => {
    const client = new FakeMinioClient();
    client.bucketExistsResult = false;
    const makeFailure = new Error("make failed");
    client.makeBucketFailure = makeFailure;
    const storage = new MinioObjectStorage(client, "imports");

    await expect(storage.putObject({ key: "one.csv", bytes: Buffer.from("one"), contentType: "text/csv" }))
      .rejects.toEqual(expect.objectContaining({ name: "ObjectStorageError", message: "Unable to store import file", cause: makeFailure }));

    client.makeBucketFailure = null;
    client.bucketExistsResult = true;
    const putFailure = new Error("put failed");
    client.putFailure = putFailure;
    await expect(storage.putObject({ key: "two.csv", bytes: Buffer.from("two"), contentType: "text/csv" }))
      .rejects.toEqual(expect.objectContaining({ name: "ObjectStorageError", message: "Unable to store import file", cause: putFailure }));
  });

  it.each(["NoSuchKey", "NotFound", "NoSuchObject"])("returns missing for stat code %s", async (code) => {
    const client = new FakeMinioClient();
    client.statFailure = Object.assign(new Error("missing"), { code });
    const storage = new MinioObjectStorage(client, "imports");

    expect(await storage.deleteObject("missing.csv")).toBe("missing");
    expect(client.removeCalls).toEqual([]);
  });

  it("returns deleted after a successful stat and removal", async () => {
    const client = new FakeMinioClient();
    const storage = new MinioObjectStorage(client, "imports");

    expect(await storage.deleteObject("one.csv")).toBe("deleted");
    expect(client.statCalls).toEqual([{ bucket: "imports", key: "one.csv" }]);
    expect(client.removeCalls).toEqual([{ bucket: "imports", key: "one.csv" }]);
  });

  it("wraps generic stat failures as inspect errors", async () => {
    const client = new FakeMinioClient();
    const failure = new Error("stat failed");
    client.statFailure = failure;
    const storage = new MinioObjectStorage(client, "imports");

    await expect(storage.deleteObject("one.csv")).rejects.toEqual(expect.objectContaining({
      name: "ObjectStorageError",
      message: "Unable to inspect import file",
      cause: failure
    }));
  });

  it("wraps removal failures as delete errors", async () => {
    const client = new FakeMinioClient();
    const failure = new Error("remove failed");
    client.removeFailure = failure;
    const storage = new MinioObjectStorage(client, "imports");

    await expect(storage.deleteObject("one.csv")).rejects.toEqual(expect.objectContaining({
      name: "ObjectStorageError",
      message: "Unable to delete import file",
      cause: failure
    }));
  });

  it("never leaks a bucket initialization error from deleteObject", async () => {
    const client = new FakeMinioClient();
    const failure = new Error("bucket failed");
    client.bucketExistsFailures.push(failure);
    const storage = new MinioObjectStorage(client, "imports");

    await expect(storage.deleteObject("one.csv")).rejects.toBeInstanceOf(ObjectStorageError);
    await expect(storage.deleteObject("one.csv")).resolves.toBe("deleted");
    expect(client.bucketExistsCalls).toEqual(["imports", "imports"]);
  });
});
