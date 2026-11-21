import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import initSqlJs, { SqlValue } from 'sql.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function parseArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return undefined;
}

function sqlLiteral(val: SqlValue): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') {
    return Number.isFinite(val) ? String(val) : 'NULL';
  }
  if (val instanceof Uint8Array) {
    throw new Error('Unexpected BLOB column in lottery888.sqlite');
  }
  const str = String(val).replace(/'/g, "''");
  return `'${str}'`;
}

async function main() {
  const sqlitePath = path.resolve(
    ROOT_DIR,
    parseArg('--sqlite') || 'data/lottery888.sqlite'
  );
  const outPath = path.resolve(
    ROOT_DIR,
    parseArg('--out') || 'workers/lottery888-api/.tmp-migration.sql'
  );

  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`Source SQLite database not found: ${sqlitePath}`);
  }

  const SQL = await initSqlJs({
    useOldExtensionFunctions: false,
    locateFile: (file: string) => {
      const localWasm = path.resolve(ROOT_DIR, 'node_modules/sql.js/dist', file);
      if (fs.existsSync(localWasm)) return localWasm;
      return file;
    },
  });

  // Read-only load into memory; original SQLite file is never modified
  const buffer = fs.readFileSync(sqlitePath);
  const db = new SQL.Database(buffer);

  const excludeSessions = process.argv.includes('--exclude-sessions');

  const tables: Array<{ name: string; mode: 'INSERT OR IGNORE' | 'INSERT OR REPLACE' }> = [
    { name: 'accounts', mode: 'INSERT OR IGNORE' },
    ...(excludeSessions ? [] : [{ name: 'sessions', mode: 'INSERT OR IGNORE' as const }]),
    { name: 'rounds', mode: 'INSERT OR IGNORE' },
    { name: 'bet_tickets', mode: 'INSERT OR IGNORE' },
    { name: 'transactions', mode: 'INSERT OR IGNORE' },
    { name: 'system_config', mode: 'INSERT OR REPLACE' },
    { name: 'audit_logs', mode: 'INSERT OR IGNORE' },
  ];

  const lines: string[] = [
    '-- Auto-generated read-only export from lottery888.sqlite for Cloudflare D1',
    '-- DO NOT COMMIT THIS FILE TO GIT',
    '',
  ];

  const counts: Record<string, number> = {};

  for (const table of tables) {
    const res = db.exec(`SELECT * FROM ${table.name}`);
    if (!res || res.length === 0) {
      counts[table.name] = 0;
      continue;
    }
    const { columns, values } = res[0];
    counts[table.name] = values.length;

    const colList = columns.map((c) => `"${c}"`).join(', ');
    for (const row of values) {
      const vals = row.map(sqlLiteral).join(', ');
      lines.push(`${table.mode} INTO "${table.name}" (${colList}) VALUES (${vals});`);
    }
    lines.push('');
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  db.close();

  console.log('[EXPORT] SQLite-to-D1 SQL export complete (read-only source).');
  console.log('[EXPORT] Output file:', path.relative(ROOT_DIR, outPath));
  console.log('[EXPORT] Row counts:', JSON.stringify(counts));
}

main().catch((err) => {
  console.error('[EXPORT ERROR]', err instanceof Error ? err.message : err);
  process.exit(1);
});
