export const COPY = {
  approvalDM: (testFlightUrl: string): string => `Hey — you're in.

Welcome to the booth. You're one of the first people on Earth
to hear what ONAY sounds like, which means two things:

  → things will break. tell us when they do.
  → your taste is shaping the show. tell us what you think.

Your TestFlight link:
${testFlightUrl}

Three places to land first:

  #testflight-builds — every new build, with a changelog and
  what we want you to try

  #bug-reports — one thread per bug. screenshots and the
  exact playlist/vibe you used = gold

  #tonight-on-onay — vote on what gets featured to the
  whole listener base. your 🔥 / 💀 reactions decide.

One ask: don't share the TestFlight link or build screenshots
outside this server yet. We'll tell you when it's go-time.

That's it. Go make her say something interesting.

— The Producer`,

  waitlistDM: `Thanks for applying to the ONAY beta.

We're keeping the first wave small — like 25 people small —
to make sure the feedback loop stays tight. You're on the
waitlist for wave two, which we'll open in a few weeks.

Stay in the server if you want — #general and #vibe-requests
are open to everyone. The more we hear from you there, the
faster you move up the list.

— The Producer`,

  dmDisabledNudge: (userMention: string, link: string): string =>
    `${userMention} — couldn't DM you (DMs disabled). Your TestFlight link: ${link}`,

  notAuthorized: 'Only @Producer or @On-Air can review applications.',
  applicationPostMissing: "Couldn't find that application post (was it deleted?).",
  approvedFooter: (reviewerMention: string): string =>
    `\n\n✅ Approved by ${reviewerMention}`,
  waitlistedFooter: (reviewerMention: string): string =>
    `\n\n⏳ Waitlisted by ${reviewerMention}`,

  bugFiled: (repo: string, issueNumber: number): string =>
    `Filed → ${repo}#${issueNumber}`,
  bugFileFailed:
    "Couldn't file this one — Producer will pick it up manually.",
  bugTruncated: '\n\n…(truncated)',
  bugBodyFooter: (username: string, threadUrl: string): string =>
    `\n\n---\n_Filed from Discord by @${username} — [thread link](${threadUrl})_`,

  voteDigestHeader: '🎙 LAST NIGHT\'S VOTES',
  voteDigestRow: (excerpt: string, count: number, ship: boolean): string =>
    `• ${excerpt} — ${count} 🔥 — ${ship ? 'SHIP IT' : 'no ship'}`,

  vibeDigestHeader: '🔥 THIS WEEK\'S VIBE PITCHES',
  vibeDigestTopRow: (
    rank: number,
    count: number,
    author: string,
    excerpt: string,
    jumpUrl: string
  ): string =>
    `${rank}. ${count} 🔥 — @${author}: "${excerpt}" → ${jumpUrl}`,
  vibeDigestHonorableHeader: '\nHonorable mentions:',
  vibeDigestHonorableRow: (author: string, excerpt: string): string =>
    `• @${author}: "${excerpt}"`,
};
