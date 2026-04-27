import express, { type Express } from "express";
import fs from "fs";
import path from "path";

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

  // fall through to index.html if the file doesn't exist (SPA fallback)
  app.use(/./, (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
