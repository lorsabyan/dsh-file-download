import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import { createHash } from "node:crypto";
import { planArchive, copyArchive, archiveName } from "../src/archive.mjs";
import { bufferedWriter, CHUNK_BYTES } from "../src/download.mjs";
import { crc32, zipEntry, zipSize, ZIP_LIMIT, ENTRY_LIMIT } from "../src/zip.mjs";
import { directorySource } from "./fixtures/archive.mjs";

const signal = () => new AbortController().signal;
const hash = (data) => createHash("sha256").update(data).digest("hex");
async function archive(source, path = "/workspace/project") {
  const plan = await planArchive(source.remote, "owner", path, signal());
  const writer = bufferedWriter();
  const progress = [];
  await copyArchive(source.remote, "owner", plan, writer, signal(), (done, total) =>
    progress.push({ done, total }),
  );
  const bytes = new Uint8Array(await writer.blob().arrayBuffer());
  assert.equal(bytes.length, plan.bytes);
  assert.equal(progress.at(-1).done, plan.bytes);
  return { plan, bytes, unpacked: unzipSync(bytes) };
}

test("recursive ZIP round-trips binary, Unicode, hidden files, empty files and empty folders", async () => {
  const data = new Uint8Array(CHUNK_BYTES + 73).map((_, n) => n % 251);
  const source = directorySource(
    {
      "project/report.docx": data,
      "project/.hidden": "hidden file",
      "project/nested/Հայերեն & spaces.txt": "Բարև աշխարհ\n",
      "project/empty.bin": new Uint8Array(),
    },
    ["project/empty-folder"],
  );
  const { unpacked, plan } = await archive(source);
  assert.equal(plan.name, "project.zip");
  assert.deepEqual(
    Object.keys(unpacked).sort(),
    [
      "project/",
      "project/.hidden",
      "project/empty-folder/",
      "project/empty.bin",
      "project/nested/",
      "project/nested/Հայերեն & spaces.txt",
      "project/report.docx",
    ].sort(),
  );
  assert.equal(hash(unpacked["project/report.docx"]), hash(data));
  assert.equal(
    new TextDecoder().decode(unpacked["project/nested/Հայերեն & spaces.txt"]),
    "Բարև աշխարհ\n",
  );
  assert.ok(source.calls.every((call) => call.sessionId === "owner"));
  assert.equal(
    source.calls.filter((call) => call.operation === "read" && call.path.endsWith("report.docx"))
      .length,
    2,
  );
});

test("an empty directory creates a valid archive containing its root folder", async () => {
  const { unpacked } = await archive(directorySource());
  assert.deepEqual(Object.keys(unpacked), ["project/"]);
});

test("archive names preserve Unicode and handle workspace and Windows paths", () => {
  assert.equal(archiveName("/workspace/Հայերեն & report"), "Հայերեն & report.zip");
  assert.equal(archiveName("C:\\work\\folder\\"), "folder.zip");
  for (const root of ["", ".", "/", "C:\\"]) assert.equal(archiveName(root), "workspace.zip");
});

test("CRC-32 matches the standard test vector across independently written chunks", () => {
  const data = new TextEncoder().encode("123456789");
  const crc = crc32(data.subarray(4), crc32(data.subarray(0, 4)));
  assert.equal((crc ^ 0xffffffff) >>> 0, 0xcbf43926);
});

test("40 MiB archive streams sequentially with bounded writes and destination backpressure", async () => {
  const source = directorySource({
    "project/large.bin": new Uint8Array(40 * 1024 * 1024).fill(179),
  });
  const plan = await planArchive(source.remote, "owner", "project", signal());
  let written = 0,
    closed = false,
    writing = false;
  const writer = {
    async write(data) {
      assert.equal(writing, false);
      writing = true;
      assert.ok(data.length <= CHUNK_BYTES);
      await new Promise((resolve) => setTimeout(resolve, 0));
      written += data.length;
      writing = false;
    },
    async close() {
      closed = true;
    },
    async abort() {
      assert.fail("Successful archive must not abort");
    },
  };
  await copyArchive(source.remote, "owner", plan, writer, signal(), () => {});
  assert.equal(written, plan.bytes);
  assert.equal(closed, true);
  assert.equal(source.calls.filter((call) => call.operation === "read").length, 40);
});

