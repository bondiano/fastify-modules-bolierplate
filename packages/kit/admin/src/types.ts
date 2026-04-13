/**
 * Shared type contracts for @kit/admin. Every phase of the package imports
 * from this file so schema introspection, discovery, rendering, and route
 * handlers agree on one shape for columns, specs, and overrides.
 */
import type { TObject } from '@sinclair/typebox';

// -------------------------------------------------------------------------
// Postgres type model
// -------------------------------------------------------------------------

/**
 * Normalised Postgres type tags. `autogen-validators` and `infer-widget`
 * branch on this. Anything `information_schema` returns that doesn't map
 * cleanly becomes `'unknown'` and renders as a JSON textarea.
 */
export type PgType =
  | 'text'
  | 'varchar'
  | 'char'
  | 'uuid'
  | 'int2'
  | 'int4'
  | 'int8'
  | 'numeric'
  | 'float4'
  | 'float8'
  | 'bool'
  | 'date'
  | 'time'
  | 'timestamp'
  | 'timestamptz'
  | 'json'
  | 'jsonb'
  | 'text_array'
  | 'enum'
  | 'unknown';

/**
 * Single-column metadata derived from `information_schema.columns` +
 * `pg_catalog.pg_type` + `information_schema.key_column_usage`. All names
 * are camelCase to match Kysely's `CamelCasePlugin`; `rawName` preserves
 * the snake_case form for raw SQL use.
 */
export interface ColumnMeta {
  readonly name: string;
  readonly rawName: string;
  readonly type: PgType;
  readonly nullable: boolean;
  /**
   * `true` for serial/identity/generated/default-now columns. These are
   * hidden from create forms and read-only on update.
   */
  readonly generated: boolean;
  readonly defaultValue: string | null;
  /** Non-null for enum domains; the set of allowed values. */
  readonly enumValues: readonly string[] | null;
  /** Non-null for FK columns; target `{ table, column }`. */
  readonly references: {
    readonly table: string;
    readonly column: string;
  } | null;
  readonly isPrimaryKey: boolean;
  /** `varchar(N)` length, else `null`. */
  readonly maxLength: number | null;
}

export interface TableMeta {
  readonly name: string;
  readonly columns: readonly ColumnMeta[];
  readonly primaryKey: readonly string[];
  /** `true` if a nullable `deletedAt` column exists. */
  readonly hasSoftDelete: boolean;
}

export interface SchemaRegistry {
  get(table: string): TableMeta | undefined;
  all(): readonly TableMeta[];
}

// -------------------------------------------------------------------------
// Widget vocabulary
// -------------------------------------------------------------------------

export type WidgetKind =
  | 'text'
  | 'textarea'
  | 'select'
  | 'radio-group'
  | 'checkbox'
  | 'number'
  | 'date'
  | 'datetime'
  | 'json'
  | 'autocomplete'
  | 'hidden'
  | 'readonly'
  | 'tags';

/**
 * Resolved field descriptor: what routes render and what the form
 * submitter serialises. Widget kinds are the union above; the renderer
 * dispatches into `views/widgets/*` on `widget`.
 */
export interface FieldSpec {
  readonly name: string;
  readonly label: string;
  readonly widget: WidgetKind;
  readonly required: boolean;
  readonly readOnly: boolean;
  readonly nullable: boolean;
  readonly maxLength: number | null;
  readonly enumValues: readonly string[] | null;
  readonly references: {
    readonly table: string;
    readonly column: string;
  } | null;
  readonly placeholder: string | null;
  readonly help: string | null;
}

export interface FieldsetSpec {
  readonly label: string;
  readonly fields: readonly string[];
  readonly collapsed?: boolean;
}

export interface ListViewSpec {
  readonly columns: readonly string[];
  readonly search: readonly string[];
  readonly defaultSort: {
    readonly field: string;
    readonly order: 'asc' | 'desc';
  };
  readonly sortableFields: readonly string[];
}

export interface FormViewSpec {
  /** When provided, the form is grouped into fieldsets in the given order. */
  readonly fieldsets: readonly FieldsetSpec[] | null;
}

// -------------------------------------------------------------------------
// Row / bulk action definitions
// -------------------------------------------------------------------------

export interface RowActionContext<Row = unknown> {
  readonly id: string;
  readonly row: Row;
  readonly cradle: Record<string, unknown>;
}

