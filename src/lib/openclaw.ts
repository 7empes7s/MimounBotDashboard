import { exec } from "child_process";

export interface OpenclawResult<T = unknown> {
  ok: boolean;
  data: T | null;
  error: string | null;
}

function run(cmd: string, timeoutMs: number): Promise<OpenclawResult> {
  return new Promise((resolve) => {
    let settled = false;

    const child = exec(
      cmd,
      { encoding: "utf8", env: { ...process.env } },
      (err, stdout) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          resolve({ ok: false, data: null, error: err.message });
          return;
        }
        const text = stdout.trim();
        try {
          resolve({ ok: true, data: JSON.parse(text), error: null });
        } catch {
          resolve({ ok: true, data: text, error: null });
        }
      },
    );

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      resolve({
        ok: false,
        data: null,
        error: `command timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);
  });
}

export function getStatus() {
  return run("openclaw status --json", 4000);
}

export function getUsage() {
  return run("openclaw status --usage --json", 5000);
}

export function getSessions() {
  return run("openclaw sessions --all-agents --json", 5000);
}
