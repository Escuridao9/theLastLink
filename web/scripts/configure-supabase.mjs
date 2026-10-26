import { mkdir, writeFile } from 'node:fs/promises';

const url = process.env.SUPABASE_URL?.trim();
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();

if (!url || !publishableKey) {
  throw new Error(
    'Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY before running this command.',
  );
}

const protocol = new URL(url).protocol;

if (protocol !== 'https:' && protocol !== 'http:') {
  throw new Error('SUPABASE_URL must be an HTTP or HTTPS URL.');
}

if (!publishableKey.startsWith('sb_publishable_')) {
  throw new Error(
    'SUPABASE_PUBLISHABLE_KEY must contain a Supabase publishable key.',
  );
}

const configuration = {
  url,
  publishableKey,
};

const directory = new URL('../src/environments/', import.meta.url);
const destination = new URL('supabase.config.ts', directory);

await mkdir(directory, { recursive: true });

await writeFile(
  destination,
  `export const supabaseConfig = ${JSON.stringify(configuration, null, 2)} as const;\n`,
  'utf8',
);