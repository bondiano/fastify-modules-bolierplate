/**
 * Generic form renderer. Dispatches each `FieldSpec` to a widget from
 * `views/widgets/`, honours fieldsets, and handles create vs update mode
 * (hides generated fields on create; demotes PKs to readonly on update).
 */
import { html } from 'htm/preact';
import type { VNode } from 'preact';

import { safeUrl } from '../safe-url.js';
import type { AdminResourceSpec, FieldSpec } from '../types.js';

import { renderWidget } from './widgets/index.js';

export interface FormProps {
  readonly spec: AdminResourceSpec;
  readonly mode: 'create' | 'update';
  readonly values: Readonly<Record<string, unknown>>;
  readonly errors: Readonly<Record<string, string>>;
  readonly prefix: string;
  readonly csrfToken: string;
  readonly action: string;
  readonly method: 'POST' | 'PATCH';
}

const isHiddenOnCreate = (field: FieldSpec): boolean =>
  field.widget === 'readonly' || field.widget === 'hidden';

const asReadonly = (field: FieldSpec): FieldSpec => ({
  ...field,
  readOnly: true,
});

const renderField = (
  field: FieldSpec,
  values: FormProps['values'],
  errors: FormProps['errors'],
  resourceName: string,
): VNode => {
  const widget = renderWidget(field, values[field.name], false, resourceName);
  const err = errors[field.name];
  return html`<div class="form-row" data-field=${field.name}>
    <label for=${field.name} class="form-label">
      ${field.label}
      ${field.required
        ? html`<span class="form-required" aria-hidden="true">*</span>`
        : null}
    </label>
    ${widget}
    ${field.help ? html`<p class="form-help muted">${field.help}</p>` : null}
    ${err ? html`<p class="field-error" role="alert">${err}</p>` : null}
  </div>`;
};

export const Form = ({
  spec,
  mode,
  values,
  errors,
  prefix,
  csrfToken,
  action,
  method,
}: FormProps): VNode => {
  const byName = new Map(spec.fields.map((f) => [f.name, f] as const));

  const prepare = (field: FieldSpec): FieldSpec | null => {
    if (mode === 'create' && isHiddenOnCreate(field)) return null;
    if (mode === 'update' && field.widget === 'hidden') return field;
    if (mode === 'update' && byName.get(field.name)?.readOnly)
      return asReadonly(field);
    return field;
  };

  const groups: { label: string | null; fields: readonly FieldSpec[] }[] = [];
  if (spec.form.fieldsets && spec.form.fieldsets.length > 0) {
    for (const fs of spec.form.fieldsets) {
      const resolved = fs.fields
        .map((name) => byName.get(name))
        .filter((f): f is FieldSpec => f !== undefined)
        .map((f) => prepare(f))
        .filter((f): f is FieldSpec => f !== null);
      groups.push({ label: fs.label, fields: resolved });
    }
  } else {
    groups.push({
      label: null,
      fields: spec.fields
        .map((f) => prepare(f))
        .filter((f): f is FieldSpec => f !== null),
    });
  }

  const cancelHref = safeUrl(`${prefix}/${spec.name}`);
  const hxPost = method === 'POST' ? action : undefined;
  const hxPatch = method === 'PATCH' ? action : undefined;
  const formError = errors['_form'];

  return html`<form
    class="admin-form"
    method="post"
    action=${action}
    hx-post=${hxPost}
    hx-patch=${hxPatch}
    hx-target="#admin-main"
    hx-swap="innerHTML"
    hx-push-url="true"
    novalidate
  >
    ${formError
      ? html`<div class="form-error" role="alert">${formError}</div>`
      : null}
    <input type="hidden" name="_csrf" value=${csrfToken} />
    ${method === 'PATCH'
      ? html`<input type="hidden" name="_method" value="PATCH" />`
      : null}
    ${groups.map((group) =>
      group.label === null
        ? html`<div class="form-group">
            ${group.fields.map((f) =>
              renderField(f, values, errors, spec.name),
            )}
          </div>`
        : html`<fieldset class="form-fieldset">
            <legend>${group.label}</legend>
            ${group.fields.map((f) =>
              renderField(f, values, errors, spec.name),
            )}
          </fieldset>`,
    )}
    <div class="form-actions">
      <button type="submit" class="btn btn-primary">Save</button>
      <a
        href=${cancelHref}
        hx-get=${cancelHref}
        hx-target="#admin-main"
        hx-swap="innerHTML"
        hx-push-url="true"
        class="btn btn-secondary"
      >
        Cancel
      </a>
    </div>
  </form>`;
};
