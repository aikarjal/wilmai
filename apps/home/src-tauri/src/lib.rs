//! WilmAI Home's native side. The window shows the web app; these commands
//! do what a web page can't: send one request to the school's Wilma, or to
//! OpenAI, from this computer. They keep nothing. Cookies, the key and all
//! data stay in the window's own storage. The menu bar icon, the closed
//! window and notifications are in shell.rs.


mod shell;
mod local_ai;
#[cfg(all(feature = "local-ai", not(all(target_os = "macos", target_arch = "aarch64"))))]
compile_error!("Local AI needs Apple Silicon macOS; build without the local-ai feature on this target.");

use reqwest::header::{CONTENT_TYPE, COOKIE, LOCATION, REFERER, RETRY_AFTER, SET_COOKIE, USER_AGENT};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::OnceLock;
use std::time::Duration;

/// Same browser identity the WilmAI CLI uses for Wilma.
const BROWSER_UA: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36";
const JEV_URL: &str = "https://api.typesafe.ai/v1/systemone";
/// OpenAI, for the Luna experiment: only these two endpoints.
const OPENAI_URL: &str = "https://api.openai.com";
const OPENAI_PATHS: [&str; 2] = ["/v1/responses", "/v1/decisions"];
/// Every Wilma the app may talk to (from wilma-client's tenant list).
const TENANT_LIST: &str = include_str!("../../../../packages/wilma-client/tenant_list.json");

fn wilma_hosts() -> &'static HashSet<String> {
    static HOSTS: OnceLock<HashSet<String>> = OnceLock::new();
    HOSTS.get_or_init(|| {
        let list: serde_json::Value = serde_json::from_str(TENANT_LIST).expect("tenant list is valid JSON");
        list["wilmat"]
            .as_array()
            .map(|tenants| {
                tenants
                    .iter()
                    .filter_map(|t| t["url"].as_str())
                    .filter_map(|u| reqwest::Url::parse(u).ok())
                    .filter_map(|u| u.host_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default()
    })
}

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            // The app follows redirects itself, so it sees every cookie and the login page.
            .redirect(reqwest::redirect::Policy::none())
            // Slow computers on proxied school networks need longer than a home connection.
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(60))
            .build()
            .expect("HTTP client")
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireRequest {
    url: String,
    method: String,
    body: Option<String>,
    content_type: Option<String>,
    cookie: Option<String>,
    /// Accept and X-Requested-With only (what Wilma's own pages send); others are dropped.
    #[serde(default)]
    headers: std::collections::HashMap<String, String>,
}

/// Request headers the page may set; everything else is the app's (user agent, referer, cookie).
const PASSED_HEADERS: [&str; 2] = ["accept", "x-requested-with"];

/// An error with its causes ("error sending request: dns error: …"): reqwest's own text stops at the first.
fn error_chain(e: &dyn std::error::Error) -> String {
    let mut text = e.to_string();
    let mut source = e.source();
    while let Some(cause) = source {
        let line = cause.to_string();
        if !text.contains(&line) {
            text.push_str(": ");
            text.push_str(&line);
        }
        source = cause.source();
    }
    text
}

fn passed_headers(headers: &std::collections::HashMap<String, String>) -> Vec<(String, String)> {
    headers
        .iter()
        .map(|(name, value)| (name.to_ascii_lowercase(), value.clone()))
        .filter(|(name, _)| PASSED_HEADERS.contains(&name.as_str()))
        .collect()
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct WireResponse {
    status: u16,
    url: String,
    location: Option<String>,
    set_cookie: Vec<String>,
    content_type: String,
    body: String,
}

/// One request to a Wilma from the tenant list, redirects not followed.
#[tauri::command]
async fn wilma_send(wire: WireRequest) -> Result<WireResponse, String> {
    let url = reqwest::Url::parse(&wire.url).map_err(|_| "Bad URL".to_string())?;
    let host = url.host_str().unwrap_or_default().to_owned();
    if url.scheme() != "https" || !wilma_hosts().contains(&host) {
        return Err(format!("Not a known Wilma: {host}"));
    }
    let mut request = if wire.method == "POST" {
        http().post(url.clone()).body(wire.body.unwrap_or_default())
    } else {
        http().get(url.clone())
    };
    request = request.header(USER_AGENT, BROWSER_UA).header(REFERER, format!("https://{host}/"));
    if let Some(cookie) = wire.cookie.filter(|c| !c.is_empty()) {
        request = request.header(COOKIE, cookie);
    }
    if let Some(content_type) = wire.content_type {
        request = request.header(CONTENT_TYPE, content_type);
    }
    for (name, value) in passed_headers(&wire.headers) {
        request = request.header(name, value);
    }
    let response = request.send().await.map_err(|e| format!("Couldn't reach Wilma: {}", error_chain(&e)))?;
    let headers = response.headers();
    let text = |name| headers.get(name).and_then(|v: &reqwest::header::HeaderValue| v.to_str().ok()).map(str::to_owned);
    let location = text(LOCATION);
    let content_type = text(CONTENT_TYPE).unwrap_or_default();
    let set_cookie = headers
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok().map(str::to_owned))
        .collect();
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| format!("Wilma's answer was cut off: {}", error_chain(&e)))?;
    Ok(WireResponse { status, url: url.to_string(), location, set_cookie, content_type, body })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JevResponse {
    status: u16,
    retry_after: Option<String>,
    body: String,
    /** The answer carries OpenAI's own headers: it came from OpenAI, not from a network that stood in for it. */
    #[serde(skip_serializing_if = "Option::is_none")]
    from_openai: Option<bool>,
}

/// One question set to Jev with the parent's own key.
#[tauri::command]
async fn jev_call(key: String, body: serde_json::Value) -> Result<JevResponse, String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("No Jev key".into());
    }
    let response = http()
        .post(JEV_URL)
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach Jev: {e}"))?;
    let status = response.status().as_u16();
    let retry_after = response.headers().get(RETRY_AFTER).and_then(|v| v.to_str().ok()).map(str::to_owned);
    let body = response.text().await.map_err(|e| e.to_string())?;
    Ok(JevResponse { status, retry_after, body, from_openai: None })
}

/// A slower client for OpenAI: a model that reasons may take longer than Wilma or Jev. OpenAI's API never redirects,
/// so a redirect means a network that blocks it (a block page): it's not followed.
fn openai_http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(120))
            .build()
            .expect("HTTP client")
    })
}

