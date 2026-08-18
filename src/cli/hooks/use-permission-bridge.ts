import { useEffect, useRef, useState } from "react";
import { setPermissionPrompter } from "../../core/permissions.js";
import {
  inkPermissionPrompter,
  registerPermissionRequestListener,
  type PermissionAnswer,
  type PermissionRequest,
} from "../services/ink-permission-prompter.js";

interface PendingRequest {
  request: PermissionRequest;
  resolve: (answer: PermissionAnswer) => void;
}

// Wires the Ink permission UI into core/permissions.ts's pluggable
// prompter seam. Kept out of App.tsx so mount/unmount wiring and the
// fail-safe-deny invariant live in one reviewable place.
export function usePermissionBridge() {
  const [pending, setPending] = useState<PendingRequest | null>(null);
  // Mirrors `pending` so unmount can deny a request still awaiting an
  // answer — without this, exiting (Ctrl+D, /exit) while a permission
  // prompt is showing would leave checkPermission() awaiting a promise
  // that never settles, hanging executeTool() forever.
  const pendingRef = useRef<PendingRequest | null>(null);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    setPermissionPrompter(inkPermissionPrompter);
    registerPermissionRequestListener((request, resolve) =>
      setPending({ request, resolve })
    );
    return () => {
      registerPermissionRequestListener(null);
      pendingRef.current?.resolve("no");
    };
  }, []);

  function respond(answer: PermissionAnswer): void {
    pending?.resolve(answer);
    setPending(null);
  }

  return { pending, respond };
}
