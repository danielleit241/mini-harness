import type { PermissionPrompter } from "../../core/permissions.js";

export interface PermissionRequest {
  toolName: string;
  input: unknown;
}

// Derived from PermissionPrompter's return type rather than redeclared, so
// this and core/permissions.ts can never drift to different answer sets.
export type PermissionAnswer = Awaited<ReturnType<PermissionPrompter>>;

type RequestListener = (
  request: PermissionRequest,
  resolve: (answer: PermissionAnswer) => void
) => void;

// Bridges checkPermission() (called deep inside executeTool(), outside the
// React tree) to the rendered PermissionPrompt: use-permission-bridge.ts
// registers itself as the listener on mount; the prompter below signals it
// with the pending request and a resolver, which PermissionPrompt's
// onSelect eventually calls. Relies on agent.ts running tool calls
// sequentially — no queueing for a hypothetical second concurrent request.
let listener: RequestListener | null = null;

export function registerPermissionRequestListener(fn: RequestListener | null): void {
  listener = fn;
}

export const inkPermissionPrompter: PermissionPrompter = (toolName, input) => {
  return new Promise<PermissionAnswer>((resolve) => {
    // No listener means there's no UI left to answer (e.g. App unmounted
    // mid-turn) — fail safe and deny, matching the unmount cleanup in
    // use-permission-bridge.ts, rather than rejecting and forcing every
    // caller up the chain to handle a broken-contract exception.
    if (!listener) {
      resolve("no");
      return;
    }
    listener({ toolName, input }, resolve);
  });
};
