/**
 * Shared utilities for admin route handlers. Consolidates duplicated
 * patterns (context assertion, CSRF extraction, body parsing, error
 * collection, HTML response dispatch) into a single importable module.
 */
import type { TObject } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { VNode } from 'preact';

import { ForbiddenException, InternalServerErrorException } from '@kit/errors';

import { renderFragment, renderPage } from '../render.js';
import { buildRenderContext, isHtmxRequest } from '../runtime/context.js';
import type { AdminContext } from '../runtime/context.js';

export interface RawBody {
  readonly [key: string]: unknown;
}

/**
 * Narrow `fastify.admin` to a guaranteed `AdminContext`, throwing a
 * 500 if the decorator is missing (server misconfiguration).
 */
export const assertAdminContext = (fastify: FastifyInstance): AdminContext => {
  const ctx = (fastify as FastifyInstance & { admin?: AdminContext }).admin;
  if (!ctx) {
    throw new InternalServerErrorException('@kit/admin: admin context missing');
  }
  return ctx;
};

/** Read the `_csrf` hidden field from a form body. */
export const extractCsrf = (body: RawBody): string => {
  const v = body['_csrf'];
  return typeof v === 'string' ? v : '';
};

/** Read the `x-csrf-token` header (single or array). */
export const headerCsrf = (request: FastifyRequest): string => {
  const header = request.headers['x-csrf-token'];
  if (typeof header === 'string') return header;
  if (Array.isArray(header) && typeof header[0] === 'string') return header[0];
  return '';
};

/** Verify a CSRF token or throw 403. */
export const verifyCsrfOrThrow = (
  ctx: AdminContext,
  token: string,
  request: FastifyRequest,
): void => {
  if (!ctx.csrf.verify(token, request.auth?.sub ?? 'anon')) {
    throw new ForbiddenException('Invalid CSRF token');
  }
};

/**
 * Strip `_csrf` and `_method` meta fields from a form body and convert
 * empty strings to `null` (HTML forms submit missing values as `""`).
 */
export const stripMeta = (body: RawBody): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === '_csrf' || k === '_method') continue;
    out[k] = v === '' ? null : v;
  }
  return out;
};

/** Collect per-field validation errors from a TypeBox schema check. */
export const collectErrors = (
  schema: TObject,
  data: unknown,
): Record<string, string> => {
  const errors: Record<string, string> = {};
  for (const err of Value.Errors(schema, data)) {
    const key = err.path.replace(/^\//, '').replaceAll('/', '.');
    if (key && !errors[key]) errors[key] = err.message;
  }
  return errors;
};

/**
 * Extract a user-friendly message from a repository/database error.
 * Recognises common Postgres constraint violations; falls back to the
 * generic error message for everything else.
 */
export const formatRepoError = (error: unknown): string => {
  const message =
    error instanceof Error ? error.message : 'An unexpected error occurred';

  if (
    message.includes('unique constraint') ||
    message.includes('duplicate key')
  )
    return 'A record with these values already exists.';
  if (
    message.includes('foreign key constraint') ||
    message.includes('violates foreign key')
  )
    return 'Referenced record does not exist.';
  if (
    message.includes('not-null constraint') ||
    message.includes('null value in column')
  )
    return 'A required field is missing.';
  if (message.includes('check constraint'))
    return 'One or more values are invalid.';

  return message;
};

/**
 * Respond with an HTML fragment (htmx swap) or a full page depending
 * on the request type. Sets `text/html` content type automatically.
 */
export const respondHtml = (
  reply: FastifyReply,
  request: FastifyRequest,
  ctx: AdminContext,
  body: VNode,
  opts: { readonly activeResource?: string } = {},
): string => {
  reply.type('text/html; charset=utf-8');
  if (isHtmxRequest(request)) return renderFragment(body);
  const extra =
    opts.activeResource === undefined
      ? {}
      : { activeResource: opts.activeResource };
  return renderPage(buildRenderContext(ctx, request, extra), body);
};
