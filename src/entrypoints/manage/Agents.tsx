/** Agents: the native bridge's state, how to install it, and this browser's name for agents. */
import { useState } from 'react';
import { AGENT_STATES } from '@/shared/agent';
import { REPO_URL } from '@/shared/ids';
import { call } from '@/shared/messages';
import { type Data, SectionHead } from './Manage';

const INSTALL =
  'curl -fsSL https://github.com/limyuquan/lanehead/releases/latest/download/install.sh | sh';

export function Agents({ data }: { data: Data }) {
  const { status, settings } = data;
  const state = AGENT_STATES[status.agent];
  const [label, setLabel] = useState(settings.label);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const saveLabel = () => {
    if (label.trim() === settings.label) return;
    call('settings', { patch: { label } }).then(
      () => setError(''),
      (err: Error) => setError(err.message),
    );
  };
  const copy = async () => {
    await navigator.clipboard.writeText(INSTALL);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const row = 'grid gap-x-6 gap-y-1 border-b border-line py-4 sm:grid-cols-[130px_minmax(0,1fr)]';
  return (
    <section aria-labelledby="agents-heading">
      <SectionHead
        id="agents"
        title="Agents"
        about="Let a coding agent switch lanes for you, through the lanehead CLI on this computer."
      />
      <dl className="border-t border-line">
        <div className={row}>
          <dt className="text-muted">Status</dt>
          <dd>
            <p className="flex items-center gap-2 font-medium" data-testid="agent-state">
              <span className="dot" style={{ background: state.dot }} />
              {state.label}
            </p>
            <p className="text-muted">
              {state.about}{' '}
              {status.agent === 'off' && !settings.agentControl && (
                <button
                  type="button"
                  className="link"
                  onClick={() => call('settings', { patch: { agentControl: true } })}
                >
                  Turn on
                </button>
              )}
            </p>
          </dd>
        </div>
        <div className={row}>
          <dt className="text-muted">Install</dt>
          <dd>
            <div className="flex items-start gap-3">
              <code className="min-w-0 break-all font-mono text-[13px]">
                <span className="text-muted select-none">$ </span>
                {INSTALL}
              </code>
              <button type="button" className="btn btn-quiet" onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="pt-1 text-muted">
              Run once in a terminal (macOS or Linux, Node.js 22+). It installs the lanehead CLI and
              registers a small bridge (native messaging host) for Chrome; add{' '}
              <code className="font-mono">-s -- --browser edge</code> after <code>sh</code> for
              another browser. The bridge listens only on this computer.
            </p>
          </dd>
        </div>
        {status.ui && (
          <div className={row}>
            <dt className="text-muted">Control page</dt>
            <dd>
              <a
                className="link font-mono text-[13px]"
                href={status.ui}
                target="_blank"
                rel="noreferrer"
              >
                {status.ui}
              </a>
              <p className="pt-1 text-muted">
                For agents with browser tools but no shell, like Claude in Chrome: they open this
                page to set a tab's headers.
              </p>
            </dd>
          </div>
        )}
        <div className={row}>
          <dt className="text-muted">Instance</dt>
          <dd>
            <code className="font-mono text-[13px]">{status.instance}</code>
            <span className="text-muted">
              {' '}
              · {status.browser} · Lanehead {status.version}
            </span>
          </dd>
        </div>
        <div className={row}>
          <dt>
            <label htmlFor="agent-label" className="text-muted">
              Label
            </label>
          </dt>
          <dd>
            <input
              id="agent-label"
              className="input w-full max-w-[280px]"
              value={label}
              onChange={(e) => setLabel(e.currentTarget.value)}
              onBlur={saveLabel}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <p className="pt-1 text-muted">
              How agents tell this browser profile apart from others.
            </p>
            {error && (
              <p role="alert" className="text-danger">
                {error}
              </p>
            )}
          </dd>
        </div>
      </dl>

      <h3 className="pt-8 pb-2 font-medium">What agents can do</h3>
      <ul className="max-w-[640px] list-disc space-y-1 pl-5 text-muted marker:text-muted">
        <li>List tabs and the headers each one sends.</li>
        <li>Put a tab in a lane, give it extra headers of its own, or turn it off.</li>
        <li>Open a URL in a new tab that sends the lane from its very first request.</li>
        <li>Reload a tab after a change.</li>
      </ul>
      <p className="pt-4 text-muted">
        Teach your agent with the{' '}
        <a
          className="link"
          href={`${REPO_URL}/blob/main/skill/SKILL.md`}
          target="_blank"
          rel="noreferrer"
        >
          Lanehead skill
        </a>
        . With Claude in Chrome, its tab ids are the ids the CLI takes.
      </p>
    </section>
  );
}
