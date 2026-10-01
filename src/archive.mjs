import { filenameOf, valueOf, fileInfo, checkIdentity, copyFile } from "./download.mjs";
import {
  ENTRY_LIMIT,
  safeComponent,
  zipEntry,
  zipBudget,
  zipSize,
  crc32,
  localHeader,
  descriptor,
  centralHeader,
  endRecord,
} from "./zip.mjs";

export function archiveName(path) {
  const basename = filenameOf(path.replace(/[\\/]+$/, ""));
  const root =
    !path || basename === "." || /^[A-Za-z]:$/.test(basename) || !path.replace(/[\\/]/g, "")
      ? "workspace"
      : basename;
  return `${root}.zip`;
}

async function listDirectory(remote, sessionId, path, signal) {
  signal.throwIfAborted();
  const listing = valueOf(await remote.list(sessionId, path || ".", signal));
  signal.throwIfAborted();
  if (
    !listing ||
    typeof listing.path !== "string" ||
    !Array.isArray(listing.entries) ||
    typeof listing.truncated !== "boolean"
  ) {
    throw new Error("The server returned an invalid folder listing.");
  }
  if (listing.truncated)
    throw new Error(
      "Harness truncated a folder listing. Increase its maxEntries setting before downloading this folder.",
    );
  if (listing.path) listing.path.split("/").forEach(safeComponent);
  const names = new Set();
  const entries = listing.entries
    .map((entry) => {
      safeComponent(entry?.name);
      if (names.has(entry.name)) throw new Error("The server returned duplicate folder entries.");
      names.add(entry.name);
      if (!["file", "directory"].includes(entry.type))
        throw new Error("This folder contains a symlink or special entry that cannot be archived.");
      return { name: entry.name, type: entry.type };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { path: listing.path, entries };
}

export async function planArchive(remote, sessionId, path, signal) {
  const name = archiveName(path);
  const root = name.slice(0, -4);
  const entries = [zipEntry(`${root}/`, true)];
  const directories = [];
  const budget = zipBudget();
  budget.add(entries[0]);
  async function visit(requestPath, archivePath, depth) {
    if (depth > 64) throw new Error("Folders nested more than 64 levels are not supported.");
    const listing = await listDirectory(remote, sessionId, requestPath, signal);
    directories.push(listing);
    for (const child of listing.entries) {
      signal.throwIfAborted();
      if (entries.length >= ENTRY_LIMIT)
        throw new Error("Folders with more than 10,000 ZIP entries are not supported.");
      const childPath = listing.path ? `${listing.path}/${child.name}` : child.name;
      const directory = child.type === "directory";
      const info = directory ? undefined : await fileInfo(remote, sessionId, childPath, signal);
      const relative = `${archivePath}/${child.name}`;
      const entry = zipEntry(relative + (directory ? "/" : ""), directory, info, childPath);
      // Check size and metadata limits during enumeration, before opening a writer.
      budget.add(entry);
      entries.push(entry);
      if (directory) await visit(childPath, relative, depth + 1);
    }
  }
  await visit(path || ".", root, 0);
  return { name, bytes: budget.bytes, entries, directories };
}

export async function copyArchive(remote, sessionId, plan, writer, signal, progress) {
  let written = 0;
  const central = [];
  const write = async (data) => {
    signal.throwIfAborted();
    await writer.write(data);
    signal.throwIfAborted();
    written += data.length;
    progress(written, plan.bytes);
  };
  try {
    assertPlan(plan);
    for (const entry of plan.entries) {
      const offset = written;
      await write(localHeader(entry));
      let crc = 0xffffffff;
      if (!entry.directory) {
        await copyFile(
          remote,
          sessionId,
          entry.path,
          entry.info,
          {
            async write(data) {
              crc = crc32(data, crc);
              await write(data);
            },
            async close() {},
            async abort() {
              await writer.abort();
            },
          },
          signal,
          () => {},
        );
        crc = (crc ^ 0xffffffff) >>> 0;
        await write(descriptor(crc, entry.bytes));
      } else crc = 0;
      central.push(centralHeader(entry, crc, offset));
    }
    // Recheck every directory and file before committing the complete archive.
    for (const expected of plan.directories) {
      const current = await listDirectory(remote, sessionId, expected.path, signal);
      if (JSON.stringify(current) !== JSON.stringify(expected))
        throw new Error("The folder changed during the download. Please try again.");
    }
    for (const entry of plan.entries) {
      if (!entry.directory)
        checkIdentity(await fileInfo(remote, sessionId, entry.path, signal), entry.info);
    }
    const offset = written;
    for (const header of central) await write(header);
    const size = written - offset;
    await write(endRecord(plan.entries.length, size, offset));
    if (written !== plan.bytes) throw new Error("The archive size did not match its plan.");
    signal.throwIfAborted();
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => {});
    throw error;
  }
}

function assertPlan(plan) {
  if (zipSize(plan.entries) !== plan.bytes) throw new Error("The archive plan is invalid.");
}
