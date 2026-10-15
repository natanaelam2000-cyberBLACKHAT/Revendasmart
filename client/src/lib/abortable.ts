/** Bound non-fetch work (auth bootstrap/token refresh) by the same request deadline. */
export function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new DOMException('Request aborted', 'AbortError'));
    if (signal.aborted) aborted();
    else signal.addEventListener('abort', aborted, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}
