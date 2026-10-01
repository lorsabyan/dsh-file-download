import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { install, apply } from "../src/client.mjs";
import { BUFFER_LIMIT } from "../src/download.mjs";
import { unzipSync } from "fflate";
import { directorySource } from "./fixtures/archive.mjs";

const BUTTON = "button[data-dsh-file-download]";
const FILE_BUTTON = 'button[data-dsh-download-kind="file"]';
let dom, ui, root, downloads, blobs, revoked;
const originalCreateURL = URL.createObjectURL;
const originalRevokeURL = URL.revokeObjectURL;

beforeEach(() => {
  dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: "https://harness.example/",
  });
  for (const key of ["window", "document", "Element", "MutationObserver"]) {
    globalThis[key] = key === "window" ? dom.window : dom.window[key];
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  downloads = [];
  blobs = [];
  revoked = [];
  URL.createObjectURL = (blob) => {
    blobs.push(blob);
    return `blob:test-${blobs.length}`;
  };
  URL.revokeObjectURL = (url) => revoked.push(url);
  dom.window.HTMLAnchorElement.prototype.click = function () {
    downloads.push({ name: this.download, href: this.href });
  };
});

afterEach(async () => {
  if (root) await act(() => root.unmount());
  ui?.dispose();
  dom.window.close();
  root = ui = undefined;
  URL.createObjectURL = originalCreateURL;
  URL.revokeObjectURL = originalRevokeURL;
  for (const key of [
    "window",
    "document",
    "Element",
    "MutationObserver",
    "IS_REACT_ACT_ENVIRONMENT",
  ]) {
    delete globalThis[key];
  }
});

function fileTree() {
  document.body.innerHTML = `<section data-sidebar-right-session="owner-session">
    <ul><li data-files-entry="file" data-files-path="/workspace/Հայերեն report.docx"><button>Open report</button></li>
    <li data-files-entry="directory" data-files-path="/workspace/folder"><button>Expand folder</button></li>
    <li data-files-entry="other" data-files-path="/workspace/link"><span>Other entry</span></li></ul>
  </section>`;
  return document.querySelector('[data-files-entry="file"]');
}

function remoteFile(data = new Uint8Array([0, 255, 17])) {
  const calls = [];
  const info = {
    version: "v1",
    absolutePath: "/workspace/Հայերեն report.docx",
    bytes: data.length,
  };
  return {
    calls,
    async stat(sessionId, path, signal) {
      signal.throwIfAborted();
      calls.push({ sessionId, path });
      return { ok: true, value: { ...info } };
    },
    async readBytes(sessionId, path, { range }, signal) {
      signal.throwIfAborted();
      const part = data.subarray(range.offset, range.offset + range.length);
      return {
        ok: true,
        value: {
          ...info,
          data: part,
          offset: range.offset,
          eof: range.offset + part.length === data.length,
        },
      };
    },
  };
}