export interface RowAction<Row = unknown> {
  readonly label: string;
  readonly icon?: string;
  readonly visible?: (row: Row) => boolean;
  readonly run: (ctx: RowActionContext<Row>) => Promise<unknown>;
}

// -------------------------------------------------------------------------
// Relation descriptor (static or dynamic)
// -------------------------------------------------------------------------

export interface RelationDescriptor {
  readonly resource: string;
  /** Which column on the target resource to display in the select. */
  readonly display: string;
  /**
   * Static list of `{ value, label }` options. When omitted the admin
   * falls back to async autocomplete via `/admin/:resource/_relations/:col`.
   */
  readonly choices?: readonly {
    readonly value: string;
    readonly label: string;
  }[];
}

// -------------------------------------------------------------------------
// Resource specs (inferred + override + merged final)
// -------------------------------------------------------------------------

export interface AdminResourceSpec {
  /** Plural, slugified table name used in URLs: `/admin/<name>`. */
  readonly name: string;
  /** Kysely table name (usually same as `name`). */
  readonly table: string;
  /** Awilix cradle key of the backing repository. */
  readonly repositoryKey: string;
  readonly label: string;
  readonly icon: string | null;
  readonly fields: readonly FieldSpec[];
  readonly list: ListViewSpec;
  readonly form: FormViewSpec;
  readonly relations: Readonly<Record<string, RelationDescriptor>>;
  readonly rowActions: readonly RowAction[];
  readonly permissions: {
    /** CASL subject tag. `null` means admin role required (no per-subject check). */
    readonly subject: string | null;
  };
  readonly hasSoftDelete: boolean;
  /** TypeBox validators autogenerated from the table meta. */
  readonly validators: {
    readonly create: TObject;
    readonly update: TObject;
  };
}

/**
 * Partial override returned by a user's `defineAdminResource` factory.
 * Only fields the user touches are merged over the inferred spec.
 */
export interface AdminResourceOverride {
  readonly label?: string;
  readonly icon?: string;
  readonly hidden?: readonly string[];
  readonly readOnly?: readonly string[];
  readonly widgets?: Readonly<Record<string, WidgetKind>>;
  readonly enumValues?: Readonly<Record<string, readonly string[]>>;
  readonly list?: Partial<ListViewSpec>;
  readonly form?: Partial<FormViewSpec>;
  readonly relations?: Readonly<
    Record<
      string,
      | RelationDescriptor
      | ((ctx: {
          readonly cradle: Record<string, unknown>;
        }) => Promise<RelationDescriptor> | RelationDescriptor)
    >
  >;
  readonly rowActions?: readonly RowAction[];
  readonly permissions?: { readonly subject?: string | null };
}

export interface AdminOverrideFactoryContext {
  readonly cradle: Record<string, unknown>;
  readonly registry: SchemaRegistry;
}

export type AdminOverrideFactory = (
  ctx: AdminOverrideFactoryContext,
) => AdminResourceOverride | Promise<AdminResourceOverride>;

export interface AdminResourceDefinition {
  readonly table: string;
  readonly factory: AdminOverrideFactory;
}

// -------------------------------------------------------------------------
// Repository duck-typing (for cradle walking)
// -------------------------------------------------------------------------

export interface PaginatedPage<T> {
  readonly items: readonly T[];
  readonly total: number;
}

export interface AdminDiscoverable {
  readonly table: string;
  findPaginatedByPage(opts: {
    page?: number;
    limit?: number;
    orderByField?: string;
    orderByDirection?: 'asc' | 'desc';
  }): Promise<PaginatedPage<unknown>>;
  findById(id: string): Promise<unknown | undefined>;
  findAll?(): Promise<readonly unknown[]>;
  create(data: unknown): Promise<unknown>;
  update(id: string, data: unknown): Promise<unknown | undefined>;
  deleteById(id: string): Promise<unknown | undefined>;
  // Optional: soft-delete + bulk ops
  restore?(id: string): Promise<unknown | undefined>;
  bulkDelete?(ids: readonly string[]): Promise<number>;
  bulkUpdate?(ids: readonly string[], data: unknown): Promise<number>;
}

export interface DiscoveredRepository {
  readonly repositoryKey: string;
  readonly repository: AdminDiscoverable;
}

// -------------------------------------------------------------------------
// Runtime admin registry (resource name -> spec)
// -------------------------------------------------------------------------

export interface AdminRegistry {
  get(name: string): AdminResourceSpec | undefined;
  all(): readonly AdminResourceSpec[];
}
