/**
 * Barrel for the admin route modules. The plugin imports from here so
 * each individual route file stays a self-contained Fastify plugin.
 */
export { assetsRoute } from './assets.route.js';
export { dashboardRoute } from './dashboard.route.js';
export { loginRoute } from './login.route.js';
export { listRoute } from './list.route.js';
export { detailRoute } from './detail.route.js';
export { createRoute } from './create.route.js';
export { updateRoute } from './update.route.js';
export { deleteRoute } from './delete.route.js';
export { relationsRoute } from './relations.route.js';
