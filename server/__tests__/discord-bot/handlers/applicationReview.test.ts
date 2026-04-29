import {
  handleApplyReaction,
  handleReviewButton,
  buildApproveCustomId,
  buildWaitlistCustomId,
  parseReviewCustomId,
} from '../../../src/discord-bot/handlers/applicationReview';
import type { BotConfig } from '../../../src/discord-bot/config';

const config: BotConfig = {
  discord: {
    botToken: 't',
    guildId: '111',
    testFlightUrl: 'https://tf/JOIN',
    startHereMessageId: '401',
    startHereEmoji: '📻',
    timezone: 'America/New_York',
    channels: {
      startHere: '201',
      apply: '202',
      bugReports: '203',
      tonightOnOnay: '204',
      vibeRequests: '205',
      welcome: '206',
    },
    roles: { producer: '301', onAir: '302', charterListener: '303' },
  },
  github: { token: 'g', bugRepo: 'a/b', bugLabel: 'tester-report' },
};

describe('parseReviewCustomId', () => {
  it('round-trips approve', () => {
    const id = buildApproveCustomId('m1', 'a1');
    expect(parseReviewCustomId(id)).toEqual({
      action: 'approve',
      messageId: 'm1',
      authorId: 'a1',
    });
  });
  it('round-trips waitlist', () => {
    const id = buildWaitlistCustomId('m2', 'a2');
    expect(parseReviewCustomId(id)).toEqual({
      action: 'waitlist',
      messageId: 'm2',
      authorId: 'a2',
    });
  });
  it('returns null for unrelated custom ids', () => {
    expect(parseReviewCustomId('something-else')).toBeNull();
  });
});

describe('handleApplyReaction', () => {
  function makeCtx(opts: {
    channelId: string;
    emoji: string;
    reactorId: string;
    authorId: string;
    alreadyHasButtons: boolean;
  }) {
    const replies: Array<{ components: unknown }> = [];
    return {
      config,
      reaction: { channelId: opts.channelId, emoji: opts.emoji },
      reactor: { id: opts.reactorId },
      message: {
        id: 'mApp',
        author: { id: opts.authorId },
        replies: opts.alreadyHasButtons
          ? [{ author: { bot: true }, components: [{}] }]
          : [],
        reply: jest.fn().mockImplementation(async (payload: unknown) => {
          replies.push(payload as { components: unknown });
        }),
      },
      replies,
    };
  }

  it('attaches buttons when the author 📻-reacts to their own post in #apply', async () => {
    const ctx = makeCtx({
      channelId: '202',
      emoji: '📻',
      reactorId: 'aX',
      authorId: 'aX',
      alreadyHasButtons: false,
    });
    await handleApplyReaction(ctx);
    expect(ctx.replies).toHaveLength(1);
    const rendered = JSON.stringify(ctx.replies[0]);
    expect(rendered).toContain('approve:mApp:aX');
    expect(rendered).toContain('waitlist:mApp:aX');
  });

  it('no-ops when reactor is not the author', async () => {
    const ctx = makeCtx({
      channelId: '202',
      emoji: '📻',
      reactorId: 'someoneElse',
      authorId: 'aX',
      alreadyHasButtons: false,
    });
    await handleApplyReaction(ctx);
    expect(ctx.replies).toHaveLength(0);
  });

  it('no-ops when buttons already exist', async () => {
    const ctx = makeCtx({
      channelId: '202',
      emoji: '📻',
      reactorId: 'aX',
      authorId: 'aX',
      alreadyHasButtons: true,
    });
    await handleApplyReaction(ctx);
    expect(ctx.replies).toHaveLength(0);
  });

  it('no-ops in other channels', async () => {
    const ctx = makeCtx({
      channelId: '999',
      emoji: '📻',
      reactorId: 'aX',
      authorId: 'aX',
      alreadyHasButtons: false,
    });
    await handleApplyReaction(ctx);
    expect(ctx.replies).toHaveLength(0);
  });
});

