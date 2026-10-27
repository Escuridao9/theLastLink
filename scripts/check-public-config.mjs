import { readFileSync } from 'node:fs';
import { validatePublicConfiguration } from '../src/configuration.ts';
const input = JSON.parse(readFileSync(new URL('../web/public/config.json', import.meta.url), 'utf8'));
const allowed = new Set(['supabaseUrl', 'supabasePublishableKey', 'catalogueId', 'transport']);
if (Object.keys(input).some(key => !allowed.has(key))) throw Error('Remove unexpected fields from public config.json. Export only the four documented public settings.');
validatePublicConfiguration(input);
console.log('Public configuration checked.');
