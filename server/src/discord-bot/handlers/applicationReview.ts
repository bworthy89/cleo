import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { COPY } from '../copy';
import type { BotConfig } from '../config';
import type { MemberLike } from './onboarding';

export function buildApproveCustomId(messageId: string, authorId: string): string {
  return `approve:${messageId}:${authorId}`;
}
export function buildWaitlistCustomId(messageId: string, authorId: string): string {
  return `waitlist:${messageId}:${authorId}`;
}

export interface ParsedReviewCustomId {
  action: 'approve' | 'waitlist';
  messageId: string;
  authorId: string;
}
export function parseReviewCustomId(customId: string): ParsedReviewCustomId | null {
  const parts = customId.split(':');
  if (parts.length !== 3) return null;
  const [action, messageId, authorId] = parts;
  if (action !== 'approve' && action !== 'waitlist') return null;
  if (!messageId || !authorId) return null;
  return { action, messageId, authorId };
}

export interface ApplyReactionContext {
  config: BotConfig;
  reaction: { channelId: string; emoji: string };
  reactor: { id: string };
  message: {
    id: string;
    author: { id: string };
    replies: Array<{ author: { bot: boolean }; components: unknown[] }>;
    reply(payload: { components: unknown[] }): Promise<unknown>;
  };
}

export async function handleApplyReaction(ctx: ApplyReactionContext): Promise<void> {
  const { config, reaction, reactor, message } = ctx;
  if (reaction.channelId !== config.discord.channels.apply) return;
  if (reaction.emoji !== config.discord.startHereEmoji) return;
  if (reactor.id !== message.author.id) return;

  const alreadyAttached = message.replies.some(
    (r) => r.author.bot && Array.isArray(r.components) && r.components.length > 0
  );
  if (alreadyAttached) return;

  const approve = new ButtonBuilder()
    .setCustomId(buildApproveCustomId(message.id, message.author.id))
    .setLabel('Approve')
    .setStyle(ButtonStyle.Success);
  const waitlist = new ButtonBuilder()
    .setCustomId(buildWaitlistCustomId(message.id, message.author.id))
    .setLabel('Waitlist')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(approve, waitlist);
  await message.reply({ components: [row] });
  console.log(`[bot:applicationReview] event=buttons-attached author=${message.author.id}`);
}

export interface ReviewButtonContext {
  config: BotConfig;
  interaction: {
    customId: string;
    memberRoles: Map<string, unknown> | { has(id: string): boolean };
    reviewer: { id: string; toString(): string };
    replyEphemeral(content: string): Promise<unknown>;
    editButtonsMessage(payload: { content?: string; components?: unknown[] }): Promise<unknown>;
  };
  fetchAppMessage(messageId: string): Promise<{ id: string; content: string }>;
  fetchAuthorMember(userId: string): Promise<MemberLike>;
  sendInWelcome(content: string): Promise<unknown>;
}

function rolesHas(roles: ReviewButtonContext['interaction']['memberRoles'], id: string): boolean {
  if (roles instanceof Map) return roles.has(id);
  return (roles as { has(id: string): boolean }).has(id);
}

export async function handleReviewButton(ctx: ReviewButtonContext): Promise<void> {
  const parsed = parseReviewCustomId(ctx.interaction.customId);
  if (!parsed) return;
  const { config, interaction } = ctx;

  const isAllowed =
    rolesHas(interaction.memberRoles, config.discord.roles.producer) ||
    rolesHas(interaction.memberRoles, config.discord.roles.onAir);
  if (!isAllowed) {
    await interaction.replyEphemeral(COPY.notAuthorized);
    return;
  }

  try {
    await ctx.fetchAppMessage(parsed.messageId);
  } catch {
    await interaction.replyEphemeral(COPY.applicationPostMissing);
    return;
  }

  const author = await ctx.fetchAuthorMember(parsed.authorId);

  if (parsed.action === 'approve') {
    await author.roles.add(config.discord.roles.charterListener);
    const dm = COPY.approvalDM(config.discord.testFlightUrl);
    try {
      await author.send(dm);
    } catch (err) {
      console.error(
        `[bot:applicationReview] event=dm-failed author=${parsed.authorId} fallback=welcome-nudge`,
        err
      );
      await ctx.sendInWelcome(
        COPY.dmDisabledNudge(author.user.toString(), config.discord.testFlightUrl)
      );
    }
    await interaction.editButtonsMessage({
      content: COPY.approvedFooter(interaction.reviewer.toString()),
      components: [],
    });
    console.log(
      `[bot:applicationReview] event=approved reviewer=${interaction.reviewer.id} author=${parsed.authorId}`
    );
  } else {
    try {
      await author.send(COPY.waitlistDM);
    } catch (err) {
      console.error(
        `[bot:applicationReview] event=waitlist-dm-failed author=${parsed.authorId}`,
        err
      );
    }
    await interaction.editButtonsMessage({
      content: COPY.waitlistedFooter(interaction.reviewer.toString()),
      components: [],
    });
    console.log(
      `[bot:applicationReview] event=waitlisted reviewer=${interaction.reviewer.id} author=${parsed.authorId}`
    );
  }
}
