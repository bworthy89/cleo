export class BroadcastSegmentCache {
  private readonly entries = new Map<string, string>();

  private key(slotIndex: number, variantIndex: number): string {
    return `${slotIndex}:${variantIndex}`;
  }

  put(slotIndex: number, variantIndex: number, base64: string): void {
    this.entries.set(this.key(slotIndex, variantIndex), base64);
  }

  get(slotIndex: number, variantIndex: number): string | undefined {
    return this.entries.get(this.key(slotIndex, variantIndex));
  }

  hasAny(slotIndex: number): boolean {
    for (const k of this.entries.keys()) {
      if (k.startsWith(`${slotIndex}:`)) return true;
    }
    return false;
  }

  pickVariant(
    slotIndex: number,
    variantCount: number,
    rng: () => number = Math.random,
  ): string | undefined {
    if (!this.hasAny(slotIndex)) return undefined;
    const picked = Math.floor(rng() * variantCount);
    return this.get(slotIndex, picked) ?? this.get(slotIndex, 0);
  }

  clear(): void {
    this.entries.clear();
  }
}
