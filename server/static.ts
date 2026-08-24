import express, { type Express } from "express";
import fs from "fs";
import path from "path";

const STATIC_ASSET_PREFIXES = ["/assets/", "/icons/"];

function isSpaNavigationRequest(req: express.Request): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (req.path === "/api" || req.path.startsWith("/api/")) return false;
  if (STATIC_ASSET_PREFIXES.some((prefix) => req.path.startsWith(prefix))) return false;
  if (path.extname(req.path)) return false;

  return Boolean(req.accepts("html"));
}

export function serveStatic(app: Express) {
  // Build distPath that works in both dev and production
  // In dev: server/ -> ../dist/public
  // In prod (CJS): dist/index.cjs -> ./public
  let distPath = path.resolve(__dirname || ".", "public");
  
  // Fallback if __dirname is undefined (can happen with some bundlers)
  if (!fs.existsSync(distPath)) {
    distPath = path.resolve(process.cwd(), "dist/public");
  }
  
  // Final fallback: relative to current working directory
  if (!fs.existsSync(distPath)) {
    distPath = path.resolve(".", "dist", "public");
  }
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  const indexPath = path.resolve(distPath, "index.html");

  // Express 5 no longer treats the old `app.use(/./, ...)` fallback as a
  // reliable catch-all for multi-segment paths. Keep the final middleware
  // pathless and decide explicitly which requests are real SPA navigations.
  app.use((req, res, next) => {
    if (!isSpaNavigationRequest(req)) return next();

    res.vary("Accept");
    return res.sendFile(indexPath, (error) => {
      if (error) next(error);
    });
  });
}
