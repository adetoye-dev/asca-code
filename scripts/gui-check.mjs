/**
 * gui-check.mjs — render the workbench in a real browser and assert what a unit
 * test cannot see: that every screen paints, that nothing overflows its window,
 * that the sidebar's icons sit on the column's centre line in both states, and
 * that opening an entry's dialog leaves the marketplace grid exactly as it was.
 *
 * Everything here was written because looking at the app found bugs the suite had
 * been happy to miss: images computing to zero width, icons flung across a panel
 * mid-transition, a card that stretched its grid out of shape. A grep cannot see
 * any of that; a screenshot can.
 *
 *   node scripts/gui-check.mjs            # headless, prints a report
 *   node scripts/gui-check.mjs --shots    # also writes PNGs to /tmp
 *
 * Needs Chrome (or Chromium) installed. Starts its own Vite server and its own
 * headless browser, and kills both on the way out.
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 5199;
const CDP_PORT = 9444;
const APP = `http://127.0.0.1:${PORT}/`;
const SHOTS = process.argv.includes("--shots");
const shotDir = "/tmp/acsa-gui-check";

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];
const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error("gui-check: no Chrome or Chromium found — install one, or skip this check.");
  process.exit(0); // Not a failure of the app; this check is optional tooling.
}

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
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`${label} never came up at ${url}`);
}

/** A very small CDP client: evaluate, screenshot, move the mouse. */
class Session {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id) {
        const p = this.pending.get(msg.id); this.pending.delete(msg.id);
        if (p) msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result);
        return;
      }
      if (msg.method === "Runtime.exceptionThrown") {
        this.errors.push((msg.params.exceptionDetails?.exception?.description || "exception").split("\n")[0]);
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
  async move(x, y) { await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 }); }
  async screenshot(name) {
    if (!SHOTS) return;
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${shotDir}/${name}.png`, Buffer.from(r.data, "base64"));
  }
}

const OVERFLOW = `(() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const s = getComputedStyle(el);
    if (s.position === 'fixed' || s.visibility === 'hidden' || s.opacity === '0') continue;
    if (r.right > vw + 1 || r.left < -1 || r.bottom > vh + 1) {
      bad.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 50), right: Math.round(r.right) });
    }
  }
  return { vw, docScrollW: document.documentElement.scrollWidth, docScrollH: document.documentElement.scrollHeight, bad: bad.slice(0, 5) };
})()`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

children.push(spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore" }));
await waitFor(APP, "vite");

children.push(spawn(chrome, [
  "--headless=new", `--remote-debugging-port=${CDP_PORT}`, "--remote-debugging-address=127.0.0.1",
  `--user-data-dir=${shotDir || "/tmp"}/chrome-profile`, "--window-size=1440,900",
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank",
], { stdio: "ignore" }));
await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`, "chrome");
if (SHOTS) mkdirSync(shotDir, { recursive: true });