async function until(predicate) {
  for (let n = 0; n < 100; n++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail("UI did not reach its expected state");
}
const status = () => document.querySelector("[data-dsh-download-status]")?.textContent || "";

test("concurrency is capped at two transfers and cancellation frees a slot", async () => {
  const row = fileTree();
  row.parentElement.append(row.cloneNode(true), row.cloneNode(true));
  const signals = [];
  ui = install({
    stat(sessionId, path, signal) {
      signals.push(signal);
      return new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
    },
  });
  const buttons = [...document.querySelectorAll(FILE_BUTTON)];
  buttons.forEach((button) => button.click());
  assert.equal(signals.length, 2);
  assert.match(status(), /Two downloads/);
  buttons[0].click();
  await until(() => !buttons[0].getAttribute("aria-label").startsWith("Cancel"));
  assert.equal(signals[0].aborted, true);
  buttons[2].click();
  assert.equal(signals.length, 3);
  ui.dispose();
  ui = undefined;
});

test("file and folder actions preserve native handlers and exclude special entries", async () => {
  const row = fileTree();
  let opened = 0,
    bubbled = 0;
  row.firstElementChild.addEventListener("click", () => opened++);
  row.addEventListener("click", () => bubbled++);
  const remote = remoteFile();
  ui = install(remote);
  assert.equal(document.querySelectorAll(BUTTON).length, 2);
  assert.equal(
    document
      .querySelector('[data-files-entry="directory"] button[data-dsh-file-download]')
      .getAttribute("aria-label"),
    "Download folder as ZIP",
  );
  assert.equal(
    document.querySelector('[data-files-entry="other"] button[data-dsh-file-download]'),
    null,
  );
  row.firstElementChild.click();
  assert.equal(opened, 1);
  assert.equal(bubbled, 1);
  row.querySelector(BUTTON).click();
  await until(() => downloads.length === 1);
  assert.equal(opened, 1);
  assert.equal(bubbled, 1);
  assert.equal(downloads[0].name, "Հայերեն report.docx");
  assert.deepEqual(new Uint8Array(await blobs[0].arrayBuffer()), new Uint8Array([0, 255, 17]));
  assert.ok(remote.calls.every((call) => call.sessionId === "owner-session"));
});

test("new rows and path/session refreshes receive one correctly labeled action", async () => {
  const row = fileTree();
  ui = install(remoteFile());
  row.setAttribute("data-files-path", "/workspace/renamed.pdf");
  const clone = row.cloneNode(true);
  clone.querySelector(BUTTON).remove();
  row.parentElement.append(clone);
  await until(() => document.querySelectorAll(FILE_BUTTON).length === 2);
  assert.equal(row.querySelector(BUTTON).getAttribute("aria-label"), "Download renamed.pdf");
  row.closest("section").removeAttribute("data-sidebar-right-session");
  await until(() => row.querySelector(BUTTON).disabled);
  row.closest("section").setAttribute("data-sidebar-right-session", "new-session");
  await until(() => !row.querySelector(BUTTON).disabled);
  assert.equal(document.querySelectorAll(FILE_BUTTON).length, 2);
});

test("preview downloads the original path using the resource owner's session", async () => {
  const host = document.createElement("div");
  host.dataset.textpreviewUrl = "dsh-resource://file/session/owner%20session/path/preview.pdf";
  document.body.append(host);
  const remote = remoteFile();
  ui = install(remote);
  root = createRoot(host);
  await act(() =>
    root.render(
      React.createElement(ui.PreviewDownload, {
        absolutePath: "/workspace/original.docx",
        sessionId: "viewer-session",
      }),
    ),
  );
  const button = host.querySelector(BUTTON);
  assert.equal(button.textContent, "Download");
  button.click();
  await until(() => downloads.length === 1);
  assert.equal(downloads[0].name, "original.docx");
  assert.ok(
    remote.calls.every(
      (call) => call.path === "/workspace/original.docx" && call.sessionId === "owner session",
    ),
  );
});

test("preview unmount cancels a pending metadata request", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  let pendingSignal;
  ui = install({
    stat(sessionId, path, signal) {
      pendingSignal = signal;
      return new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
    },
  });
  root = createRoot(host);
  await act(() =>
    root.render(
      React.createElement(ui.PreviewDownload, {
        absolutePath: "/workspace/a.pdf",
        sessionId: "owner",
      }),
    ),
  );
  host.querySelector(BUTTON).click();
  assert.equal(pendingSignal.aborted, false);
  await act(() => root.unmount());
  root = undefined;
  await until(() => pendingSignal.aborted);
  assert.equal(downloads.length, 0);
});

test("large files require a supported save picker without reading or buffering the file", async () => {
  const row = fileTree();
  let read = false;
  ui = install({
    async stat() {
      return {
        ok: true,
        value: { version: "v1", absolutePath: "/workspace/a.bin", bytes: BUFFER_LIMIT + 1 },
      };
    },
    async readBytes() {
      read = true;
    },
  });
  row.querySelector(BUTTON).click();
  await until(() => status().includes("Chrome or Edge"));
  assert.equal(read, false);
  assert.equal(downloads.length, 0);
  assert.equal(blobs.length, 0);
});

test("expired picker gestures allow a second click to open the picker immediately", async () => {
  const row = fileTree();
  let picks = 0,
    reads = 0,
    aborted = false;
  const info = { version: "v1", absolutePath: "/workspace/a.bin", bytes: BUFFER_LIMIT + 1 };
  window.showSaveFilePicker = async () => {
    picks++;
    if (picks === 1) throw new dom.window.DOMException("Gesture expired", "SecurityError");
    return {
      async createWritable() {
        return {
          async abort() {
            aborted = true;
          },
        };
      },
    };
  };
  ui = install({
    async stat() {
      return { ok: true, value: { ...info } };
    },
    async readBytes() {
      reads++;
      throw new Error("Test disconnect");
    },
  });
  const button = row.querySelector(BUTTON);
  button.click();
  await until(() => status().includes("Click Download again"));
  assert.equal(reads, 0);
  button.click();
  assert.equal(picks, 2, "retry calls the picker before awaiting metadata");
  await until(() => status().includes("Test disconnect"));
  assert.equal(aborted, true);
  assert.equal(downloads.length, 0);
});

test("unloading removes controls and styles, revokes blobs, and disconnects observation", async () => {
  const row = fileTree();
  ui = install(remoteFile());
  row.querySelector(BUTTON).click();
  await until(() => downloads.length === 1);
  ui.dispose();
  ui = undefined;
  assert.equal(document.querySelectorAll(BUTTON).length, 0);
  assert.equal(document.querySelector("[data-dsh-download-status]"), null);
  assert.equal(document.querySelector("[data-dsh-file-download-style]"), null);
  assert.equal(row.classList.contains("dsh-file-download-row"), false);
  assert.deepEqual(revoked, ["blob:test-1"]);
  row.parentElement.append(row.cloneNode(true));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.querySelectorAll(BUTTON).length, 0);
});

