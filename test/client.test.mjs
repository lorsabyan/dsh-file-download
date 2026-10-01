import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { install, apply } from "../src/client.mjs";
import { BUFFER_LIMIT } from "../src/download.mjs";

const BUTTON = "button[data-dsh-file-download]";
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
  const buttons = [...document.querySelectorAll(BUTTON)];
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

test("file actions preserve native open handlers and exclude folders and other entries", async () => {
  const row = fileTree();
  let opened = 0,
    bubbled = 0;
  row.firstElementChild.addEventListener("click", () => opened++);
  row.addEventListener("click", () => bubbled++);
  const remote = remoteFile();
  ui = install(remote);
  assert.equal(document.querySelectorAll(BUTTON).length, 1);
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
  await until(() => document.querySelectorAll(BUTTON).length === 2);
  assert.equal(row.querySelector(BUTTON).getAttribute("aria-label"), "Download renamed.pdf");
  row.closest("section").removeAttribute("data-sidebar-right-session");
  await until(() => row.querySelector(BUTTON).disabled);
  row.closest("section").setAttribute("data-sidebar-right-session", "new-session");
  await until(() => !row.querySelector(BUTTON).disabled);
  assert.equal(document.querySelectorAll(BUTTON).length, 2);
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

test("activation registers the official preview action slot and unloads it", () => {
  fileTree();
  let cleanup,
    unregistered = false,
    registered;
  const ctx = {
    remote: { workspaceFiles: remoteFile() },
    effect(callback) {
      cleanup = callback();
    },
    slots: {
      inject(name, callback) {
        assert.equal(name, "sidebar.right.tab.document.actions");
        callback();
        return () => {
          unregistered = true;
        };
      },
      register(meta, component) {
        registered = { meta, component };
      },
    },
  };
  apply(ctx);
  assert.equal(registered.meta.id, "dsh-file-download");
  assert.equal(typeof registered.component, "function");
  cleanup();
  assert.equal(unregistered, true);
  assert.equal(document.querySelectorAll(BUTTON).length, 0);
});
