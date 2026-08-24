import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { output as ZodOutput } from "zod";
import { canSign, parseList, pendingCount, type HancockFilter, type HancockRequest } from "./hancock.logic";
import { APP_NAME, SIGNER } from "./hancock.store";
import { loadTray, runSign, type Tray } from "./hancock.shared";

function userHome(): string {
  return homedir().replace(/\/\.paseo$/, "") || homedir();
}

function hancockBin(): string {
  const local = join(userHome(), ".local/bin/hancock");
  if (existsSync(local)) {
    return local;
  }
  return "hancock";
}

function runHancock(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(hancockBin(), args, {
      env: { ...process.env, HOME: userHome() },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function loadRequests(filter: HancockFilter): Promise<{ requests: HancockRequest[]; error: string | null }> {
  const listed = await runHancock(filter === "all" ? ["list", "--all", "--json"] : ["list", "--json"]);
  if (listed.code !== 0 && !listed.stdout.trim()) {
    return { requests: [], error: listed.stderr.trim() || `hancock list failed (${listed.code})` };
  }
  const parsed = parseList(parseJson(listed.stdout));
  if (listed.stdout.trim() && parsed.length === 0 && listed.stdout.trim()[0] !== "[") {
    return { requests: [], error: listed.stdout.trim() };
  }
  return { requests: parsed, error: null };
}

async function tray(filter: HancockFilter, detailId?: string): Promise<Tray> {
  const binary = hancockBin();
  const version = await runHancock(["version"]).then((result) => result.stdout.trim() || result.stderr.trim() || "unknown");
  const status = await runHancock(["status"]).then((result) => result.stdout.trim() || result.stderr.trim() || "");
  const loaded = await loadRequests(filter);
  let detail = "";
  let openId = detailId ?? null;
  if (openId) {
    const shown = await runHancock(["show", openId]);
    detail = (shown.stdout || shown.stderr).trim();
    if (!detail) {
      openId = null;
    }
  }
  return {
    host: APP_NAME,
    binary,
    version,
    statusLine: status || (loaded.requests.length === 0 ? "hancock: empty" : `${pendingCount(loaded.requests)} pending`),
    filter,
    pending: pendingCount(loaded.requests),
    requests: loaded.requests,
    detailId: openId,
    detail,
    error: loaded.error,
  };
}

export async function loadTrayHandler(input: ZodOutput<typeof loadTray.input>): Promise<Tray> {
  return tray(input.filter ?? "pending", input.id);
}

export async function runSignHandler(input: ZodOutput<typeof runSign.input>): Promise<Tray> {
  const current = await tray(input.filter ?? "pending", input.id);
  const row = current.requests.find((item) => item.id === input.id);
  if (!row) {
    throw new Error(`Unknown Hancock request ${input.id}`);
  }
  if (!canSign(row, input.action)) {
    throw new Error(`Cannot ${input.action} ${input.id}`);
  }
  const signed = await runHancock([input.action, input.id, "--as", SIGNER]);
  if (signed.code !== 0) {
    throw new Error(signed.stderr.trim() || signed.stdout.trim() || `hancock ${input.action} failed`);
  }
  return tray(input.filter ?? "pending");
}