test("activation registers the preview and folder toolbar slots and unloads them", () => {
  fileTree();
  let cleanup,
    unregistered = [],
    registered = [];
  const ctx = {
    remote: { workspaceFiles: remoteFile() },
    effect(callback) {
      cleanup = callback();
    },
    slots: {
      inject(name, callback) {
        callback();
        return () => {
          unregistered.push(name);
        };
      },
      register(meta, component) {
        registered.push({ meta, component });
      },
    },
  };
  apply(ctx);
  assert.deepEqual(
    registered.map((item) => item.meta.id),
    ["dsh-file-download", "dsh-folder-download"],
  );
  assert.ok(registered.every((item) => typeof item.component === "function"));
  cleanup();
  assert.deepEqual(unregistered, [
    "sidebar.right.tab.document.actions",
    "sidebar.right.tab.files.actions",
  ]);
  assert.equal(document.querySelectorAll(BUTTON).length, 0);
});

test("folder action saves a recursive ZIP without triggering native expand", async () => {
  fileTree();
  const folder = document.querySelector('[data-files-entry="directory"]');
  let expanded = 0,
    bubbled = 0;
  folder.firstElementChild.addEventListener("click", () => expanded++);
  folder.addEventListener("click", () => bubbled++);
  const source = directorySource(
    { "folder/nested/file.txt": "content" },
    ["folder/empty"],
    "folder",
  );
  ui = install(source.remote);
  folder.firstElementChild.click();
  assert.equal(expanded, 1);
  assert.equal(bubbled, 1);
  folder.querySelector(BUTTON).click();
  await until(() => downloads.length === 1);
  assert.equal(expanded, 1);
  assert.equal(bubbled, 1);
  assert.equal(downloads[0].name, "folder.zip");
  const files = unzipSync(new Uint8Array(await blobs[0].arrayBuffer()));
  assert.equal(new TextDecoder().decode(files["folder/nested/file.txt"]), "content");
  assert.ok(Object.hasOwn(files, "folder/empty/"));
});

test("folder save picker opens on the original click and streams directly to its writer", async () => {
  fileTree();
  const source = directorySource(
    { "folder/large.bin": new Uint8Array(40 * 1024 * 1024).fill(179) },
    [],
    "folder",
  );
  let chosen = false,
    closed = false,
    bytes = 0;
  const list = source.remote.list;
  source.remote.list = async (...args) => {
    assert.equal(chosen, true);
    return list(...args);
  };
  window.showSaveFilePicker = async ({ suggestedName }) => {
    assert.equal(suggestedName, "folder.zip");
    chosen = true;
    return {
      async createWritable() {
        return {
          async write(data) {
            bytes += data.length;
          },
          async close() {
            closed = true;
          },
          async abort() {
            assert.fail("Successful streaming must not abort");
          },
        };
      },
    };
  };
  ui = install(source.remote);
  document.querySelector('[data-files-entry="directory"]').querySelector(BUTTON).click();
  assert.equal(chosen, true, "Save picker must be opened before awaiting enumeration");
  await until(() => closed);
  assert.ok(bytes > 40 * 1024 * 1024);
  assert.equal(blobs.length, 0);
  assert.equal(downloads.length, 0);
  assert.match(status(), /Saved folder.zip/);
});

test("canceling a folder picker performs no enumeration or file reads", async () => {
  fileTree();
  const source = directorySource({}, [], "folder");
  window.showSaveFilePicker = async () => {
    throw new dom.window.DOMException("Cancelled", "AbortError");
  };
  ui = install(source.remote);
  document.querySelector('[data-files-entry="directory"]').querySelector(BUTTON).click();
  await until(() => status().includes("cancelled"));
  assert.equal(source.calls.length, 0);
  assert.equal(downloads.length, 0);
});

test("Files toolbar saves the workspace root with the sidebar's owning session", async () => {
  const host = document.createElement("section");
  host.dataset.sidebarRightSession = "root-owner";
  document.body.append(host);
  const source = directorySource({ "a.txt": "root content" }, [], "");
  ui = install(source.remote);
  root = createRoot(host);
  await act(() => root.render(React.createElement(ui.FolderDownload, { absolutePath: "" })));
  const button = host.querySelector(BUTTON);
  assert.equal(button.textContent, "Download ZIP");
  assert.equal(button.disabled, false);
  button.click();
  await until(() => downloads.length === 1);
  assert.equal(downloads[0].name, "workspace.zip");
  assert.ok(source.calls.every((call) => call.sessionId === "root-owner"));
});

test("an incomplete folder listing reports an error without starting a download", async () => {
  fileTree();
  ui = install({
    async list() {
      return { ok: true, value: { path: "folder", entries: [], truncated: true } };
    },
  });
  document.querySelector('[data-files-entry="directory"]').querySelector(BUTTON).click();
  await until(() => status().includes("truncated"));
  assert.equal(downloads.length, 0);
  assert.equal(blobs.length, 0);
});

test("a row changing to an unsupported entry loses its action", async () => {
  const row = fileTree();
  ui = install(remoteFile());
  row.setAttribute("data-files-entry", "other");
  await until(() => !row.querySelector(BUTTON));
  assert.equal(row.classList.contains("dsh-file-download-row"), false);
});
