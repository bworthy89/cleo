import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Guild,
  type GuildMember,
  type TextChannel,
  type ForumChannel,
  type Message,
  type ButtonInteraction,
  type MessageReaction,
  type User,
  type PartialMessageReaction,
  type PartialUser,
  type AnyThreadChannel,
} from 'discord.js';
import * as cron from 'node-cron';
import * as path from 'path';
import { loadBotConfig, type BotConfig } from './config';
import { BotStateStore, type LastDigests } from './state';
import { GitHubClient } from './github';
import { handleStartHereReaction } from './handlers/onboarding';
import {
  handleApplyReaction,
  handleReviewButton,
  parseReviewCustomId,
} from './handlers/applicationReview';
import {
  collectVoteCandidates,
  composeVoteDigest,
  type VoteMessage,
} from './handlers/voteTally';
import { handleBugThreadCreate } from './handlers/bugForwarder';
import { composeVibeDigest, type VibePitch } from './handlers/vibeDigest';

const HEARTBEAT_MS = 60_000;
const STATE_DIR = path.resolve(process.cwd(), '.bot-state');

export async function start(): Promise<void> {
  const config = loadBotConfig();
  const store = new BotStateStore(STATE_DIR);
  const github = new GitHubClient({ token: config.github.token, repo: config.github.bugRepo });

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  });

  client.on(Events.Error, (err) => console.error('[bot:gateway] error', err));
  client.on(Events.ShardError, (err) => console.error('[bot:gateway] shard error', err));

  let guild: Guild | null = null;
  let lastEventAt = new Date().toISOString();

  client.on(Events.ClientReady, async () => {
    guild = await client.guilds.fetch(config.discord.guildId);
    console.log(
      `[bot:bootstrap] event=ready guild=${guild.id} members=${guild.memberCount ?? '?'}`
    );
    schedule(client, config, store, () => guild!);
    setInterval(() => {
      console.log(
        `[bot:heartbeat] members=${guild?.memberCount ?? '?'} ws=${client.ws.ping}ms lastEvent=${lastEventAt}`
      );
    }, HEARTBEAT_MS);
  });

  client.on(Events.MessageReactionAdd, async (reaction, user) => {
    lastEventAt = new Date().toISOString();
    try {
      const r = await ensureFullReaction(reaction);
      const u = await ensureFullUser(user);
      if (u.bot) return;
      await routeReaction(r, u, client, config, () => guild!);
    } catch (err) {
      console.error('[bot:reaction] dispatch failed', err);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    lastEventAt = new Date().toISOString();
    try {
      if (!interaction.isButton()) return;
      const parsed = parseReviewCustomId(interaction.customId);
      if (!parsed) return;
      await routeReviewButton(interaction, client, config, () => guild!);
    } catch (err) {
      console.error('[bot:interaction] dispatch failed', err);
    }
  });

  client.on(Events.ThreadCreate, async (thread, newlyCreated) => {
    lastEventAt = new Date().toISOString();
    if (!newlyCreated) return;
    try {
      await routeBugThread(thread, store, config, github, () => guild!);
    } catch (err) {
      console.error('[bot:thread] dispatch failed', err);
    }
  });

  await client.login(config.discord.botToken);
}

async function ensureFullReaction(
  r: MessageReaction | PartialMessageReaction
): Promise<MessageReaction> {
  return r.partial ? await r.fetch() : r;
}
async function ensureFullUser(u: User | PartialUser): Promise<User> {
  return u.partial ? await u.fetch() : u;
}

async function routeReaction(
  reaction: MessageReaction,
  user: User,
  client: Client,
  config: BotConfig,
  getGuild: () => Guild
): Promise<void> {
  const emojiName = reaction.emoji.name ?? '';
  const channelId = reaction.message.channelId;

  if (reaction.message.id === config.discord.startHereMessageId) {
    const guild = getGuild();
    await handleStartHereReaction({
      config,
      reaction: { messageId: reaction.message.id, emoji: emojiName },
      reactor: { id: user.id },
      fetchMember: async (uid) => {
        const member = await guild.members.fetch(uid);
        return memberToLike(member);
      },
      sendInWelcome: async (content) => {
        const ch = (await client.channels.fetch(config.discord.channels.welcome)) as TextChannel;
        await ch.send(content);
      },
    });
    return;
  }

  if (channelId === config.discord.channels.apply) {
    const message = reaction.message.partial
      ? await reaction.message.fetch()
      : (reaction.message as Message);
    // Single batch of 100 (Discord's per-call max). Apply-channel reactions
    // are a hot path, so we don't paginate unbounded — if 100+ messages
    // pile up between an application post and the bot's button reply, the
    // dedup check has bigger problems than this fetch can solve.
    const repliesColl = await message.channel.messages.fetch({
      after: message.id,
      limit: 100,
    });
    const replies = Array.from(repliesColl.values()).filter(
      (m) => m.reference?.messageId === message.id
    );
    await handleApplyReaction({
      config,
      reaction: { channelId, emoji: emojiName },
      reactor: { id: user.id },
      message: {
        id: message.id,
        author: { id: message.author.id },
        replies: replies.map((m) => ({
          author: { bot: m.author.bot },
          components: m.components ?? [],
        })),
        reply: async (payload) => {
          await message.reply(payload as Parameters<Message['reply']>[0]);
        },
      },
    });
  }
}

