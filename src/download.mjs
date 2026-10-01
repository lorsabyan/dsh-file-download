export const CHUNK_BYTES = 1024 * 1024;
export const BUFFER_LIMIT = 32 * 1024 * 1024;

export function filenameOf(path) {
  return (
    path
      .split(/[\\/]/)
      .pop()
      .replace(/[\u0000-\u001f\u007f]/g, "_") || "download"
  );
}

export function checkIdentity(info, expected) {
  if (
    info.version !== expected.version ||
    info.absolutePath !== expected.absolutePath ||
    info.bytes !== expected.bytes
  ) {
    throw new Error("The file changed during the download. Please try again.");
  }
}

export function valueOf(result) {
  if (result?.ok === true) return result.value;
  if (result?.ok === false) {
    throw result.error instanceof Error
      ? result.error
      : new Error(result.error?.message || "The server refused this file.");
  }
  throw new Error("The server returned an invalid file response.");
}

export async function fileInfo(remote, sessionId, path, signal) {
  signal.throwIfAborted();
  const info = valueOf(await remote.stat(sessionId, path, signal));
  signal.throwIfAborted();
  if (
    !info ||
    !Number.isSafeInteger(info.bytes) ||
    info.bytes < 0 ||
    typeof info.version !== "string" ||
    typeof info.absolutePath !== "string" ||
    !info.absolutePath
  ) {
    throw new Error("The server did not report a valid file size.");
  }
  return info;
}

// File access uses Harness's existing authenticated Remote.
// Ranged reads keep each transfer request bounded.
export async function copyFile(remote, sessionId, path, expected, writer, signal, progress) {
  try {
    checkIdentity(await fileInfo(remote, sessionId, path, signal), expected);
    let offset = 0;
    while (offset < expected.bytes) {
      signal.throwIfAborted();
      const page = valueOf(
        await remote.readBytes(
          sessionId,
          path,
          {
            range: { offset, length: Math.min(CHUNK_BYTES, expected.bytes - offset) },
          },
          signal,
        ),
      );
      signal.throwIfAborted();
      checkIdentity(page, expected);
      if (
        !(page.data instanceof Uint8Array) ||
        page.offset !== offset ||
        page.data.length === 0 ||
        page.data.length > Math.min(CHUNK_BYTES, expected.bytes - offset) ||
        page.eof !== (offset + page.data.length === expected.bytes)
      ) {
        throw new Error("The server returned an incomplete file. Please try again.");
      }
      await writer.write(page.data);
      offset += page.data.length;
      progress(offset, expected.bytes);
    }
    signal.throwIfAborted();
    checkIdentity(await fileInfo(remote, sessionId, path, signal), expected);
    signal.throwIfAborted();
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => {});
    throw error;
  }
}

export function bufferedWriter(limit = BUFFER_LIMIT) {
  const chunks = [];
  let size = 0;
  let complete = false;
  let ended = false;
  return {
    async write(data) {
      if (ended) throw new Error("Download is no longer writable.");
      if (size + data.length > limit)
        throw new Error(
          "This browser needs a save dialog for files larger than 32 MiB. Use Chrome or Edge.",
        );
      chunks.push(data.slice());
      size += data.length;
    },
    async close() {
      if (ended) throw new Error("Download is no longer writable.");
      ended = true;
      complete = true;
    },
    async abort() {
      chunks.length = 0;
      size = 0;
      complete = false;
      ended = true;
    },
    blob() {
      if (!complete) throw new Error("Download is incomplete.");
      return new Blob(chunks, { type: "application/octet-stream" });
    },
  };
}
