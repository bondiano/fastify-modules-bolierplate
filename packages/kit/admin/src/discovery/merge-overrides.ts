/**
 * Layer an `AdminResourceOverride` on top of an inferred
 * `AdminResourceSpec`. Pure function -- never mutates input. Relations
 * are passed in already resolved: the override factory may return
 * async functions for relations and the plugin resolves those first.
 */
import type {
  AdminResourceOverride,
  AdminResourceSpec,
  FieldSpec,
  FieldsetSpec,
  FormViewSpec,
  ListViewSpec,
  RelationDescriptor,
  WidgetKind,
} from '../types.js';

const dropHidden = (
  fields: readonly FieldSpec[],
  hidden: readonly string[] | undefined,
): readonly FieldSpec[] => {
  if (!hidden || hidden.length === 0) return fields;
  const blocked = new Set(hidden);
  return fields.filter((f) => !blocked.has(f.name));
};

const applyReadOnly = (
  fields: readonly FieldSpec[],
  readOnly: readonly string[] | undefined,
): readonly FieldSpec[] => {
  if (!readOnly || readOnly.length === 0) return fields;
  const set = new Set(readOnly);
  return fields.map((f) => (set.has(f.name) ? { ...f, readOnly: true } : f));
};

const applyWidgets = (
  fields: readonly FieldSpec[],
  widgets: Readonly<Record<string, WidgetKind>> | undefined,
): readonly FieldSpec[] => {
  if (!widgets) return fields;
  return fields.map((f) => {
    const w = widgets[f.name];
    return w ? { ...f, widget: w } : f;
  });
};

const applyEnumValues = (
  fields: readonly FieldSpec[],
  enumValues: Readonly<Record<string, readonly string[]>> | undefined,
): readonly FieldSpec[] => {
  if (!enumValues) return fields;
  return fields.map((f) => {
    const values = enumValues[f.name];
    return values ? { ...f, enumValues: values } : f;
  });
};

const dropHiddenFromList = (
  list: ListViewSpec,
  hidden: readonly string[] | undefined,
): ListViewSpec => {
  if (!hidden || hidden.length === 0) return list;
  const blocked = new Set(hidden);
  return { ...list, columns: list.columns.filter((c) => !blocked.has(c)) };
};

const dropHiddenFromFieldsets = (
  form: FormViewSpec,
  hidden: readonly string[] | undefined,
): FormViewSpec => {
  if (!hidden || hidden.length === 0) return form;
  if (form.fieldsets === null) return form;
  const blocked = new Set(hidden);
  const next: FieldsetSpec[] = form.fieldsets.map((fs) => ({
    ...fs,
    fields: fs.fields.filter((f) => !blocked.has(f)),
  }));
  return { ...form, fieldsets: next };
};

const mergeList = (
  inferred: ListViewSpec,
  override: Partial<ListViewSpec> | undefined,
): ListViewSpec => {
  if (!override) return inferred;
  return {
    columns: override.columns ?? inferred.columns,
    search: override.search ?? inferred.search,
    defaultSort: override.defaultSort ?? inferred.defaultSort,
    sortableFields: override.sortableFields ?? inferred.sortableFields,
    filters: override.filters ?? inferred.filters,
  };
};

const mergeForm = (
  inferred: FormViewSpec,
  override: Partial<FormViewSpec> | undefined,
): FormViewSpec => {
  if (!override) return inferred;
  if (override.fieldsets !== undefined) {
    return { fieldsets: override.fieldsets };
  }
  return inferred;
};

export const mergeOverrides = (
  inferred: AdminResourceSpec,
  override: AdminResourceOverride | undefined,
  resolvedRelations: Readonly<Record<string, RelationDescriptor>>,
): AdminResourceSpec => {
  if (!override) {
    return {
      ...inferred,
      relations: { ...inferred.relations, ...resolvedRelations },
    };
  }

  const fieldsAfterHidden = dropHidden(inferred.fields, override.hidden);
  const fieldsAfterReadOnly = applyReadOnly(
    fieldsAfterHidden,
    override.readOnly,
  );
  const fieldsAfterWidgets = applyWidgets(
    fieldsAfterReadOnly,
    override.widgets,
  );
  const fields = applyEnumValues(fieldsAfterWidgets, override.enumValues);

  const listAfterHidden = dropHiddenFromList(inferred.list, override.hidden);
  const list = mergeList(listAfterHidden, override.list);

  const formAfterHidden = dropHiddenFromFieldsets(
    inferred.form,
    override.hidden,
  );
  const form = mergeForm(formAfterHidden, override.form);

  const relations: Readonly<Record<string, RelationDescriptor>> = {
    ...inferred.relations,
    ...resolvedRelations,
  };

  const rowActions = override.rowActions
    ? [...inferred.rowActions, ...override.rowActions]
    : inferred.rowActions;

  const permissions =
    override.permissions && override.permissions.subject !== undefined
      ? { subject: override.permissions.subject }
      : inferred.permissions;

  const tenantScoped = override.tenantScoped ?? inferred.tenantScoped;
  // `scope` defaults track `tenantScoped` when the override flips the
  // flag without explicitly choosing a scope, so a forced `tenantScoped:
  // false` doesn't leave a stale `'tenant'` scope behind.
  const scope =
    override.scope ??
    (override.tenantScoped === undefined
      ? inferred.scope
      : tenantScoped
        ? 'tenant'
        : 'system');

  // Group is opt-in; an override of `null` is honoured (lets a service
  // explicitly un-group a previously-grouped resource).
  const group = override.group === undefined ? inferred.group : override.group;

  const detailActions = override.detailActions ?? inferred.detailActions;

  const sensitiveColumns =
    override.sensitiveColumns ?? inferred.sensitiveColumns;

  const auditEnabled =
    override.auditEnabled === undefined
      ? inferred.auditEnabled
      : override.auditEnabled;

  const readOnlyResource =
    override.readOnlyResource === undefined
      ? inferred.readOnlyResource
      : override.readOnlyResource;

  return {
    ...inferred,
    label: override.label ?? inferred.label,
    icon: override.icon ?? inferred.icon,
    fields,
    list,
    form,
    relations,
    rowActions,
    permissions,
    tenantScoped,
    scope,
    group,
    detailActions,
    sensitiveColumns,
    auditEnabled,
    readOnlyResource,
  };
};
