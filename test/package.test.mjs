import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import React from "react";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("prebuilt browser module registers the package ID and uses Harness's React", async () => {
  let loaded;
  const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
  vm.runInNewContext(source, {
    TextEncoder,
    TextDecoder,
    window: {
      __ModuleLoader__: {
        load(record) {
          loaded = record;
        },
      },
    },
  });
  assert.equal(loaded.id, pkg.name);
  const requested = [];
  const client = loaded.factory((name) => {
    requested.push(name);
    assert.equal(name, "react");
    return React;
  });
  assert.deepEqual(requested, ["react"]);
  assert.equal(typeof client.apply, "function");
  assert.deepEqual(Array.from(client.inject), ["remote", "remote.workspaceFiles", "slots"]);
});

test("bundle declares its portable activation patch and web services", async () => {
  assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml");
  const patch = await readFile(new URL("../cordis.patch.yml", import.meta.url), "utf8");
  assert.match(patch, /name: dsh-file-download\s/);
  assert.equal(pkg.dsh.client.platform, "web");
  assert.ok(pkg.dsh.client.inject.includes("@deepseek-ai/dsh-api-workspace-files"));
  assert.ok(pkg.dsh.client.inject.includes("@deepseek-ai/dsh-client-ui-sidebar-documentpreview"));
  assert.equal(pkg.dependencies, undefined, "release adds no runtime dependencies");
  assert.equal(pkg.scripts.prepare, undefined, "installing prebuilt code needs no prepare hook");
});

test("server entry activates without registering new server services", async () => {
  const server = await import("../lib/index.js");
  server.apply(
    new Proxy(
      {},
      {
        get() {
          assert.fail("Server entry unexpectedly accessed a service");
        },
      },
    ),
  );
});

test("release archive contains only the documented public runtime files", () => {
  const cache = mkdtempSync(path.join(tmpdir(), "dsh-file-download-pack-"));
  let pack;
  try {
    [pack] = JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json", "--cache", cache], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
  assert.deepEqual(
    pack.files.map((file) => file.path).sort(),
    [
      "CHANGELOG.md",
      "LICENSE",
      "README.md",
      "cordis.patch.yml",
      "lib/client.js",
      "lib/index.js",
      "package.json",
    ].sort(),
  );
  assert.equal(pack.name, "dsh-file-download");
  assert.ok(pack.unpackedSize < 100_000);
});