describe('handleReviewButton', () => {
  function makeCtx(opts: {
    customId: string;
    clickerHasProducer?: boolean;
    clickerHasOnAir?: boolean;
    appPostExists?: boolean;
    authorDmThrows?: boolean;
  }) {
    const ephemerals: string[] = [];
    const dms: string[] = [];
    const edits: Array<{ content?: string; components?: unknown[] }> = [];
    const roleAdds: string[] = [];
    const welcomeSends: string[] = [];

    return {
      config,
      interaction: {
        customId: opts.customId,
        memberRoles: new Map<string, unknown>([
          ...(opts.clickerHasProducer ? [['301', {}] as [string, unknown]] : []),
          ...(opts.clickerHasOnAir ? [['302', {}] as [string, unknown]] : []),
        ]),
        reviewer: { id: 'rev1', toString: () => '<@rev1>' },
        replyEphemeral: jest.fn().mockImplementation(async (s: string) => {
          ephemerals.push(s);
        }),
        editButtonsMessage: jest
          .fn()
          .mockImplementation(async (payload: { content?: string; components?: unknown[] }) => {
            edits.push(payload);
          }),
      },
      fetchAppMessage: jest.fn().mockImplementation(async () => {
        if (!opts.appPostExists) throw new Error('Unknown Message');
        return { id: 'mApp', content: 'application body' };
      }),
      fetchAuthorMember: jest.fn().mockResolvedValue({
        user: {
          id: 'aX',
          username: 'kari',
          toString: () => '<@aX>',
        },
        roles: {
          cache: new Map(),
          add: jest.fn().mockImplementation(async (roleId: string) => {
            roleAdds.push(roleId);
          }),
        },
        send: jest.fn().mockImplementation(async (s: string) => {
          if (opts.authorDmThrows) throw new Error('dm closed');
          dms.push(s);
        }),
      }),
      sendInWelcome: jest.fn().mockImplementation(async (s: string) => {
        welcomeSends.push(s);
      }),
      ephemerals,
      dms,
      edits,
      roleAdds,
      welcomeSends,
    };
  }

  it('rejects non-Producer non-OnAir clicks ephemerally', async () => {
    const ctx = makeCtx({
      customId: buildApproveCustomId('mApp', 'aX'),
      appPostExists: true,
    });
    await handleReviewButton(ctx);
    expect(ctx.ephemerals).toHaveLength(1);
    expect(ctx.ephemerals[0]).toContain('Producer');
    expect(ctx.roleAdds).toEqual([]);
  });

  it('approve grants role, DMs author, edits buttons message', async () => {
    const ctx = makeCtx({
      customId: buildApproveCustomId('mApp', 'aX'),
      clickerHasProducer: true,
      appPostExists: true,
    });
    await handleReviewButton(ctx);
    expect(ctx.roleAdds).toEqual(['303']);
    expect(ctx.dms).toHaveLength(1);
    expect(ctx.dms[0]).toContain('https://tf/JOIN');
    expect(ctx.edits).toHaveLength(1);
    expect(ctx.edits[0].components).toEqual([]);
    expect(ctx.edits[0].content).toContain('Approved by <@rev1>');
  });

  it('waitlist DMs author with the waitlist copy and edits buttons message', async () => {
    const ctx = makeCtx({
      customId: buildWaitlistCustomId('mApp', 'aX'),
      clickerHasOnAir: true,
      appPostExists: true,
    });
    await handleReviewButton(ctx);
    expect(ctx.roleAdds).toEqual([]);
    expect(ctx.dms).toHaveLength(1);
    expect(ctx.dms[0]).toContain('waitlist');
    expect(ctx.edits[0].content).toContain('Waitlisted by <@rev1>');
  });

  it('handles deleted application post by replying ephemerally', async () => {
    const ctx = makeCtx({
      customId: buildApproveCustomId('mApp', 'aX'),
      clickerHasProducer: true,
      appPostExists: false,
    });
    await handleReviewButton(ctx);
    expect(ctx.ephemerals).toHaveLength(1);
    expect(ctx.ephemerals[0]).toContain("Couldn't find");
    expect(ctx.roleAdds).toEqual([]);
  });

  it('falls back to #welcome nudge on approve when DM closed', async () => {
    const ctx = makeCtx({
      customId: buildApproveCustomId('mApp', 'aX'),
      clickerHasProducer: true,
      appPostExists: true,
      authorDmThrows: true,
    });
    await handleReviewButton(ctx);
    expect(ctx.roleAdds).toEqual(['303']);
    expect(ctx.welcomeSends).toHaveLength(1);
    expect(ctx.welcomeSends[0]).toContain('https://tf/JOIN');
  });
});