/// OpenAI's own headers: every answer from its API has them; a block page or a proxy's error doesn't.
fn from_openai(headers: &reqwest::header::HeaderMap) -> bool {
    headers.contains_key("x-request-id") || headers.keys().any(|name| name.as_str().starts_with("openai-"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Reach {
    reachable: bool,
    /** What stood in the way: "network" (no connection), "intercepted" (an answer, but not OpenAI's). */
    reason: Option<String>,
    detail: Option<String>,
}

/// Can this computer reach OpenAI at all? One request without a key (OpenAI answers 401 with its own headers).
#[tauri::command]
async fn openai_reach() -> Reach {
    match openai_http().get(format!("{OPENAI_URL}/v1/models")).timeout(Duration::from_secs(20)).send().await {
        Ok(response) if from_openai(response.headers()) => Reach { reachable: true, reason: None, detail: None },
        Ok(response) => Reach { reachable: false, reason: Some("intercepted".into()), detail: Some(format!("HTTP {}", response.status().as_u16())) },
        Err(e) => Reach { reachable: false, reason: Some("network".into()), detail: Some(error_chain(&e)) },
    }
}

/// One request to OpenAI (Responses or Decisions) with the parent's own key; nothing kept.
#[tauri::command]
async fn openai_call(key: String, path: String, body: serde_json::Value) -> Result<JevResponse, String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("No OpenAI key".into());
    }
    if !OPENAI_PATHS.contains(&path.as_str()) {
        return Err(format!("Not an endpoint the app uses: {path}"));
    }
    let response = openai_http()
        .post(format!("{OPENAI_URL}{path}"))
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach OpenAI: {}", error_chain(&e)))?;
    let status = response.status().as_u16();
    let retry_after = response.headers().get(RETRY_AFTER).and_then(|v| v.to_str().ok()).map(str::to_owned);
    let openai = from_openai(response.headers());
    let body = response.text().await.map_err(|e| e.to_string())?;
    Ok(JevResponse { status, retry_after, body, from_openai: Some(openai) })
}

#[derive(Deserialize)]
struct OllamaRequest {
    endpoint: String,
    path: String,
    body: Option<serde_json::Value>,
}

fn local_model_url(wire: &OllamaRequest) -> Result<(reqwest::Url, bool), String> {
    let mut url = reqwest::Url::parse(&wire.endpoint).map_err(|_| "Bad Ollama address")?;
    if url.scheme() != "http" || !matches!(url.host_str(), Some("127.0.0.1" | "[::1]" | "::1"))
        || !url.username().is_empty() || url.password().is_some() || url.path() != "/"
        || url.query().is_some() || url.fragment().is_some() {
        return Err("Ollama must use an HTTP loopback address".into());
    }
    let get = ["/api/version", "/api/tags", "/api/ps"].contains(&wire.path.as_str());
    if !get && !["/api/chat", "/v1/systemone", "/api/show", "/api/generate"].contains(&wire.path.as_str()) {
        return Err("Not a local model endpoint the app uses".into());
    }
    if wire.path == "/api/generate" {
        let body = wire.body.as_ref().and_then(|v| v.as_object()).ok_or("Expected an unload request")?;
        if body.len() != 2 || body.get("keep_alive") != Some(&serde_json::json!(0)) || !body.get("model").is_some_and(|v| v.is_string()) {
            return Err("Only model unloading is allowed here".into());
        }
    }
    url.set_path(&wire.path);
    Ok((url, get))
}

/// Local inference has no API key and never follows redirects or uses a proxy.
#[tauri::command]
async fn ollama_call(manager: tauri::State<'_, local_ai::LocalAi>, wire: OllamaRequest) -> Result<JevResponse, String> {
    let (url, get) = local_model_url(&wire)?;
    if wire.endpoint == local_ai::MANAGED_ENDPOINT { return manager.call(&wire.path, wire.body).await; }
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    let client = CLIENT.get_or_init(|| reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).build().expect("local HTTP client"));
    let request = if get { client.get(url) } else { client.post(url).json(&wire.body) };
    let response = request.timeout(Duration::from_secs(if get { 10 } else { 300 })).send().await
        .map_err(|e| format!("Couldn't reach Ollama: {e}"))?;
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| e.to_string())?;
    Ok(JevResponse { status, retry_after: None, body, from_openai: None })
}

