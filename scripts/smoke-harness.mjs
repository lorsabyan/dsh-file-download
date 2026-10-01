import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const archive = path.resolve(
  process.argv[2] || path.join(root, "dist", `${pkg.name}-${pkg.version}.tgz`),
);
const dsh = process.env.DSH_BIN || "dsh";
const home = await mkdtemp(path.join(tmpdir(), "dsh-file-download-smoke-"));
const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: "1" };
const run = (...args) =>
  execFileSync(dsh, args, {
    env,
    cwd: home,
    encoding: "utf8",
    timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
let server;
try {
  await readFile(archive);
  run("plugin", "--profile", "web", "add", archive);
  assert.ok(run("--profile", "web", "--dump-config").includes(pkg.name), "Bundle layer is missing");
  server = spawn(dsh, ["--profile", "web", "--host", "127.0.0.1", "--port", "0", "--no-open"], {
    env,
    cwd: home,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "",
    failure;
  const collect = (data) => {
    log = (log + data.toString()).slice(-32_768);
  };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);
  server.on("error", (error) => {
    failure = error;
  });
  const deadline = Date.now() + 60_000;
  let launch;
  while (Date.now() < deadline) {
    if (failure) throw failure;
    assert.equal(server.exitCode, null, "Harness exited before serving the plugin");
    launch = log.match(/https?:\/\/127\.0\.0\.1:\d+[^\s"'<>]*/)?.[0];
    if (launch) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(launch, "Harness did not emit its localhost launch URL");
  const address = new URL(launch);
  const rootURL = `${address.origin}/`;
  assert.equal((await fetch(rootURL)).status, 401, "Fresh web profile must require authentication");
  const exchange = await fetch(address, { redirect: "manual" });
  assert.equal(exchange.status, 303, "Native launch token exchange failed");
  const cookie = exchange.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "Native launch did not set a session cookie");
  const page = await fetch(rootURL, { headers: { Cookie: cookie } });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes(pkg.name), "Browser boot manifest is missing the plugin");
  console.log("PASS: archive installation, native authentication, and browser boot manifest.");
  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("close", resolve));
  server = undefined;
  run("plugin", "--profile", "web", "remove", pkg.name);
  assert.ok(
    !run("--profile", "web", "--dump-config").includes(pkg.name),
    "Removal left the bundle active",
  );
  console.log("PASS: plugin removal clears its bundle layer.");
} finally {
  if (server && server.exitCode === null) {
    const closed = new Promise((resolve) => server.once("close", resolve));
    server.kill("SIGTERM");
    const timer = setTimeout(() => server.kill("SIGKILL"), 5_000);
    await closed;
    clearTimeout(timer);
  }
  await rm(home, { recursive: true, force: true });
}
