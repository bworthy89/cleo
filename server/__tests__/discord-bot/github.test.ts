import nock from 'nock';
import { GitHubClient } from '../../src/discord-bot/github';

const TOKEN = 'test-github-token';
const REPO = 'bworthy89/cleo';

describe('GitHubClient', () => {
  beforeEach(() => {
    nock.disableNetConnect();
  });
  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('creates an issue and returns the issue number', async () => {
    nock('https://api.github.com')
      .post(`/repos/${REPO}/issues`, (body) => {
        expect(body.title).toBe('Crash on bake');
        expect(body.body).toContain('Filed from Discord');
        expect(body.labels).toEqual(['crash', 'tester-report']);
        return true;
      })
      .reply(201, { number: 142, html_url: `https://github.com/${REPO}/issues/142` });

    const client = new GitHubClient({ token: TOKEN, repo: REPO });
    const result = await client.createIssue({
      title: 'Crash on bake',
      body: 'Steps...\n\n---\n_Filed from Discord by @kari — [thread](https://x)_',
      labels: ['crash', 'tester-report'],
    });
    expect(result.number).toBe(142);
  });

  it('retries on transient 5xx then succeeds', async () => {
    nock('https://api.github.com')
      .post(`/repos/${REPO}/issues`)
      .reply(500, { message: 'Server error' });
    nock('https://api.github.com')
      .post(`/repos/${REPO}/issues`)
      .reply(201, { number: 7, html_url: 'https://x' });

    const client = new GitHubClient({
      token: TOKEN,
      repo: REPO,
      retryDelaysMs: [10, 10, 10],
    });
    const result = await client.createIssue({ title: 't', body: 'b', labels: [] });
    expect(result.number).toBe(7);
  });

  it('throws after exhausting all retries', async () => {
    for (let i = 0; i < 3; i++) {
      nock('https://api.github.com')
        .post(`/repos/${REPO}/issues`)
        .reply(500, { message: 'Server error' });
    }

    const client = new GitHubClient({
      token: TOKEN,
      repo: REPO,
      retryDelaysMs: [5, 5, 5],
    });
    await expect(
      client.createIssue({ title: 't', body: 'b', labels: [] })
    ).rejects.toThrow();
  });
});