async function routeReviewButton(
  interaction: ButtonInteraction,
  client: Client,
  config: BotConfig,
  getGuild: () => Guild
): Promise<void> {
  const guild = getGuild();
  const memberRoles = (interaction.member?.roles ?? null) as
    | { cache: Map<string, unknown> }
    | null;
  const cache = memberRoles?.cache ?? new Map<string, unknown>();
  const applyChannel = (await client.channels.fetch(
    config.discord.channels.apply
  )) as TextChannel;

  await interaction.deferUpdate();

  await handleReviewButton({
    config,
    interaction: {
      customId: interaction.customId,
      memberRoles: cache,
      reviewer: { id: interaction.user.id, toString: () => `<@${interaction.user.id}>` },
      replyEphemeral: async (content) => {
        await interaction.followUp({ content, ephemeral: true });
      },
      editButtonsMessage: async (payload) => {
        await interaction.editReply({ content: payload.content, components: [] });
      },
    },
    fetchAppMessage: async (messageId) => {
      const m = await applyChannel.messages.fetch(messageId);
      return { id: m.id, content: m.content };
    },
    fetchAuthorMember: async (uid) => {
      const member = await guild.members.fetch(uid);
      return memberToLike(member);
    },
    sendInWelcome: async (content) => {
      const ch = (await client.channels.fetch(
        config.discord.channels.welcome
      )) as TextChannel;
      await ch.send(content);
    },
  });
}

async function routeBugThread(
  thread: AnyThreadChannel,
  store: BotStateStore,
  config: BotConfig,
  github: GitHubClient,
  getGuild: () => Guild
): Promise<void> {
  if (thread.parentId !== config.discord.channels.bugReports) return;

  const tagNames: string[] = [];
  const parent = thread.parent as ForumChannel | null;
  if (parent && 'availableTags' in parent && Array.isArray(thread.appliedTags)) {
    for (const tagId of thread.appliedTags) {
      const tag = parent.availableTags.find((t) => t.id === tagId);
      if (tag) tagNames.push(tag.name);
    }
  }

  const threadUrl = `https://discord.com/channels/${getGuild().id}/${thread.id}`;

  await handleBugThreadCreate({
    store,
    config: {
      bugReportsChannelId: config.discord.channels.bugReports,
      githubBugRepo: config.github.bugRepo,
      githubBugLabel: config.github.bugLabel,
    },
    thread: {
      id: thread.id,
      parentId: thread.parentId ?? '',
      name: thread.name,
      url: threadUrl,
      appliedTagNames: tagNames,
      reply: async (s: string) => {
        await thread.send(s);
      },
    },
    fetchStarterMessage: async () => {
      const starter = await thread.fetchStarterMessage();
      if (!starter) throw new Error('starter message not yet available');
      return { content: starter.content, author: { username: starter.author.username } };
    },
    starterRetryDelaysMs: [1_000, 1_500, 2_500],
    createIssue: (input) => github.createIssue(input),
  });
}

function memberToLike(member: GuildMember) {
  return {
    user: {
      id: member.user.id,
      username: member.user.username,
      toString: () => `<@${member.user.id}>`,
    },
    roles: {
      cache: member.roles.cache,
      add: async (roleId: string) => {
        await member.roles.add(roleId);
      },
    },
    send: async (content: string) => {
      await member.send(content);
    },
  };
}

/**
 * Paginate channel messages backwards from newest, calling `onMessage` for
 * each message NEWER THAN `sinceMs`. Stops when a batch crosses the cutoff
 * or when no more messages are returned, whichever comes first. Defensive
 * cap at `MAX_PAGES * 100` so a misconfigured `sinceMs` can't iterate the
 * channel's entire history.
 */
