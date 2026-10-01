import { BUFFER_LIMIT, filenameOf, fileInfo, copyFile, bufferedWriter } from "./download.mjs";
import React from "react";

const ROW = '[data-files-entry="file"][data-files-path]';
const BUTTON = "button[data-dsh-file-download]";
const CSS = `
.dsh-file-download-row{position:relative}
.dsh-file-download-row>button:not([data-dsh-file-download]){padding-inline-end:42px}
button[data-dsh-file-download]{position:absolute;inset-inline-end:6px;top:2px;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;padding:4px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary,currentColor);cursor:pointer;z-index:1}
button[data-dsh-file-download]:hover{background:var(--dsw-alias-interactive-bg-hover,#8882)}
button[data-dsh-file-download]:focus-visible{outline:2px solid var(--dsw-alias-label-primary,currentColor);outline-offset:1px}
button[data-dsh-file-download]:disabled{opacity:.4;cursor:default}
button[data-dsh-file-download] svg{width:16px;height:16px;pointer-events:none}
button[data-dsh-file-download="preview"]{position:static;width:auto;height:28px;gap:5px;padding:4px 7px;font:12px/1.4 system-ui;white-space:nowrap}
[data-dsh-download-status]{position:fixed;bottom:22px;right:22px;max-width:min(420px,90vw);padding:10px 14px;border:1px solid var(--dsw-alias-border-l3,#8886);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#222);font:13px/1.5 system-ui;box-shadow:0 4px 20px #0002;z-index:10000;overflow-wrap:anywhere}
`;

function icon(button, busy = false) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", busy ? "M6 6l12 12M18 6L6 18" : "M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.8");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  button.replaceChildren(svg);
  if (button.dataset.dshFileDownload === "preview") {
    button.append(document.createTextNode(busy ? "Cancel" : "Download"));
  }
}