const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
const page = targets.find((t) => t.type === "page") || (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(APP)}`, { method: "PUT" })).json());
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const session = new Session(ws);
await session.send("Page.enable");
await session.send("Runtime.enable");

try {
  // 1. Nothing overflows its window, at three sizes.
  for (const [width, height] of [[1440, 900], [1280, 800], [1024, 700]]) {
    await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await session.send("Page.navigate", { url: APP });
    await sleep(2200);
    const m = await session.eval(OVERFLOW);
    check(`${width}×${height}: nothing outside the window`,
      m.bad.length === 0 && m.docScrollW <= m.vw && m.docScrollH <= height,
      m.bad.length ? JSON.stringify(m.bad) : `scroll ${m.docScrollW}×${m.docScrollH}`);
    await session.screenshot(`viewport-${width}`);
  }

  await session.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await session.send("Page.navigate", { url: APP });
  await sleep(2200);

  // 2. The sidebar's icons share the column's centre line, in both states.
  const geometry = await session.eval(`(() => {
    const nav = document.querySelector('[data-testid="workbench-nav"]');
    const left = nav.getBoundingClientRect().left;
    const icons = [...nav.querySelectorAll('[data-testid^="nav-item-"] svg')].map((svg) => {
      const r = svg.getBoundingClientRect();
      return +(r.left - left + r.width / 2).toFixed(1);
    });
    return { collapsed: Number.parseInt(nav.style.width, 10), centres: icons };
  })()`);
  await session.move(28, 500);
  await sleep(600);
  const expanded = await session.eval(`(() => {
    const nav = document.querySelector('[data-testid="workbench-nav"]');
    const left = nav.getBoundingClientRect().left;
    return {
      width: Number.parseInt(nav.style.width, 10),
      centres: [...nav.querySelectorAll('[data-testid^="nav-item-"] svg')].map((svg) => {
        const r = svg.getBoundingClientRect();
        return +(r.left - left + r.width / 2).toFixed(1);
      }),
    };
  })()`);
  const aligned = (list) => list.every((c) => Math.abs(c - 28) <= 0.6);
  check("sidebar icons sit on the centre line when collapsed", aligned(geometry.centres), `centres ${geometry.centres.join(", ")}`);
  check("sidebar icons still sit on it when expanded", aligned(expanded.centres) && expanded.width > 100, `width ${expanded.width}, centres ${expanded.centres.join(", ")}`);

  // 2b. The rail is big enough to read, and the brand outranks it.
  //     `Icon` writes its size as an inline style, so a `w-8 h-8` class on a rail
  //     icon is silently ignored — the rail must be sized by the `size` prop, and
  //     this asserts the rendered box, not the class. The brand is an <img>: its
  //     ink carries ~23% padding, so "bigger than the icons" must be checked
  //     against ink, not against the box.
  const scale = await session.eval(`(() => {
    const nav = document.querySelector('[data-testid="workbench-nav"]');
    const img = nav.querySelector('[data-testid="nav-brand"] img');
    const icon = nav.querySelector('[data-testid^="nav-item-"] svg');
    if (!img || !icon) return null;
    const box = icon.getBoundingClientRect().width;
    const unit = box / icon.viewBox.baseVal.width;
    let ink = 0; try { ink = icon.getBBox().height * unit; } catch { /* unmeasurable */ }
    const brand = img.getBoundingClientRect().width;
    return { iconBox: +box.toFixed(1), iconInk: +ink.toFixed(1), brand, brandInk: +(0.7695 * brand).toFixed(1) };
  })()`);
  // A band rather than an exact number: the rail's size is a single constant
  // that gets tuned by eye, and this check exists to catch it falling back to
  // the 16px default or drifting out of the rail's range — not to pin it.
  check("rail icons are sized in the 20–30px band, not the Icon default",
    scale && scale.iconBox >= 20 && scale.iconBox <= 30,
    scale ? `icon ${scale.iconBox}px` : "no icon found");
  check("the brand mark is larger than the rail icons",
    scale && scale.brand > scale.iconBox && scale.brandInk > scale.iconInk,
    scale ? `brand ${scale.brand}px (ink ~${scale.brandInk}) vs icon ${scale.iconBox}px (ink ~${scale.iconInk})` : "no brand found");

  // 2c. A size class actually decides the size. This is the end-to-end form of
  //     the Icon bug: the component used to inline a 16px width on every icon,
  //     so a `w-3.5` class was dead. Only svgs with no inline size are counted —
  //     an explicit `size` prop is *supposed* to win, and it writes one.
  const classOnly = await session.eval(`(() => {
    const rows = [];
    for (const svg of document.querySelectorAll('svg')) {
      if (svg.getAttribute('style')) continue;              // explicitly sized
      const m = (svg.getAttribute('class') || '').match(/(?:^|\\s)w-\\[?([0-9.]+)(px|rem)?\\]?/);
      if (!m) continue;
      const r = svg.getBoundingClientRect();
      if (!r.width) continue;
      const declared = m[2] === 'px' ? parseFloat(m[1]) : m[2] === 'rem' ? parseFloat(m[1]) * 16 : parseFloat(m[1]) * 4;
      rows.push({ cls: m[0].trim(), declared, rendered: +r.width.toFixed(1) });
    }
    return rows;
  })()`);
  const honoured = classOnly.length >= 5 && classOnly.every((r) => Math.abs(r.declared - r.rendered) <= 0.5);
  check("a size class on an icon decides its size",
    honoured,
    `${classOnly.length} class-sized icons, e.g. ${classOnly.slice(0, 3).map((r) => `${r.cls} -> ${r.rendered}px`).join(", ")}`);

  await session.move(1000, 500);
  await sleep(500);
  await session.screenshot("sidebar");

  // 3. Every screen paints something with a way back out of it.
  for (const id of ["git", "codeMap", "aiManager", "marketplace", "monitor"]) {
    await session.eval(`document.querySelector('[data-testid="nav-item-${id}"]').click()`);
    await sleep(900);
    const page = await session.eval(`({ back: Boolean(document.querySelector('[aria-label="Back to the editor"]')), text: document.body.innerText.length })`);
    check(`${id} screen renders with a way back`, page.back && page.text > 400);
    await session.screenshot(`screen-${id}`);
  }

  // 4. An entry's dialog opens, and the grid keeps its shape while it is up.
  await session.eval(`document.querySelector('[data-testid="nav-item-marketplace"]').click()`);
  await sleep(900);
  const before = await session.eval(`[...new Set([...document.querySelectorAll('[data-testid^="marketplace-item-"]')].map((b) => Math.round(b.getBoundingClientRect().height)))]`);
  await session.eval(`document.querySelector('[data-testid^="marketplace-item-"]').click()`);
  await sleep(700);
  const after = await session.eval(`(() => ({
    rows: [...new Set([...document.querySelectorAll('[data-testid^="marketplace-item-"]')].map((b) => Math.round(b.getBoundingClientRect().height)))],
    dialog: Boolean(document.querySelector('[data-testid="marketplace-detail"]')),
  }))()`);
  check("an entry's detail opens as a dialog and the grid keeps its height",
    after.dialog && JSON.stringify(before) === JSON.stringify(after.rows),
    `rows ${before.join("/")} -> ${after.rows.join("/")}`);
  await session.screenshot("marketplace-detail");

  // 5. Nothing threw along the way.
  check("no uncaught errors in the console", session.errors.length === 0, session.errors.slice(0, 3).join(" | "));
} finally {
  ws.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\ngui-check: ${results.length - failed}/${results.length} passed${SHOTS ? ` (screenshots in ${shotDir})` : ""}`);
process.exit(failed === 0 ? 0 : 1);