/// The Luna experiment's comparison with Jev, written where the app keeps its data
/// (~/Library/Application Support/ai.wilm.home on a Mac). Only these names.
#[tauri::command]
async fn save_report(app: tauri::AppHandle, name: String, text: String) -> Result<String, String> {
    use tauri::Manager;
    if !["luna-compare.md", "luna-compare.json", "luna-material.json"].contains(&name.as_str()) {
        return Err("Not a report the app writes".into());
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(&name);
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn clear_reports(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    for name in ["luna-compare.md", "luna-compare.json", "luna-material.json"] {
        match std::fs::remove_file(dir.join(name)) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

/// Where earlier versions kept the Jev key: the system keychain (macOS
/// Keychain, Windows Credential Manager). The app now keeps it in its own
/// storage, like the WilmAI CLI keeps its logins (macOS asked for the password
/// after every new build of an app without a Developer ID); this only reads
/// it once, to move it. Only names the app knows are accepted.
fn secret(name: &str) -> Result<keyring::Entry, String> {
    match name {
        "jev-key" => keyring::Entry::new("ai.wilm.home", name).map_err(|e| e.to_string()),
        _ => Err(format!("Unknown secret: {name}")),
    }
}

#[tauri::command]
async fn secret_get(name: String) -> Result<Option<String>, String> {
    match secret(&name)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

// Commands that touch the Keychain or files are async, so they run off the main thread: after each new
// build's signature macOS asks again before handing over the Jev key, and a synchronous command waiting on
// that prompt froze the window, blank, until it was answered.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    let builder = tauri::Builder::default();
    // Windows starts a second copy when the app is opened again from the Start menu (its window only hides on close)
    // or a notification is clicked in the notification centre: that copy hands over and quits, and this one shows.
    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| shell::show(app)));
    let builder = builder.plugin(tauri_plugin_opener::init());
    // The updater deserializes a required public key during startup. Development
    // packages use the manual checker until real signing credentials are configured.
    let builder = if has_signed_updater(context.config()) {
        builder.plugin(tauri_plugin_updater::Builder::new().build())
    } else {
        builder
    };
    builder
        .setup(|app| {
            use tauri::Manager;
            let dir = app.path().app_data_dir()?.join("local-ai");
            let assets = app.path().resolve("local-ai", tauri::path::BaseDirectory::Resource)?;
            #[cfg(debug_assertions)]
            let assets = if assets.is_dir() { assets } else { std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/local-ai") };
            app.manage(local_ai::LocalAi::new(dir, assets));
            shell::setup(app)?;
            Ok(())
        })
        // Closing the window hides it; the app goes on in the menu bar (shell.rs).
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    shell::hide(window);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            wilma_send,
            jev_call,
            openai_call,
            openai_reach,
            ollama_call,
            local_ai::local_ai_status,
            local_ai::local_ai_install,
            local_ai::local_ai_cancel,
            local_ai::local_ai_stop,
            local_ai::local_ai_remove,
            save_report,
            clear_reports,
            secret_get,
            shared_session_get,
            shared_session_set,
            shared_session_remove,
            secrets_read,
            secrets_write,
            secrets_delete,
            update_manifest,
            app_edition,
            restart_after_update,
            prepare_app_update,
            resume_after_failed_update,
            shell::tray_labels,
            shell::tray_title,
            shell::show_main,
            shell::notify
        ])
        .build(context)
        .expect("error while building WilmAI Home")
        .run(|app, event| {
            use tauri::Manager;
            if matches!(event, tauri::RunEvent::Exit) { app.state::<local_ai::LocalAi>().shutdown(); }
            // The Dock icon (or opening the app again) brings the window back.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                shell::show(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

/*
 * WilmAI's shared session file: the CLI's `wilmai-sessions.json`, where every
 * WilmAI program on this computer (CLI commands, assistants' connectors, this
 * app) keeps each login's Wilma session. Wilma allows one live session per
 * account, so programs that each log in end each other's sessions; sharing
 * the file lets them continue one. Same place, format and rules as the CLI
 * (packages/wilma-cli/src/session-store.ts): `{ key: { state, savedAt, by } }`,
 * entries older than six hours ignored and dropped, written through a temp
 * file only this user can read. `by` names the program that saved it
 * ("cli", "mcp", "home"), so the app can tell which one started a session.
 *
 * A login's session has two labels while the old one is retired, as in the
 * CLI (packages/wilma-cli/src/session-keys.ts; docs/secret-store.md there,
 * machine 4):
 * - v2: SHA-256 hex of "wilmai-session-v2", the Wilma address (no trailing
 *   slash) and the lower-case username, made here from the login;
 * - v1: SHA-256 hex of the address, the lower-case username and the password.
 *   The window makes it while it has the password and keeps it with its saved
 *   session; older WilmAI programs know only this one.
 * The app saves under v2, and under v1 when it has it; it looks under both and
 * takes the newer entry; signing a login out or forgetting it removes both.
 * Nothing here reads the CLI's settings: the same keys work however the CLI
 * keeps its password.
 */
const SESSION_TTL_MS: u64 = 6 * 60 * 60 * 1000;
const MAX_STATE_BYTES: usize = 64 * 1024;

/// Where the CLI's config file would be (only its folder is used: the session file is next to it). WILMAI_CONFIG_PATH,
/// else $XDG_CONFIG_HOME/wilmai or ~/.config/wilmai.
fn config_file() -> Option<std::path::PathBuf> {
    use std::path::PathBuf;
    if let Ok(config) = std::env::var("WILMAI_CONFIG_PATH") {
        if !config.is_empty() {
            return Some(PathBuf::from(config));
        }
    }
    let base = match std::env::var("XDG_CONFIG_HOME") {
        Ok(xdg) if !xdg.is_empty() => PathBuf::from(xdg),
        _ => PathBuf::from(std::env::var("HOME").ok()?).join(".config"),
    };
    Some(base.join("wilmai").join("config.json"))
}

fn sessions_path() -> Option<std::path::PathBuf> {
    config_file()?.parent().map(|dir| dir.join("wilmai-sessions.json"))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn valid_session_key(key: &str) -> bool {
    key.len() == 64 && key.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn sha256_hex(text: &str) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(text.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// A Wilma address as the CLI writes it into keys: without a trailing slash.
fn wilma_address(url: &str) -> &str {
    url.strip_suffix('/').unwrap_or(url)
}

/// The v2 label: no password in it, so it's the same whoever keeps the password, and wherever.
fn session_key_v2(base_url: &str, username: &str) -> String {
    sha256_hex(&format!("wilmai-session-v2\n{}\n{}", wilma_address(base_url), username.to_lowercase()))
}

/// A login in the shared session file, as the window sends it: its Wilma and username, and its v1 label when the window
/// had the password.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct SessionLogin {
    base_url: String,
    username: String,
    #[serde(default)]
    v1_key: Option<String>,
}

/// The login's labels: v2, then v1 when the window has it.
fn session_keys(login: &SessionLogin) -> Result<Vec<String>, String> {
    if login.base_url.trim().is_empty() || login.username.trim().is_empty() {
        return Err("Not a WilmAI login".into());
    }
    let mut keys = vec![session_key_v2(&login.base_url, &login.username)];
    match login.v1_key.as_deref() {
        Some(key) if valid_session_key(key) => keys.push(key.to_owned()),
        Some(_) => return Err("Not a WilmAI session key".into()),
        None => {}
    }
    Ok(keys)
}

/// One login's saved session: its state, when it was saved, and which WilmAI program saved it (newer programs say).
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SharedEntry {
    state: String,
    saved_at: u64,
    by: Option<String>,
}

/// The session saved under `key`, if it's recent enough to try.
fn read_session(all: &serde_json::Value, key: &str, now: u64) -> Option<SharedEntry> {
    let entry = all.get(key)?;
    let saved_at = entry.get("savedAt")?.as_u64()?;
    if now.saturating_sub(saved_at) > SESSION_TTL_MS {
        return None;
    }
    let state = entry.get("state")?.as_str()?.to_owned();
    let by = entry.get("by").and_then(|v| v.as_str()).filter(|b| b.len() <= 32).map(str::to_owned);
    Some(SharedEntry { state, saved_at, by })
}

/// The newest session under any of the login's labels that's recent enough to try (on a tie, the first label's).
fn read_newest(content: &str, keys: &[String], now: u64) -> Option<SharedEntry> {
    let all: serde_json::Value = serde_json::from_str(content).ok()?;
    keys.iter().filter_map(|key| read_session(&all, key, now)).fold(None, |newest, entry| match newest {
        Some(newest) if newest.saved_at >= entry.saved_at => Some(newest),
        _ => Some(entry),
    })
}

/// The file's new content with `state` saved under every label (old entries dropped).
fn write_session(content: &str, keys: &[String], state: &str, now: u64) -> String {
    let mut all = match serde_json::from_str::<serde_json::Value>(content) {
        Ok(serde_json::Value::Object(map)) => map,
        _ => serde_json::Map::new(),
    };
    all.retain(|_, entry| entry.get("savedAt").and_then(|v| v.as_u64()).is_some_and(|at| now.saturating_sub(at) <= SESSION_TTL_MS));
    for key in keys {
        all.insert(key.to_owned(), serde_json::json!({ "state": state, "savedAt": now, "by": "home" }));
    }
    serde_json::Value::Object(all).to_string()
}

/// The file's new content without the login's labels; None when it has none of them (nothing to write).
fn remove_sessions(content: &str, keys: &[String]) -> Option<String> {
    let serde_json::Value::Object(mut all) = serde_json::from_str::<serde_json::Value>(content).ok()? else { return None };
    let before = all.len();
    for key in keys {
        all.remove(key);
    }
    (all.len() != before).then(|| serde_json::Value::Object(all).to_string())
}

/// Replace the session file: temp file + rename, like the CLI, so another program never reads half a file.
fn replace_sessions_file(path: &std::path::Path, next: &str) -> Result<(), String> {
    use std::io::Write;
    let dir = path.parent().ok_or("No folder for sessions")?;
    // Only this user may read the folder and the file (on Windows, the user's profile already keeps others out).
    let mut folder = std::fs::DirBuilder::new();
    folder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        folder.mode(0o700);
    }
    folder.create(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("wilmai-sessions.json.{}.{}.tmp", std::process::id(), now_ms()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&tmp).map_err(|e| e.to_string())?;
    file.write_all(next.as_bytes()).map_err(|e| e.to_string())?;
    drop(file);
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn shared_session_get(login: SessionLogin) -> Result<Option<SharedEntry>, String> {
    let keys = session_keys(&login)?;
    let Some(path) = sessions_path() else { return Ok(None) };
    match std::fs::read_to_string(&path) {
        Ok(content) => Ok(read_newest(&content, &keys, now_ms())),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
async fn shared_session_set(login: SessionLogin, state: String) -> Result<(), String> {
    if state.len() > MAX_STATE_BYTES || !state.contains("Wilma2SID") {
        return Err("Not a WilmAI session".into());
    }
    let keys = session_keys(&login)?;
    let path = sessions_path().ok_or("No home folder")?;
    let content = std::fs::read_to_string(&path).unwrap_or_default();
    replace_sessions_file(&path, &write_session(&content, &keys, &state, now_ms()))
}

/// The login signed out or forgotten here: its session goes from the file under both labels.
#[tauri::command]
async fn shared_session_remove(login: SessionLogin) -> Result<(), String> {
    let keys = session_keys(&login)?;
    let Some(path) = sessions_path() else { return Ok(()) };
    let Ok(content) = std::fs::read_to_string(&path) else { return Ok(()) };
    match remove_sessions(&content, &keys) {
        Some(next) => replace_sessions_file(&path, &next),
        None => Ok(()),
    }
}

/*
 * The app's own secrets in the system keychain: the remembered Wilma passwords
 * and the OpenAI key (src/data/store.ts). One entry, service
 * "ai.wilm.home.secrets", account "secrets" (no username in it), value the
 * window's JSON, ASCII only (it escapes the rest). The window reads it once at
 * start and writes it whole after a change; Reset app deletes it. Nothing here
 * reads another program's entries (the Jev key's old place aside, `secret`).
 *
 * - macOS: /usr/bin/security in a child process, killed after ten seconds.
 *   The item trusts /usr/bin/security only (-T), so it's read without macOS
 *   asking for the Mac's password, whatever this app's signature or version.
 *   The value goes in as hex on stdin (`security -i`), never on a command
 *   line. Saving deletes the item and adds it again, never changes it in place
 *   (-U): changing an item's content makes macOS ask for authorization, and
 *   until someone answers, that keychain refuses everything (exit 152).
 * - Windows (and Linux): the keyring crate, Credential Manager (the Secret
 *   Service on Linux).
 */
const SECRETS_SERVICE: &str = "ai.wilm.home.secrets";
const SECRETS_ACCOUNT: &str = "secrets";
/// Credential Manager keeps at most 2,560 bytes in one entry.
const MAX_SECRETS_BYTES: usize = 2560;
/// How long the keychain may take to answer; after that it counts as refused (on a Mac the child process is killed).
const KEYCHAIN_TIMEOUT: Duration = Duration::from_secs(10);

/// One keychain entry: its service and account, and (a test hook, macOS) a keychain file instead of the default one.
#[derive(Clone, Debug)]
struct SecretEntry {
    service: String,
    account: String,
    keychain_file: Option<String>,
}

impl SecretEntry {
    fn home() -> Self {
        SecretEntry { service: SECRETS_SERVICE.into(), account: SECRETS_ACCOUNT.into(), keychain_file: None }
    }
}

/// Names go into `security`'s command text as they are: letters, digits, dots and dashes only.
fn valid_entry_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && !name.starts_with('-') && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
}

/// A keychain file for the tests: an absolute path with nothing to quote.
fn valid_keychain_file(path: &str) -> bool {
    path.starts_with('/') && !path.contains(['"', '\\', '\n', '\r'])
}

fn check_entry(entry: &SecretEntry) -> Result<(), String> {
    let file_ok = entry.keychain_file.as_deref().is_none_or(valid_keychain_file);
    if valid_entry_name(&entry.service) && valid_entry_name(&entry.account) && file_ok {
        Ok(())
    } else {
        Err("Not a WilmAI Home keychain entry".into())
    }
}

/// What the window keeps there: printable ASCII (it escapes everything else), short enough for Credential Manager.
fn valid_secret_value(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_SECRETS_BYTES && value.bytes().all(|b| (0x20..0x7f).contains(&b))
}

/// Why the keychain didn't do it.
#[derive(Debug, PartialEq)]
enum KeychainError {
    /// Locked, declined, no answer in time, or it said no.
    Refused(String),
    /// No keychain to use here.
    Unavailable(String),
}

impl std::fmt::Display for KeychainError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            KeychainError::Refused(why) => write!(f, "The keychain didn't do it: {why}"),
            KeychainError::Unavailable(why) => write!(f, "No keychain to use here: {why}"),
        }
    }
}

/// One finished run of a program.
#[derive(Debug, PartialEq)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
struct Run {
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

/// One run of a program: `input` written to its stdin, which is then closed; its output read while it runs. Killed
/// after `timeout` (then None).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn run_with_timeout(program: &str, args: &[String], input: &str, timeout: Duration) -> std::io::Result<Option<Run>> {
    use std::io::{Read, Write};
    use std::process::{Command, Stdio};
    let mut child = Command::new(program).args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
    let mut stdin = child.stdin.take().expect("stdin is piped");
    let input = input.to_owned();
    // From threads of their own, so a program that doesn't read, or writes a lot, can't stall this one.
    let writer = std::thread::spawn(move || {
        let _ = stdin.write_all(input.as_bytes());
    });
    fn reader(mut pipe: impl Read + Send + 'static) -> std::thread::JoinHandle<String> {
        std::thread::spawn(move || {
            let mut out = Vec::new();
            let _ = pipe.read_to_end(&mut out);
            String::from_utf8_lossy(&out).into_owned()
        })
    }
    let stdout = reader(child.stdout.take().expect("stdout is piped"));
    let stderr = reader(child.stderr.take().expect("stderr is piped"));
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if let Some(status) = child.try_wait()? {
            let _ = writer.join();
            return Ok(Some(Run { code: status.code(), stdout: stdout.join().unwrap_or_default(), stderr: stderr.join().unwrap_or_default() }));
        }
        if std::time::Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(None);
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// `security` arguments that read the entry's value alone (-w).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn security_find_args(entry: &SecretEntry) -> Vec<String> {
    let mut args: Vec<String> = vec!["find-generic-password".into(), "-s".into(), entry.service.clone(), "-a".into(), entry.account.clone(), "-w".into()];
    args.extend(entry.keychain_file.clone());
    args
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn security_delete_args(entry: &SecretEntry) -> Vec<String> {
    let mut args: Vec<String> = vec!["delete-generic-password".into(), "-s".into(), entry.service.clone(), "-a".into(), entry.account.clone()];
    args.extend(entry.keychain_file.clone());
    args
}

/// The line `security -i` reads on stdin to add the entry: the value as hex (nothing to quote), trusted by
/// /usr/bin/security only. Never -U.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn security_add_command(entry: &SecretEntry, value: &str) -> String {
    let hex: String = value.bytes().map(|b| format!("{b:02x}")).collect();
    let file = entry.keychain_file.as_deref().map(|path| format!(" \"{path}\"")).unwrap_or_default();
    format!("add-generic-password -s {} -a {} -l \"WilmAI Home\" -T /usr/bin/security -X {hex}{file}\n", entry.service, entry.account)
}

/// The last line `security` wrote to stderr, or its exit code.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn security_failure(run: &Run) -> KeychainError {
    let said = run.stderr.trim().lines().last().unwrap_or_default();
    KeychainError::Refused(if said.is_empty() { format!("security exited with {:?}", run.code) } else { said.to_owned() })
}

/// `find-generic-password -w`: exit 0 the value and a newline, 44 no such entry, anything else refused.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn security_read_answer(run: &Run) -> Result<Option<String>, KeychainError> {
    match run.code {
        Some(0) => Ok(Some(run.stdout.strip_suffix('\n').unwrap_or(&run.stdout).to_owned())),
        Some(44) => Ok(None),
        _ => Err(security_failure(run)),
    }
}

/// `delete-generic-password`: exit 0 deleted, 44 there was none.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn security_delete_answer(run: &Run) -> Result<bool, KeychainError> {
    match run.code {
        Some(0) => Ok(true),
        Some(44) => Ok(false),
        _ => Err(security_failure(run)),
    }
}

/// `security -i`: a command that failed can still exit 0, saying "returned -N" on stderr.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn security_add_answer(run: &Run) -> Result<(), KeychainError> {
    let refused = run.stderr.split("returned -").skip(1).any(|rest| rest.starts_with(|c: char| c.is_ascii_digit()));
    if run.code == Some(0) && !refused {
        Ok(())
    } else {
        Err(security_failure(run))
    }
}

#[cfg(target_os = "macos")]
fn security(args: &[String], input: &str) -> Result<Run, KeychainError> {
    const SECURITY: &str = "/usr/bin/security";
    match run_with_timeout(SECURITY, args, input, KEYCHAIN_TIMEOUT) {
        Ok(Some(run)) => Ok(run),
        Ok(None) => Err(KeychainError::Refused("no answer in time".into())),
        Err(e) => Err(KeychainError::Unavailable(format!("{SECURITY}: {e}"))),
    }
}

#[cfg(target_os = "macos")]
fn keychain_read(entry: &SecretEntry) -> Result<Option<String>, KeychainError> {
    security_read_answer(&security(&security_find_args(entry), "")?)
}

#[cfg(target_os = "macos")]
fn keychain_write(entry: &SecretEntry, value: &str) -> Result<(), KeychainError> {
    security_delete_answer(&security(&security_delete_args(entry), "")?)?;
    security_add_answer(&security(&["-i".into()], &security_add_command(entry, value))?)
}

#[cfg(target_os = "macos")]
fn keychain_delete(entry: &SecretEntry) -> Result<bool, KeychainError> {
    security_delete_answer(&security(&security_delete_args(entry), "")?)
}

#[cfg(not(target_os = "macos"))]
fn keyring_entry(entry: &SecretEntry) -> Result<keyring::Entry, KeychainError> {
    if entry.keychain_file.is_some() {
        return Err(KeychainError::Unavailable("a keychain file is for macOS only".into()));
    }
    keyring::Entry::new(&entry.service, &entry.account).map_err(|e| KeychainError::Unavailable(e.to_string()))
}

/// Windows and Linux: the value as bytes (Credential Manager's 2,560, where the password form would allow half).
#[cfg(not(target_os = "macos"))]
fn keychain_read(entry: &SecretEntry) -> Result<Option<String>, KeychainError> {
    match keyring_entry(entry)?.get_secret() {
        Ok(bytes) => String::from_utf8(bytes).map(Some).map_err(|_| KeychainError::Refused("not the app's entry".into())),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(KeychainError::Refused(e.to_string())),
    }
}

#[cfg(not(target_os = "macos"))]
fn keychain_write(entry: &SecretEntry, value: &str) -> Result<(), KeychainError> {
    keyring_entry(entry)?.set_secret(value.as_bytes()).map_err(|e| KeychainError::Refused(e.to_string()))
}

#[cfg(not(target_os = "macos"))]
fn keychain_delete(entry: &SecretEntry) -> Result<bool, KeychainError> {
    match keyring_entry(entry)?.delete_credential() {
        Ok(()) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(KeychainError::Refused(e.to_string())),
    }
}

/// One keychain call at a time.
static KEYCHAIN: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// A keychain call off the main thread (a prompt must not freeze the window), one at a time. A native call that can't be
/// stopped (Windows) is left to finish by itself; the window hears it was refused.
async fn keychain_call<T: Send + 'static>(call: impl FnOnce() -> Result<T, KeychainError> + Send + 'static) -> Result<T, String> {
    let task = tauri::async_runtime::spawn_blocking(move || {
        let _one = KEYCHAIN.lock().unwrap_or_else(|e| e.into_inner());
        call()
    });
    match tokio::time::timeout(KEYCHAIN_TIMEOUT + Duration::from_secs(2), task).await {
        Ok(Ok(result)) => result.map_err(|e| e.to_string()),
        _ => Err(KeychainError::Refused("no answer in time".into()).to_string()),
    }
}

