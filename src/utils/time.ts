export function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 17) return 'Afternoon';
  if (hour >= 17 && hour < 21) return 'Evening';
  return 'Late Night';
}

/**
 * Format a Date as 12-hour clock time (e.g. "9:30 PM") for `userContext.timeOfDay`.
 * Sent to the broadcast server's LLM prompt; the LLM tends to echo the format
 * verbatim, so 12h-with-AM/PM avoids literal-reading TTS engines (nano-vllm-voxcpm)
 * narrating "twenty-one thirty" when given "21:30". Server-side preprocessForTTS
 * also catches any 24h form that slips through.
 */
export function formatLocalTime12h(d: Date = new Date()): string {
  const h24 = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m} ${ampm}`;
}
