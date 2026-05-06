/**
 * Build-step CLI: compiles every `templates/*.mjml` into a static HTML
 * file under `dist/templates/compiled/`, and copies sibling `.txt`
 * plain-text fallbacks alongside. The runtime renderer
 * (`src/templates/render.ts`) reads from `dist/templates/compiled/`.
 *
 * Run via `pnpm --filter @kit/mailer build:templates` (also chained
 * after `tsc -p tsconfig.json` in the package's `build` script).
 *
 * Empty `templates/` is fine -- the script no-ops and the renderer
 * surfaces a clear "Compiled template not found" error at first send
 * if a consumer tries to render an unregistered template.
 *
 * Why compile-at-build instead of MJML at runtime: mjml's compiler is
 * heavyweight (~130MB resident in our benchmarks) and adds 50-200ms
 * p99 per send. Build-time compilation flattens that to zero runtime
 * cost while still letting templates ship as readable MJML in source.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface MjmlResult {
  html: string;
  errors: { line: number; message: string }[];
}

interface MjmlCompiler {
  (
    input: string,
    options?: { validationLevel?: 'strict' | 'soft' | 'skip' },
  ): MjmlResult;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const sourceDir = path.join(packageRoot, 'templates');
const outDir = path.join(packageRoot, 'dist', 'templates', 'compiled');

const loadMjml = async (): Promise<MjmlCompiler> => {
  const module_ = (await import('mjml')) as unknown as {
    default?: MjmlCompiler;
  } & MjmlCompiler;
  // mjml ships both `module.exports = mjml` (CJS) and a default ESM
  // export. Handle either via a runtime `typeof` check.
  if (typeof module_ === 'function') return module_;
  if (typeof module_.default === 'function') return module_.default;
  throw new TypeError('Unable to resolve mjml compiler from `mjml` package');
};

const ensureDir = async (dir: string): Promise<void> => {
  await fs.mkdir(dir, { recursive: true });
};

const main = async (): Promise<void> => {
  let entries: string[];
  try {
    entries = await fs.readdir(sourceDir);
  } catch {
    // No templates/ dir -- nothing to compile.
    return;
  }
  const mjmlFiles = entries.filter((entry) => entry.endsWith('.mjml'));
  if (mjmlFiles.length === 0) {
    return;
  }

  const mjml = await loadMjml();
  await ensureDir(outDir);

  for (const file of mjmlFiles) {
    const baseName = path.basename(file, '.mjml');
    const sourcePath = path.join(sourceDir, file);
    const source = await fs.readFile(sourcePath, 'utf8');
    const result = mjml(source, { validationLevel: 'strict' });
    if (result.errors.length > 0) {
      const lines = result.errors
        .map((error) => `  line ${error.line}: ${error.message}`)
        .join('\n');
      throw new Error(`MJML errors in ${file}:\n${lines}`);
    }
    const htmlPath = path.join(outDir, `${baseName}.html`);
    await fs.writeFile(htmlPath, result.html, 'utf8');

    const textSource = path.join(sourceDir, `${baseName}.txt`);
    try {
      const text = await fs.readFile(textSource, 'utf8');
      await fs.writeFile(path.join(outDir, `${baseName}.txt`), text, 'utf8');
    } catch {
      throw new Error(
        `Plain-text fallback not found for ${file} -- expected ${textSource}`,
      );
    }
    console.log(`compiled ${file} -> ${path.relative(packageRoot, htmlPath)}`);
  }
};

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`compile-mjml failed: ${message}`);
  process.exit(1);
});
