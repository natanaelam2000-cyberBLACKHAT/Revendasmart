import crypto from "node:crypto";
import path from "node:path";
import { execFileSync } from "node:child_process";

function commitSha() {
  return process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function sanitizeModuleId(moduleId, projectRoot) {
  const normalized = String(moduleId).replaceAll("\\", "/");
  const nodeModulesMarker = "/node_modules/";
  const nodeModulesIndex = normalized.lastIndexOf(nodeModulesMarker);
  if (nodeModulesIndex >= 0) {
    const packagePath = normalized.slice(nodeModulesIndex + nodeModulesMarker.length);
    const segments = packagePath.split("/");
    const packageName = segments[0]?.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
    return `npm/${packageName || "unknown"}/${segments.slice(packageName?.startsWith("@") ? 2 : 1).join("/")}`;
  }

  const relative = path.relative(projectRoot, normalized).replaceAll("\\", "/");
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return `project/${relative}`;
  return `external/${crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16)}`;
}

function packageNameFromId(moduleId) {
  const normalized = String(moduleId).replaceAll("\\", "/");
  const marker = "/node_modules/";
  const index = normalized.lastIndexOf(marker);
  if (index < 0) return null;
  const segments = normalized.slice(index + marker.length).split("/");
  return segments[0]?.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0] || null;
}

function numericOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

export function rollupModuleDiagnostics({ projectRoot }) {
  return {
    name: "rollup-module-diagnostics",
    apply: "build",
    generateBundle(_outputOptions, bundle) {
      const chunks = [];
      const moduleOccurrences = new Map();

      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        const modules = Object.entries(output.modules).map(([moduleId, info]) => {
          const sanitizedId = sanitizeModuleId(moduleId, projectRoot);
          const occurrence = moduleOccurrences.get(sanitizedId) || [];
          occurrence.push(output.fileName);
          moduleOccurrences.set(sanitizedId, occurrence);
          return {
            id: sanitizedId,
            package: packageNameFromId(moduleId),
            renderedLength: numericOrNull(info.renderedLength),
            originalLength: numericOrNull(info.originalLength),
          };
        }).sort((a, b) => (b.renderedLength || 0) - (a.renderedLength || 0));

        chunks.push({
          file: output.fileName,
          name: output.name || null,
          isEntry: Boolean(output.isEntry),
          isDynamicEntry: Boolean(output.isDynamicEntry),
          imports: [...output.imports],
          dynamicImports: [...output.dynamicImports],
          modules,
          moduleCount: modules.length,
        });
      }

      const duplicateModules = [...moduleOccurrences.entries()]
        .filter(([, chunkFiles]) => new Set(chunkFiles).size > 1)
        .map(([id, chunkFiles]) => ({ id, chunks: [...new Set(chunkFiles)].sort() }))
        .sort((a, b) => a.id.localeCompare(b.id));

      const packageTotals = new Map();
      for (const chunk of chunks) {
        for (const module of chunk.modules) {
          const packageName = module.package || "project";
          const current = packageTotals.get(packageName) || { package: packageName, renderedLength: 0, originalLength: 0, moduleOccurrences: 0, chunks: new Set() };
          current.renderedLength += module.renderedLength || 0;
          current.originalLength += module.originalLength || 0;
          current.moduleOccurrences += 1;
          current.chunks.add(chunk.file);
          packageTotals.set(packageName, current);
        }
      }

      const report = {
        schemaVersion: 1,
        diagnostic: "rollup-module-contributions",
        testedCommit: commitSha(),
        chunks: chunks.sort((a, b) => a.file.localeCompare(b.file)),
        packageContributions: [...packageTotals.values()]
          .map(({ chunks: packageChunks, ...entry }) => ({ ...entry, chunks: [...packageChunks].sort() }))
          .sort((a, b) => b.renderedLength - a.renderedLength),
        duplicateModules,
        totals: {
          chunkCount: chunks.length,
          moduleOccurrenceCount: chunks.reduce((sum, chunk) => sum + chunk.modules.length, 0),
          duplicateModuleCount: duplicateModules.length,
        },
      };

      this.emitFile({
        type: "asset",
        fileName: ".vite/rollup-module-diagnostics.json",
        source: `${JSON.stringify(report, null, 2)}\n`,
      });
    },
  };
}
