import { createServer } from "vite";

// Test infrastructure only: allow read-only dependency links in restricted Windows worktrees.
const linked = process.env.AUTH_TEST_LINKED_DEPS === "1";
const server = await createServer({
  resolve: { preserveSymlinks: linked },
  optimizeDeps: { esbuildOptions: { preserveSymlinks: linked } },
  server: { host: "127.0.0.1", port: Number(process.env.E2E_PORT || 5067), strictPort: true },
});
await server.listen();
