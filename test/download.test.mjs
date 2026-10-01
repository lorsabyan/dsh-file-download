import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  BUFFER_LIMIT,
  CHUNK_BYTES,
  filenameOf,
  fileInfo,
  copyFile,
  bufferedWriter,
} from "../src/download.mjs";

const digest = (data) => createHash("sha256").update(data).digest("hex");
function source(data) {
  const info = { version: "v1", absolutePath: "/workspace/a.bin", bytes: data.length };
  const requests = [];
  const remote = {
    async stat(session, path, signal) {
      signal.throwIfAborted();
      return { ok: true, value: { ...info } };
    },
    async readBytes(session, path, { range }, signal) {
      signal.throwIfAborted();
      requests.push(range);
      const part = data.subarray(range.offset, range.offset + range.length);
      return {
        ok: true,
        value: {
          ...info,
          offset: range.offset,
          data: part,
          eof: range.offset + part.length === data.length,
        },
      };
    },
  };
  return { remote, info, requests };
}

test("binary and Unicode content downloads byte-for-byte across chunk boundaries", async () => {
  const bytes = Buffer.alloc(CHUNK_BYTES * 2 + 79);
  for (let n = 0; n < bytes.length; n++) bytes[n] = n % 251;
  Buffer.from("Հայերեն\0DOCX/PDF/XLSX\n").copy(bytes, CHUNK_BYTES - 10);
  const { remote, info, requests } = source(bytes);
  const writer = bufferedWriter();
  await copyFile(remote, "session", "a.bin", info, writer, new AbortController().signal, () => {});
  assert.equal(digest(Buffer.from(await writer.blob().arrayBuffer())), digest(bytes));
  assert.equal(requests.length, 3);
});

test("empty files are valid downloads", async () => {
  const { remote, info } = source(Buffer.alloc(0));
  const writer = bufferedWriter();
  await copyFile(remote, "session", "a.bin", info, writer, new AbortController().signal, () => {});
  assert.equal(writer.blob().size, 0);
});

test("40 MiB file streams without a complete-file read or growing destination buffer", async () => {
  const bytes = Buffer.alloc(40 * 1024 * 1024, 179);
  const { remote, info, requests } = source(bytes);
  const hash = createHash("sha256");
  let count = 0,
    closed = false;
  const writer = {
    async write(part) {
      hash.update(part);
      count += part.length;
    },
    async close() {
      closed = true;
    },
    async abort() {},
  };
  await copyFile(remote, "session", "a.bin", info, writer, new AbortController().signal, () => {});
  assert.equal(hash.digest("hex"), digest(bytes));
  assert.equal(count, bytes.length);
  assert.equal(closed, true);
  assert.equal(requests.length, 40);
  assert.ok(requests.every((r) => r.length <= CHUNK_BYTES));
});

test("changing source aborts the destination instead of completing a mixed file", async () => {
  const { remote, info } = source(Buffer.alloc(CHUNK_BYTES * 2, 1));
  const read = remote.readBytes;
  remote.readBytes = async (...args) => {
    const page = await read(...args);
    if (page.value.offset) page.value.version = "v2";
    return page;
  };
  let aborted = false,
    closed = false;
  const writer = {
    async write() {},
    async close() {
      closed = true;
    },
    async abort() {
      aborted = true;
    },
  };
  await assert.rejects(
    copyFile(remote, "session", "a.bin", info, writer, new AbortController().signal, () => {}),
    /changed/,
  );
  assert.equal(aborted, true);
  assert.equal(closed, false);
});

test("truncated, offset-mismatched and malformed reads never complete", async () => {
  for (const corrupt of [
    (p) => {
      p.eof = true;
    },
    (p) => {
      p.offset++;
    },
    (p) => {
      p.data = new Uint8Array();
    },
  ]) {
    const { remote, info } = source(Buffer.alloc(CHUNK_BYTES * 2, 1));
    const read = remote.readBytes;
    remote.readBytes = async (...args) => {
      const page = await read(...args);
      corrupt(page.value);
      return page;
    };
    const writer = bufferedWriter();
    await assert.rejects(
      copyFile(remote, "session", "a.bin", info, writer, new AbortController().signal, () => {}),
      /incomplete/,
    );
    assert.throws(() => writer.blob(), /incomplete/);
  }
});

