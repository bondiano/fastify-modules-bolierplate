// Public barrel for `@kit/mailer`. The detailed surface lives in subpath
// exports declared in `package.json` (`./config`, `./schema`,
// `./repository`, `./transport`, `./webhooks`, `./templates`,
// `./provider`). The barrel re-exports the runtime entry points used by
// most consumers (mailer service factory, registry types, repositories).
//
// `SendOptions` collides between the transport boundary (`{ idempotencyKey }`)
// and the service surface (`{ idempotencyKey, to, tenantId, ... }`). The
// barrel keeps the service one as `SendOptions` and re-exports the
// transport one under the prefixed name `TransportSendOptions`.

// Seed templates: importing this side-effect module at barrel-load
// time runs `defineTemplate(...)` for every kit-side template so the
// registry is populated before any `mailerService.send(name, ...)` call
// is made. Consumers shipping additional templates must
// `defineTemplate(...)` them along their own module-import path
// (typically `services/<svc>/src/modules/mailer/...`).
import './templates/seed.js';

export * from './schema.js';
export * from './config.js';
export * from './errors.js';
export * from './templates/_helpers.js';
export * from './templates/registry.js';
export * from './templates/render.js';
export {
  createTransport,
  createDevMemoryTransport,
  createPostmarkTransport,
  createResendTransport,
  createSesTransport,
  createSmtpTransport,
} from './transports/index.js';
export type {
  DevMemoryEntry,
  DevMemoryTransport,
  MailEvent,
  MailEventType,
  MailTransport,
  SendOptions as TransportSendOptions,
  SendResult as TransportSendResult,
  TransportName,
  WebhookVerifyInput,
} from './transports/index.js';
export * from './webhooks/index.js';
export * from './mail-deliveries-repository.js';
export * from './mail-events-repository.js';
export * from './mail-suppressions-repository.js';
export * from './mailer-service.js';
export * from './provider.js';
