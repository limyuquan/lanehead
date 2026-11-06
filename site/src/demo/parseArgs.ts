/**
 * Stand-in for `node:util` on the website (aliased in site/vite.config.ts), so the demo terminal
 * parses commands with the CLI's own `cli/args.ts`. Only `parseArgs`, and only what the CLI uses:
 * string and boolean options, long and short names, `--name=value`, `-Hvalue`, `multiple`,
 * positionals and `--`. Errors read like Node's.
 */
type Option = { type: 'string' | 'boolean'; short?: string; multiple?: boolean };
type Config = { args: string[]; options: Record<string, Option>; allowPositionals?: boolean };
type Values = Record<string, string | boolean | (string | boolean)[] | undefined>;

export function parseArgs({ args, options, allowPositionals }: Config) {
  const values: Values = {};
  const positionals: string[] = [];
  const put = (name: string, opt: Option, value: string | boolean) => {
    if (opt.multiple) {
      const list = (values[name] as (string | boolean)[] | undefined) ?? [];
      values[name] = [...list, value];
    } else values[name] = value;
  };
  const unknown = (arg: string) =>
    new TypeError(
      `Unknown option '${arg}'. To specify a positional argument starting with a '-', place it after a '--', as in '-- "${arg}"'.`,
    );
  const missing = (name: string, opt: Option) =>
    new TypeError(
      `Option '${opt.short ? `-${opt.short}, ` : ''}--${name} <value>' argument missing`,
    );

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = arg.slice(2, eq < 0 ? undefined : eq);
      const opt = options[name];
      if (!opt) throw unknown(`--${name}`);
      if (opt.type === 'boolean') {
        if (eq >= 0) throw new TypeError(`Option '--${name}' does not take an argument`);
        put(name, opt, true);
        continue;
      }
      const value = eq >= 0 ? arg.slice(eq + 1) : args[++i];
      if (value === undefined) throw missing(name, opt);
      put(name, opt, value);
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      // A group of short flags; a string option takes the rest of the group or the next arg.
      for (let j = 1; j < arg.length; j++) {
        const c = arg[j] as string;
        const entry = Object.entries(options).find(([, o]) => o.short === c);
        if (!entry) throw unknown(`-${c}`);
        const [name, opt] = entry;
        if (opt.type === 'boolean') {
          put(name, opt, true);
          continue;
        }
        const value = j + 1 < arg.length ? arg.slice(j + 1) : args[++i];
        if (value === undefined) throw missing(name, opt);
        put(name, opt, value);
        break;
      }
      continue;
    }
    if (!allowPositionals) throw new TypeError(`Unexpected argument '${arg}'`);
    positionals.push(arg);
  }
  return { values, positionals };
}
