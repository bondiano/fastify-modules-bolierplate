import type { Effect } from 'effect';
import type { FastifyReply, FastifyRequest, RouteHandlerMethod } from 'fastify';

import { runEffect } from './run.js';

/**
 * Lift an `Effect`-returning function into a Fastify route handler.
 *
 *   fastify.get('/users/:id', effectHandler((req) =>
 *     usersService.findById(req.params.id)
 *   ));
 *
 * On `Fail` the typed error is mapped via `@kit/errors` (`DomainError.toException`
 * for tagged domain errors, passthrough for `ExceptionBase`, otherwise 500).
 * On `Die` the defect is wrapped as a 500. Either way, it surfaces as a thrown
 * `ExceptionBase` so the kit's global Fastify error handler serializes it.
 */
export const effectHandler = <A, E>(
  fn: (request: FastifyRequest, reply: FastifyReply) => Effect.Effect<A, E>,
): RouteHandlerMethod =>
  async function (request, reply) {
    return runEffect(fn(request, reply));
  };
