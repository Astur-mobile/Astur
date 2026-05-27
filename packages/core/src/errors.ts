export class AsturError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AsturError';
    this.code = code;
    this.details = details;
  }
}

export class TimeoutError extends AsturError {
  constructor(message: string, details?: unknown) {
    super('TIMEOUT', message, details);
    this.name = 'TimeoutError';
  }
}
