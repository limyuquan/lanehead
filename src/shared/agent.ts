/** The native bridge's state as the UI shows it, read live from `storage.session.agent`. */
import { browser } from 'wxt/browser';
import type { AgentState } from '@/core/types';
import { call } from './messages';

export const AGENT_STATES: Record<AgentState, { label: string; about: string; dot: string }> = {
  connected: {
    label: 'Connected',
    about: 'Agents on this computer can use the lanehead CLI now.',
    dot: '#188038',
  },
  connecting: {
    label: 'Connecting…',
    about: 'Waiting for the bridge to answer.',
    dot: '#b06000',
  },
  'no-host': {
    label: 'Bridge not installed',
    about: 'Run the install command below. Lanehead retries every 30 seconds.',
    dot: '#c5221f',
  },
  off: {
    label: 'Off',
    about: 'Agent control is turned off.',
    dot: 'var(--color-muted)',
  },
};

/** The bridge state the service worker published; asks it directly if it has not yet. */
export async function readAgent(): Promise<AgentState> {
  const { agent } = await browser.storage.session.get('agent');
  return (agent as AgentState | undefined) ?? (await call('status', {})).agent;
}
