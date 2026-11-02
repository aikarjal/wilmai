import { ChildLooks } from "./ChildLooks";
import { updateSettings, useApp } from "../data/store";
import { UpdatesCard } from "./Update";
import { APP_VERSION } from "../data/edition";
import { SessionHistory } from "./SessionHistory";
import { isDemo, syncNow } from "../data/engine";
import { AISettings } from "./AISettings";
import { notificationsAvailable, testNotification } from "../data/notify";
import { Icon } from "./bits";
import { onWindows } from "../wilma/transport";
import { t } from "../i18n";
import { intelligenceOn, type Settings as SettingsModel } from "../data/model";

const LANGUAGES: { id: SettingsModel["language"]; label: () => string }[] = [
  { id: "auto", label: () => t("Automatic") },
  { id: "fi", label: () => "Suomi" },
  { id: "sv", label: () => "Svenska" },
  { id: "en", label: () => "English" },
];

/** The app's own language, here and in the sign-in page's settings. */
export function LanguageChoice() {
  const language = useApp((s) => s.settings.language ?? "auto");
  return (
    <div role="group" aria-label={t("App language")} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {LANGUAGES.map((l) => (
        <button key={l.id} className="seg" lang={l.id === "auto" ? undefined : l.id} aria-pressed={language === l.id} onClick={() => updateSettings({ language: l.id })}>
          {l.label()}
        </button>
      ))}
    </div>
  );
}

const THEMES: { id: NonNullable<SettingsModel["theme"]>; icon: string; label: () => string }[] = [
  { id: "auto", icon: "auto", label: () => t("Automatic") },
  { id: "light", icon: "today", label: () => t("Light") },
  { id: "dark", icon: "moon", label: () => t("Dark") },
];

/** Light, dark or the computer's: words in the sign-in page's settings, icons in the menu (compact). */
export function ThemeChoice({ compact = false }: { compact?: boolean }) {
  const theme = useApp((s) => s.settings.theme ?? "auto");
  return (
    <div className={`theme-choice${compact ? " compact" : ""}`} role="group" aria-label={t("Theme")} style={compact ? undefined : { display: "flex", gap: 6, flexWrap: "wrap" }}>
      {THEMES.map((x) => (
        <button
          key={x.id}
          type="button"
          className={compact ? undefined : "seg"}
          aria-pressed={theme === x.id}
          aria-label={compact ? x.label() : undefined}
          title={compact ? x.label() : undefined}
          onClick={() => updateSettings({ theme: x.id })}
        >
          {compact ? <Icon name={x.icon} /> : x.label()}
        </button>
      ))}
    </div>
  );
}

export function Settings() {
  const settings = useApp((s) => s.settings);
  const demo = isDemo();

  return (
    <main className="page settings">
      <h1>{t("Settings")}</h1>

      <AISettings />

      <ChildLooks />

      <section className="card">
        <h2>{t("App language")}</h2>
        <p>{t("The language of the app's own words. Automatic follows your computer's language.")}</p>
        <LanguageChoice />
      </section>

      {notificationsAvailable ? (
        <section className="card">
          <h2>
            <Icon name="bell" /> {t("Notifications")}
          </h2>
          <label className="switch">
            <input type="checkbox" checked={settings.notify !== false} onChange={(e) => updateSettings({ notify: e.target.checked })} />
            <div>
              <b>{t("Notify me")}</b>
              <span>{t("When something new needs you, and the evening before its deadline. Clicking a notification opens it.")}</span>
            </div>
          </label>
          <p className="help-line">
            {onWindows
              ? t("WilmAI Home stays by the clock, in the taskbar's notification area, when you close its window, and checks Wilma every ten minutes. Quit it by right-clicking that icon.")
              : t("WilmAI Home stays in the menu bar when you close its window and checks Wilma every ten minutes. Quit it from the menu bar icon.")}
          </p>
          <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => void testNotification()}>
            {t("Send a test notification")}
          </button>
        </section>
      ) : null}

      {/* Opening messages ahead is for the AI: without one, nothing reads them. */}
      {!demo && intelligenceOn(settings) ? (
        <section className="card">
          <h2>{t("Reading from Wilma")}</h2>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.backgroundRead}
              onChange={(e) => {
                updateSettings({ backgroundRead: e.target.checked });
                if (e.target.checked) void syncNow();
              }}
            />
            <div>
              <b>{t("Open new messages in the background")}</b>
              <span>
                {t("Lets the AI read the whole message before you do. Wilma then shows those messages as read. Off: unread messages are sorted from their subject until you open them.")}
              </span>
            </div>
          </label>
        </section>
      ) : null}

      {!demo ? <SessionHistory /> : null}

      <UpdatesCard />

      <p className="build-stamp">WilmAI Home {APP_VERSION} Beta · {__APP_BUILD__}</p>
    </main>
  );
}


