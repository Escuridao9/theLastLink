import { spawnSync } from 'node:child_process';
if(!process.env.npm_execpath)throw Error('Run through npm run typecheck:edge.');
const result=spawnSync(process.execPath,[process.env.npm_execpath,'exec','--yes','--package=deno@2.9.6','--',
  'deno','check','--node-modules-dir=manual','supabase/functions/match-api/index.ts'],{stdio:'inherit'});
process.exit(result.status??1);