test("a final stat detects changes after the last chunk", async () => {
  const { remote, info } = source(Buffer.from("last chunk"));
  let stats = 0;
  remote.stat = async () => ({
    ok: true,
    value: { ...info, version: ++stats === 2 ? "changed" : "v1" },
  });
  const writer = bufferedWriter();
  await assert.rejects(
    copyFile(remote, "session", "a.bin", info, writer, new AbortController().signal, () => {}),
    /changed/,
  );
  assert.throws(() => writer.blob(), /incomplete/);
});

test("cancellation aborts the destination, and a disconnected server remains an error", async () => {
  const { remote, info } = source(Buffer.alloc(CHUNK_BYTES * 2, 1));
  const controller = new AbortController();
  const writer = bufferedWriter();
  await assert.rejects(
    copyFile(remote, "session", "a.bin", info, writer, controller.signal, () => controller.abort()),
    { name: "AbortError" },
  );
  assert.throws(() => writer.blob(), /incomplete/);
  const other = source(Buffer.from("file"));
  other.remote.readBytes = async () => {
    throw new Error("Disconnected");
  };
  await assert.rejects(
    copyFile(
      other.remote,
      "session",
      "a.bin",
      other.info,
      bufferedWriter(),
      new AbortController().signal,
      () => {},
    ),
    /Disconnected/,
  );
});

test("buffer limit prevents accidental unbounded fallback downloads", async () => {
  const writer = bufferedWriter(2);
  await assert.rejects(writer.write(new Uint8Array(3)), /larger than 32 MiB/);
  assert.equal(BUFFER_LIMIT, 32 * 1024 * 1024);
});

test("native Remote error envelopes abort the download without saving a file", async () => {
  const { remote, info } = source(Buffer.from("file"));
  remote.readBytes = async () => ({ ok: false, error: { message: "Permission denied" } });
  const writer = bufferedWriter();
  await assert.rejects(
    copyFile(remote, "session", "a.bin", info, writer, new AbortController().signal, () => {}),
    /Permission denied/,
  );
  assert.throws(() => writer.blob(), /incomplete/);
});

test("filename extraction preserves spaces, Armenian and punctuation", () => {
  assert.equal(filenameOf("/workspace/Հայերեն & report.pdf"), "Հայերեն & report.pdf");
  assert.equal(filenameOf("C:\\work\\hello.docx"), "hello.docx");
  assert.equal(filenameOf("/workspace/bad\nname.bin"), "bad_name.bin");
});

test("invalid metadata is rejected before any file read", async () => {
  for (const info of [
    null,
    {},
    { bytes: -1 },
    { bytes: 1.5 },
    { bytes: Number.MAX_SAFE_INTEGER + 1 },
    { bytes: 1, version: 1, absolutePath: "/a" },
    { bytes: 1, version: "v1", absolutePath: 42 },
  ]) {
    const remote = {
      async stat() {
        return { ok: true, value: info };
      },
    };
    await assert.rejects(
      fileInfo(remote, "owner", "/a", new AbortController().signal),
      /valid file size/,
    );
  }
});

test("cancellation while stat is pending prevents a save picker or subsequent reads", async () => {
  const controller = new AbortController();
  const remote = {
    async stat() {
      controller.abort();
      return { ok: true, value: { bytes: 1, version: "v1", absolutePath: "/a" } };
    },
  };
  await assert.rejects(fileInfo(remote, "owner", "/a", controller.signal), { name: "AbortError" });
});

test("an aborted or closed buffer cannot accept more data or complete again", async () => {
  for (const end of ["abort", "close"]) {
    const writer = bufferedWriter();
    await writer.write(new Uint8Array([1]));
    await writer[end]();
    await assert.rejects(writer.write(new Uint8Array([2])), /no longer writable/);
    await assert.rejects(writer.close(), /no longer writable/);
    if (end === "abort") assert.throws(() => writer.blob(), /incomplete/);
  }
});
