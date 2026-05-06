/**
 * Domain errors for `@kit/mailer`. Mirror the shape used by `@kit/auth`'s
 * errors: every class carries `statusCode` + `error` (name) so the global
 * Fastify error handler can map them to HTTP responses without coupling
 * this package to `@kit/errors`. Routes that hit user-facing surfaces
 * (e.g. webhook receivers) can convert these into 200/204 responses
 * deliberately to avoid leaking validity to the caller.
 */
export class MailerError extends Error {
  public readonly statusCode: number;
  public readonly error: string;

  constructor(message: string, statusCode: number, error: string) {
    super(message);
    this.name = error;
    this.statusCode = statusCode;
    this.error = error;
  }
}

/** Thrown by transports for retryable failures (5xx, network, throttle).
 * BullMQ catches it and applies exponential backoff. The worker
 * translates these into `mailDeliveriesRepository.recordAttempt` +
 * rethrow so the queue keeps retrying. */
export class MailTransportRetryable extends MailerError {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message, 503, 'MailTransportRetryable');
    this.code = code;
  }
}

/** Thrown by transports for fatal failures (4xx, bad recipient, auth).
 * Worker marks the row `failed`, no retry. */
export class MailTransportFatal extends MailerError {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message, 400, 'MailTransportFatal');
    this.code = code;
  }
}

/** Thrown by `mailerService.send(...)` when the configured provider's
 * SDK is missing. Surfaces a clear "install X" hint at the call site. */
export class MailerNotConfigured extends MailerError {
  constructor(message: string) {
    super(message, 500, 'MailerNotConfigured');
  }
}

/** Returned (not thrown) by the worker when a recipient hits the
 * suppression list. The delivery row is marked `suppressed` and the
 * caller / audit row records `'mail.suppressed'`. */
export class SuppressionHit extends MailerError {
  public readonly email: string;
  public readonly reason: string;
  constructor(email: string, reason: string) {
    super(
      `Recipient ${email} is on the suppression list (${reason})`,
      422,
      'SuppressionHit',
    );
    this.email = email;
    this.reason = reason;
  }
}

/** Thrown by webhook verifiers when the signature is invalid or the
 * payload is malformed. Webhook receivers translate to HTTP 200 + an
 * empty body to avoid leaking validity to attackers (per OWASP Webhook
 * Security guidance). */
export class WebhookVerificationFailed extends MailerError {
  constructor(message = 'Webhook signature verification failed') {
    super(message, 401, 'WebhookVerificationFailed');
  }
}
