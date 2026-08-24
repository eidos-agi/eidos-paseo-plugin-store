import { parseFace, parseQueueLine, viewerUrl } from "./prim.logic";

function fail(message: string): never {
  throw new Error(message);
}

const face = parseFace(`---
title: Prim
profile: brand
type: kit
---
# hi
`);
if (face.title !== "Prim" || face.profile !== "brand") {
  fail(`face parse ${JSON.stringify(face)}`);
}

const cmd = parseQueueLine("open house.opff");
if (cmd?.action !== "open" || cmd.value !== "house.opff") {
  fail("queue open");
}
if (parseQueueLine("tab color")?.value !== "color") {
  fail("queue tab");
}

const url = viewerUrl("http://127.0.0.1:7411", {
  id: "prim-docs",
  title: "Prim",
  profile: "",
  type: "",
  path: "/tmp",
  source: "docs",
  admitted: false,
}, "face");
if (!url.includes("/view") || !url.includes("prim-docs")) {
  fail(url);
}

console.log(JSON.stringify({ ok: true, face, url }, null, 2));
