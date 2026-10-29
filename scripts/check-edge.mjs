import { spawnSync } from 'node:child_process';

if (!process.env.npm_execpath) throw Error('Run through an npm script.');
const mode = process.argv[2] ?? 'check';
if (!['check', 'test'].includes(mode)) throw Error('Expected check or test.');
const tasks =
  mode === 'check'
    ? [
        [
          '--config',
          'supabase/functions/create-room/deno.json',
          'supabase/functions/create-room/index.ts',
        ],
        [
          '--config',
          'supabase/functions/join-room/deno.json',
          'supabase/functions/join-room/index.ts',
        ],
        ['supabase/functions/match-api/index.ts'],
      ]
    : [
        [
          '--config',
          'supabase/functions/create-room/deno.json',
          'supabase/functions/create-room/handler.test.ts',
          'supabase/functions/join-room/handler.test.ts',
        ],
      ];

for (const args of tasks) {
  const result = spawnSync(
    process.execPath,
    [
      process.env.npm_execpath,
      'exec',
      '--yes',
      '--package=deno@2.9.6',
      '--',
      'deno',
      mode,
      `--node-modules-dir=${mode === 'check' ? 'manual' : 'none'}`,
      ...args,
    ],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