test("truncated listings never silently create incomplete archives", async () => {
  const source = directorySource();
  const list = source.remote.list;
  source.remote.list = async (...args) => {
    const result = await list(...args);
    result.value.truncated = true;
    return result;
  };
  await assert.rejects(planArchive(source.remote, "owner", "project", signal()), /truncated/);
});

test("unsafe or duplicate names and special entries fail before reading file content", async () => {
  for (const entries of [
    [{ name: "../escape", type: "file" }],
    [{ name: "C:escape", type: "file" }],
    [{ name: "bad\\path", type: "file" }],
    [{ name: "..", type: "directory" }],
    [{ name: "bad\0name", type: "file" }],
    [{ name: "bad\ud800name", type: "file" }],
    [
      { name: "a", type: "directory" },
      { name: "a", type: "directory" },
    ],
    [{ name: "link", type: "other" }],
  ]) {
    const remote = {
      async list() {
        return { ok: true, value: { path: "project", entries, truncated: false } };
      },
    };
    await assert.rejects(
      planArchive(remote, "owner", "project", signal()),
      /safely|duplicate|special/,
    );
  }
});

test("native symlink and unreadable-file errors abort archive planning", async () => {
  for (const type of ["file", "directory"]) {
    let calls = 0;
    const remote = {
      async list() {
        if (calls++) return { ok: false, error: { message: "Symlink directory is not allowed" } };
        return {
          ok: true,
          value: { path: "project", entries: [{ name: "link", type }], truncated: false },
        };
      },
      async stat() {
        return { ok: false, error: { message: "Permission denied or symlink file" } };
      },
    };
    await assert.rejects(planArchive(remote, "owner", "project", signal()), /[Ss]ymlink/);
  }
});

test("changed directory membership or earlier file contents aborts the complete archive", async () => {
  for (const change of ["membership", "contents"]) {
    const source = directorySource({ "project/a.txt": "a", "project/z.txt": "z" });
    const plan = await planArchive(source.remote, "owner", "project", signal());
    const read = source.remote.readBytes;
    source.remote.readBytes = async (...args) => {
      const result = await read(...args);
      if (args[1].endsWith("z.txt"))
        source.setFile(change === "membership" ? "project/new.txt" : "project/a.txt", "b");
      return result;
    };
    const writer = bufferedWriter();
    await assert.rejects(
      copyArchive(source.remote, "owner", plan, writer, signal(), () => {}),
      /changed/,
    );
    assert.throws(() => writer.blob(), /incomplete/);
  }
});

test("canceling during enumeration or streaming aborts without completing a ZIP", async () => {
  const source = directorySource({ "project/a.bin": new Uint8Array(CHUNK_BYTES * 2) });
  const before = new AbortController();
  before.abort();
  await assert.rejects(planArchive(source.remote, "owner", "project", before.signal), {
    name: "AbortError",
  });
  const plan = await planArchive(source.remote, "owner", "project", signal());
  const controller = new AbortController();
  const writer = bufferedWriter();
  await assert.rejects(
    copyArchive(source.remote, "owner", plan, writer, controller.signal, (done) => {
      if (done > CHUNK_BYTES) controller.abort();
    }),
    { name: "AbortError" },
  );
  assert.throws(() => writer.blob(), /incomplete/);
});

test("archive format and metadata limits are enforced before a destination is opened", () => {
  const directory = zipEntry("project/", true);
  const large = zipEntry("project/large.bin", false, { bytes: ZIP_LIMIT - 100 });
  assert.throws(() => zipSize([directory, large]), /ZIP32/);
  assert.throws(() => zipSize(Array(ENTRY_LIMIT + 1).fill(directory)), /10,000/);
  const long = zipEntry(`project/${"x".repeat(65000)}/`, true);
  assert.throws(() => zipSize(Array(65).fill(long)), /metadata/);
});
