/*
 * The repository's GitHub stars, for the GitHub chip in the top bar. Used at
 * build time (the number in the static page) and by the Worker's daily job
 * (the live number), so it must not depend on Next.
 */

export const GITHUB_REPO = "aikarjal/wilmai";
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;

/** `token` is optional: it lifts GitHub's per-IP limit on anonymous API requests. */
export async function githubStars(init: RequestInit = {}, token?: string): Promise<number> {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "wilm.ai",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  if (!response.ok) throw new Error(`GitHub API answered ${response.status}`);
  const body = (await response.json()) as { stargazers_count?: unknown };
  if (typeof body.stargazers_count !== "number") throw new Error("GitHub API: no star count");
  return body.stargazers_count;
}
