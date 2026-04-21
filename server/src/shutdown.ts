export interface ClosableServer {
  close(callback: (err?: Error) => void): void;
}

export interface ShutdownOptions {
  timeoutMs: number;
}

/**
 * Drains the HTTP server then runs each cleanup. Errors from individual
 * cleanups are logged but don't abort the rest — we want to flush as much
 * state as possible before PM2 SIGKILLs us. A hard timeout prevents a stuck
 * cleanup from blocking the process forever.
 */
export async function gracefulShutdown(
  server: ClosableServer,
  cleanups: Array<() => Promise<void>>,
  options: ShutdownOptions,
): Promise<void> {
  const work = (async () => {
    await new Promise<void>((resolve) => {
      server.close((err) => {
        if (err) console.error('[shutdown] server.close error', err);
        resolve();
      });
    });
    for (const cleanup of cleanups) {
      try {
        await cleanup();
      } catch (err) {
        console.error('[shutdown] cleanup error', err);
      }
    }
  })();

  await Promise.race([
    work,
    new Promise<void>((resolve) => setTimeout(resolve, options.timeoutMs)),
  ]);
}
