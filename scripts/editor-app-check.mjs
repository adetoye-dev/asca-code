/**
 * editor-app-check.mjs — the whole app, in a browser, driven like a user.
 *
 * The editor's typing bug — one keystroke landing per click — does not reproduce
 * when the editor is mounted on its own, which says the cause is in the app
 * around it: the dockview panels, the workbench context, a per-keystroke effect.
 * So this runs the *real* app with a stubbed Tauri IPC layer, opens a file from
 * the explorer, and types into it with real key events. It reproduced the bug
 * (`a{hello` -> `a{h`) and names the culprit in a focusout stack.
 *
 * Why a stub rather than the packaged app: a Tauri rebuild is minutes and gives
 * no DOM to inspect; this is seconds and lets the test read exactly what the
 * user sees. The assertions are on the rendered text, so they cannot pass
 * because a mocked model said so.
 *
 *   node scripts/editor-app-check.mjs            # against the dev server
 *   node scripts/editor-app-check.mjs --dist     # against the built bundle
 *
 * Two things about the browser that this had to work around, and neither is
 * obvious from a failure:
 *
 *   * Monaco chooses its input mechanism from `typeof globalThis.EditContext`,
 *     which Chrome has and the macOS webview the app actually ships in does
 *     not. The stub deletes it, so Chrome exercises the same path a user does;
 *     without that this silently tests a mechanism no user has.
 *   * Monaco renders a space as `&nbsp;` so layout will not collapse it, so the
 *     text read back out of `.view-lines` is full of U+00A0 where the file has
 *     U+0020. `editorText` normalises, which keeps assertions from failing on a
 *     rendering detail — and from passing by accident.
 *
 * And one for whoever verifies the packaged app by hand instead: two copies can
 * be installed at once (a build under `.tauri/target` and the released one),
 * `cua.getApp("ACSA Code")` may bind to either, and a screenshot can show one
 * while the AX tree describes the other — which is how a fixed build gets
 * reported as still broken. Kill every copy, confirm none remain, and bind by
 * full app path.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 5202;
const CDP_PORT = 9446;
const APP = `http://127.0.0.1:${PORT}/`;
/**
 * `--dist` serves the built bundle instead of the dev server.
 *
 * The dev server and the shipped app are not the same artifact, and a bug that
 * only appears in one is exactly the kind that ships. This is how the packaged
 * bundle gets checked from the same browser that checks the source.
 */
const SERVE_DIST = process.argv.includes("--dist");

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];
const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error("editor-app-check: no Chrome/Chromium found.");
  process.exit(0);
}

/**
 * The smallest Tauri that this app's startup path actually talks to.
 *
 * `EditContext` is removed on purpose. Monaco picks its input mechanism from
 * `typeof globalThis.EditContext === 'function'` and Chrome has it while the
 * macOS webview the app actually ships in does not — so leaving it in would
 * test a code path no user has.
 */
