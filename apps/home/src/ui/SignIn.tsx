import { useMemo, useState, type ReactNode } from "react";
import { useLocalEdition } from "../data/edition";
import { Brand, Icon } from "./bits";
import { TENANTS, searchTenants, type Tenant } from "../data/tenants";
import { isDesktopApp } from "../wilma/transport";
import { t } from "../i18n";

/** A sentence translated whole, with the part between asterisks wrapped in markup: "Wilma, *reimagined.*" */
function marked(text: string, wrap: (part: string) => ReactNode): ReactNode {
  const [before, part, after = ""] = text.split("*");
  return part === undefined ? text : (
    <>
      {before}
      {wrap(part)}
      {after}
    </>
  );
}

/** Choosing a school's Wilma: search by town or school, then the one picked, with Change to search again. */
export function SchoolPicker({ tenant, onPick, onChange, locked = false, label, id = "school" }: { tenant: Tenant | null; onPick: (t: Tenant) => void; onChange: () => void; locked?: boolean; label?: string; id?: string }) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => searchTenants(query), [query]);
  // Chosen, it keeps its label and the search's height, so nothing below moves (its address is under the password).
  if (tenant) {
    return (
      <div className="field" style={{ marginBottom: 0 }}>
        <span className="label">{label ?? t("Your school's Wilma")}</span>
        <div className="picked">
          <Icon name="book" />
          <div>
            <b>{tenant.name}</b>
          </div>
          <button type="button" className="btn btn-quiet btn-sm" onClick={onChange} disabled={locked}>
            {t("Change")}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <label htmlFor={id}>{label ?? t("Your school's Wilma")}</label>
      <div className="school-search">
        <input id={id} className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Town or school, e.g. Tampere")} autoComplete="off" autoFocus />
        {matches.length ? (
          <div className="schools" role="listbox" aria-label={t("Matching Wilmas")}>
            {matches.map((x) => (
              <button
                type="button"
                key={x.url}
                role="option"
                aria-selected={false}
                onClick={() => {
                  setQuery("");
                  onPick(x);
                }}
              >
                {x.name}
                <small>
                  {new URL(x.url).host}
                  {x.municipalities.length ? ` · ${x.municipalities.map((m) => m.name_fi).join(", ")}` : ""}
                </small>
              </button>
            ))}
          </div>
        ) : query.trim().length >= 2 ? (
          <span className="help">{t("No Wilma matches “{query}”.", { query })}</span>
        ) : null}
      </div>
    </div>
  );
}

/** The username last signed in with on each Wilma, offered again (parents rarely remember it either). Never the password. */
export function lastUsername(url: string): string {
  try {
    const saved = JSON.parse(localStorage.getItem("wilmai.usernames") ?? "{}") as Record<string, string>;
    return saved[url.replace(/\/$/, "").toLowerCase()] ?? "";
  } catch {
    return "";
  }
}

export function rememberUsername(url: string, username: string) {
  try {
    const saved = JSON.parse(localStorage.getItem("wilmai.usernames") ?? "{}") as Record<string, string>;
    localStorage.setItem("wilmai.usernames", JSON.stringify({ ...saved, [url.replace(/\/$/, "").toLowerCase()]: username }));
  } catch {
    // not remembered: typed again next time
  }
}

/** A Wilma address as the list of Wilmas names it, or by its address when it isn't listed. */
export const tenantFor = (url: string, name?: string | null): Tenant =>
  TENANTS.find((x) => x.url.replace(/\/$/, "") === url.replace(/\/$/, "")) ?? { url, name: name ?? new URL(url).host, municipalities: [] };

/** The page's left side: what WilmAI Home is, and where things stay. */
export function Intro() {
  const localEdition = useLocalEdition();
  return (
    <section className="signin-side">
      <Brand style={{ padding: 0 }} />
      <h1>{marked(t("Wilma, *reimagined.*"), (part) => <span className="mark on">{part}</span>)}</h1>
      <p className="lede">
        {t("Today's lessons, the messages that need you, and what's coming up, for a student or the whole family.")}{" "}
        {isDesktopApp ? t("It reads the same Wilma you already use, and it runs on this computer.") : t("It reads the same Wilma you already use, and it runs in this browser.")}
      </p>
      <ul className="facts" style={{ maxWidth: 520 }}>
        <li>
          <Icon name="device" />
          <span>
            <b>{isDesktopApp ? t("Stays on this computer.") : t("Stays in this app.")}</b> {t("No WilmAI server stores or passes on anything.")}
          </span>
        </li>
        <li>
          <Icon name="lock" />
          <span>
            {marked(
              isDesktopApp
                ? t("*Your password goes only to your school's Wilma.* The app remembers it in this computer's keychain, so signing in again is one click.")
                : t("*Your password goes only to your school's Wilma.* The app remembers it here, scrambled, so signing in again is one click."),
              (part) => <b>{part}</b>
            )}
          </span>
        </li>
        <li>
          <Icon name="spark" />
          <span>
            <b>{t("WilmAI Intelligence is optional.")}</b> {localEdition === true ? t("Once you're in, choose it in Settings: OpenAI with your own key, usually tens of cents a month, or local AI on this Mac.") : t("Once you're in, choose it in Settings. OpenAI with your own key usually costs tens of cents a month.")}
          </span>
        </li>
      </ul>
    </section>
  );
}
