import type {
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
  onSendHookHandler,
} from 'fastify';

/**
 * Stored response for idempotency replay.
 */
export interface StoredResponse {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/**
 * Pluggable storage backend for idempotency keys.
 * Implement with Redis for production, or use `createInMemoryIdempotencyStore` for dev/test.
 */
export interface IdempotencyStore {
  /** Retrieve a previously stored response. */
  get(key: string): Promise<StoredResponse | undefined>;
  /** Store a response with a TTL in milliseconds. */
  set(key: string, response: StoredResponse, ttlMs: number): Promise<void>;
  /** Try to acquire a processing lock. Returns `true` if lock was acquired. */
  tryLock(key: string, ttlMs: number): Promise<boolean>;
  /** Release a processing lock. */
  unlock(key: string): Promise<void>;
}

export interface IdempotencyPluginOptions {
  /** Storage backend for idempotency keys. */
  store: IdempotencyStore;
  /** TTL for stored responses in milliseconds. @default 86_400_000 (24 hours) */
  ttl?: number;
  /** Header name to read the idempotency key from. @default 'idempotency-key' */
  headerName?: string;
}

export interface WithIdempotencyOptions {
  /** When true, return 400 if the idempotency key header is missing. @default false */
  required?: boolean;
}

const DEFAULT_HEADER = 'idempotency-key';
const DEFAULT_TTL = 86_400_000; // 24 hours

/**
 * Per-route idempotency helper. Returns `preHandler` and `onSend` hooks
 * that should be spread into a Fastify route definition.
 *
 * Requires the idempotency plugin to be registered on the Fastify instance.
 *
 * @example
 * ```ts
 * fastify.route({
 *   method: 'POST',
 *   url: '/orders',
 *   ...withIdempotency({ required: true }),
 *   handler: async (request, reply) => { ... },
 * });
 * ```
 */
export const withIdempotency = (
  options: WithIdempotencyOptions = {},
): { preHandler: preHandlerHookHandler; onSend: onSendHookHandler } => {
  const { required = false } = options;

  const preHandler: preHandlerHookHandler = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const headerName = request.server.idempotencyHeaderName ?? DEFAULT_HEADER;
    const store = request.server.idempotencyStore;
    const ttl = request.server.idempotencyTtl ?? DEFAULT_TTL;

    const key = request.headers[headerName] as string | undefined;

    if (!key) {
      if (required) {
        return reply.status(400).send({
          data: null,
          error: {
            statusCode: 400,
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            error: 'Bad Request',
            message: `Missing required header: ${headerName}`,
          },
        });
      }
      return;
    }

    request.idempotencyKey = key;

    // Check for cached response
    const cached = await store.get(key);
    if (cached) {
      request.idempotencyActive = false;
      for (const [name, value] of Object.entries(cached.headers)) {
        void reply.header(name, value);
      }
      return reply.status(cached.statusCode).send(cached.body);
    }

    // Try to acquire lock
    const locked = await store.tryLock(key, ttl);
    if (!locked) {
      return reply.status(409).send({
        data: null,
        error: {
          statusCode: 409,
          code: 'IDEMPOTENCY_KEY_IN_PROGRESS',
          error: 'Conflict',
          message:
            'A request with this idempotency key is already being processed',
        },
      });
    }

    request.idempotencyActive = true;
  };

  return { preHandler, onSend: idempotencyOnSend };
};

const idempotencyOnSend: onSendHookHandler = async (
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
) => {
  if (!request.idempotencyKey || !request.idempotencyActive) return payload;

  const store = request.server.idempotencyStore;
  const ttl = request.server.idempotencyTtl ?? DEFAULT_TTL;

  const responseHeaders: Record<string, string> = {};
  const rawHeaders = reply.getHeaders();
  for (const [name, value] of Object.entries(rawHeaders)) {
    if (value != null) responseHeaders[name] = String(value);
  }

  await store.set(
    request.idempotencyKey,
    {
      statusCode: reply.statusCode,
      headers: responseHeaders,
      body: payload,
    },
    ttl,
  );

  await store.unlock(request.idempotencyKey);
  return payload;
};
