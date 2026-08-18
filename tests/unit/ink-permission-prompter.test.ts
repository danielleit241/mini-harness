import { afterEach, describe, expect, it } from "vitest";
import {
  inkPermissionPrompter,
  registerPermissionRequestListener,
} from "../../src/cli/services/ink-permission-prompter.js";

afterEach(() => {
  registerPermissionRequestListener(null);
});

describe("inkPermissionPrompter", () => {
  it("fails safe and resolves 'no' when no listener is registered", async () => {
    await expect(inkPermissionPrompter("write_file", { path: "a" })).resolves.toBe("no");
  });

  it("forwards the request to the registered listener and resolves with its answer", async () => {
    registerPermissionRequestListener((request, resolve) => {
      expect(request).toEqual({ toolName: "run_command", input: { command: "ls" } });
      resolve("always");
    });

    await expect(inkPermissionPrompter("run_command", { command: "ls" })).resolves.toBe(
      "always"
    );
  });

  it("fails safe again once the listener is unregistered", async () => {
    registerPermissionRequestListener((_request, resolve) => resolve("yes"));
    registerPermissionRequestListener(null);

    await expect(inkPermissionPrompter("write_file", { path: "a" })).resolves.toBe("no");
  });
});