const TAURI_STUB = `(() => {
  globalThis.EditContext = undefined;
  window.__engineCalls = [];
  const callbacks = new Map();
  let nextCallbackId = 1;
  let nextEventId = 1;

  const TREE = [
    { name: "probe.ts", path: "/probe/probe.ts", is_dir: false, size_bytes: 6, children: null },
  ];
  const CONTENTS = { "/probe/probe.ts": "a{\\n}\\n" };
  const SETTINGS = {};
  const DB = {
    "settings.get": () => SETTINGS,
    "settings.set": () => ({ ok: true }),
    "providers.get": () => ({}),
    "secrets.list": () => [],
    "projects.list": () => [{ path: "/probe", name: "probe", last_opened_at: Date.now(), is_active: 1 }],
    "projects.active": () => ({ path: "/probe", name: "probe", last_opened_at: Date.now(), is_active: 1 }),
    "projects.touch": () => ({ ok: true }),
    "projects.forget": () => ({ ok: true }),
    "chat.load": () => null,
    "usage.summary": () => ({}),
  };

  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback(callback, once) {
      const id = nextCallbackId++;
      callbacks.set(id, { callback, once });
      return id;
    },
    async invoke(cmd, args) {
      window.__engineCalls.push(cmd + (args && args.subcommand ? ":" + args.subcommand : "") + (args && args.args && args.args[0] ? ":" + args.args[0] : ""));
      if (cmd === "plugin:event|listen") return nextEventId++;
      if (cmd === "plugin:event|unlisten") return null;
      if (cmd === "engine_call") {
        const sub = args && args.subcommand;
        const list = args && args.args;
        if (sub === "db") {
          const fn = DB[list && list[0]];
          return JSON.stringify({ ok: true, data: fn ? fn() : null });
        }
        if (sub === "git") return JSON.stringify({ ok: true, data: { branch: "dev", files: [] } });
        if (sub === "indexer") return JSON.stringify({ ok: true, data: { indexed: true, totalSymbols: 0, profile: null } });
        if (sub === "ollama") return JSON.stringify({ ok: true, data: { installed: false, running: false, models: [], recommendedModel: "qwen2.5-coder:3b", totalRamGb: 0 } });
        if (sub === "project") return JSON.stringify({ ok: true, data: { ok: true } });
        if (sub === "crash") return JSON.stringify({ ok: true, data: { ok: true } });
        return JSON.stringify({ ok: true, data: null });
      }
      if (cmd === "list_project_files") return TREE;
      if (cmd === "read_file_content") return CONTENTS[args && args.filePath] || "";
      if (cmd === "write_file_content") return null;
      if (cmd === "create_file_or_folder") return null;
      if (cmd === "delete_project_file") return null;
      if (cmd === "pick_folder") return null;
      if (cmd === "fetch_system_metrics") return { cpu_usage: 1, memory_usage: 1, disk_usage: 1 };
      return null;
    },
  };
})();`;

/** Records every focus change with a stack, so a focus thief names itself. */
const FOCUS_LOGGER = `(() => {
  window.__focusLog = [];
  const describe = (el) => {
    if (!el) return null;
    const cls = String(el.className || '').split(/\\s+/).filter(Boolean).slice(0, 3).join('.');
    return el.tagName + (cls ? '.' + cls : '');
  };
  const record = (type) => (event) => {
    window.__focusLog.push({
      type,
      target: describe(event.target),
      now: describe(document.activeElement),
      stack: String((new Error()).stack || '').split('\\n').slice(2, 7).join(' <- '),
    });
  };
  document.addEventListener('focusout', record('focusout'), true);
  document.addEventListener('focusin', record('focusin'), true);
})();`;

const children = [];
const cleanup = () => {
  for (const child of children) {
    try { child.kill("SIGTERM"); } catch { /* already gone */ }
  }
};
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

async function waitFor(url, label, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try { const res = await fetch(url); if (res.ok) return; } catch { /* not up */ }
    await sleep(500);
  }
  throw new Error(`${label} never came up at ${url}`);
}

class Session {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; this.console = [];
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id) {
        const p = this.pending.get(msg.id); this.pending.delete(msg.id);
        if (p) msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result);
        return;
      }
      if (msg.method === "Runtime.consoleAPICalled") {
        const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
        this.console.push(`${msg.params.type}: ${text}`.slice(0, 240));
        if (msg.params.type === "error") this.errors.push(text.slice(0, 240));
      }
      if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
        this.console.push(`log: ${msg.params.entry.text}`.slice(0, 240));
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const details = msg.params.exceptionDetails;
        const head = (details?.exception?.description || details?.text || "exception").split("\n")[0];
        const frames = (details?.stackTrace?.callFrames || [])
          .slice(0, 8)
          .map((f) => `${f.functionName || "?"} @ ${String(f.url).replace(/^http:\/\/127\.0\.0\.1:\d+/, "")}:${f.lineNumber + 1}:${f.columnNumber + 1}`);
        this.errors.push([head, ...frames].join("\n      "));
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result?.value;
  }
  async click(x, y) {
    for (const type of ["mousePressed", "mouseReleased"]) {
      await this.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, buttons: type === "mousePressed" ? 1 : 0 });
    }
  }
  async char(ch) {
    const code = ch.codePointAt(0);
    await this.send("Input.dispatchKeyEvent", {
      type: "keyDown", text: ch, unmodifiedText: ch, key: ch,
      windowsVirtualKeyCode: code, nativeVirtualKeyCode: code,
    });
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp", key: ch, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code,
    });
  }
  async type(text, delay = 70) {
    for (const ch of text) { await this.char(ch); await sleep(delay); }
  }
  async chord(key, code) {
    for (const type of ["rawKeyDown", "keyUp"]) {
      await this.send("Input.dispatchKeyEvent", { type, key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: 4 });
    }
  }
  /**
   * A non-character key. `text` is what the browser would insert for the key,
   * and CDP only models a real Enter if it is given the carriage return the
   * keyboard would produce — without it the editor sees a key code and nothing
   * else, which is not what a user's Enter does.
   */
  async press(key, code, { modifiers = 0, text } = {}) {
    for (const type of ["rawKeyDown", "keyUp"]) {
      const params = { type, key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers };
      if (text && type === "rawKeyDown") { params.type = "keyDown"; params.text = text; params.unmodifiedText = text; }
      await this.send("Input.dispatchKeyEvent", params);
    }
  }
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/**
 * What the editor is actually showing.
 *
 * Monaco renders a space as `&nbsp;` so the layout engine will not collapse it,
 * so the text read back out of `.view-lines` is full of U+00A0 where the file
 * has U+0020. Normalising here keeps assertions about the file from failing on
 * a rendering detail — and keeps them from passing by accident too.
 */
