import { folderOf, normalizePath } from "./tree.logic";
import type { Catalog, Chat, Project, Workspace } from "./tree.shared";

export const TENANT_ORDER = ["AIC", "Eidos", "Greenmark", "Reeves", "Northstar"] as const;

export const TENANT_LABEL_KEY = "tenant";

export function isTenantName(name: string): boolean {
  return (TENANT_ORDER as readonly string[]).includes(name);
}

export type Filter = "live" | "all";

export type DeskRow =
  | {
      kind: "tenant";
      key: string;
      title: string;
      depth: number;
      open: boolean;
      live: number;
      quiet: number;
    }
  | {
      kind: "product";
      key: string;
      title: string;
      depth: number;
      open: boolean;
      live: number;
      quiet: number;
      cwd: string;
    }
  | {
      kind: "chat";
      key: string;
      title: string;
      depth: number;
      id: string;
      status: string;
      live: boolean;
      folder: string;
    };

type Product = {
  id: string;
  title: string;
  cwd: string;
  chats: Chat[];
};

type Tenant = {
  name: string;
  products: Product[];
};

const LIVE_STATUSES = new Set([
  "running",
  "initializing",
  "working",
  "active",
  "busy",
  "streaming",
  "error",
  "failed",
  "attention",
  "needs_input",
  "needs-input",
]);

export function isLive(status: string): boolean {
  return LIVE_STATUSES.has(status.trim().toLowerCase());
}

export function statusLabel(status: string): string {
  if (isLive(status)) {
    return status === "error" || status === "failed" ? "needs you" : "live";
  }
  if (status === "closed") {
    return "quiet";
  }
  return "idle";
}

function tenantFromTitle(title: string): string | undefined {
  for (const tenant of TENANT_ORDER) {
    if (
      title === tenant ||
      title.startsWith(`${tenant} `) ||
      title.startsWith(`${tenant}-`) ||
      title.startsWith(`${tenant}—`)
    ) {
      return tenant;
    }
  }
  return undefined;
}

function tenantFromPath(cwd: string, projects: Project[]): string | undefined {
  const normalized = cwd.replace(/\/$/, "");
  if (!normalized) {
    return undefined;
  }
  const hit = [...projects]
    .filter((project) => isTenantName(project.name) && project.path)
    .sort((a, b) => b.path.length - a.path.length)
    .find(
      (project) =>
        normalized === project.path.replace(/\/$/, "") ||
        normalized.startsWith(`${project.path.replace(/\/$/, "")}/`),
    );
  return hit?.name;
}

export function tenantOfWorkspace(workspace: Workspace, projects: Project[]): string {
  if (isTenantName(workspace.project)) {
    return workspace.project;
  }
  if (workspace.projectId) {
    const named = projects.find((project) => project.id === workspace.projectId);
    if (named && isTenantName(named.name)) {
      return named.name;
    }
  }
  return (
    tenantFromTitle(workspace.title) ??
    tenantFromPath(workspace.cwd, projects) ??
    "Other"
  );
}

export function tenantOfChat(chat: Chat, projects: Project[]): string {
  return tenantFromTitle(chat.title) ?? tenantFromPath(chat.cwd ?? "", projects) ?? "Other";
}

function attachChats(workspaces: Workspace[], chats: Chat[]): Map<string, Chat[]> {
  const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const grouped = new Map<string, Chat[]>();
  const unused = [...chats];
  const claimed = new Set<string>();

  for (const chat of unused) {
    const id = chat.workspaceId;
    if (id && byId.has(id)) {
      const list = grouped.get(id) ?? [];
      list.push(chat);
      grouped.set(id, list);
      claimed.add(chat.id);
    }
  }

  for (const chat of unused) {
    if (claimed.has(chat.id) || !chat.cwd) {
      continue;
    }
    const exact = workspaces.find((workspace) => workspace.cwd === chat.cwd);
    if (exact) {
      const list = grouped.get(exact.id) ?? [];
      list.push(chat);
      grouped.set(exact.id, list);
      claimed.add(chat.id);
    }
  }

  for (const chat of unused) {
    if (claimed.has(chat.id) || !chat.cwd) {
      continue;
    }
    const prefix = [...workspaces]
      .filter(
        (workspace) => chat.cwd === workspace.cwd || chat.cwd?.startsWith(`${workspace.cwd}/`),
      )
      .sort((a, b) => b.cwd.length - a.cwd.length)[0];
    if (prefix) {
      const list = grouped.get(prefix.id) ?? [];
      list.push(chat);
      grouped.set(prefix.id, list);
      claimed.add(chat.id);
    }
  }

  grouped.set(
    "unfiled",
    unused.filter((chat) => !claimed.has(chat.id)),
  );
  return grouped;
}

function tally(chats: Chat[]): { live: number; quiet: number } {
  let live = 0;
  let quiet = 0;
  for (const chat of chats) {
    if (isLive(chat.status)) {
      live += 1;
    } else {
      quiet += 1;
    }
  }
  return { live, quiet };
}

function sortChats(chats: Chat[]): Chat[] {
  return [...chats].sort((a, b) => {
    const liveDelta = Number(isLive(b.status)) - Number(isLive(a.status));
    if (liveDelta !== 0) {
      return liveDelta;
    }
    return a.title.localeCompare(b.title);
  });
}

function tenantRank(name: string): number {
  const index = (TENANT_ORDER as readonly string[]).indexOf(name);
  if (index >= 0) {
    return index;
  }
  return name === "Other" ? 1000 : 100 + name.localeCompare("M");
}