async fn read_secrets(entry: SecretEntry) -> Result<Option<String>, String> {
    check_entry(&entry)?;
    keychain_call(move || keychain_read(&entry)).await
}

async fn write_secrets(entry: SecretEntry, value: String) -> Result<(), String> {
    check_entry(&entry)?;
    if !valid_secret_value(&value) {
        return Err("Not something the app keeps in the keychain".into());
    }
    keychain_call(move || keychain_write(&entry, &value)).await
}

async fn delete_secrets(entry: SecretEntry) -> Result<bool, String> {
    check_entry(&entry)?;
    keychain_call(move || keychain_delete(&entry)).await
}

/// The app's entry: its value, or None when there's none.
#[tauri::command]
async fn secrets_read() -> Result<Option<String>, String> {
    read_secrets(SecretEntry::home()).await
}

/// Replace the app's entry with this value.
#[tauri::command]
async fn secrets_write(value: String) -> Result<(), String> {
    write_secrets(SecretEntry::home(), value).await
}

/// Delete the app's entry (Reset app); false when there was none.
#[tauri::command]
async fn secrets_delete() -> Result<bool, String> {
    delete_secrets(SecretEntry::home()).await
}

/*
 * Is there a newer version? One small file at a fixed address on wilm.ai:
 * {"version": "0.2.0", "notes": "…", "url": "https://wilm.ai/app"}. The
 * request carries nothing about the user (no cookies, no identifiers); the
 * server sees the address it comes from and the app version in the user
 * agent. Failed checks never claim the app is current.
 */
