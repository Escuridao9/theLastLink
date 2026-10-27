import { writeFileSync } from 'node:fs';
import { PREVIEW_CONFIGURATION, validatePublicConfiguration } from '../src/configuration.ts';
const configuration = validatePublicConfiguration({ ...PREVIEW_CONFIGURATION,
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '',
});
writeFileSync(new URL('../web/public/config.json', import.meta.url), JSON.stringify(configuration, null, 2)+'\n');
console.log(configuration.supabaseUrl ? 'Frontend public configuration written. No private environment values were exported.' : 'Catalogue preview configured; multiplayer needs your manually configured Supabase project.');
