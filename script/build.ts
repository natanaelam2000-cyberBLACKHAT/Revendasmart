import { build as esbuild } from "esbuild";
import { build as viteBuild, loadEnv } from "vite";
import { rm, readFile } from "fs/promises";
import { execSync } from "node:child_process";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

function resolveBuildId() {
  if (process.env.VITE_APP_BUILD_ID) return process.env.VITE_APP_BUILD_ID;
  try {
    return execSync("git rev-parse --short=12 HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "local-dev";
  }
}

function assertProductionBuildDoesNotUseFirebaseEmulators() {
  const viteEnv = loadEnv("production", process.cwd(), "");
  const emulatorFlag = process.env.VITE_USE_FIREBASE_EMULATORS || viteEnv.VITE_USE_FIREBASE_EMULATORS;

  if (emulatorFlag === "true") {
    throw new Error("VITE_USE_FIREBASE_EMULATORS=true é permitido apenas em ambiente local e bloqueia build de produção.");
  }
}

async function buildAll() {
  assertProductionBuildDoesNotUseFirebaseEmulators();
  process.env.VITE_APP_BUILD_ID = resolveBuildId();

  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
