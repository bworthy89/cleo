import { COPY } from '../copy';
import type { BotStateStore, BugEntry, BugThreadIssueMap } from '../state';

export const MAX_TITLE = 200;
export const MAX_BODY = 60_000;

const RECOGNIZED_TAGS = new Set([
  'crash',
  'audio',
  'ui',
  'bake-failure',
  'onay-script',
  'auth',
  'other',
]);

export function mapTagsToLabels(tagNames: string[], constLabel: string): string[] {
  const recognized = tagNames.filter((t) => RECOGNIZED_TAGS.has(t));
  return [...recognized, constLabel];
}

export function truncateBody(body: string): string {
  if (body.length <= MAX_BODY) return body;
  return body.slice(0, MAX_BODY) + COPY.bugTruncated;
}

export interface BugForwarderContext {
  store: BotStateStore;
  config: {
    bugReportsChannelId: string;
    githubBugRepo: string;
    githubBugLabel: string;
  };
  thread: {
    id: string;
    parentId: string;
    name: string;
    url: string;
    appliedTagNames: string[];
    reply(content: string): Promise<unknown>;
  };
  fetchStarterMessage(): Promise<{ content: string; author: { username: string } }>;
  starterRetryDelaysMs: number[];
  createIssue(input: {
    title: string;
    body: string;
    labels: string[];
  }): Promise<{ number: number; htmlUrl: string }>;
}

async function fetchStarterWithRetry(
  ctx: BugForwarderContext
): Promise<{ content: string; author: { username: string } } | null> {
  for (let i = 0; i <= ctx.starterRetryDelaysMs.length; i++) {
    try {
      return await ctx.fetchStarterMessage();
    } catch {
      if (i < ctx.starterRetryDelaysMs.length) {
        await new Promise((r) => setTimeout(r, ctx.starterRetryDelaysMs[i]));
      }
    }
  }
  return null;
}

const ERROR_MSG_MAX = 500;

function summarizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.length > ERROR_MSG_MAX ? raw.slice(0, ERROR_MSG_MAX) + '…' : raw;
}

export async function handleBugThreadCreate(ctx: BugForwarderContext): Promise<void> {
  if (ctx.thread.parentId !== ctx.config.bugReportsChannelId) return;

  // Hold the bug-thread-issue-map lock for the whole "check → call GitHub →
  // record result" flow. This is the only call site that mutates this file,
  // so per-file serialization is enough. Two concurrent threadCreate events
  // for the same thread (gateway re-delivery) can't both pass the dedup
  // check and create duplicate issues.
  type Outcome =
    | { kind: 'skipped' }
    | { kind: 'starter-unavailable' }
    | { kind: 'filed'; issueNumber: number }
    | { kind: 'pendingManual' };
  const outcomeRef: { value: Outcome } = { value: { kind: 'skipped' } };

  await ctx.store.update<BugThreadIssueMap>(
    'bug-thread-issue-map.json',
    {},
    async (map) => {
      if (map[ctx.thread.id]) {
        console.log(
          `[bot:bugForwarder] event=skip-duplicate thread=${ctx.thread.id} status=${map[ctx.thread.id].status}`
        );
        outcomeRef.value = { kind: 'skipped' };
        return map;
      }

      const starter = await fetchStarterWithRetry(ctx);
      if (!starter) {
        console.error(
          `[bot:bugForwarder] event=starter-unavailable thread=${ctx.thread.id}`
        );
        outcomeRef.value = { kind: 'starter-unavailable' };
        return map;
      }

      const title =
        ctx.thread.name.length > MAX_TITLE
          ? ctx.thread.name.slice(0, MAX_TITLE)
          : ctx.thread.name;
      const body = truncateBody(
        starter.content + COPY.bugBodyFooter(starter.author.username, ctx.thread.url)
      );
      const labels = mapTagsToLabels(ctx.thread.appliedTagNames, ctx.config.githubBugLabel);

      try {
        const issue = await ctx.createIssue({ title, body, labels });
        const entry: BugEntry = {
          status: 'filed',
          repo: ctx.config.githubBugRepo,
          issueNumber: issue.number,
          filedAt: new Date().toISOString(),
        };
        outcomeRef.value = { kind: 'filed', issueNumber: issue.number };
        return { ...map, [ctx.thread.id]: entry };
      } catch (err) {
        console.error(
          `[bot:bugForwarder] event=create-failed thread=${ctx.thread.id}`,
          err
        );
        const entry: BugEntry = {
          status: 'pendingManual',
          repo: ctx.config.githubBugRepo,
          lastErrorAt: new Date().toISOString(),
          lastError: summarizeError(err),
        };
        outcomeRef.value = { kind: 'pendingManual' };
        return { ...map, [ctx.thread.id]: entry };
      }
    }
  );

  // Reply in-thread AFTER the lock is released — Discord round-trip
  // doesn't need to hold up other concurrent updates.
  const outcome = outcomeRef.value;
  if (outcome.kind === 'filed') {
    await ctx.thread.reply(COPY.bugFiled(ctx.config.githubBugRepo, outcome.issueNumber));
    console.log(
      `[bot:bugForwarder] event=filed thread=${ctx.thread.id} issue=${outcome.issueNumber}`
    );
  } else if (outcome.kind === 'pendingManual') {
    await ctx.thread.reply(COPY.bugFileFailed);
  }
}
