import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import nock from 'nock';
import { BotStateStore } from '../../src/discord-bot/state';
import { GitHubClient } from '../../src/discord-bot/github';
import { handleBugThreadCreate } from '../../src/discord-bot/handlers/bugForwarder';

describe('integration: bug forwarder + state survives restart', () => {
  const REPO = 'bworthy89/cleo';
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-int-'));
    nock.disableNetConnect();
  });
  afterEach(async () => {
    nock.cleanAll();
    nock.enableNetConnect();
    await fs.rm(dir, { recursive: true, force: true });
  });

  function ctxFor(threadId: string, github: GitHubClient, store: BotStateStore) {
    const replies: string[] = [];
    return {
      store,
      config: {
        bugReportsChannelId: 'BUGS',
        githubBugRepo: REPO,
        githubBugLabel: 'tester-report',
      },
      thread: {
        id: threadId,
        parentId: 'BUGS',
        name: 'crash on bake',
        url: 'https://discord/thread',
        appliedTagNames: ['crash'],
        reply: jest.fn().mockImplementation(async (s: string) => {
          replies.push(s);
        }),
      },
      fetchStarterMessage: jest.fn().mockResolvedValue({
        content: 'it crashed',
        author: { username: 'kari' },
      }),
      starterRetryDelaysMs: [10],
      createIssue: (input: { title: string; body: string; labels: string[] }) =>
        github.createIssue(input),
      replies,
    };
  }

  it('re-fired threadCreate after restart does not double-create on GitHub', async () => {
    nock('https://api.github.com')
      .post(`/repos/${REPO}/issues`)
      .reply(201, { number: 42, html_url: `https://github.com/${REPO}/issues/42` });

    // First "process lifetime"
    const store1 = new BotStateStore(dir);
    const gh1 = new GitHubClient({ token: 'tk', repo: REPO, retryDelaysMs: [] });
    const ctx1 = ctxFor('threadX', gh1, store1);
    await handleBugThreadCreate(ctx1);
    expect(ctx1.replies[0]).toBe(`Filed → ${REPO}#42`);
    await store1.flush();

    // Second "process lifetime" — fresh store + GitHub mock, but state file persists
    nock('https://api.github.com')
      .post(`/repos/${REPO}/issues`)
      .reply(500); // would fail loudly if called

    const store2 = new BotStateStore(dir);
    const gh2 = new GitHubClient({ token: 'tk', repo: REPO, retryDelaysMs: [] });
    const ctx2 = ctxFor('threadX', gh2, store2);
    await handleBugThreadCreate(ctx2);
    expect(ctx2.replies).toEqual([]); // skipped silently
    expect(nock.pendingMocks()).toHaveLength(1); // 500 mock was never hit
  });
});