function buildTenants(catalog: Catalog): Tenant[] {
  const grouped = attachChats(catalog.workspaces, catalog.chats);
  const tenants = new Map<string, Tenant>();

  function ensure(name: string): Tenant {
    const existing = tenants.get(name);
    if (existing) {
      return existing;
    }
    const created = { name, products: [] };
    tenants.set(name, created);
    return created;
  }

  for (const workspace of catalog.workspaces) {
    const tenant = ensure(tenantOfWorkspace(workspace, catalog.projects));
    tenant.products.push({
      id: workspace.id,
      title: workspace.title || workspace.id.slice(0, 8),
      cwd: workspace.cwd,
      chats: sortChats(grouped.get(workspace.id) ?? []),
    });
  }

  const loose = grouped.get("unfiled") ?? [];
  const byTenant = new Map<string, Chat[]>();
  for (const chat of loose) {
    const name = tenantOfChat(chat, catalog.projects);
    const list = byTenant.get(name) ?? [];
    list.push(chat);
    byTenant.set(name, list);
  }
  for (const [name, chats] of byTenant) {
    if (chats.length === 0) {
      continue;
    }
    ensure(name).products.push({
      id: `unfiled:${name}`,
      title: "Unfiled",
      cwd: "",
      chats: sortChats(chats),
    });
  }

  for (const tenant of tenants.values()) {
    tenant.products.sort((a, b) => {
      const aLive = tally(a.chats).live;
      const bLive = tally(b.chats).live;
      if (bLive !== aLive) {
        return bLive - aLive;
      }
      if (a.title === "Unfiled") {
        return 1;
      }
      if (b.title === "Unfiled") {
        return -1;
      }
      return a.title.localeCompare(b.title);
    });
  }

  return [...tenants.values()].sort((a, b) => tenantRank(a.name) - tenantRank(b.name));
}

function hitsQuery(text: string, query: string): boolean {
  return !query || text.toLowerCase().includes(query);
}

export function defaultOpenKeys(catalog: Catalog): string[] {
  const keys: string[] = [];
  for (const tenant of buildTenants(catalog)) {
    const products = tenant.products.filter((product) => tally(product.chats).live > 0);
    if (products.length === 0) {
      continue;
    }
    keys.push(`tenant:${tenant.name}`);
    for (const product of products) {
      keys.push(`product:${product.id}`);
    }
  }
  return keys;
}

export function buildDeskRows(
  catalog: Catalog,
  filter: Filter,
  query: string,
  expanded: Set<string>,
): DeskRow[] {
  const needle = query.trim().toLowerCase();
  const searching = Boolean(needle);
  const rows: DeskRow[] = [];

  for (const tenant of buildTenants(catalog)) {
    const products = tenant.products
      .map((product) => ({
        ...product,
        chats: product.chats.filter((chat) => {
          if (filter === "live" && !isLive(chat.status)) {
            return false;
          }
          return (
            hitsQuery(chat.title, needle) ||
            hitsQuery(chat.id, needle) ||
            hitsQuery(folderOf(chat), needle) ||
            hitsQuery(product.title, needle) ||
            hitsQuery(tenant.name, needle)
          );
        }),
      }))
      .filter((product) => {
        if (searching) {
          return product.chats.length > 0 || hitsQuery(product.title, needle);
        }
        if (filter === "live") {
          return tally(product.chats).live > 0;
        }
        return true;
      });

    if (products.length === 0) {
      continue;
    }

    const live = products.reduce((sum, product) => sum + tally(product.chats).live, 0);
    const quiet = products.reduce((sum, product) => sum + tally(product.chats).quiet, 0);
    if (filter === "live" && live === 0 && !searching) {
      continue;
    }

    const tenantKey = `tenant:${tenant.name}`;
    const open = searching || filter === "live" || expanded.has(tenantKey);
    rows.push({
      kind: "tenant",
      key: tenantKey,
      title: tenant.name,
      depth: 0,
      open,
      live,
      quiet,
    });
    if (!open) {
      continue;
    }

    for (const product of products) {
      const counts = tally(product.chats);
      const productKey = `product:${product.id}`;
      const productOpen = searching || filter === "live" || expanded.has(productKey);
      rows.push({
        kind: "product",
        key: productKey,
        title: product.title,
        depth: 1,
        open: productOpen,
        live: counts.live,
        quiet: counts.quiet,
        cwd: product.cwd,
      });
      if (!productOpen) {
        continue;
      }
      for (const chat of product.chats) {
        rows.push({
          kind: "chat",
          key: `chat:${product.id}:${chat.id}`,
          title: chat.title,
          depth: 2,
          id: chat.id,
          status: chat.status,
          live: isLive(chat.status),
          folder: folderOf(chat),
        });
      }
    }
  }

  return rows;
}

export function countLive(catalog: Catalog): number {
  return catalog.chats.filter((chat) => isLive(chat.status)).length;
}

export type TenantStamp = {
  agentId: string;
  tenant: string;
  current: string;
};

export function tenantStamps(catalog: Catalog): TenantStamp[] {
  const grouped = attachChats(catalog.workspaces, catalog.chats);
  const stamps: TenantStamp[] = [];
  const seen = new Set<string>();

  function add(chat: Chat, tenant: string): void {
    if (!isTenantName(tenant) || seen.has(chat.id)) {
      return;
    }
    seen.add(chat.id);
    stamps.push({
      agentId: chat.id,
      tenant,
      current: chat.labels[TENANT_LABEL_KEY] ?? "",
    });
  }

  for (const workspace of catalog.workspaces) {
    const tenant = tenantOfWorkspace(workspace, catalog.projects);
    for (const chat of grouped.get(workspace.id) ?? []) {
      add(chat, tenant);
    }
  }
  for (const chat of grouped.get("unfiled") ?? []) {
    add(chat, tenantOfChat(chat, catalog.projects));
  }
  return stamps;
}

export { normalizePath };
