import { describe, expect, it } from "vitest";
import {
  ObjectStorageError,
  unavailableObjectStorage
} from "../src/storage/object-storage.js";
import { FakeObjectStorage } from "./support/fake-object-storage.js";

describe("object storage port", () => {
  it("preserves a typed error name and cause", () => {
    const cause = new Error("sdk failed");
    const error = new ObjectStorageError("Unable to store import file", cause);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ObjectStorageError");
    expect(error.message).toBe("Unable to store import file");
    expect(error.cause).toBe(cause);
  });

  it("provides stable unavailable storage failures", async () => {
    await expect(unavailableObjectStorage.putObject({
      key: "imports/a.csv",
      bytes: Buffer.from("bytes"),
      contentType: "text/csv"
    })).rejects.toMatchObject({ name: "ObjectStorageError", message: "Unable to store import file" });
    await expect(unavailableObjectStorage.deleteObject("imports/a.csv"))
      .rejects.toMatchObject({ name: "ObjectStorageError", message: "Unable to delete import file" });
  });
});

describe("FakeObjectStorage", () => {
  it("copies uploaded bytes so later caller mutation cannot change the stored object", async () => {
    const storage = new FakeObjectStorage();
    const bytes = Buffer.from("before");

    await storage.putObject({ key: "imports/a.csv", bytes, contentType: "text/csv" });
    bytes.fill(0);

    expect(storage.objects.get("imports/a.csv")).toMatchObject({
      key: "imports/a.csv",
      contentType: "text/csv"
    });
    expect(storage.objects.get("imports/a.csv")?.bytes.toString()).toBe("before");
  });

  it("surfaces the configured put failure without storing the object", async () => {
    const storage = new FakeObjectStorage();
    const failure = new Error("put failed");
    storage.putFailure = failure;

    await expect(storage.putObject({
      key: "imports/a.csv",
      bytes: Buffer.from("bytes"),
      contentType: "text/csv"
    })).rejects.toBe(failure);
    expect(storage.objects.size).toBe(0);
  });

  it("returns deleted or missing and supports deterministic delete failures", async () => {
    const storage = new FakeObjectStorage();
    await storage.putObject({ key: "imports/a.csv", bytes: Buffer.from("bytes"), contentType: "text/csv" });

    expect(await storage.deleteObject("imports/a.csv")).toBe("deleted");
    expect(await storage.deleteObject("imports/a.csv")).toBe("missing");

    storage.deleteFailures.add("imports/failing.csv");
    await expect(storage.deleteObject("imports/failing.csv")).rejects.toThrow("delete failed");
  });
});