const editorText = (s) =>
  s.eval(`((document.querySelector('.monaco-editor .view-lines') || {}).innerText || '').replace(/\\u00a0/g, ' ')`);
const inputState = (s) => s.eval(`(() => {
  const t = document.querySelector('.monaco-editor textarea');
  return t ? { readOnly: t.readOnly, active: document.activeElement === t, start: t.selectionStart } : null;
})()`);

/** Open the probe file and put the caret in it, the way a user does. */
async function openFileAndFocus(session) {
  for (let i = 0; i < 60; i++) {
    const ready = await session
      .eval(`Boolean([...document.querySelectorAll('[role="treeitem"]')].find((n) => /probe\\.ts/.test(n.textContent || '')))`)
      .catch(() => false);
    if (ready) break;
    await sleep(500);
  }
  await session.eval(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => /probe\\.ts/.test(n.textContent || '')).click()`);
  for (let i = 0; i < 60; i++) {
    const ready = await session.eval(`Boolean(document.querySelector('.monaco-editor .view-lines'))`).catch(() => false);
    if (ready) break;
    await sleep(500);
  }
  await sleep(700);
  const point = await session.eval(`(() => {
    const el = document.querySelector('.monaco-editor .view-lines');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + 30), y: Math.round(r.top + 8) };
  })()`);
  await session.click(point.x, point.y);
  await sleep(400);
  return point;
}

children.push(
  SERVE_DIST
    ? spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" })
    : spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore" })
);
await waitFor(APP, "vite");

children.push(spawn(chrome, [
  "--headless=new", `--remote-debugging-port=${CDP_PORT}`, "--remote-debugging-address=127.0.0.1",
  "--user-data-dir=/tmp/acsa-editor-app-check/chrome-profile", "--window-size=1440,900",
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank",
], { stdio: "ignore" }));
await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`, "chrome");

const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const session = new Session(ws);
await session.send("Page.enable");
await session.send("Runtime.enable");
await session.send("Log.enable");
await session.send("Emulation.setFocusEmulationEnabled", { enabled: true });
await session.send("Page.addScriptToEvaluateOnNewDocument", { source: TAURI_STUB });
await session.send("Page.addScriptToEvaluateOnNewDocument", { source: FOCUS_LOGGER });
await session.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await session.send("Page.navigate", { url: APP });

const point = await openFileAndFocus(session);
console.log(`  clicking into line 1 at ${point.x},${point.y}`);
console.log("  editor shows:", JSON.stringify(await editorText(session)));

const focused = await inputState(session);
check("clicking the code focuses the editor's input", Boolean(focused && focused.active && !focused.readOnly), JSON.stringify(focused));

// One character, with a stack for every focus change it causes. This is where
// "one keystroke per focus" is either explained or is not happening.
await session.eval("window.__focusLog.length = 0");
await session.char("h");
await sleep(500);
console.log(`  after one 'h': text=${JSON.stringify(await editorText(session))} ${JSON.stringify(await inputState(session))}`);
for (const entry of await session.eval("window.__focusLog")) {
  console.log(`    ${entry.type} target=${entry.target} now=${entry.now}`);
  if (entry.type === "focusout") console.log(`      ${entry.stack}`);
}

