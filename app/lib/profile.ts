/**
 * Profile identity for the local, multi-person app. No login: the private
 * network is the door. A request names its person with `?p=<id>` or an
 * `x-person` header; anything else is the owner's profile: SOUL_OWNER in .env.local, or "me".
 */

export const DEFAULT_PROFILE = /^[a-z0-9][a-z0-9_-]{0,39}$/.test(process.env.SOUL_OWNER ?? "") ? process.env.SOUL_OWNER! : "me";

/** The seven lenses every interview runs. Birth lenses fill from the chart, not from items. */
export const ALWAYS_ON_LENSES = ["human_design", "gene_keys", "enneagram", "attachment", "bigfive", "chronotype", "values", "drucker", "wealth_dynamics"] as const;
/** Always-on lenses added after launch. A new assessment goes here too, so people who already finished get its questions. */
export const LATER_LENSES: readonly string[] = ["drucker", "wealth_dynamics"];
/** Paid instruments: on only when the person toggles them and enters the real result. Never proxied. */
export const PAID_LENSES = ["kolbe", "working_genius"] as const;
export type Lens = (typeof ALWAYS_ON_LENSES)[number] | (typeof PAID_LENSES)[number];
export const ALL_LENSES: readonly Lens[] = [...ALWAYS_ON_LENSES, ...PAID_LENSES];

/** Per-connector preference (lib/connectors.ts). Absent means enabled; `ingested` holds hashes of export files already taken in. */
export type ConnectorPref = { enabled: boolean; last_sync?: string; ingested?: string[] };

export type Profile = {
  id: string;
  name: string;
  email?: string;
  intention?: string;
  birth_time_known: boolean;
  enabled_lenses: string[];
  consent_at?: string;
  connectors?: Record<string, ConnectorPref>;
};

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export function sanitizeProfileId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const id = raw.trim().toLowerCase();
  return ID_RE.test(id) ? id : null;
}

/** `?p=` wins, then `x-person`, then the default. Unknown shapes fall back to the default rather than erroring. */
export function profileIdFrom(req: Request | { url?: string; headers?: Headers } | null | undefined): string {
  if (!req) return DEFAULT_PROFILE;
  try {
    if (req.url) {
      const q = new URL(req.url, "http://local").searchParams.get("p");
      const fromQuery = sanitizeProfileId(q);
      if (fromQuery) return fromQuery;
    }
  } catch { /* relative or odd URL: ignore */ }
  const fromHeader = sanitizeProfileId(req.headers?.get?.("x-person") ?? null);
  return fromHeader ?? DEFAULT_PROFILE;
}

export function displayName(id: string): string {
  return id === DEFAULT_PROFILE ? "" : id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]+/g, " ");
}

export function defaultProfile(id: string): Profile {
  return { id, name: displayName(id), birth_time_known: false, enabled_lenses: [...ALWAYS_ON_LENSES] };
}

/** Always-on lenses are never removable; paid lenses are kept only when explicitly listed. Unknown names are dropped. */
export function normalizeLenses(requested: unknown): string[] {
  const asked = new Set(Array.isArray(requested) ? requested.filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase()) : []);
  const paid = PAID_LENSES.filter((l) => asked.has(l));
  return [...ALWAYS_ON_LENSES, ...paid];
}
