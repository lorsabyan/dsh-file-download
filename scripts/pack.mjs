import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const dist = path.join(root, "dist");
await mkdir(dist, { recursive: true });
const cache = mkdtempSync(path.join(tmpdir(), "dsh-file-download-pack-"));
try {
  execFileSync("npm", ["pack", "--pack-destination", dist, "--cache", cache], {
    cwd: root,
    stdio: "inherit",
  });
} finally {
  rmSync(cache, { recursive: true, force: true });
}
const filename = `${pkg.name}-${pkg.version}.tgz`;
const hash = createHash("sha256")
  .update(await readFile(path.join(dist, filename)))
  .digest("hex");
await writeFile(path.join(dist, "SHA256SUMS"), `${hash}  ${filename}\n`);
console.log(`Release archive: dist/${filename}`);