export function install(remote) {
  const style = document.createElement("style");
  style.dataset.dshFileDownloadStyle = "";
  style.textContent = CSS;
  document.head.append(style);
  const status = document.createElement("div");
  status.dataset.dshDownloadStatus = "";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  document.body.append(status);
  const active = new Map();
  const prepared = new WeakMap();
  const urls = new Map();
  let disposed = false;
  let statusTimer;

  const notify = (text, error = false) => {
    if (disposed) return;
    clearTimeout(statusTimer);
    status.textContent = text;
    status.hidden = false;
    statusTimer = setTimeout(
      () => {
        status.hidden = true;
      },
      error ? 15000 : 5000,
    );
  };

  const contextOf = (row) => ({
    path: row.getAttribute("data-files-path"),
    sessionId: row
      .closest("[data-sidebar-right-session]")
      ?.getAttribute("data-sidebar-right-session"),
  });

  async function download(button, getContext) {
    if (active.has(button)) {
      active.get(button).abort();
      return;
    }
    const { path, sessionId } = getContext();
    if (!path || !sessionId) return;
    if (active.size >= 2) {
      notify("Two downloads are running. Wait for one to finish.");
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    const name = filenameOf(path);
    active.set(button, controller);
    button.setAttribute("aria-label", `Cancel download of ${name}`);
    button.title = `Cancel download of ${name}`;
    icon(button, true);
    let writer;
    let buffered;
    try {
      const cached = prepared.get(button);
      prepared.delete(button);
      let info;
      // A second click after an expired user gesture opens the picker immediately.
      if (cached?.path === path && cached.sessionId === sessionId) {
        const handle = await window.showSaveFilePicker({ suggestedName: name });
        info = await fileInfo(remote, sessionId, path, signal);
        writer = await handle.createWritable();
      } else {
        info = await fileInfo(remote, sessionId, path, signal);
        if (info.bytes > BUFFER_LIMIT) {
          if (typeof window.showSaveFilePicker !== "function") {
            throw new Error("Files larger than 32 MiB need Chrome or Edge's save dialog.");
          }
          prepared.set(button, { path, sessionId });
          const handle = await window.showSaveFilePicker({ suggestedName: name });
          prepared.delete(button);
          writer = await handle.createWritable();
        } else {
          buffered = bufferedWriter();
          writer = buffered;
        }
      }
      notify(`Downloading ${name}…`);
      await copyFile(remote, sessionId, path, info, writer, signal, (done, total) => {
        button.title = `Cancel download of ${name} (${Math.floor((done / total) * 100)}%)`;
      });
      if (buffered) {
        const url = URL.createObjectURL(buffered.blob());
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = name;
        anchor.hidden = true;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        urls.set(
          url,
          setTimeout(() => {
            URL.revokeObjectURL(url);
            urls.delete(url);
          }, 60000),
        );
      }
      notify(buffered ? `Download started: ${name}` : `Saved ${name}`);
    } catch (error) {
      if (writer) await writer.abort().catch(() => {});
      if (signal.aborted || error?.name === "AbortError") {
        prepared.delete(button);
        notify(`Download cancelled: ${name}`);
      } else if (
        ["SecurityError", "NotAllowedError"].includes(error?.name) &&
        prepared.has(button)
      ) {
        notify("Click Download again to choose where to save this large file.", true);
      } else {
        prepared.delete(button);
        notify(`Download failed: ${String(error?.message || error).slice(0, 180)}`, true);
      }
    } finally {
      active.delete(button);
      if (!disposed && button.isConnected) {
        const current = getContext();
        const label = `Download ${filenameOf(current.path || path)}`;
        button.setAttribute("aria-label", label);
        button.title = label;
        button.disabled = !current.sessionId;
        icon(button);
      }
    }
  }

  function attach(row) {
    const { path, sessionId } = contextOf(row);
    let button = [...row.children].find((child) => child.matches(BUTTON));
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.dataset.dshFileDownload = "";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void download(button, () => contextOf(row));
      });
      row.classList.add("dsh-file-download-row");
      row.append(button);
      icon(button);
    }
    if (!active.has(button)) {
      const label = `Download ${filenameOf(path)}`;
      button.setAttribute("aria-label", label);
      button.title = label;
      button.disabled = !sessionId;
    }
  }

  function scan(node) {
    if (!(node instanceof Element)) return;
    if (node.matches(ROW)) attach(node);
    node.querySelectorAll(ROW).forEach(attach);
  }

  // Add sibling controls, never replace React-owned file rows or their handlers.
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") scan(record.target);
      else for (const node of record.addedNodes) scan(node);
    }
  });
  scan(document.body);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-files-path", "data-sidebar-right-session"],
  });

  function PreviewDownload({ absolutePath, sessionId }) {
    const host = React.useRef(null);
    React.useEffect(() => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.dshFileDownload = "preview";
      const getContext = () => {
        // A preview can reference a file owned by a different session.
        const address = host.current
          ?.closest("[data-textpreview-url]")
          ?.getAttribute("data-textpreview-url");
        const prefix = "dsh-resource://file/session/";
        let ownerSession = sessionId;
        if (address?.startsWith(prefix)) {
          try {
            ownerSession = decodeURIComponent(address.slice(prefix.length).split("/")[0]);
          } catch {
            return {};
          }
        }
        return { path: absolutePath, sessionId: ownerSession };
      };
      const label = `Download ${filenameOf(absolutePath)}`;
      button.setAttribute("aria-label", label);
      button.title = label;
      button.disabled = !absolutePath || !getContext().sessionId;
      icon(button);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void download(button, getContext);
      });
      host.current.append(button);
      return () => {
        active.get(button)?.abort();
        prepared.delete(button);
        button.remove();
      };
    }, [absolutePath, sessionId]);
    return React.createElement("span", { ref: host, "data-dsh-preview-download": "" });
  }

  const dispose = () => {
    disposed = true;
    observer.disconnect();
    clearTimeout(statusTimer);
    for (const controller of active.values()) controller.abort();
    for (const [url, timer] of urls) {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    }
    document.querySelectorAll(BUTTON).forEach((button) => button.remove());
    document
      .querySelectorAll(".dsh-file-download-row")
      .forEach((row) => row.classList.remove("dsh-file-download-row"));
    style.remove();
    status.remove();
  };
  return { PreviewDownload, dispose };
}

export const inject = ["remote", "remote.workspaceFiles", "slots"];
export function apply(ctx) {
  ctx.effect(() => {
    const ui = install(ctx.remote.workspaceFiles);
    const unregister = ctx.slots.inject("sidebar.right.tab.document.actions", () =>
      ctx.slots.register(
        {
          name: "sidebar.right.tab.document.actions",
          id: "dsh-file-download",
          order: 100,
        },
        ui.PreviewDownload,
      ),
    );
    return () => {
      unregister();
      ui.dispose();
    };
  });
}