const MAX_PAGES = 50; // 5000-message hard cap — far above any realistic v1 window
async function fetchMessagesSince(
  channel: TextChannel,
  sinceMs: number,
  onMessage: (m: Message) => Promise<void>
): Promise<void> {
  let before: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (batch.size === 0) return;
    let crossedCutoff = false;
    for (const m of batch.values()) {
      if (m.createdTimestamp < sinceMs) {
        crossedCutoff = true;
        continue;
      }
      await onMessage(m);
    }
    if (crossedCutoff) return;
    before = batch.last()?.id;
    if (!before) return;
  }
  console.warn(
    `[bot:fetchMessagesSince] hit MAX_PAGES=${MAX_PAGES} cap on channel=${channel.id} since=${new Date(sinceMs).toISOString()}`
  );
}

async function fetchFireReactors(m: Message): Promise<string[]> {
  const fireReaction = m.reactions.cache.find((r) => r.emoji.name === '🔥');
  if (!fireReaction) return [];
  const users = await fireReaction.users.fetch();
  return users.filter((u) => !u.bot).map((u) => u.id);
}

function schedule(
  client: Client,
  config: BotConfig,
  store: BotStateStore,
  getGuild: () => Guild
): void {
  cron.schedule(
    '0 0 * * *',
    () => {
      runVoteTally(client, config, store, getGuild).catch((err) =>
        console.error('[bot:voteTally] cron failed', err)
      );
    },
    { timezone: config.discord.timezone }
  );
  cron.schedule(
    '0 21 * * 0',
    () => {
      runVibeDigest(client, config, store, getGuild).catch((err) =>
        console.error('[bot:vibeDigest] cron failed', err)
      );
    },
    { timezone: config.discord.timezone }
  );
  console.log('[bot:bootstrap] event=cron-scheduled tz=' + config.discord.timezone);
}

async function runVoteTally(
  client: Client,
  config: BotConfig,
  store: BotStateStore,
  getGuild: () => Guild
): Promise<void> {
  const last = await store.read<LastDigests>('last-digests.json', {});
  const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
  if (last.voteDigestAt && new Date(last.voteDigestAt).getTime() > sinceMs) {
    console.log('[bot:voteTally] event=already-ran-this-window');
    return;
  }
  const guild = getGuild();
  const channel = (await client.channels.fetch(config.discord.channels.tonightOnOnay)) as TextChannel;

  const recent: VoteMessage[] = [];
  await fetchMessagesSince(channel, sinceMs, async (m) => {
    recent.push({
      id: m.id,
      authorId: m.author.id,
      content: m.content,
      fireReactors: await fetchFireReactors(m),
    });
  });

  const producerCache = new Map<string, boolean>();
  const isProducer = async (uid: string): Promise<boolean> => {
    if (producerCache.has(uid)) return producerCache.get(uid)!;
    try {
      const member = await guild.members.fetch(uid);
      const has = member.roles.cache.has(config.discord.roles.producer);
      producerCache.set(uid, has);
      return has;
    } catch {
      producerCache.set(uid, false);
      return false;
    }
  };
  for (const c of recent) await isProducer(c.authorId);

  const candidates = collectVoteCandidates(recent, (id) => producerCache.get(id) === true);
  const digest = composeVoteDigest(candidates);
  if (!digest) {
    console.log('[bot:voteTally] event=empty-window');
    return;
  }
  await channel.send(digest);
  await store.write('last-digests.json', {
    ...last,
    voteDigestAt: new Date().toISOString(),
  });
  console.log('[bot:voteTally] event=posted candidates=' + candidates.length);
}

async function runVibeDigest(
  client: Client,
  config: BotConfig,
  store: BotStateStore,
  _getGuild: () => Guild
): Promise<void> {
  const last = await store.read<LastDigests>('last-digests.json', {});
  const sinceMs = last.vibeDigestAt
    ? new Date(last.vibeDigestAt).getTime()
    : Date.now() - 7 * 24 * 60 * 60 * 1000;
  const channel = (await client.channels.fetch(
    config.discord.channels.vibeRequests
  )) as TextChannel;

  const pitches: VibePitch[] = [];
  await fetchMessagesSince(channel, sinceMs, async (m) => {
    if (m.author.bot) return;
    pitches.push({
      id: m.id,
      authorUsername: m.author.username,
      content: m.content,
      jumpUrl: `https://discord.com/channels/${m.guildId ?? ''}/${m.channelId}/${m.id}`,
      fireReactors: await fetchFireReactors(m),
      createdAt: new Date(m.createdTimestamp).toISOString(),
    });
  });

  const digest = composeVibeDigest(pitches);
  if (!digest) {
    console.log('[bot:vibeDigest] event=empty-window');
    return;
  }
  await channel.send(digest);
  await store.write('last-digests.json', {
    ...last,
    vibeDigestAt: new Date().toISOString(),
  });
  console.log('[bot:vibeDigest] event=posted pitches=' + pitches.length);
}
