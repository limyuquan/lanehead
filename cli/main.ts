/**
 * `lanehead`: the CLI agents use to give browser tabs their own request headers, and (as the
 * hidden `host` command) the native host the browser starts. See docs/CONTRACTS.md section 6.
 *
 * stdout: one line of compact JSON, the result or `{"error":{code,message}}`.
 * Exit: 0 ok, 1 operation error, 2 usage error, 3 not connected.
 */

import SKILL from '../skill/SKILL.md';
import { LaneheadError } from '../src/core/types';
import { CliError, type Command, HELP, parse } from './args';
import { hint, instances, runOp } from './client';
import { host } from './host';
import { install, installed, installSkill, uninstall } from './install';

async function run(cmd: Command): Promise<unknown> {
  switch (cmd.kind) {
    case 'op':
      return runOp(cmd);
    case 'status': {
      const found = await instances();
      const base = { installed: installed(), instances: found };
      return found.length ? base : { ...base, hint: hint() };
    }
    case 'install':
      return install(cmd);
    case 'uninstall':
      return uninstall();
    case 'skill':
      return cmd.install ? installSkill(SKILL) : SKILL;
    case 'help':
      return HELP;
  }
}

const argv = process.argv.slice(2);
if (argv[0] === 'host') host();
else {
  let pretty = false;
  const print = (value: unknown) =>
    process.stdout.write(
      typeof value === 'string' ? value : `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`,
    );
  try {
    const cmd = parse(argv);
    pretty = cmd.pretty;
    print(await run(cmd));
  } catch (err) {
    const known = err instanceof CliError || err instanceof LaneheadError;
    const { code, message } = known ? err : { code: 'INTERNAL', message: String(err) };
    const extra = err instanceof CliError ? err.extra : {};
    print({ error: { code, message, ...extra } });
    process.exitCode = err instanceof CliError ? err.exit : 1;
  }
}
