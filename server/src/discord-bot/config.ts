import { z } from 'zod';

const RepoSlug = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'must be in "owner/repo" form');

const EnvSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  DISCORD_TESTFLIGHT_URL: z.string().url(),
  DISCORD_CHANNEL_START_HERE: z.string().min(1),
  DISCORD_CHANNEL_APPLY: z.string().min(1),
  DISCORD_CHANNEL_BUG_REPORTS: z.string().min(1),
  DISCORD_CHANNEL_TONIGHT_ON_ONAY: z.string().min(1),
  DISCORD_CHANNEL_VIBE_REQUESTS: z.string().min(1),
  DISCORD_CHANNEL_WELCOME: z.string().min(1),
  DISCORD_ROLE_PRODUCER: z.string().min(1),
  DISCORD_ROLE_ON_AIR: z.string().min(1),
  DISCORD_ROLE_CHARTER_LISTENER: z.string().min(1),
  DISCORD_START_HERE_MESSAGE_ID: z.string().min(1),
  DISCORD_START_HERE_EMOJI: z.string().min(1).default('📻'),
  DISCORD_TIMEZONE: z.string().min(1).default('America/New_York'),
  GITHUB_TOKEN: z.string().min(1),
  GITHUB_BUG_REPO: RepoSlug,
  GITHUB_BUG_LABEL: z.string().min(1).default('tester-report'),
});

export interface BotConfig {
  discord: {
    botToken: string;
    guildId: string;
    testFlightUrl: string;
    startHereMessageId: string;
    startHereEmoji: string;
    timezone: string;
    channels: {
      startHere: string;
      apply: string;
      bugReports: string;
      tonightOnOnay: string;
      vibeRequests: string;
      welcome: string;
    };
    roles: {
      producer: string;
      onAir: string;
      charterListener: string;
    };
  };
  github: {
    token: string;
    bugRepo: string; // "owner/repo"
    bugLabel: string;
  };
}

export function loadBotConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('\n  ');
    throw new Error(`[bot:config] invalid env:\n  ${issues}`);
  }
  const e = parsed.data;
  return {
    discord: {
      botToken: e.DISCORD_BOT_TOKEN,
      guildId: e.DISCORD_GUILD_ID,
      testFlightUrl: e.DISCORD_TESTFLIGHT_URL,
      startHereMessageId: e.DISCORD_START_HERE_MESSAGE_ID,
      startHereEmoji: e.DISCORD_START_HERE_EMOJI,
      timezone: e.DISCORD_TIMEZONE,
      channels: {
        startHere: e.DISCORD_CHANNEL_START_HERE,
        apply: e.DISCORD_CHANNEL_APPLY,
        bugReports: e.DISCORD_CHANNEL_BUG_REPORTS,
        tonightOnOnay: e.DISCORD_CHANNEL_TONIGHT_ON_ONAY,
        vibeRequests: e.DISCORD_CHANNEL_VIBE_REQUESTS,
        welcome: e.DISCORD_CHANNEL_WELCOME,
      },
      roles: {
        producer: e.DISCORD_ROLE_PRODUCER,
        onAir: e.DISCORD_ROLE_ON_AIR,
        charterListener: e.DISCORD_ROLE_CHARTER_LISTENER,
      },
    },
    github: {
      token: e.GITHUB_TOKEN,
      bugRepo: e.GITHUB_BUG_REPO,
      bugLabel: e.GITHUB_BUG_LABEL,
    },
  };
}
