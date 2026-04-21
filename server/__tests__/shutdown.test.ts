import { gracefulShutdown } from '@/shutdown';

describe('gracefulShutdown', () => {
  it('closes the server then runs each cleanup in order', async () => {
    const calls: string[] = [];
    const server = {
      close: (cb: (err?: Error) => void) => {
        calls.push('server.close');
        cb();
      },
    };
    const cleanups = [
      async () => { calls.push('cleanup-1'); },
      async () => { calls.push('cleanup-2'); },
    ];

    await gracefulShutdown(server, cleanups, { timeoutMs: 1000 });

    expect(calls).toEqual(['server.close', 'cleanup-1', 'cleanup-2']);
  });

  it('still runs remaining cleanups when one throws', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const calls: string[] = [];
    const server = { close: (cb: () => void) => cb() };
    const cleanups = [
      async () => { throw new Error('boom'); },
      async () => { calls.push('cleanup-2'); },
    ];

    await gracefulShutdown(server, cleanups, { timeoutMs: 1000 });

    expect(calls).toEqual(['cleanup-2']);
    expect(errSpy).toHaveBeenCalledWith('[shutdown] cleanup error', expect.any(Error));
    errSpy.mockRestore();
  });

  it('times out and resolves if cleanups hang', async () => {
    const server = { close: (cb: () => void) => cb() };
    const cleanups = [
      () => new Promise<void>(() => { /* never resolves */ }),
    ];

    const start = Date.now();
    await gracefulShutdown(server, cleanups, { timeoutMs: 50 });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(45);
    expect(elapsed).toBeLessThan(500);
  });
});