const UPDATE_MANIFEST_URL: &str = "https://wilm.ai/app/latest.json";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Edition { local_ai: bool, signed_updater: bool }

fn has_signed_updater(config: &tauri::Config) -> bool {
    config.plugins.0.get("updater").and_then(|v| v.get("pubkey"))
        .and_then(|v| v.as_str()).is_some_and(|s| !s.is_empty())
}

#[tauri::command]
fn app_edition(app: tauri::AppHandle) -> Edition {
    Edition {
        local_ai: cfg!(feature = "local-ai"),
        signed_updater: has_signed_updater(app.config()),
    }
}

#[tauri::command]
fn prepare_app_update(app: tauri::AppHandle) {
    use tauri::Manager;
    app.state::<local_ai::LocalAi>().shutdown();
}

#[tauri::command]
fn resume_after_failed_update(app: tauri::AppHandle) {
    use tauri::Manager;
    app.state::<local_ai::LocalAi>().resume_after_update_failure();
}

#[tauri::command]
fn restart_after_update(app: tauri::AppHandle) {
    use tauri::Manager;
    app.state::<local_ai::LocalAi>().shutdown();
    app.restart();
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct Release {
    version: String,
    #[serde(default)]
    notes: Option<String>,
    #[serde(default)]
    url: Option<String>,
}

/// The manifest's release, if the text is one (a version that looks like 1.2.3, links only to wilm.ai or GitHub).
fn parse_release(body: &str) -> Option<Release> {
    let release: Release = serde_json::from_str(body).ok()?;
    let looks_like_version = release.version.len() <= 64 && semver::Version::parse(&release.version).is_ok();
    if !looks_like_version {
        return None;
    }
    let url = release.url.filter(|u| u.starts_with("https://wilm.ai/") || u.starts_with("https://github.com/"));
    let notes = release.notes.map(|n| n.chars().take(2000).collect());
    Some(Release { version: release.version, notes, url })
}

#[tauri::command]
async fn update_manifest() -> Result<Option<Release>, String> {
    let response = http()
        .get(UPDATE_MANIFEST_URL)
        .header(USER_AGENT, concat!("WilmAI-Home/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Couldn't check for updates: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Update check returned HTTP {}", response.status()));
    }
    let body = response.text().await.map_err(|e| e.to_string())?;
    parse_release(&body).map(Some).ok_or_else(|| "The update feed is invalid.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_the_tenant_list() {
        let hosts = wilma_hosts();
        assert!(hosts.len() > 400);
        assert!(hosts.contains("helsinki.inschool.fi"));
        assert!(!hosts.contains("example.com"));
    }

    const V1: &str = "c4cb441cdc450d3151d3de14dd1576b4aa3235ea224813cac8e8d9c982dd3507";
    const V2: &str = "18e7bcf46ac5969e085d0b5eac867bbbf4ffe590073dce493c82445fd120f6d9";

    fn login(v1_key: Option<&str>) -> SessionLogin {
        SessionLogin { base_url: "https://example.inschool.fi".into(), username: "Matti.M".into(), v1_key: v1_key.map(str::to_owned) }
    }

    #[test]
    fn shared_session_file_like_the_cli() {
        let keys = vec!["a".repeat(64)];
        let now = 10 * SESSION_TTL_MS;
        let written = write_session(r#"{"old":{"state":"x","savedAt":1},"other":{"state":"keep","savedAt":0}}"#.replace(":0}", &format!(":{}}}", now - 1000)).as_str(), &keys, "{\"cookies\":[]}", now);
        let all: serde_json::Value = serde_json::from_str(&written).unwrap();
        assert!(all.get("old").is_none(), "entries older than six hours are dropped");
        assert_eq!(all["other"]["state"], "keep", "other logins are kept");
        let entry = read_newest(&written, &keys, now + 1).unwrap();
        assert_eq!((entry.state.as_str(), entry.by.as_deref()), ("{\"cookies\":[]}", Some("home")), "saved by this app");
        assert_eq!(read_newest(&written, &keys, now + SESSION_TTL_MS + 1), None, "too old to try");
        assert_eq!(read_newest("not json", &keys, now), None);
        assert_eq!(write_session("garbage", &keys, "s", now), format!("{{\"{}\":{{\"by\":\"home\",\"savedAt\":{now},\"state\":\"s\"}}}}", keys[0]));
        assert!(valid_session_key(&"0123456789abcdef".repeat(4)));
        assert!(!valid_session_key("../etc"));
        assert!(!valid_session_key(&"A".repeat(64)), "the CLI writes lowercase hex");
    }

    #[test]
    fn session_keys_like_the_cli() {
        assert_eq!(session_key_v2("https://example.inschool.fi/", "Matti.M"), V2, "no trailing slash, the username in lower case");
        assert_eq!(session_key_v2("https://example.inschool.fi", "matti.m"), V2);
        // v1 is made by the window (it has the password); the formula, for the record:
        assert_eq!(sha256_hex("https://example.inschool.fi\nmatti.m\npw"), V1);
        assert_eq!(session_keys(&login(Some(V1))).unwrap(), [V2, V1], "v2 first, then v1");
        assert_eq!(session_keys(&login(None)).unwrap(), [V2], "no password, no v1");
        assert!(session_keys(&login(Some("../etc/passwd"))).is_err());
        assert!(session_keys(&login(Some(&V1.to_uppercase()))).is_err(), "the CLI writes lowercase hex");
        assert!(session_keys(&SessionLogin { base_url: "https://example.inschool.fi".into(), username: " ".into(), v1_key: None }).is_err());
        let wire: SessionLogin = serde_json::from_str(r#"{"baseUrl":"https://example.inschool.fi","username":"Matti.M","v1Key":"x"}"#).unwrap();
        assert_eq!(wire.v1_key.as_deref(), Some("x"), "the window's field names");
    }

    #[test]
    fn both_labels_saved_and_the_newer_read() {
        let now = 10 * SESSION_TTL_MS;
        let keys = session_keys(&login(Some(V1))).unwrap();
        let written: serde_json::Value = serde_json::from_str(&write_session("{}", &keys, "{\"Wilma2SID\":1}", now)).unwrap();
        assert_eq!((written[V2]["state"].as_str(), written[V1]["state"].as_str()), (Some("{\"Wilma2SID\":1}"), Some("{\"Wilma2SID\":1}")), "under both");

        // An older program saved a newer session under v1 only; a keychain login of the CLI's, under v2 only.
        let file = |v2_at: u64, v1_at: u64| {
            serde_json::json!({
                V2: { "state": "v2", "savedAt": v2_at, "by": "cli" },
                V1: { "state": "v1", "savedAt": v1_at, "by": "mcp" },
            })
            .to_string()
        };
        assert_eq!(read_newest(&file(now - 10, now - 5), &keys, now).unwrap().state, "v1", "the newer wins");
        assert_eq!(read_newest(&file(now - 5, now - 10), &keys, now).unwrap().state, "v2");
        assert_eq!(read_newest(&file(now - 5, now - 5), &keys, now).unwrap().state, "v2", "a tie: v2");
        assert_eq!(read_newest(&file(now - 5, now - 5), &keys[..1], now).unwrap().state, "v2", "without the password, v2 only");
        assert_eq!(read_newest(&file(now - SESSION_TTL_MS - 1, now - 10), &keys, now).unwrap().state, "v1", "an expired one doesn't count");

        let removed: serde_json::Value = serde_json::from_str(&remove_sessions(&format!(r#"{{"{V2}":{{}},"{V1}":{{}},"other":{{}}}}"#), &keys).unwrap()).unwrap();
        assert_eq!(removed, serde_json::json!({ "other": {} }), "signing out takes both, nothing else");
        assert_eq!(remove_sessions(r#"{"other":{}}"#, &keys), None, "nothing to write");
        assert_eq!(remove_sessions("not json", &keys), None);
    }

    #[tokio::test]
    async fn shares_sessions_without_reading_the_cli_settings() {
        // The CLI's settings are a folder here: reading them would fail. Only the session file next to them is used.
        let mut id = [0u8; 8];
        getrandom::getrandom(&mut id).unwrap();
        let dir = std::env::temp_dir().join(format!("wilmai-home-test-{}", id.iter().map(|b| format!("{b:02x}")).collect::<String>()));
        std::fs::create_dir_all(dir.join("config.json")).unwrap();
        std::env::set_var("WILMAI_CONFIG_PATH", dir.join("config.json"));
        let state = "{\"Wilma2SID\":\"x\"}".to_owned();
        shared_session_set(login(Some(V1)), state.clone()).await.unwrap();
        let file: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("wilmai-sessions.json")).unwrap()).unwrap();
        assert!(file.get(V1).is_some() && file.get(V2).is_some(), "under both labels");
        assert_eq!(shared_session_get(login(None)).await.unwrap().unwrap().state, state, "found without the password");
        shared_session_remove(login(Some(V1))).await.unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("wilmai-sessions.json")).unwrap(), "{}", "both gone");
        assert!(shared_session_set(login(None), "no session cookie".into()).await.is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn entry(file: Option<&str>) -> SecretEntry {
        SecretEntry { service: "ai.wilm.home.secrets".into(), account: "secrets".into(), keychain_file: file.map(str::to_owned) }
    }

    #[test]
    fn the_security_command_text() {
        let value = r#"{"v":1,"openaiKey":"sk-\"q\" \\ \u00e4"}"#;
        let line = security_add_command(&entry(None), value);
        let hex: String = value.bytes().map(|b| format!("{b:02x}")).collect();
        assert_eq!(line, format!("add-generic-password -s ai.wilm.home.secrets -a secrets -l \"WilmAI Home\" -T /usr/bin/security -X {hex}\n"));
        assert!(!line.contains("-U"), "never changed in place");
        assert!(!line.contains("openaiKey"), "the value only as hex");
        assert!(security_add_command(&entry(Some("/tmp/test.keychain-db")), "x").ends_with(" -X 78 \"/tmp/test.keychain-db\"\n"), "a keychain file last");
        assert_eq!(security_find_args(&entry(None)), ["find-generic-password", "-s", "ai.wilm.home.secrets", "-a", "secrets", "-w"]);
        assert_eq!(security_delete_args(&entry(Some("/tmp/k"))), ["delete-generic-password", "-s", "ai.wilm.home.secrets", "-a", "secrets", "/tmp/k"]);
        assert!(!security_find_args(&entry(None)).iter().any(|a| a.contains("openaiKey")), "no value on a command line");
    }

    #[test]
    fn reads_what_security_answers() {
        let run = |code: Option<i32>, stdout: &str, stderr: &str| Run { code, stdout: stdout.into(), stderr: stderr.into() };
        assert_eq!(security_read_answer(&run(Some(0), "{\"v\":1}\n", "")), Ok(Some("{\"v\":1}".into())), "the trailing newline goes");
        assert_eq!(security_read_answer(&run(Some(44), "", "The specified item could not be found in the keychain.")), Ok(None));
        assert!(matches!(security_read_answer(&run(Some(152), "", "User interaction is not allowed.")), Err(KeychainError::Refused(why)) if why.contains("interaction")));
        assert!(matches!(security_read_answer(&run(Some(51), "", "")), Err(KeychainError::Refused(_))));
        assert!(matches!(security_read_answer(&run(None, "", "")), Err(KeychainError::Refused(_))), "killed");
        assert_eq!(security_delete_answer(&run(Some(0), "", "")), Ok(true));
        assert_eq!(security_delete_answer(&run(Some(44), "", "")), Ok(false), "there was none");
        assert!(security_delete_answer(&run(Some(152), "", "")).is_err());
        assert_eq!(security_add_answer(&run(Some(0), "", "")), Ok(()));
        assert!(security_add_answer(&run(Some(0), "", "add-generic-password: returned -25299")).is_err(), "-i says it on stderr");
        assert!(security_add_answer(&run(Some(1), "", "")).is_err());
        assert_eq!(security_add_answer(&run(Some(0), "", "a note that returned -x")), Ok(()), "only a number counts");
    }

    #[test]
    fn only_the_apps_own_entry_names_and_values() {
        assert!(check_entry(&SecretEntry::home()).is_ok());
        assert!(check_entry(&entry(Some("/private/tmp/scratch/test.keychain-db"))).is_ok());
        for bad in ["", "-s", "a b", "a\"b", "a\nb", "ai.wilm.home.secrets -a x", &"a".repeat(65)] {
            assert!(!valid_entry_name(bad), "{bad:?}");
            let mut e = entry(None);
            e.account = bad.to_owned();
            assert!(check_entry(&e).is_err(), "{bad:?}");
        }
        for bad in ["relative.keychain", "/tmp/a\"b", "/tmp/a\nb", "/tmp/a\\b"] {
            assert!(check_entry(&entry(Some(bad))).is_err(), "{bad:?}");
        }
        assert!(valid_secret_value(r#"{"v":1,"passwords":{"k":"p\u00e4"}}"#));
        assert!(!valid_secret_value(""));
        assert!(!valid_secret_value("pää"), "the window escapes everything past ASCII");
        assert!(!valid_secret_value("a\nb"));
        assert!(!valid_secret_value(&"a".repeat(MAX_SECRETS_BYTES + 1)), "too long for Credential Manager");
    }

    #[tokio::test]
    async fn a_bad_entry_or_value_never_reaches_the_keychain() {
        // Refused before any keychain call: these can't touch the real keychain.
        let mut bad = SecretEntry::home();
        bad.account = "-a".into();
        assert!(read_secrets(bad.clone()).await.is_err());
        assert!(delete_secrets(bad).await.is_err());
        assert!(write_secrets(SecretEntry::home(), "pää".into()).await.unwrap_err().starts_with("Not something"));
    }

    #[cfg(unix)]
    #[test]
    fn a_slow_keychain_call_is_stopped() {
        let run = run_with_timeout("/bin/cat", &[], "value on stdin", Duration::from_secs(5)).unwrap().unwrap();
        assert_eq!((run.code, run.stdout.as_str()), (Some(0), "value on stdin"), "stdin given, then closed");
        let started = std::time::Instant::now();
        assert_eq!(run_with_timeout("/bin/sleep", &["5".into()], "", Duration::from_millis(200)).unwrap(), None, "killed");
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    use tauri::async_runtime::block_on;

    /// Removes the test entry however the test ends.
    struct Cleanup(SecretEntry);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = keychain_delete(&self.0);
        }
    }

    /// The app's own entry in the real keychain, under a test service (never the app's own). Opt-in:
    /// `cargo test -- --ignored home_secrets_in_the_real_keychain`. WILMAI_HOME_KEYCHAIN_SERVICE picks the service
    /// (default ai.wilm.home.secrets.test); on macOS, WILMAI_HOME_KEYCHAIN_PATH a keychain file instead of the login
    /// keychain (made and unlocked beforehand: `security create-keychain` and `security unlock-keychain`).
    #[test]
    #[ignore]
    fn home_secrets_in_the_real_keychain() {
        let service = std::env::var("WILMAI_HOME_KEYCHAIN_SERVICE").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "ai.wilm.home.secrets.test".into());
        assert_ne!(service, SECRETS_SERVICE, "never the app's own entry");
        let mut id = [0u8; 8];
        getrandom::getrandom(&mut id).unwrap();
        let account = format!("test-{}", id.iter().map(|b| format!("{b:02x}")).collect::<String>());
        let entry = SecretEntry { service, account, keychain_file: std::env::var("WILMAI_HOME_KEYCHAIN_PATH").ok().filter(|p| !p.is_empty()) };
        check_entry(&entry).expect("a test entry the app could make");
        let _cleanup = Cleanup(entry.clone());
        let first = r#"{"v":1,"openaiKey":"sk-test \"q\" \\ \u00e4","wilmaPassword":"","passwords":{}}"#;
        let second = r#"{"v":1,"openaiKey":"","wilmaPassword":"","passwords":{"[\"https://example.inschool.fi\",\"parent\"]":"pw"}}"#;
        assert_eq!(block_on(read_secrets(entry.clone())), Ok(None), "nothing there yet");
        block_on(write_secrets(entry.clone(), first.into())).expect("written");
        assert_eq!(block_on(read_secrets(entry.clone())).unwrap().as_deref(), Some(first), "read back exactly");
        block_on(write_secrets(entry.clone(), second.into())).expect("replaced: deleted and added again, with nothing to answer");
        assert_eq!(block_on(read_secrets(entry.clone())).unwrap().as_deref(), Some(second));
        #[cfg(target_os = "macos")]
        if let Some(file) = &entry.keychain_file {
            // The item trusts /usr/bin/security only: read without a prompt, whatever runs it.
            let dump = run_with_timeout("/usr/bin/security", &["dump-keychain".into(), "-a".into(), file.clone()], "", KEYCHAIN_TIMEOUT).unwrap().unwrap();
            let decrypt = dump.stdout.split("entry 1:").next().unwrap_or_default();
            assert!(decrypt.contains("applications (1):") && decrypt.contains("0: /usr/bin/security (OK)"), "trusted applications: {}", dump.stdout);
        }
        assert_eq!(block_on(delete_secrets(entry.clone())), Ok(true));
        assert_eq!(block_on(read_secrets(entry.clone())), Ok(None), "gone");
        assert_eq!(block_on(delete_secrets(entry)), Ok(false), "nothing left to delete");
    }

    #[test]
    fn reads_update_manifests() {
        let ok = parse_release(r#"{"version":"0.2.0","notes":"Uutta","url":"https://wilm.ai/app"}"#).unwrap();
        assert_eq!(ok.version, "0.2.0");
        assert_eq!(ok.url.as_deref(), Some("https://wilm.ai/app"));
        assert_eq!(parse_release(r#"{"version":"0.3.0-beta.1"}"#).unwrap().notes, None);
        assert_eq!(parse_release(r#"{"version":"0.2.0","url":"https://evil.example/x"}"#).unwrap().url, None, "links only to wilm.ai or GitHub");
        assert!(parse_release(r#"{"version":"latest"}"#).is_none());
        assert!(parse_release("<html>not found</html>").is_none());
    }

    #[test]
    fn passes_only_page_headers() {
        let headers = [("X-Requested-With", "XMLHttpRequest"), ("Cookie", "Wilma2SID=x"), ("Accept", "application/json"), ("Host", "evil.example")]
            .into_iter()
            .map(|(k, v)| (k.to_owned(), v.to_owned()))
            .collect();
        let mut passed = passed_headers(&headers);
        passed.sort();
        assert_eq!(passed, vec![("accept".to_owned(), "application/json".to_owned()), ("x-requested-with".to_owned(), "XMLHttpRequest".to_owned())]);
    }

    #[test]
    fn only_known_secrets() {
        assert!(secret("jev-key").is_ok());
        assert!(secret("anything-else").is_err());
    }

    #[test]
    fn local_models_never_reach_remote_hosts_or_other_routes() {
        let wire = |endpoint: &str, path: &str| OllamaRequest { endpoint: endpoint.into(), path: path.into(), body: None };
        assert!(local_model_url(&wire("http://127.0.0.1:11434", "/api/chat")).is_ok());
        assert!(local_model_url(&wire("http://[::1]:11434", "/api/version")).is_ok());
        for endpoint in ["https://127.0.0.1", "http://localhost", "http://example.com", "http://127.0.0.1.evil.test", "http://user:pw@127.0.0.1", "http://127.0.0.1/path", "http://127.0.0.1?redirect=1"] {
            assert!(local_model_url(&wire(endpoint, "/api/chat")).is_err(), "{endpoint}");
        }
        assert!(local_model_url(&wire("http://127.0.0.1", "/api/pull")).is_err());
        assert!(local_model_url(&wire("http://127.0.0.1", "/api/delete")).is_err());
        assert!(local_model_url(&wire("http://127.0.0.1", "/api/generate")).is_err());
        assert!(local_model_url(&OllamaRequest { endpoint: "http://127.0.0.1".into(), path: "/api/generate".into(), body: Some(serde_json::json!({ "model": "wilmai-clef", "keep_alive": 0 })) }).is_ok());
    }

    #[tokio::test]
    async fn refuses_other_hosts() {
        let wire = WireRequest { url: "https://example.com/".into(), method: "GET".into(), body: None, content_type: None, cookie: None, headers: Default::default() };
        assert!(wilma_send(wire).await.unwrap_err().starts_with("Not a known Wilma"));
        let plain = WireRequest { url: "http://helsinki.inschool.fi/".into(), method: "GET".into(), body: None, content_type: None, cookie: None, headers: Default::default() };
        assert!(wilma_send(plain).await.is_err());
    }
}
