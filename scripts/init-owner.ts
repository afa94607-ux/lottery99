import 'dotenv/config';
import { db } from '../server/db';

function parseArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return undefined;
}

async function main() {
  const username = parseArg('--username') || process.env.OWNER_INIT_USERNAME;
  const password = parseArg('--password') || process.env.OWNER_INIT_PASSWORD;
  const name = parseArg('--name') || 'Platform Owner';

  if (!username || !password) {
    console.error(
      'Usage: npx tsx scripts/init-owner.ts --username <USERNAME> --password <PASSWORD>'
    );
    console.error('Or set OWNER_INIT_USERNAME and OWNER_INIT_PASSWORD in your environment.');
    process.exit(1);
  }

  await db.init();
  const owner = db.createOrUpdateOwnerAccount(username, password, name);
  console.log(
    `[OK] Owner account initialized securely in SQLite database (ID: ${owner.id}, Username: ${owner.username}).`
  );
}

main().catch((err) => {
  console.error('[ERROR] Failed to initialize owner account:', err.message || err);
  process.exit(1);
});
