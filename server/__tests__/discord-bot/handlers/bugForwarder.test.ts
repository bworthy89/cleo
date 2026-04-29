import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BotStateStore } from '../../../src/discord-bot/state';
import {
  handleBugThreadCreate,
  mapTagsToLabels,
  truncateBody,
  MAX_TITLE,
  MAX_BODY,
} from '../../../src/discord-bot/handlers/bugForwarder';

const REPO = 'bworthy89/cleo';

function makeCtx(opts: {
  store: BotStateStore;
  threadId: string;
  channelId: string;
  title: string;
  starterText?: string;
  appliedTagNames?: string[];
  username?: string;
  threadUrl?: string;
  starterFails?: boolean;
  createIssueImpl?: jest.Mock;
}) {
  const replies: string[] = [];
  return {
    store: opts.store,
    config: {
      bugReportsChannelId: 'BUGS',
      githubBugRepo: REPO,
      githubBugLabel: 'tester-report',
    },
    thread: {
      id: opts.threadId,
      parentId: opts.channelId,
      name: opts.title,
      url: opts.threadUrl ?? 'https://discord/thread',
      appliedTagNames: opts.appliedTagNames ?? ['crash'],
      reply: jest.fn().mockImplementation(async (s: string) => {
        replies.push(s);
      }),
    },
    fetchStarterMessage: jest.fn().mockImplementation(async () => {
      if (opts.starterFails) throw new Error('not yet available');
      return {
        content: opts.starterText ?? 'something broke',
        author: { username: opts.username ?? 'kari' },
      };
    }),
    starterRetryDelaysMs: [10, 10, 10],
    createIssue:
      opts.createIssueImpl ??
      jest.fn().mockResolvedValue({ number: 142, htmlUrl: `https://github.com/${REPO}/issues/142` }),
    replies,
  };
}

describe('mapTagsToLabels', () => {
  it('maps recognized tags and drops unknowns; always adds tester-report', () => {
    expect(mapTagsToLabels(['crash', 'unknown', 'audio'], 'tester-report')).toEqual([
      'crash',
      'audio',
      'tester-report',
    ]);
    expect(mapTagsToLabels([], 'tester-report')).toEqual(['tester-report']);
  });
});

describe('truncateBody', () => {
  it('truncates oversized bodies and appends an ellipsis', () => {
    const body = 'x'.repeat(MAX_BODY + 1000);
    const out = truncateBody(body);
    expect(out.length).toBeLessThan(MAX_BODY + 1000);
    expect(out.endsWith('…(truncated)')).toBe(true);
  });
  it('leaves small bodies alone', () => {
    expect(truncateBody('short')).toBe('short');
  });
});

describe('handleBugThreadCreate', () => {
  let dir: string;
  let store: BotStateStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-bug-'));
    store = new BotStateStore(dir);
  });
  afterEach(async () => {
    await store.flush();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('creates a GitHub issue, replies with link, persists state', async () => {
    const ctx = makeCtx({ store, threadId: 't1', channelId: 'BUGS', title: 'crash' });
    await handleBugThreadCreate(ctx);

    expect(ctx.createIssue).toHaveBeenCalledTimes(1);
    expect(ctx.replies[0]).toBe(`Filed → ${REPO}#142`);

    await store.flush();
    const map = await store.read<Record<string, unknown>>(
      'bug-thread-issue-map.json',
      {}
    );
    expect(map['t1']).toMatchObject({ status: 'filed', issueNumber: 142, repo: REPO });
  });

  it('truncates titles longer than 200 chars', async () => {
    const longTitle = 't'.repeat(MAX_TITLE + 50);
    const ctx = makeCtx({ store, threadId: 't2', channelId: 'BUGS', title: longTitle });
    await handleBugThreadCreate(ctx);
    const args = ctx.createIssue.mock.calls[0][0];
    expect(args.title.length).toBe(MAX_TITLE);
  });

  it('skips re-firing when state already has a filed entry', async () => {
    await store.write('bug-thread-issue-map.json', {
      t3: { status: 'filed', issueNumber: 99, repo: REPO },
    });
    await store.flush();
    const ctx = makeCtx({ store, threadId: 't3', channelId: 'BUGS', title: 'whatever' });
    await handleBugThreadCreate(ctx);
    expect(ctx.createIssue).not.toHaveBeenCalled();
    expect(ctx.replies).toEqual([]);
  });

  it('skips re-firing when state has a pendingManual entry', async () => {
    await store.write('bug-thread-issue-map.json', {
      t4: { status: 'pendingManual', repo: REPO },
    });
    await store.flush();
    const ctx = makeCtx({ store, threadId: 't4', channelId: 'BUGS', title: 'whatever' });
    await handleBugThreadCreate(ctx);
    expect(ctx.createIssue).not.toHaveBeenCalled();
  });

  it('on GitHub failure, replies with manual-fallback copy and persists pendingManual', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('500'));
    const ctx = makeCtx({
      store,
      threadId: 't5',
      channelId: 'BUGS',
      title: 'fails',
      createIssueImpl: failing,
    });
    await handleBugThreadCreate(ctx);
    expect(ctx.replies[0]).toContain('Producer will pick it up manually');
    await store.flush();
    const map = await store.read<Record<string, unknown>>(
      'bug-thread-issue-map.json',
      {}
    );
    expect(map['t5']).toMatchObject({ status: 'pendingManual', repo: REPO });
  });

  it('ignores threadCreate in other channels', async () => {
    const ctx = makeCtx({ store, threadId: 't6', channelId: 'OTHER', title: 'x' });
    await handleBugThreadCreate(ctx);
    expect(ctx.createIssue).not.toHaveBeenCalled();
  });
});
