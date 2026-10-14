/**
 * Caps generation requests per calendar day (server local time), so a bug or
 * a runaway loop cannot run up a large Claude bill. Kept in memory: restarting
 * the server resets it, which is acceptable for a single-user local service.
 */
export class DailyLimiter {
  private day = '';
  private count = 0;

  constructor(private readonly limit: number) {}

  private roll(now: Date) {
    const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    if (day !== this.day) {
      this.day = day;
      this.count = 0;
    }
  }

  used(now: Date): number {
    this.roll(now);
    return this.count;
  }

  tryConsume(now: Date): boolean {
    this.roll(now);
    if (this.count >= this.limit) return false;
    this.count += 1;
    return true;
  }
}
