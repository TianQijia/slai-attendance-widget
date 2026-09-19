// Loopback-only visual preview; it cannot read school records or pair a service.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { now, state, bootstrap } = require("../tests/desktop-fixture");
const root = path.resolve(__dirname, "../extension");
const allowed = new Set(require("../release-files.json").archive);
const mime = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const name = req.url === "/" ? "widget.html" : req.url.slice(1);
  if (!allowed.has(name) || !Object.hasOwn(mime, path.extname(name))) { res.writeHead(404); res.end(); return; }
  let bytes = fs.readFileSync(path.join(root, name));
  if (name === "widget.js") bytes = Buffer.from(`(${bootstrap.toString()})(${JSON.stringify({ now, state })});\n` + bytes.toString());
  res.writeHead(200, { "Content-Type": mime[path.extname(name)] + ([".html", ".css", ".js"].includes(path.extname(name)) ? "; charset=utf-8" : ""), "Cache-Control": "no-store" });
  res.end(bytes);
});
server.listen(Number(process.env.SLAI_PREVIEW_PORT || 4173), "127.0.0.1", () => console.log(`Synthetic desktop preview: http://127.0.0.1:${server.address().port}/`));
