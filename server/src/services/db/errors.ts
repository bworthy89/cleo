export class DbBootError extends Error {
  readonly cause: unknown;
  readonly step: string;
  constructor(step: string, filePath: string, cause: unknown) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(`db boot failed at step "${step}" for "${filePath}": ${causeMsg}`);
    this.name = 'DbBootError';
    this.step = step;
    this.cause = cause;
  }
}
