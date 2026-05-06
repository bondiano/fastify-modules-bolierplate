/**
 * Typed template registry for `@kit/mailer`. Mirrors the `Jobs` /
 * `Queues` augmentation pattern from `@kit/jobs`: each template ships a
 * `declare module '@kit/mailer' { interface MailTemplates { '<name>':
 * <PayloadType> } }` block, and `mailerService.send(name, payload, opts)`
 * statically validates the payload shape against the registry.
 *
 * The registry deliberately ships empty -- consumers (and the seed
 * templates in `templates/<name>.fixture.ts`) populate it.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface MailTemplates {}
}

/**
 * Locale tag used by the renderer + recorded on `mail_deliveries.locale`.
 * Hardcoded to `'en'` in v1; multi-locale message bundles ship in
 * Phase 3 (per the plan in `docs-ai/ROADMAP.md` §2c "Out of scope").
 */
export type MailLocale = 'en';

/**
 * Per-template fixture used by `/admin/mail/preview` to render a
 * synthetic preview WITHOUT touching real customer data. Each registered
 * template ships its fixture alongside the MJML/text source.
 */
export interface PreviewFixture<TPayload> {
  readonly to: string;
  readonly payload: TPayload;
  readonly locale?: MailLocale;
}

/**
 * Runtime metadata describing a registered template. Populated by
 * `defineTemplate(...)` calls at module-import time so the admin
 * preview route can list every registered template without scanning the
 * file system.
 */
export interface RegisteredTemplate<K extends keyof MailTemplates> {
  readonly name: K;
  /** Human-readable subject template ({{var}} interpolation allowed). */
  readonly subject: string;
  /** Default tags forwarded to providers that support categorization
   * (Resend, Postmark message streams, SES configuration sets). */
  readonly tags?: readonly string[];
  /** Synthetic data used by `/admin/mail/preview`. */
  readonly previewFixture: PreviewFixture<MailTemplates[K]>;
}

const REGISTRY = new Map<string, RegisteredTemplate<keyof MailTemplates>>();

/**
 * Register a template at module-import time. Each `templates/<name>.ts`
 * file in the consumer package or `@kit/mailer` itself calls this once
 * so the registry is populated by the time `mailerService.send(...)`
 * runs.
 *
 * @example
 * ```ts
 * defineTemplate('password-reset', {
 *   subject: 'Reset your password for {{productName}}',
 *   tags: ['transactional', 'auth'],
 *   previewFixture: {
 *     to: 'preview@example.com',
 *     payload: { resetUrl: 'https://example.com/reset?token=preview', productName: 'Acme' },
 *   },
 * });
 * ```
 */
export const defineTemplate = <K extends keyof MailTemplates>(
  name: K,
  meta: Omit<RegisteredTemplate<K>, 'name'>,
): RegisteredTemplate<K> => {
  const entry: RegisteredTemplate<K> = { name, ...meta };
  REGISTRY.set(String(name), entry as RegisteredTemplate<keyof MailTemplates>);
  return entry;
};

export const getRegisteredTemplate = <K extends keyof MailTemplates>(
  name: K,
): RegisteredTemplate<K> | undefined =>
  REGISTRY.get(String(name)) as RegisteredTemplate<K> | undefined;

export const listRegisteredTemplates = (): readonly RegisteredTemplate<
  keyof MailTemplates
>[] => [...REGISTRY.values()];

/** Test/debug-only escape hatch -- clears the registry. Vitest-isolated
 * suites can use this to rebuild the registry between runs. */
export const _resetTemplateRegistry = (): void => REGISTRY.clear();
