import { loadBotConfig } from '../../src/discord-bot/config';

describe('loadBotConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('parses a valid env into a typed config', () => {
    const cfg = loadBotConfig();
    expect(cfg.discord.botToken).toBe('test-bot-token');
    expect(cfg.discord.guildId).toBe('111');
    expect(cfg.discord.testFlightUrl).toBe('https://testflight.apple.com/join/TEST');
    expect(cfg.discord.channels.startHere).toBe('201');
    expect(cfg.discord.channels.welcome).toBe('206');
    expect(cfg.discord.roles.producer).toBe('301');
    expect(cfg.discord.startHereMessageId).toBe('401');
    expect(cfg.discord.startHereEmoji).toBe('📻');
    expect(cfg.discord.timezone).toBe('America/New_York');
    expect(cfg.github.token).toBe('test-github-token');
    expect(cfg.github.bugRepo).toBe('bworthy89/cleo');
    expect(cfg.github.bugLabel).toBe('tester-report');
  });

  it('throws a descriptive error when DISCORD_BOT_TOKEN is missing', () => {
    delete process.env.DISCORD_BOT_TOKEN;
    expect(() => loadBotConfig()).toThrow(/DISCORD_BOT_TOKEN/);
  });

  it('throws when GITHUB_BUG_REPO is not in owner/repo form', () => {
    process.env.GITHUB_BUG_REPO = 'not-a-slug';
    expect(() => loadBotConfig()).toThrow(/GITHUB_BUG_REPO/);
  });

  it('defaults DISCORD_START_HERE_EMOJI to 📻 when unset', () => {
    delete process.env.DISCORD_START_HERE_EMOJI;
    const cfg = loadBotConfig();
    expect(cfg.discord.startHereEmoji).toBe('📻');
  });
});
