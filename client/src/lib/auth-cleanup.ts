/** Logout/deletion must finish clearing session state even when one local storage is unavailable. */
export async function finishAuthCleanup(steps: readonly (() => unknown | Promise<unknown>)[]): Promise<boolean> {
  let complete = true;
  for (const step of steps) {
    try { await step(); } catch { complete = false; }
  }
  return complete;
}
