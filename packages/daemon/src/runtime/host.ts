import type { HostActivation } from '@olympus/shared';
import type { ActivationRequest, ActivationResult, AgentRuntime, ToolResult } from './types.js';
import { summarizeToolCall } from './types.js';

interface Pending {
  req: ActivationRequest;
  createdAt: number;
  claimedAt: number | null;
  timer: NodeJS.Timeout | null;
  resolve: (result: ActivationResult) => void;
}

const ENDED: ToolResult = {
  ok: false,
  text: 'This activation has ended (or you no longer work here). Stop now and end your turn.',
};

/**
 * Runs employees inside the Owner's Claude Code session, on the app's own login.
 * The daemon never starts a model itself: it queues activations, the session claims them
 * (/olympus:brief or /olympus:run), runs each one as a plugin subagent, and reports it done.
 * Employee tool calls come back through the plugin's MCP server, keyed by activation id.
 */
export class HostRuntime implements AgentRuntime {
  readonly mode = 'claude-code' as const;
  private pending = new Map<string, Pending>();
  private lastSeen: number | null = null;

  constructor(private readonly claimTimeoutMs: number) {}

  run(req: ActivationRequest): Promise<ActivationResult> {
    return new Promise((resolve) => {
      const entry: Pending = { req, createdAt: Date.now(), claimedAt: null, timer: null, resolve };
      this.pending.set(req.activationId, entry);
      req.abortController.signal.addEventListener(
        'abort',
        () => this.finish(req.activationId, { outcome: 'aborted', detail: 'Stopped by the company.' }),
        { once: true },
      );
    });
  }

  /** Hands every unclaimed activation to the calling Claude Code session. */
  claim(): HostActivation[] {
    this.lastSeen = Date.now();
    const claimed: HostActivation[] = [];
    for (const [id, entry] of this.pending) {
      if (entry.claimedAt !== null) continue;
      entry.claimedAt = Date.now();
      entry.timer = setTimeout(
        () =>
          this.finish(id, {
            outcome: 'error',
            detail: 'Claude Code did not report this activation in time. Its messages go back to the inbox.',
            requeue: true,
          }),
        this.claimTimeoutMs,
      );
      entry.timer.unref();
      claimed.push({
        activation_id: id,
        agent: entry.req.agentType,
        description: entry.req.description,
        prompt: entry.req.prompt,
      });
    }
    return claimed;
  }

  /** The session reports a subagent's final report. Returns false for an unknown or ended activation. */
  done(activationId: string, report: string): boolean {
    const entry = this.pending.get(activationId);
    if (!entry) return false;
    this.lastSeen = Date.now();
    const text = report.trim();
    if (text) entry.req.emit({ kind: 'note', text: text.slice(0, 4000) });
    this.finish(activationId, { outcome: 'success' });
    return true;
  }

  /** An employee's company tool call, coming through the plugin MCP server. */
  tool(activationId: string, tool: string, input: Record<string, unknown>): ToolResult {
    const entry = this.pending.get(activationId);
    if (!entry) return ENDED;
    this.lastSeen = Date.now();
    const result = entry.req.tools.call(tool, input);
    entry.req.emit({ kind: 'action', tool, summary: summarizeToolCall(tool, input) });
    return result;
  }

  counts(): { waiting: number; running: number; lastSeenAt: string | null } {
    let waiting = 0;
    let running = 0;
    for (const entry of this.pending.values()) {
      if (entry.claimedAt === null) waiting++;
      else running++;
    }
    return { waiting, running, lastSeenAt: this.lastSeen ? new Date(this.lastSeen).toISOString() : null };
  }

  private finish(activationId: string, result: Omit<ActivationResult, 'durationMs'>): void {
    const entry = this.pending.get(activationId);
    if (!entry) return;
    this.pending.delete(activationId);
    if (entry.timer) clearTimeout(entry.timer);
    entry.resolve({ ...result, durationMs: Date.now() - (entry.claimedAt ?? entry.createdAt) });
  }
}
