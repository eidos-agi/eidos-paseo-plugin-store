import {
  canSign,
  filterTray,
  parseList,
  pendingCount,
  shortCommand,
  type HancockRequest,
} from "./hancock.logic";

function fail(message: string): never {
  throw new Error(message);
}

function expect(ok: unknown, message: string): void {
  if (!ok) {
    fail(message);
  }
}

const sample = parseList([
  {
    id: "req_aaa",
    command: "git push origin main",
    cwd: "/repo",
    reason: "ship",
    risk: "high",
    status: "pending",
    created_at: "2026-08-24T00:00:00Z",
    exit_code: null,
    approver: "",
    stderr: "",
  },
  {
    id: "req_bbb",
    command: "echo hi",
    cwd: "",
    reason: "",
    status: "approved",
    created_at: "2026-08-23T00:00:00Z",
  },
]);

expect(sample.length === 2, "parse two rows");
expect(sample[0].id === "req_aaa" && sample[0].status === "pending", "pending row");
expect(sample[1].exitCode === null && sample[1].command === "echo hi", "optional fields");
expect(pendingCount(sample) === 1, "one pending");
expect(filterTray(sample, "pending").length === 1, "pending filter");
expect(canSign(sample[0] as HancockRequest, "approve") === true, "can approve pending");
expect(canSign(sample[1] as HancockRequest, "approve") === false, "cannot re-sign");
expect(shortCommand("a".repeat(80), 20).endsWith("…"), "truncates");
expect(parseList({ not: "array" }).length === 0, "bad payload");
expect(parseList([{ command: "x" }]).length === 0, "missing id dropped");

console.log(JSON.stringify({ ok: true, pending: pendingCount(sample) }));
