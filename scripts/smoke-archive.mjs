import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, open, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { planArchive, copyArchive } from "../src/archive.mjs";
import { bufferedWriter, CHUNK_BYTES } from "../src/download.mjs";

const binary = process.platform === "win32" ? "dsh.cmd" : "dsh";
const dsh =
  process.env.DSH_BIN ||
  (process.env.PATH || "")
    .split(path.delimiter)
    .map((dir) => path.join(dir, binary))
    .find(existsSync);
assert.ok(dsh, "Harness must be available on PATH, or supplied as DSH_BIN");
const hostRequire = createRequire(await realpath(dsh));
const hostImport = (name) => import(pathToFileURL(hostRequire.resolve(name)).href);
const { Context } = await hostImport("@deepseek-ai/cordis");
const { LocalFileSystem } = await hostImport("@deepseek-ai/dsh-fs-local");
const { WorkspaceFiles } = await hostImport("@deepseek-ai/dsh-api-workspace-files");
const temp = await mkdtemp(path.join(tmpdir(), "dsh-folder-archive-"));
const workspace = path.join(temp, "workspace");
await mkdir(path.join(workspace, "project", "nested"), { recursive: true });
await mkdir(path.join(workspace, "project", "empty-folder"));
const original = new TextEncoder().encode("Բարև աշխարհ\n");
await writeFile(path.join(workspace, "project", "nested", "Հայերեն & spaces.txt"), original);
await writeFile(path.join(workspace, "project", ".hidden"), "hidden");
await writeFile(path.join(workspace, "project", "empty.bin"), new Uint8Array());
const ctx = new Context();
let fiber;
try {
  fiber = await ctx.plugin(LocalFileSystem, { cwd: workspace });
  ctx.provide("sandboxPolicy", {
    workspaceRoot: workspace,
    resolve: () => ({ mode: "workspace-write", workspaceRoot: workspace }),
  });
  const endpoint = new WorkspaceFiles(ctx, {
    maxBytes: CHUNK_BYTES,
    maxFileBytes: CHUNK_BYTES,
    maxLines: 5000,
    maxEntries: 2000,
  });
  const scope = { sessionId: "archive-smoke", workspaceRoot: workspace };
  const remote = {
    async list(sessionId, target, signal) {
      return { ok: true, value: await endpoint.list(scope, target, signal) };
    },
    async stat(sessionId, target, signal) {
      return { ok: true, value: await endpoint.stat(scope, target, signal) };
    },
    async readBytes(sessionId, target, options, signal) {
      const value = await endpoint.readBytes(scope, target, options, signal);
      return {
        ok: true,
        value: {
          ...value,
          data: typeof value.data === "string" ? Buffer.from(value.data, "base64") : value.data,
        },
      };
    },
  };
  const signal = () => new AbortController().signal;
  const plan = await planArchive(
    remote,
    scope.sessionId,
    path.join(workspace, "project"),
    signal(),
  );
  const buffered = bufferedWriter();
  await copyArchive(remote, scope.sessionId, plan, buffered, signal(), () => {});
  const files = unzipSync(new Uint8Array(await buffered.blob().arrayBuffer()));
  assert.deepEqual(files["project/nested/Հայերեն & spaces.txt"], original);
  assert.equal(new TextDecoder().decode(files["project/.hidden"]), "hidden");
  assert.equal(files["project/empty.bin"].length, 0);
  assert.ok(Object.hasOwn(files, "project/empty-folder/"));

  const large = new Uint8Array(40 * 1024 * 1024).fill(179);
  await writeFile(path.join(workspace, "project", "large.bin"), large);
  const largePlan = await planArchive(remote, scope.sessionId, "project", signal());
  const destination = path.join(temp, "project.zip");
  const handle = await open(destination, "w");
  const writer = {
    async write(data) {
      assert.ok(data.length <= CHUNK_BYTES);
      await handle.writeFile(data);
    },
    async close() {
      await handle.close();
    },
    async abort() {
      await handle.close().catch(() => {});
      await rm(destination, { force: true });
    },
  };
  await copyArchive(remote, scope.sessionId, largePlan, writer, signal(), () => {});
  const unpacked = unzipSync(await readFile(destination));
  const digest = (data) => createHash("sha256").update(data).digest("hex");
  assert.equal(digest(unpacked["project/large.bin"]), digest(large));

  await symlink(
    path.join(workspace, "project", "large.bin"),
    path.join(workspace, "project", "link.bin"),
  );
  await assert.rejects(planArchive(remote, scope.sessionId, "project", signal()));
  console.log(
    "PASS: real Harness directory service; recursive Unicode/hidden/empty entries, 40 MiB streaming, and symlink refusal.",
  );
} finally {
  await fiber?.dispose();
  await rm(temp, { recursive: true, force: true });
}