// Back to a clean slate for the real assertions.
await session.send("Page.navigate", { url: APP });
await sleep(1500);
const point2 = await openFileAndFocus(session);
check("the editor is focused with its input writable", Boolean(await inputState(session).then((s) => s && s.active && !s.readOnly)), JSON.stringify(await inputState(session)));

await session.type("hello");
await sleep(700);
const afterBurst = await editorText(session);
console.log("  after a burst of 'hello':", JSON.stringify(afterBurst));
check("all five characters of one burst land", afterBurst.includes("hello"), JSON.stringify(afterBurst));

// A second focus and one more character: the caret must survive the refocus.
await session.click(point2.x, point2.y);
await sleep(300);
await session.type("Z");
await sleep(600);
const afterRefocus = await editorText(session);
console.log("  after click + 'Z':", JSON.stringify(afterRefocus));
check("a character after a refocus still lands", afterRefocus.includes("Z"), JSON.stringify(afterRefocus));

// Undo has to take that one character back.
await session.chord("z", 90);
await sleep(600);
const afterUndo = await editorText(session);
console.log("  after Cmd+Z:", JSON.stringify(afterUndo));
check("Cmd+Z undoes the last character", !afterUndo.includes("Z") && afterUndo.includes("hello"), JSON.stringify(afterUndo));

// Typing is only half of "can I edit this file by hand": the keys that are not
// characters have to reach the editor too. Tab is the one the user called out —
// with focus on the body it moved to the Review button instead of indenting.
await session.chord("a", 65);
await session.press("ArrowLeft", 37);
await session.press("Tab", 9);
await sleep(400);
const afterTab = await editorText(session);
const tabFocus = await inputState(session);
const tabIndented = /^[ \t]+a\{hello/.test(afterTab);
const tabKeptFocus = Boolean(tabFocus?.active);
check("Tab indents in the editor instead of leaving it",
  tabIndented && tabKeptFocus,
  `indented=${tabIndented} focused=${tabKeptFocus} text=${JSON.stringify(afterTab)}`);

// Enter and backspace, asserted against a document typed from scratch: where
// the caret sits after a select-all has to be constructed, not guessed.
await session.chord("a", 65);
await session.type("x");
await sleep(300);
await session.press("Enter", 13, { text: "\r" });
await sleep(300);
await session.type("y");
await sleep(400);
const afterEnter = await editorText(session);
check("Enter opens a new line and the next text lands on it",
  afterEnter === "x\ny", JSON.stringify(afterEnter));

await session.press("Backspace", 8);
await session.press("Backspace", 8);
await sleep(400);
const afterBackspace = await editorText(session);
check("Backspace deletes inside the editor", afterBackspace === "x", JSON.stringify(afterBackspace));

// The caret has to follow the arrow keys, not stay pinned. Asserted after each
// press: left then right would land back where it started and prove nothing.
const beforeArrow = (await inputState(session)).start;
await session.press("ArrowLeft", 37);
await sleep(250);
const afterLeft = await inputState(session);
await session.press("ArrowRight", 39);
await sleep(250);
const afterRight = await inputState(session);
check("arrow keys move the caret and focus stays put",
  Boolean(afterLeft?.active) && afterLeft.start === beforeArrow - 1 && afterRight.start === beforeArrow,
  `${beforeArrow} -> ${afterLeft?.start} -> ${afterRight?.start} focused=${afterLeft?.active}`);

check("no uncaught errors in the console", session.errors.length === 0, session.errors.slice(0, 4).join(" || "));
if (process.env.DUMP_CALLS) {
  console.log("\ncalls:", JSON.stringify(await session.eval("window.__engineCalls")));
  console.log("getIndexStatus ->", await session.eval(
    `(async () => { const m = await import('/src/services/agentHarness.ts'); return JSON.stringify(await m.getIndexStatus('/probe')); })()`
  ));
}

ws.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\neditor-app-check: ${results.length - failed}/${results.length} passed`);
cleanup();
process.exit(failed === 0 ? 0 : 1);
