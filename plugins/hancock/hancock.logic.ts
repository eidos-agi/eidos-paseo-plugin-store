export type HancockRequest = {
  id: string;
  command: string;
  cwd: string;
  reason: string;
  risk: string;
  status: string;
  createdAt: string;
  exitCode: number | null;
  approver: string;
  stderr: string;
};

export type HancockFilter = "pending" | "all";

export type HancockAction = "approve" | "deny" | "skip";

export function parseList(raw: unknown): HancockRequest[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const rows: HancockRequest[] = [];
  for (const item of raw) {
    const rec = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
    const id = typeof rec?.id === "string" ? rec.id.trim() : "";
    if (!rec || !id) {
      continue;
    }
    rows.push({
      id,
      command: typeof rec.command === "string" ? rec.command : "",
      cwd: typeof rec.cwd === "string" ? rec.cwd : "",
      reason: typeof rec.reason === "string" ? rec.reason : "",
      risk: typeof rec.risk === "string" ? rec.risk : "",
      status: typeof rec.status === "string" ? rec.status : "unknown",
      createdAt: typeof rec.created_at === "string" ? rec.created_at : "",
      exitCode: typeof rec.exit_code === "number" ? rec.exit_code : null,
      approver: typeof rec.approver === "string" ? rec.approver : "",
      stderr: typeof rec.stderr === "string" ? rec.stderr : "",
    });
  }
  return rows;
}

export function isPending(row: HancockRequest): boolean {
  return row.status === "pending" || row.status === "";
}

export function filterTray(rows: HancockRequest[], filter: HancockFilter): HancockRequest[] {
  if (filter === "pending") {
    return rows.filter(isPending);
  }
  return rows;
}

export function canSign(row: HancockRequest, action: HancockAction): boolean {
  return isPending(row) && (action === "approve" || action === "deny" || action === "skip");
}

export function pendingCount(rows: HancockRequest[]): number {
  return rows.filter(isPending).length;
}

export function shortCommand(command: string, max = 72): string {
  const text = command.replace(/\s+/g, " ").trim();
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}
