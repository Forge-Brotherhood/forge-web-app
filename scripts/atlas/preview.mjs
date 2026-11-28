// Screenshot the built styles with MapLibre GL JS in headless Chrome.
//
//   node forge-web-app/scripts/atlas/preview.mjs        (after build.sh)
//
// Serves the Atlas resources and a preview page from build/preview over a local server with
// HTTP range support (PMTiles needs it), drives headless Chrome over the DevTools protocol so
// each shot waits for the map to finish loading, and saves one PNG per view and theme to ./preview/.
import { spawn } from "node:child_process";
import { createReadStream, mkdirSync, readdirSync, statSync, writeFileSync, existsSync, symlinkSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ATLAS = path.resolve(HERE, "../../../forge-ios-app/Forge/Forge/Resources/Atlas");
const ROOT = path.join(HERE, "build/preview");
const SHOTS = path.join(HERE, "preview");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 8765;
const DEVTOOLS = 9333;

const VIEWS = {
  "paul-first-journey": [29.85, 34.55, 36.75, 38.55],
  "holy-land": [34.9, 31.55, 35.65, 32.95],
  "bethlehem-jerusalem": [35.05, 31.58, 35.37, 31.85], // about 30 km across
  whole: [-10, 10, 60, 46],
};

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<script src="https://unpkg.com/pmtiles@3.2.1/dist/pmtiles.js"></script>
<style>html,body,#map{margin:0;width:100%;height:100%}</style></head><body><div id="map"></div>
<script>
const q = new URLSearchParams(location.search);
const b = q.get('bbox').split(',').map(Number);
maplibregl.addProtocol('pmtiles', new pmtiles.Protocol().tile);
fetch('atlas-' + q.get('theme') + '.json').then(r => r.text()).then(t => {
  const style = JSON.parse(t.replaceAll('{ATLAS_DIR}', location.origin));
  const map = new maplibregl.Map({container: 'map', style, bounds: [[b[0], b[1]], [b[2], b[3]]],
    fadeDuration: 0, attributionControl: false});
  map.on('error', e => { window.__errors = (window.__errors || []).concat(String(e.error && e.error.message)); });
  map.once('idle', () => { window.__done = true; });
});
</script></body></html>`;

function serve() {
  return http
    .createServer((req, res) => {
      const file = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
      if (!existsSync(file)) return res.writeHead(404).end();
      const size = statSync(file).size;
      const type = file.endsWith(".html") ? "text/html" : file.endsWith(".json") ? "application/json" : "application/octet-stream";
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
      if (!m) {
        res.writeHead(200, { "Content-Type": type, "Content-Length": size });
        return createReadStream(file).pipe(res);
      }
      const start = Number(m[1]);
      const end = Math.min(m[2] ? Number(m[2]) : size - 1, size - 1);
      res.writeHead(206, { "Content-Type": type, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${size}` });
      createReadStream(file, { start, end }).pipe(res);
    })
    .listen(PORT, "127.0.0.1");
}

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((ok) => ws.addEventListener("open", ok, { once: true }));
  let id = 0;
  const waiting = new Map();
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && waiting.has(msg.id)) waiting.get(msg.id)(msg.result || {}), waiting.delete(msg.id);
  });
  const send = (method, params = {}) =>
    new Promise((ok) => {
      waiting.set(++id, ok);
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { send, close: () => ws.close() };
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function main() {
  mkdirSync(ROOT, { recursive: true });
  mkdirSync(SHOTS, { recursive: true });
  for (const name of readdirSync(ATLAS)) {
    const link = path.join(ROOT, name);
    if (!existsSync(link)) symlinkSync(path.join(ATLAS, name), link);
  }
  writeFileSync(path.join(ROOT, "index.html"), PAGE);
  const server = serve();
  const chrome = spawn(CHROME, ["--headless", `--remote-debugging-port=${DEVTOOLS}`, "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader", "--hide-scrollbars", `--user-data-dir=${path.join(HERE, "build/chrome")}`, "about:blank"],
    { stdio: "ignore" });
  try {
    let target;
    for (let i = 0; i < 50 && !target; i++) {
      await sleep(200);
      target = await fetch(`http://127.0.0.1:${DEVTOOLS}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === "page")).catch(() => null);
    }
    const page = await cdp(target.webSocketDebuggerUrl);
    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 700, deviceScaleFactor: 2, mobile: false });
    for (const [view, bbox] of Object.entries(VIEWS)) {
      for (const theme of ["night", "cream"]) {
        await page.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html?theme=${theme}&bbox=${bbox.join(",")}` });
        let done = false;
        for (let i = 0; i < 150 && !done; i++) {
          await sleep(200);
          const r = await page.send("Runtime.evaluate", { expression: "window.__done === true", returnByValue: true });
          done = r.result && r.result.value;
        }
        const errs = await page.send("Runtime.evaluate", { expression: "JSON.stringify(window.__errors || [])", returnByValue: true });
        const shot = await page.send("Page.captureScreenshot", { format: "png" });
        const out = path.join(SHOTS, `${view}-${theme}.png`);
        writeFileSync(out, Buffer.from(shot.data, "base64"));
        console.log(`preview: ${out}${done ? "" : " (timed out)"} errors=${errs.result.value}`);
      }
    }
    page.close();
  } finally {
    chrome.kill();
    server.close();
  }
}

main();
