import { normalizeTenantUrl, rankTenants } from "@wilm-ai/wilma-cli/dist/tenant-search.js";
// Imported as JSON so it is bundled; the client's own loader reads it from disk,
// which doesn't survive Next.js bundling.
import data from "../../../packages/wilma-client/tenant_list.json";

type TenantInfo = Parameters<typeof rankTenants>[0][number];

const tenants = (data as unknown as { wilmat: TenantInfo[] }).wilmat;

export function searchTenantList(query: string, limit: number): TenantInfo[] {
  return rankTenants(tenants, query, limit);
}

export function findTenant(url: string): TenantInfo | null {
  const target = normalizeTenantUrl(url);
  return tenants.find((t) => normalizeTenantUrl(t.url) === target) ?? null;
}
