import { listTenants, type TenantInfo } from "@wilm-ai/wilma-client";

// tenant_list.json uses snake_case municipality keys while the client type
// declares camelCase; accept both so municipality search actually matches.
type RawMunicipality = { nameFi?: string; nameSv?: string; name_fi?: string; name_sv?: string } | null;

function municipalityNames(tenant: TenantInfo): string[] {
  const list = (Array.isArray(tenant.municipalities) ? tenant.municipalities : []) as RawMunicipality[];
  const names: string[] = [];
  for (const m of list) {
    if (!m) continue;
    for (const value of [m.nameFi, m.nameSv, m.name_fi, m.name_sv]) {
      if (value) names.push(value);
    }
  }
  return names;
}

export function fuzzyIncludes(target: string, needle: string): boolean {
  const hay = (target ?? "").toLowerCase();
  const search = (needle ?? "").toLowerCase();
  if (!search) return true;
  if (hay.includes(search)) return true;
  let i = 0;
  for (const ch of hay) {
    if (ch === search[i]) {
      i += 1;
      if (i >= search.length) return true;
    }
  }
  return false;
}

export function tenantMatches(search: string, tenant: TenantInfo): boolean {
  const needle = (search ?? "").toLowerCase();
  if (fuzzyIncludes(tenant.name ?? "", needle)) return true;
  if (fuzzyIncludes(tenant.url ?? "", needle)) return true;
  return municipalityNames(tenant).some((name) => fuzzyIncludes(name, needle));
}

/**
 * 0 = subdomain or name equals the query (a city's own Wilma),
 * 1 = municipality equals it, 2 = prefix, 3 = substring, 4 = fuzzy, null = no match.
 */
function matchRank(search: string, tenant: TenantInfo): number | null {
  const needle = search.trim().toLowerCase();
  const host = (tenant.url ?? "").replace(/^https?:\/\//, "").toLowerCase();
  const subdomain = host.split(".")[0] ?? "";
  const name = (tenant.name ?? "").toLowerCase();
  const municipalities = municipalityNames(tenant).map((m) => m.toLowerCase());
  const fields = [name, subdomain, ...municipalities];
  if (subdomain === needle || name === needle) return 0;
  if (municipalities.includes(needle)) return 1;
  if (fields.some((f) => f.startsWith(needle))) return 2;
  if (fields.some((f) => f.includes(needle)) || host.includes(needle)) return 3;
  if (tenantMatches(needle, tenant)) return 4;
  return null;
}

// Within a rank, list a municipality's own school Wilma before private schools,
// institutes and colleges — that's the one most parents are looking for.
function municipalBias(tenant: TenantInfo): number {
  return /kaupun|kunta|kunnan|perusopetus|opetustoimi|sivistys/i.test(tenant.name ?? "") ? 0 : 1;
}

/** Rank a tenant list against a query (pure; for callers that load the list themselves). */
export function rankTenants(tenants: TenantInfo[], query: string, limit = 20): TenantInfo[] {
  const needle = (query ?? "").trim();
  if (!needle) return tenants.slice(0, limit);
  const ranked = tenants
    .map((tenant) => ({ tenant, rank: matchRank(needle, tenant) }))
    .filter((entry): entry is { tenant: TenantInfo; rank: number } => entry.rank !== null);
  // Loose letter-by-letter matches ("espoo" inside "Joensuun ... opetus") are only
  // a fallback for typos; never mix them into real results.
  const hasRealMatch = ranked.some((entry) => entry.rank < 4);
  return ranked
    .filter((entry) => !hasRealMatch || entry.rank < 4)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        municipalBias(a.tenant) - municipalBias(b.tenant) ||
        (a.tenant.name ?? "").localeCompare(b.tenant.name ?? "", "fi")
    )
    .slice(0, limit)
    .map((entry) => entry.tenant);
}

export async function searchTenants(query: string, limit = 20): Promise<TenantInfo[]> {
  return rankTenants(await listTenants(), query, limit);
}

/** Canonical form of a Wilma address: lowercase scheme and host, no trailing slash. */
export function normalizeTenantUrl(value: string): string {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    return `${url.origin}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return trimmed.replace(/\/$/, "");
  }
}

/**
 * Resolve a tenant from a URL or a school/city name for non-interactive use.
 * Throws with the candidate list when the name is ambiguous.
 */
export async function resolveTenant(query: string): Promise<TenantInfo> {
  const value = (query ?? "").trim();
  if (!value) throw new Error("Missing Wilma address (a URL like https://<school>.inschool.fi or a city name).");
  if (/^https?:\/\//i.test(value)) {
    const url = normalizeTenantUrl(value);
    const tenants = await listTenants();
    return tenants.find((t) => normalizeTenantUrl(t.url) === url) ?? { url, name: url, municipalities: [] };
  }
  const tenants = await listTenants();
  const ranked = tenants
    .map((tenant) => ({ tenant, rank: matchRank(value, tenant) }))
    .filter((entry): entry is { tenant: TenantInfo; rank: number } => entry.rank !== null && entry.rank <= 3);
  const best = Math.min(...ranked.map((entry) => entry.rank));
  const top = ranked.filter((entry) => entry.rank === best).map((entry) => entry.tenant);
  if (top.length === 1) return top[0];
  if (!top.length) {
    throw new Error(`No Wilma found for "${value}". Many schools use their city's Wilma: try the city or municipality the school is in. Or use the full address, e.g. https://<school>.inschool.fi`);
  }
  const options = top.slice(0, 10).map((t) => `  ${t.url}  ${t.name}`).join("\n");
  throw new Error(`"${value}" matches several Wilmas. Use the address instead:\n${options}`);
}
