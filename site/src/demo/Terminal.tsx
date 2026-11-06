/** The demo terminal: type `lanehead …` and the pretend browser answers (cli.ts). */
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { run } from './cli';

type Entry = { id: number; cmd: string; out: string; error?: boolean };
let ids = 0;

export function Terminal({ tabs }: { tabs: number[] }) {
  const [log, setLog] = useState<Entry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const history = useRef<string[]>([]);
  const at = useRef(0);
  const screen = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  const exec = async (cmd: string, focus = true) => {
    setBusy(true);
    const { text, error } = await run(cmd);
    setBusy(false);
    if (cmd.trim()) history.current = [...history.current.filter((c) => c !== cmd), cmd];
    at.current = history.current.length;
    if (text === '\f') setLog([]);
    else setLog((l) => [...l.slice(-30), { id: ids++, cmd, out: text, ...(error && { error }) }]);
    setInput('');
    if (focus) field.current?.focus({ preventScroll: true });
  };

  // Opens with the first thing an agent runs.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void exec('lanehead tabs', false);
  });

  // Keep the newest output in view, inside the terminal only.
  const count = log.length;
  useEffect(() => {
    const el = screen.current;
    if (el && count) el.scrollTop = el.scrollHeight;
  }, [count]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) void exec(input);
  };

  const [a = 0, b = a] = tabs;
  const tries = [
    `lanehead set ${b} -p staging --reload`,
    `lanehead set ${a} -H 'x-debug: 1'`,
    `lanehead clear ${a} --reload`,
    `lanehead get ${a}`,
  ];

  return (
    <section className="win terminal" aria-label="Terminal" data-testid="terminal">
      <div className="term-bar">
        <span className="lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="term-title">Terminal — agent</span>
      </div>
      <div className="term-screen" ref={screen}>
        {log.map((e) => (
          <div key={e.id} className="term-entry">
            <p className="term-cmd">
              <span className="term-prompt" aria-hidden="true">
                ${' '}
              </span>
              {e.cmd}
            </p>
            {e.out && (
              <pre className={e.error ? 'term-out term-err' : 'term-out'} data-testid="term-out">
                {e.out}
              </pre>
            )}
          </div>
        ))}
        <form onSubmit={submit} className="term-line">
          <span className="term-prompt" aria-hidden="true">
            $
          </span>
          <input
            ref={field}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              const h = history.current;
              if (e.key === 'ArrowUp' && at.current > 0) {
                e.preventDefault();
                at.current -= 1;
                setInput(h[at.current] ?? '');
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                at.current = Math.min(h.length, at.current + 1);
                setInput(h[at.current] ?? '');
              }
            }}
            aria-label="Command"
            placeholder="lanehead help"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            data-testid="term-input"
          />
        </form>
      </div>
      <div className="term-tries">
        <span className="dim">Try</span>
        {tries.map((t) => (
          <button key={t} type="button" disabled={busy} onClick={() => void exec(t)}>
            {t.replace(/^lanehead /, '')}
          </button>
        ))}
      </div>
    </section>
  );
}
