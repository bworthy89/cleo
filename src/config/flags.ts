/**
 * Feature flags. Flip these to toggle experimental paths.
 * Can be swapped for remote config later.
 */
export const FLAGS = {
  /** Use the new pre-baked broadcast home screen instead of HomeScreenRedesign. */
  broadcastHome: false,
} as const;
