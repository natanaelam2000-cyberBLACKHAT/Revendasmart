/**
 * PRO-07F.4 — servidor estático throwaway, só para visualizar visual-review.html no Browser pane
 * durante esta sprint. Não faz parte da entrega funcional (phase2-server.ts é o harness real).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const RUN_DIR = path.join(".tmp", "product-cutout-smoke", "2026-08-17T01-48-05-144Z", "B");

http.createServer((req, res) => {
  const filePath = path.join(RUN_DIR, req.url === "/" ? "visual-review.html" : (req.url || ""));
  try {
    const bytes = fs.readFileSync(filePath);
    res.setHeader("Content-Type", filePath.endsWith(".html") ? "text/html" : filePath.endsWith(".png") ? "image/png" : "application/octet-stream");
    res.end(bytes);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
}).listen(5184, "127.0.0.1", () => console.log("static viewer on http://127.0.0.1:5184"));
