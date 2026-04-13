/**
 * `GET /:resource/_relations/:col` -- autocomplete endpoint for FK
 * columns. Returns an HTML `<ul>` fragment; the autocomplete widget
 * populates a hidden input from the clicked `<li>`.
 *
 * Filtering is done in JS against the target resource's `findAll`
 * (when present) or a bounded `findPaginatedByPage` page. Good enough
 * for small FK tables; large ones should provide a dedicated API.
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { html } from 'htm/preact';

import { NotFoundException } from '@kit/errors';

import { renderFragment } from '../render.js';
import { getRepo } from '../runtime/context.js';
import type { AdminDiscoverable, AdminResourceSpec } from '../types.js';

import { assertAdminContext } from './_helpers.js';

const LOOKUP_LIMIT = 50;
const MAX_RESULTS = 20;

const loadCandidates = async (
  repo: AdminDiscoverable,
): Promise<readonly Record<string, unknown>[]> => {
  if (typeof repo.findAll === 'function') {
    const all = await repo.findAll();
    return all.map((r) => r as Record<string, unknown>);
  }
  const page = await repo.findPaginatedByPage({ page: 1, limit: LOOKUP_LIMIT });
  return page.items.map((r) => r as Record<string, unknown>);
};

const pickDisplay = (
  row: Record<string, unknown>,
  _targetSpec: AdminResourceSpec,
  display: string,
): string => {
  const value = row[display] ?? row['name'] ?? row['title'] ?? row['id'];
  if (value === null || value === undefined) return '';
  return String(value);
};

const pickId = (row: Record<string, unknown>): string => {
  const id = row['id'];
  return id === null || id === undefined ? '' : String(id);
};

const RelationResultItem = ({
  id,
  label,
}: {
  readonly id: string;
  readonly label: string;
}) =>
  html`<li
    class="admin-autocomplete__item"
    data-value=${id}
    style="padding:8px 12px;cursor:pointer;user-select:none;"
  >
    ${label}
  </li>`;

const RelationResults = ({
  matches,
}: {
  readonly matches: readonly { id: string; label: string }[];
}) =>
  html`<ul style="list-style:none;margin:0;padding:0;">
    ${matches.length === 0
      ? html`<li style="padding:8px 12px;color:#888;">No matches.</li>`
      : matches.map(
          (opt) =>
            html`<${RelationResultItem} id=${opt.id} label=${opt.label} />`,
        )}
  </ul>`;

export const relationsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/:resource/_relations/:col',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = assertAdminContext(fastify);

      const params = request.params as { resource?: string; col?: string };
      const spec = ctx.registry.getOrThrow(params.resource ?? '');
      const colName = params.col ?? '';

      const field = spec.fields.find((f) => f.name === colName);
      if (!field || !field.references) {
        throw new NotFoundException(`Column "${colName}" is not a relation`);
      }

      const relation = spec.relations[colName];
      const targetName = relation?.resource ?? field.references.table;
      const targetSpec = ctx.registry.get(targetName);
      if (!targetSpec)
        throw new NotFoundException(
          `Target resource "${targetName}" not found`,
        );

      const targetRepo = getRepo(ctx, targetSpec);
      const display = relation?.display ?? 'id';

      const queryRecord = (request.query ?? {}) as Record<string, unknown>;
      const raw =
        typeof queryRecord['q'] === 'string'
          ? queryRecord['q']
          : typeof queryRecord[`${colName}__display`] === 'string'
            ? (queryRecord[`${colName}__display`] as string)
            : '';
      const q = raw.toLowerCase();

      const candidates = await loadCandidates(targetRepo);
      const matches = candidates
        .map((row) => ({
          id: pickId(row),
          label: pickDisplay(row, targetSpec, display),
        }))
        .filter((opt) => opt.id.length > 0)
        .filter((opt) => (q ? opt.label.toLowerCase().includes(q) : true))
        .slice(0, MAX_RESULTS);

      reply.type('text/html; charset=utf-8');
      return renderFragment(html`<${RelationResults} matches=${matches} />`);
    },
  );
};

export default relationsRoute;
