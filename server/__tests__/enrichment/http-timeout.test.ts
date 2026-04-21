import { fetchWithTimeout } from '../../src/services/enrichment/http-timeout';

describe('fetchWithTimeout', () => {
  it('resolves when underlying fetch resolves in time', async () => {
    const fakeFetch = jest.fn().mockResolvedValue(new Response('ok'));
    const res = await fetchWithTimeout('https://example.com', { timeoutMs: 1000, fetchImpl: fakeFetch });
    expect(await res.text()).toBe('ok');
  });

  it('rejects when underlying fetch exceeds timeout', async () => {
    const slow = () => new Promise((_r, reject) => {
      setTimeout(() => reject(new Error('cancelled')), 50);
    });
    const fakeFetch: typeof fetch = ((_url: unknown, init?: { signal?: AbortSignal }) => {
      return new Promise((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        slow().catch(reject);
      });
    }) as typeof fetch;
    await expect(
      fetchWithTimeout('https://example.com', { timeoutMs: 10, fetchImpl: fakeFetch }),
    ).rejects.toThrow(/abort/i);
  });
});
