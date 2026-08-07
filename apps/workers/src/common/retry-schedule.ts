export function scheduleWithRetry(
  task: () => Promise<void>,
  retryMs: number,
  onError: (error: Error) => void,
): void {
  const run = () => {
    void task().catch((error) => {
      onError(error as Error);
      setTimeout(run, retryMs).unref();
    });
  };
  run();
}
