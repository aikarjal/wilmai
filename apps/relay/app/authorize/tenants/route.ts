import { jsonResponse } from "../../../lib/oauth";
import { searchTenantList } from "../../../lib/wilma";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const tenants = searchTenantList(q.slice(0, 100), 12);
  return jsonResponse({ tenants: tenants.map((t) => ({ url: t.url, name: t.name })) });
}
