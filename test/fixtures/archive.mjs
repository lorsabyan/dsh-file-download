import assert from "node:assert/strict";

export function directorySource(initial = {}, emptyDirectories = [], root = "project") {
  const files = new Map();
  const directories = new Set([root, ...emptyDirectories]);
  const calls = [];
  const resolve = (path) => path.replace(/^\/workspace\/?/, "").replace(/^\.$/, "");
  const setFile = (name, data) => {
    const previous = files.get(name);
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    files.set(name, {
      data: bytes,
      info: {
        absolutePath: `/workspace/${name}`,
        version: String(Number(previous?.info.version || 0) + 1),
        bytes: bytes.length,
      },
    });
    let parent = name;
    while (parent.includes("/")) {
      parent = parent.slice(0, parent.lastIndexOf("/"));
      directories.add(parent);
    }
  };
  for (const [name, data] of Object.entries(initial)) setFile(name, data);
  const remote = {
    async list(sessionId, path, signal) {
      signal.throwIfAborted();
      const relative = resolve(path);
      calls.push({ operation: "list", sessionId, path });
      assert.ok(directories.has(relative), `Unknown fixture directory: ${relative}`);
      const prefix = relative ? `${relative}/` : "";
      const entries = [];
      for (const name of directories) {
        if (
          name.startsWith(prefix) &&
          name !== relative &&
          !name.slice(prefix.length).includes("/")
        )
          entries.push({ name: name.slice(prefix.length), type: "directory" });
      }
      for (const [name, file] of files) {
        if (name.startsWith(prefix) && !name.slice(prefix.length).includes("/"))
          entries.push({ name: name.slice(prefix.length), type: "file", size: file.info.bytes });
      }
      return { ok: true, value: { path: relative, entries, truncated: false } };
    },
    async stat(sessionId, path, signal) {
      signal.throwIfAborted();
      calls.push({ operation: "stat", sessionId, path });
      const file = files.get(resolve(path));
      assert.ok(file, `Unknown fixture file: ${path}`);
      return { ok: true, value: { ...file.info } };
    },
    async readBytes(sessionId, path, { range }, signal) {
      signal.throwIfAborted();
      calls.push({ operation: "read", sessionId, path, range });
      const file = files.get(resolve(path));
      const data = file.data.subarray(range.offset, range.offset + range.length);
      return {
        ok: true,
        value: {
          ...file.info,
          data,
          offset: range.offset,
          eof: range.offset + data.length === file.data.length,
        },
      };
    },
  };
  return { remote, files, directories, setFile, calls };
}
