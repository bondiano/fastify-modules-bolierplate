/**
 * Serves the two vendored static assets (`admin.css`, `htmx.min.js`) from
 * the package's own `assets/` directory. Files are read once at plugin
 * boot and kept in-memory -- no per-request filesystem IO.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { FastifyPluginAsync } from 'fastify';

const CACHE_CONTROL = 'public, max-age=3600';

const readAsset = async (name: string): Promise<string> => {
  const path = fileURLToPath(new URL(`../../assets/${name}`, import.meta.url));
  return readFile(path, 'utf8');
};

export const assetsRoute: FastifyPluginAsync = async (fastify) => {
  const [css, js, adminJs] = await Promise.all([
    readAsset('admin.css'),
    readAsset('htmx.min.js'),
    readAsset('admin.js'),
  ]);

  fastify.get('/_assets/admin.css', async (_request, reply) => {
    reply.type('text/css; charset=utf-8');
    reply.header('cache-control', CACHE_CONTROL);
    return css;
  });

  fastify.get('/_assets/htmx.min.js', async (_request, reply) => {
    reply.type('application/javascript; charset=utf-8');
    reply.header('cache-control', CACHE_CONTROL);
    return js;
  });

  fastify.get('/_assets/admin.js', async (_request, reply) => {
    reply.type('application/javascript; charset=utf-8');
    reply.header('cache-control', CACHE_CONTROL);
    return adminJs;
  });
};

export default assetsRoute;
