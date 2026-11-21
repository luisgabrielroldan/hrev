import { connected, error } from '../store.ts';
import type { AgentStatus } from '../types.ts';

export function StatusBar({ agent }: { agent: AgentStatus }) {
  if (!connected.value) {
    return (
      <div class="status status-disconnected" role="status">
        Reconnecting to hrev… Your comments are safe. New comments can be saved when the connection returns.
      </div>
    );
  }
  if (error.value) {
    return (
      <div class="status status-error" role="alert">
        {error.value}
      </div>
    );
  }
  if (agent === 'working') {
    return (
      <div class="status status-working" role="status">
        <span class="pulse" aria-hidden="true" />
        The agent is working on your comments
      </div>
    );
  }
  if (agent === 'idle') {
    return (
      <div class="status status-idle" role="status">
        The agent is not listening right now. Your comments are saved. The agent gets them when it listens again.
      </div>
    );
  }
  return null;
}
