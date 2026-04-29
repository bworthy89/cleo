import { handleStartHereReaction } from '../../../src/discord-bot/handlers/onboarding';
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

function makeMember(opts: { hasCharter: boolean; dmThrows?: boolean }) {
  const sent: string[] = [];
  const added: string[] = [];
  return {
    user: { id: 'u1', username: 'kari', toString: () => '<@u1>' },
    roles: {
      cache: new Map(opts.hasCharter ? [['303', {}]] : []),
      add: jest.fn().mockImplementation(async (roleId: string) => {
        added.push(roleId);
      }),
    },
    send: jest.fn().mockImplementation(async (content: string) => {
      if (opts.dmThrows) throw new Error('Cannot send messages to this user');
      sent.push(content);
    }),
    sent,
    added,
  };
}

describe('handleStartHereReaction', () => {
  function makeCtx(member: ReturnType<typeof makeMember>) {
    const welcomeSends: string[] = [];
    return {
      config,
      reaction: { messageId: '401', emoji: '📻' },
      reactor: { id: 'u1' },
      fetchMember: jest.fn().mockResolvedValue(member),
      sendInWelcome: jest.fn().mockImplementation(async (s: string) => {
        welcomeSends.push(s);
      }),
      welcomeSends,
    };
  }

  it('grants the role and DMs the TestFlight link', async () => {
    const member = makeMember({ hasCharter: false });
    const ctx = makeCtx(member);
    await handleStartHereReaction(ctx);
    expect(member.added).toEqual(['303']);
    expect(member.sent[0]).toContain('https://tf/JOIN');
    expect(member.sent[0]).toContain("you're in");
    expect(ctx.welcomeSends).toEqual([]);
  });

  it('no-ops when reactor already has @Charter Listener', async () => {
    const member = makeMember({ hasCharter: true });
    const ctx = makeCtx(member);
    await handleStartHereReaction(ctx);
    expect(member.added).toEqual([]);
    expect(member.sent).toEqual([]);
  });

  it('falls back to a #welcome nudge when DM is disabled', async () => {
    const member = makeMember({ hasCharter: false, dmThrows: true });
    const ctx = makeCtx(member);
    await handleStartHereReaction(ctx);
    expect(member.added).toEqual(['303']);
    expect(ctx.welcomeSends).toHaveLength(1);
    expect(ctx.welcomeSends[0]).toContain('https://tf/JOIN');
  });

  it('ignores reactions on other messages', async () => {
    const member = makeMember({ hasCharter: false });
    const ctx = makeCtx(member);
    ctx.reaction = { messageId: '999', emoji: '📻' };
    await handleStartHereReaction(ctx);
    expect(member.added).toEqual([]);
  });

  it('ignores reactions with the wrong emoji', async () => {
    const member = makeMember({ hasCharter: false });
    const ctx = makeCtx(member);
    ctx.reaction = { messageId: '401', emoji: '👍' };
    await handleStartHereReaction(ctx);
    expect(member.added).toEqual([]);
  });
});
