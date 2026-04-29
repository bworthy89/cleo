import { COPY } from '../copy';
import type { BotConfig } from '../config';

export interface MemberLike {
  user: { id: string; username: string; toString(): string };
  roles: {
    cache: Map<string, unknown> | { has(id: string): boolean };
    add(roleId: string): Promise<unknown>;
  };
  send(content: string): Promise<unknown>;
}

export interface OnboardingContext {
  config: BotConfig;
  reaction: { messageId: string; emoji: string };
  reactor: { id: string };
  fetchMember(userId: string): Promise<MemberLike>;
  sendInWelcome(content: string): Promise<unknown>;
}

function memberHasRole(member: MemberLike, roleId: string): boolean {
  const cache = member.roles.cache;
  if (cache instanceof Map) return cache.has(roleId);
  return (cache as { has(id: string): boolean }).has(roleId);
}

export async function handleStartHereReaction(ctx: OnboardingContext): Promise<void> {
  const { config, reaction } = ctx;
  if (reaction.messageId !== config.discord.startHereMessageId) return;
  if (reaction.emoji !== config.discord.startHereEmoji) return;

  const member = await ctx.fetchMember(ctx.reactor.id);
  const charterRole = config.discord.roles.charterListener;
  if (memberHasRole(member, charterRole)) {
    console.log(`[bot:onboarding] event=already-charter actor=${ctx.reactor.id}`);
    return;
  }

  await member.roles.add(charterRole);
  console.log(`[bot:onboarding] event=role-granted actor=${ctx.reactor.id}`);

  const dm = COPY.approvalDM(config.discord.testFlightUrl);
  try {
    await member.send(dm);
    console.log(`[bot:onboarding] event=dm-sent actor=${ctx.reactor.id}`);
  } catch (err) {
    console.error(
      `[bot:onboarding] event=dm-failed actor=${ctx.reactor.id} fallback=welcome-nudge`,
      err
    );
    // The role grant is already committed. If the #welcome fallback also
    // fails (e.g. bot lacks Send Messages there), don't let it bubble — log
    // it so an operator can see the user was approved but never got the link.
    try {
      await ctx.sendInWelcome(
        COPY.dmDisabledNudge(member.user.toString(), config.discord.testFlightUrl)
      );
    } catch (welcomeErr) {
      console.error(
        `[bot:onboarding] event=welcome-nudge-failed actor=${ctx.reactor.id} member=${member.user.id} — manual TestFlight link delivery required`,
        welcomeErr
      );
    }
  }
}
