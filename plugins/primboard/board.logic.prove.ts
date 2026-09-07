import {
  axCard,
  axColumn,
  columnFor,
  defaultTab,
  dragSucceeded,
  placePack,
  findAx,
  groupBoard,
  hitColumn,
  oracleFromGrouped,
  packViewerUrl,
  type PackCard,
} from "./board.logic";

const pack: PackCard = {
  id: "demo-atlas.opf",
  title: "Atlas",
  profile: "opf",
  type: "opf",
  path: "/tmp/atlas",
  source: "demo",
  admitted: false,
};

const url = packViewerUrl("http://127.0.0.1:7411", pack, "face");
if (!url.includes("/view")) throw new Error("viewer path");
if (!url.includes("id=demo-atlas.opf")) throw new Error("pack id");
if (!url.includes("tab=face")) throw new Error("tab");
if (defaultTab({ ...pack, profile: "album", type: "album" }) !== "play") {
  throw new Error("album tab");
}

const other: PackCard = { ...pack, id: "notes-call", title: "Call", source: "memory", admitted: true };
const beforeGrouped = groupBoard([pack, other]);
const before = oracleFromGrouped(beforeGrouped);
if (before.demo[0] !== "demo-atlas.opf") throw new Error("atlas starts in demo");
if (before.memory[0] !== "notes-call") throw new Error("call starts in memory");
if (columnFor(pack) !== "demo") throw new Error("source column");

const placed = placePack({}, pack.id, "memory");
const after = oracleFromGrouped(groupBoard([pack, other], placed));
if (!dragSucceeded(before, after, pack.id, "memory")) {
  throw new Error(`drop did not move atlas: ${JSON.stringify({ before, after })}`);
}
if (after.demo.includes(pack.id)) throw new Error("atlas still in demo");
if (!after.memory.includes(pack.id)) throw new Error("atlas missing from memory");
if (dragSucceeded(before, after, pack.id, "demo")) throw new Error("same-column must not count as a drag");
if (dragSucceeded(before, before, pack.id, "memory")) throw new Error("unchanged oracle must fail");

const frames = {
  memory: { x: 0, y: 0, width: 100, height: 200 },
  demo: { x: 100, y: 0, width: 100, height: 200 },
};
if (hitColumn(20, 40, frames) !== "memory") throw new Error("hit memory");
if (hitColumn(150, 40, frames) !== "demo") throw new Error("hit demo");
if (hitColumn(400, 40, frames) !== null) throw new Error("miss");

const snap = [
  { axidentifier: axCard(pack.id), x: 140, y: 50 },
  { axidentifier: axColumn("memory"), x: 40, y: 50 },
];
const from = findAx(snap, axCard(pack.id));
const to = findAx(snap, axColumn("memory"));
if (!from || !to) throw new Error("ax labels missing");
const dropAt = hitColumn(to.x, to.y, frames);
if (dropAt !== "memory") throw new Error("ax drop target");
const robotAfter = oracleFromGrouped(groupBoard([pack, other], placePack({}, pack.id, dropAt)));
if (!dragSucceeded(before, robotAfter, pack.id, "memory")) {
  throw new Error("ax-driven drop failed the oracle");
}
if (axCard(pack.id) !== "primboard.card.demo-atlas.opf") throw new Error("ax card id");
if (axColumn("memory") !== "primboard.column.memory") throw new Error("ax column id");

console.log("ok");
console.log(JSON.stringify({ before, after: robotAfter }, null, 2));
