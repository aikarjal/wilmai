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
            cli_logins,
            cli_login_secret,
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
 * Keys are the CLI's (packages/wilma-cli/src/session-keys.ts):
 * - v1, as always: SHA-256 hex of the Wilma address, the lower-case username
 *   and the password. The app makes it from the password it has and sends it
 *   with the login.
 * - v2, while the CLI keeps the login's password in the keychain: SHA-256 hex
 *   of "wilmai-session-v2", the address and the lower-case username.
 * The CLI can move a login between its file and the keychain while the app is
 * open, so the key is worked out here from the CLI's config at every read and
 * write, never kept (docs/secret-store.md in the CLI, machine 4).
 */
const SESSION_TTL_MS: u64 = 6 * 60 * 60 * 1000;
const MAX_STATE_BYTES: usize = 64 * 1024;

/// The CLI's config file: WILMAI_CONFIG_PATH, else $XDG_CONFIG_HOME/wilmai or ~/.config/wilmai (config.json).
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

fn lower_hex(text: &str, len: usize) -> bool {
    text.len() == len && text.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn valid_session_key(key: &str) -> bool {
    lower_hex(key, 64)
}

/// A Wilma address as the CLI writes it into keys: without one trailing slash.
fn wilma_address(url: &str) -> &str {
    url.strip_suffix('/').unwrap_or(url)
}

/// The v2 key: no password, so the session is found without reading the keychain.
fn session_key_v2(base_url: &str, username: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(format!("wilmai-session-v2\n{}\n{}", wilma_address(base_url), username.to_lowercase()).as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Whether the CLI's config has this login (address, trailing slash aside; username in any case) with its password
/// outside its file: in the keychain, or a store a newer CLI knows. The CLI keys those sessions by v2 too.
fn is_keychain_login(config: &str, base_url: &str, username: &str) -> bool {
    let Ok(config) = serde_json::from_str::<serde_json::Value>(config) else { return false };
    let username = username.to_lowercase();
    config.get("profiles").and_then(|p| p.as_array()).is_some_and(|profiles| {
        profiles.iter().any(|p| {
            p["secrets"].as_str().is_some_and(|store| !store.is_empty())
                && p["tenantUrl"].as_str().is_some_and(|url| wilma_address(url) == wilma_address(base_url))
                && p["username"].as_str().is_some_and(|name| name.to_lowercase() == username)
        })
    })
}

/// A login in the shared session file: its Wilma and username, and the v1 key when the app knows the password.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct SessionLogin {
    base_url: String,
    username: String,
    #[serde(default)]
    v1_key: Option<String>,
}

/// The login's key now: v2 while the CLI keeps it in the keychain, else the v1 key (none: the app can't share its session).
fn session_key(config: &str, login: &SessionLogin) -> Result<Option<String>, String> {
    if is_keychain_login(config, &login.base_url, &login.username) {
        return Ok(Some(session_key_v2(&login.base_url, &login.username)));
    }
    match login.v1_key.as_deref() {
        Some(key) if valid_session_key(key) => Ok(Some(key.to_owned())),
        Some(_) => Err("Not a WilmAI session key".into()),
        None => Ok(None),
    }
}

/// The CLI's config as it is now: empty when there's none, an error when it's there but can't be read (nothing is written then).
fn cli_config_now() -> Result<String, String> {
    let Some(path) = config_file() else { return Ok(String::new()) };
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("The WilmAI CLI's settings couldn't be read: {e}")),
    }
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
fn read_session(content: &str, key: &str, now: u64) -> Option<SharedEntry> {
    let all: serde_json::Value = serde_json::from_str(content).ok()?;
    let entry = all.get(key)?;
    let saved_at = entry.get("savedAt")?.as_u64()?;
    if now.saturating_sub(saved_at) > SESSION_TTL_MS {
        return None;
    }
    let state = entry.get("state")?.as_str()?.to_owned();
    let by = entry.get("by").and_then(|v| v.as_str()).filter(|b| b.len() <= 32).map(str::to_owned);
    Some(SharedEntry { state, saved_at, by })
}

/// The file's new content with `state` saved under `key` (old entries dropped).
fn write_session(content: &str, key: &str, state: &str, now: u64) -> String {
    let mut all = match serde_json::from_str::<serde_json::Value>(content) {
        Ok(serde_json::Value::Object(map)) => map,
        _ => serde_json::Map::new(),
    };
    all.retain(|_, entry| entry.get("savedAt").and_then(|v| v.as_u64()).is_some_and(|at| now.saturating_sub(at) <= SESSION_TTL_MS));
    all.insert(key.to_owned(), serde_json::json!({ "state": state, "savedAt": now, "by": "home" }));
    serde_json::Value::Object(all).to_string()
}

#[tauri::command]
async fn shared_session_get(login: SessionLogin) -> Result<Option<SharedEntry>, String> {
    let Some(key) = session_key(&cli_config_now()?, &login)? else { return Ok(None) };
    let Some(path) = sessions_path() else { return Ok(None) };
    match std::fs::read_to_string(&path) {
        Ok(content) => Ok(read_session(&content, &key, now_ms())),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
async fn shared_session_set(login: SessionLogin, state: String) -> Result<(), String> {
    use std::io::Write;
    if state.len() > MAX_STATE_BYTES || !state.contains("Wilma2SID") {
        return Err("Not a WilmAI session".into());
    }
    // No key (a login whose password the app never had, kept in the CLI's file): nothing to share it under.
    let Some(key) = session_key(&cli_config_now()?, &login)? else { return Ok(()) };
    let path = sessions_path().ok_or("No home folder")?;
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
    let content = std::fs::read_to_string(&path).unwrap_or_default();
    let next = write_session(&content, &key, &state, now_ms());
    // Temp file + rename, like the CLI: another program never reads half a file.
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
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/*
 * The WilmAI CLI's saved logins on this computer (its config.json), for the
 * sign-in page's one-click "Continue as". The list carries no secrets. One
 * login's password (and two-step key) is read only when the app signs in with
 * it, and only for a Wilma on the tenant list; it goes no further than this
 * app's own login to that Wilma. The CLI keeps them lightly obfuscated
 * (base64 of "wilmai::" + the secret), not encrypted; the file is readable by
 * this user only.
 *
 * A login can instead be in the system keychain ("secrets": "keychain"): one
 * entry per login, service ai.wilm.wilma-cli, account the login's random
 * "secretId", value JSON {"password", "totpSecret"} (non-ASCII escaped). The
 * config then says only whether there's an authenticator key ("hasTotp"). The
 * entry is read only when Wilma needs a new login, never to list the logins
 * or to find a shared session. Any other "secrets" is a store a newer WilmAI
 * made.
 */
const CLI_SECRET_PREFIX: &str = "wilmai::";
const CLI_KEYCHAIN_SERVICE: &str = "ai.wilm.wilma-cli";
/// How long the keychain may take to answer; after that it counts as refused (on a Mac the child process is killed).
const KEYCHAIN_TIMEOUT: Duration = Duration::from_secs(10);
const KEYCHAIN_MISSING: &str = "The password the WilmAI CLI saved for this Wilma isn't in the keychain any more. Log in again with the CLI (`wilma login`), or type the password here.";
const KEYCHAIN_REFUSED: &str = "The keychain on this computer didn't hand over the password the WilmAI CLI saved. If the computer is locked or asking for a password, unlock it, then try again.";
const NEWER_STORE: &str = "A newer WilmAI saved this login's password where this version of WilmAI Home can't read it. Update WilmAI Home, or type the password here.";

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SavedLogin {
    id: String,
    base_url: String,
    username: String,
    tenant_name: Option<String>,
    has_totp: bool,
    /// The CLI keeps this login's password in the keychain (its shared session's key is then v2).
    keychain: bool,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct LoginSecret {
    password: String,
    totp_secret: Option<String>,
}

fn reveal_cli_secret(value: &str) -> Option<String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(value.trim()).ok()?;
    String::from_utf8(bytes).ok()?.strip_prefix(CLI_SECRET_PREFIX).map(str::to_owned)
}

/// The config's logins for known Wilmas, the last one used first (like the CLI).
fn saved_profiles(content: &str) -> Vec<serde_json::Value> {
    let Ok(config) = serde_json::from_str::<serde_json::Value>(content) else { return vec![] };
    let last = config.get("lastProfileId").and_then(|v| v.as_str()).unwrap_or_default().to_owned();
    let mut profiles: Vec<serde_json::Value> = config
        .get("profiles")
        .and_then(|p| p.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        // A password in the file, or a store named (the keychain, or one a newer WilmAI made: said when it's used).
        .filter(|p| p["id"].is_string() && p["username"].is_string() && (p["passwordObfuscated"].is_string() || p["secrets"].is_string()))
        .filter(|p| p["tenantUrl"].as_str().is_some_and(is_known_wilma))
        .collect();
    profiles.sort_by_key(|p| p["id"].as_str() != Some(last.as_str()));
    profiles
}

fn is_known_wilma(url: &str) -> bool {
    reqwest::Url::parse(url).is_ok_and(|u| u.scheme() == "https" && u.host_str().is_some_and(|h| wilma_hosts().contains(h)))
}

fn to_saved_login(profile: &serde_json::Value) -> SavedLogin {
    let keychain = profile["secrets"].as_str() == Some("keychain");
    SavedLogin {
        id: profile["id"].as_str().unwrap_or_default().to_owned(),
        base_url: profile["tenantUrl"].as_str().unwrap_or_default().trim_end_matches('/').to_owned(),
        username: profile["username"].as_str().unwrap_or_default().to_owned(),
        tenant_name: profile["tenantName"].as_str().map(str::to_owned),
        // A keychain login says so in the config, so listing it doesn't read the keychain.
        has_totp: if keychain {
            profile["hasTotp"].as_bool().unwrap_or(false)
        } else {
            profile["totpSecretObfuscated"].as_str().is_some_and(|s| !s.is_empty())
        },
        keychain,
    }
}

fn read_cli_config() -> String {
    config_file().and_then(|path| std::fs::read_to_string(path).ok()).unwrap_or_default()
}

#[tauri::command]
async fn cli_logins() -> Vec<SavedLogin> {
    saved_profiles(&read_cli_config()).iter().map(to_saved_login).collect()
}

/// Where one saved login's secrets are: in the config (read now), or in the keychain entry named by its secretId.
#[derive(Debug, PartialEq)]
enum SavedSecret {
    File(LoginSecret),
    Keychain(String),
}

fn saved_secret(config: &str, id: &str) -> Result<SavedSecret, String> {
    let profiles = saved_profiles(config);
    let profile = profiles.iter().find(|p| p["id"].as_str() == Some(id)).ok_or("That saved login isn't there any more.")?;
    match profile["secrets"].as_str() {
        None => {
            let password = profile["passwordObfuscated"].as_str().and_then(reveal_cli_secret).ok_or("The saved login has no readable password.")?;
            let totp_secret = profile["totpSecretObfuscated"].as_str().filter(|s| !s.is_empty()).and_then(reveal_cli_secret);
            Ok(SavedSecret::File(LoginSecret { password, totp_secret }))
        }
        Some("keychain") => Ok(SavedSecret::Keychain(profile["secretId"].as_str().unwrap_or_default().to_owned())),
        Some(_) => Err(NEWER_STORE.into()),
    }
}

#[tauri::command]
async fn cli_login_secret(id: String) -> Result<LoginSecret, String> {
    match saved_secret(&read_cli_config(), &id)? {
        SavedSecret::File(secret) => Ok(secret),
        SavedSecret::Keychain(secret_id) => read_keychain_login(secret_id).await,
    }
}

/// The CLI makes each entry's name from 16 random bytes: 32 lowercase hex characters, nothing else.
fn valid_secret_id(secret_id: &str) -> bool {
    lower_hex(secret_id, 32)
}

/// Why a keychain entry couldn't be had.
#[derive(Debug, PartialEq)]
enum EntryError {
    /// No such entry (deleted outside WilmAI), or not the CLI's format.
    Missing,
    /// Locked, declined, or no answer in time.
    Refused,
}

fn entry_message(error: EntryError) -> String {
    match error {
        EntryError::Missing => KEYCHAIN_MISSING.into(),
        EntryError::Refused => KEYCHAIN_REFUSED.into(),
    }
}

/// The entry's value as the CLI writes it: {"password": "…", "totpSecret": "…" | null}.
fn parse_cli_entry(value: &str) -> Option<LoginSecret> {
    let entry: serde_json::Value = serde_json::from_str(value).ok()?;
    let password = entry.get("password")?.as_str().filter(|p| !p.is_empty())?.to_owned();
    let totp_secret = entry.get("totpSecret").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(str::to_owned);
    Some(LoginSecret { password, totp_secret })
}

/// A keychain login's password and authenticator key, read once, off the main thread (a prompt must not freeze the window).
async fn read_keychain_login(secret_id: String) -> Result<LoginSecret, String> {
    if !valid_secret_id(&secret_id) {
        return Err(KEYCHAIN_MISSING.into());
    }
    let read = tauri::async_runtime::spawn_blocking(move || read_cli_entry(&secret_id));
    // A native call that can't be stopped (Windows) is left to finish by itself; the parent hears now.
    let value = match tokio::time::timeout(KEYCHAIN_TIMEOUT + Duration::from_secs(1), read).await {
        Ok(Ok(result)) => result,
        _ => Err(EntryError::Refused),
    };
    let value = value.map_err(entry_message)?;
    parse_cli_entry(&value).ok_or_else(|| KEYCHAIN_MISSING.into())
}

/// What `security find-generic-password -w` came to: exit 0 the value and a newline, 44 no such entry, anything else refused.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn security_answer(code: Option<i32>, stdout: &str) -> Result<String, EntryError> {
    match code {
        Some(0) => Ok(stdout.strip_suffix('\n').unwrap_or(stdout).to_owned()),
        Some(44) => Err(EntryError::Missing),
        _ => Err(EntryError::Refused),
    }
}

/// One run of a program with its output, killed after `timeout` (then None).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn run_with_timeout(program: &str, args: &[&str], timeout: Duration) -> std::io::Result<Option<(Option<i32>, String)>> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    let mut child = Command::new(program).args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn()?;
    let mut stdout = child.stdout.take().expect("stdout is piped");
    // Read while it runs, so a long answer can't fill the pipe and stall it.
    let reader = std::thread::spawn(move || {
        let mut out = Vec::new();
        let _ = stdout.read_to_end(&mut out);
        out
    });
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if let Some(status) = child.try_wait()? {
            let out = reader.join().unwrap_or_default();
            return Ok(Some((status.code(), String::from_utf8_lossy(&out).into_owned())));
        }
        if std::time::Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(None);
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// macOS: through /usr/bin/security, as the CLI does. Its entries trust only that program, so they're handed over
/// without asking for the Mac's password, whoever runs it.
#[cfg(target_os = "macos")]
fn read_cli_entry(secret_id: &str) -> Result<String, EntryError> {
    let args = ["find-generic-password", "-s", CLI_KEYCHAIN_SERVICE, "-a", secret_id, "-w"];
    match run_with_timeout("/usr/bin/security", &args, KEYCHAIN_TIMEOUT) {
        Ok(Some((code, stdout))) => security_answer(code, &stdout),
        _ => Err(EntryError::Refused),
    }
}

/// The CLI's keychain entry for one login, and nothing else: the Jev key's `secret` stays the only other one.
#[cfg(not(target_os = "macos"))]
fn cli_entry(secret_id: &str) -> Result<keyring::Entry, String> {
    if !valid_secret_id(secret_id) {
        return Err(format!("Not a WilmAI keychain entry: {secret_id}"));
    }
    keyring::Entry::new(CLI_KEYCHAIN_SERVICE, secret_id).map_err(|e| e.to_string())
}

/// Windows: Credential Manager through the keyring crate, the same entry the CLI's keyring library writes.
#[cfg(not(target_os = "macos"))]
fn read_cli_entry(secret_id: &str) -> Result<String, EntryError> {
    match cli_entry(secret_id).map_err(|_| EntryError::Missing)?.get_password() {
        Ok(value) => Ok(value),
        Err(keyring::Error::NoEntry) => Err(EntryError::Missing),
        Err(_) => Err(EntryError::Refused),
    }
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
    /// Reads an entry the CLI really wrote (macOS: through /usr/bin/security; Windows: Credential Manager).
    /// Opt-in: `WILMAI_INTEROP_SECRET_ID=<id> WILMAI_INTEROP_PASSWORD=<pw> cargo test -- --ignored reads_an_entry_the_cli_wrote`
    /// after the CLI's store saved {password} under that id (packages/wilma-cli/test/keychain-real.mjs prints how).
    #[test]
    #[ignore]
    fn reads_an_entry_the_cli_wrote() {
        let id = std::env::var("WILMAI_INTEROP_SECRET_ID").expect("WILMAI_INTEROP_SECRET_ID");
        let password = std::env::var("WILMAI_INTEROP_PASSWORD").expect("WILMAI_INTEROP_PASSWORD");
        let read = tauri::async_runtime::block_on(read_keychain_login(id)).expect("Home reads the CLI's entry");
        assert_eq!(read.password, password);
        assert_eq!(read.totp_secret.as_deref(), Some("JBSWY3DPEHPK3PXP"));
    }

    use super::*;

    #[test]
    fn knows_the_tenant_list() {
        let hosts = wilma_hosts();
        assert!(hosts.len() > 400);
        assert!(hosts.contains("helsinki.inschool.fi"));
        assert!(!hosts.contains("example.com"));
    }

    #[test]
    fn shared_session_file_like_the_cli() {
        let key = "a".repeat(64);
        let now = 10 * SESSION_TTL_MS;
        let written = write_session(r#"{"old":{"state":"x","savedAt":1},"other":{"state":"keep","savedAt":0}}"#.replace(":0}", &format!(":{}}}", now - 1000)).as_str(), &key, "{\"cookies\":[]}", now);
        let all: serde_json::Value = serde_json::from_str(&written).unwrap();
        assert!(all.get("old").is_none(), "entries older than six hours are dropped");
        assert_eq!(all["other"]["state"], "keep", "other logins are kept");
        let entry = read_session(&written, &key, now + 1).unwrap();
        assert_eq!((entry.state.as_str(), entry.by.as_deref()), ("{\"cookies\":[]}", Some("home")), "saved by this app");
        assert_eq!(read_session(&written, &key, now + SESSION_TTL_MS + 1), None, "too old to try");
        assert_eq!(read_session("not json", &key, now), None);
        assert_eq!(write_session("garbage", &key, "s", now), format!("{{\"{key}\":{{\"by\":\"home\",\"savedAt\":{now},\"state\":\"s\"}}}}"));
        assert!(valid_session_key(&"0123456789abcdef".repeat(4)));
        assert!(!valid_session_key("../etc"));
        assert!(!valid_session_key(&"A".repeat(64)), "the CLI writes lowercase hex");
    }

    #[test]
    fn a_session_written_while_the_cli_moves_a_login_lands_under_its_key_now() {
        let now = 10 * SESSION_TTL_MS;
        let v1 = "c4cb441cdc450d3151d3de14dd1576b4aa3235ea224813cac8e8d9c982dd3507";
        let login = SessionLogin { base_url: "https://example.inschool.fi".into(), username: "Matti.M".into(), v1_key: Some(v1.into()) };
        let file = r#"{"profiles":[{"id":"p","tenantUrl":"https://example.inschool.fi","username":"Matti.M","passwordObfuscated":"x"}]}"#;
        let keychain = r#"{"profiles":[{"id":"p","tenantUrl":"https://example.inschool.fi","username":"Matti.M","secrets":"keychain","secretId":"0123456789abcdef0123456789abcdef"}]}"#;
        let first = write_session("{}", &session_key(file, &login).unwrap().unwrap(), "{\"Wilma2SID\":1}", now);
        let second = write_session(&first, &session_key(keychain, &login).unwrap().unwrap(), "{\"Wilma2SID\":2}", now);
        let all: serde_json::Value = serde_json::from_str(&second).unwrap();
        assert_eq!(all[v1]["state"], "{\"Wilma2SID\":1}");
        assert_eq!(all[session_key_v2("https://example.inschool.fi", "Matti.M")]["state"], "{\"Wilma2SID\":2}", "the next write, after the move, under v2");
        assert_eq!(read_session(&second, &session_key(keychain, &login).unwrap().unwrap(), now).unwrap().state, "{\"Wilma2SID\":2}");
    }

    #[test]
    fn reads_the_cli_logins() {
        let secret = |s: &str| {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD.encode(format!("wilmai::{s}"))
        };
        let config = serde_json::json!({
            "lastProfileId": "b",
            "profiles": [
                { "id": "a", "tenantUrl": "https://helsinki.inschool.fi/", "username": "first", "passwordObfuscated": secret("pw1") },
                { "id": "b", "tenantUrl": "https://espoo.inschool.fi", "tenantName": "Espoo", "username": "second", "passwordObfuscated": secret("pw2"), "totpSecretObfuscated": secret("JBSWY3DPEHPK3PXP") },
                { "id": "c", "tenantUrl": "https://evil.example", "username": "x", "passwordObfuscated": secret("pw3") }
            ]
        })
        .to_string();
        let logins: Vec<SavedLogin> = saved_profiles(&config).iter().map(to_saved_login).collect();
        assert_eq!(logins.len(), 2, "only Wilmas on the tenant list");
        assert_eq!(logins[0].id, "b", "the last one used first");
        assert!(logins[0].has_totp && !logins[1].has_totp);
        assert!(!logins[0].keychain && !logins[1].keychain);
        assert_eq!(logins[1].base_url, "https://helsinki.inschool.fi");
        assert_eq!(reveal_cli_secret(&secret("pw2")).as_deref(), Some("pw2"));
        assert_eq!(reveal_cli_secret("cGxhaW4="), None, "not the CLI's format");
        assert!(saved_profiles("not json").is_empty());
        assert_eq!(saved_secret(&config, "b").unwrap(), SavedSecret::File(LoginSecret { password: "pw2".into(), totp_secret: Some("JBSWY3DPEHPK3PXP".into()) }));
        assert_eq!(saved_secret(&config, "c").unwrap_err(), "That saved login isn't there any more.");
    }

    const SECRET_ID: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn lists_keychain_logins_without_reading_the_keychain() {
        let config = serde_json::json!({
            "secretStore": "keychain",
            "keychainLogins": { "k": SECRET_ID },
            "profiles": [
                { "id": "k", "tenantUrl": "https://espoo.inschool.fi/", "username": "Parent", "secrets": "keychain", "secretId": SECRET_ID, "hasTotp": true, "credentialsStamp": "0123456789abcdef" },
                { "id": "k2", "tenantUrl": "https://helsinki.inschool.fi", "username": "other", "secrets": "keychain", "secretId": SECRET_ID, "hasTotp": false },
                { "id": "n", "tenantUrl": "https://helsinki.inschool.fi", "username": "newer", "secrets": "vault", "hasTotp": true },
                { "id": "x", "tenantUrl": "https://helsinki.inschool.fi", "username": "nothing" }
            ]
        })
        .to_string();
        let logins: Vec<SavedLogin> = saved_profiles(&config).iter().map(to_saved_login).collect();
        assert_eq!(logins.iter().map(|l| l.id.as_str()).collect::<Vec<_>>(), ["k", "k2", "n"], "a login with neither a password nor a store isn't listed");
        assert_eq!(
            logins[0],
            SavedLogin { id: "k".into(), base_url: "https://espoo.inschool.fi".into(), username: "Parent".into(), tenant_name: None, has_totp: true, keychain: true }
        );
        assert!(!logins[1].has_totp, "hasTotp says it for a keychain login");
        assert!(!logins[2].keychain && !logins[2].has_totp, "another store isn't the keychain, and its hasTotp isn't trusted");
        assert_eq!(saved_secret(&config, "k").unwrap(), SavedSecret::Keychain(SECRET_ID.into()));
        assert_eq!(saved_secret(&config, "n").unwrap_err(), NEWER_STORE, "saved by a newer WilmAI");
    }

    #[test]
    fn reads_the_cli_keychain_entry_format() {
        assert_eq!(parse_cli_entry(r#"{"password":"pää","totpSecret":null}"#), Some(LoginSecret { password: "pää".into(), totp_secret: None }), "non-ASCII comes escaped");
        assert_eq!(parse_cli_entry(r#"{"password":"pw","totpSecret":"JBSWY3DPEHPK3PXP"}"#).unwrap().totp_secret.as_deref(), Some("JBSWY3DPEHPK3PXP"));
        assert_eq!(parse_cli_entry(r#"{"password":"","totpSecret":null}"#), None, "no password");
        assert_eq!(parse_cli_entry("pw"), None, "not the CLI's JSON");
        assert_eq!(security_answer(Some(0), "{\"password\":\"pw\"}\n"), Ok("{\"password\":\"pw\"}".into()), "the trailing newline goes");
        assert_eq!(security_answer(Some(44), ""), Err(EntryError::Missing), "errSecItemNotFound");
        assert_eq!(security_answer(Some(51), ""), Err(EntryError::Refused), "declined or locked");
        assert_eq!(security_answer(None, ""), Err(EntryError::Refused), "killed");
        assert!(entry_message(EntryError::Missing).contains("isn't in the keychain any more"));
        assert!(entry_message(EntryError::Refused).contains("unlock it, then try again"));
    }

    #[test]
    fn only_the_cli_entry_names() {
        assert!(valid_secret_id(SECRET_ID));
        for bad in ["", "0123456789ABCDEF0123456789ABCDEF", "0123456789abcdef", "0123456789abcdef0123456789abcdef0", "../../../0123456789abcdef01234567", "-s other 89abcdef0123456789abcdef"] {
            assert!(!valid_secret_id(bad), "{bad}");
        }
        #[cfg(not(target_os = "macos"))]
        assert!(cli_entry("not-an-id").is_err());
    }

    #[tokio::test]
    async fn a_bad_secret_id_never_reaches_the_keychain() {
        // Refused before any keychain call: a test can't touch the real keychain.
        for bad in ["", "-a", "ABCDEF0123456789abcdef0123456789"] {
            assert_eq!(read_keychain_login(bad.into()).await.unwrap_err(), KEYCHAIN_MISSING);
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_slow_keychain_call_is_stopped() {
        assert_eq!(run_with_timeout("/bin/echo", &["value"], Duration::from_secs(5)).unwrap(), Some((Some(0), "value\n".into())));
        let started = std::time::Instant::now();
        assert_eq!(run_with_timeout("/bin/sleep", &["5"], Duration::from_millis(200)).unwrap(), None, "killed");
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn session_keys_like_the_cli() {
        let v2 = "18e7bcf46ac5969e085d0b5eac867bbbf4ffe590073dce493c82445fd120f6d9";
        assert_eq!(session_key_v2("https://example.inschool.fi/", "Matti.M"), v2);
        assert_eq!(session_key_v2("https://example.inschool.fi", "matti.m"), v2);
        assert!(valid_session_key(&session_key_v2("https://example.inschool.fi", "x")));
    }

    #[test]
    fn the_key_follows_the_cli_config_at_each_read_and_write() {
        let v1 = "c4cb441cdc450d3151d3de14dd1576b4aa3235ea224813cac8e8d9c982dd3507";
        let v2 = "18e7bcf46ac5969e085d0b5eac867bbbf4ffe590073dce493c82445fd120f6d9";
        let login = |v1_key: Option<&str>| SessionLogin { base_url: "https://example.inschool.fi".into(), username: "Matti.M".into(), v1_key: v1_key.map(str::to_owned) };
        let profile = |secrets: Option<&str>, url: &str, username: &str| {
            let mut p = serde_json::json!({ "id": "p", "tenantUrl": url, "username": username });
            if let Some(secrets) = secrets {
                p["secrets"] = secrets.into();
                p["secretId"] = SECRET_ID.into();
            }
            serde_json::json!({ "profiles": [p] }).to_string()
        };
        let keychain = profile(Some("keychain"), "https://example.inschool.fi/", "matti.m");
        let file = profile(None, "https://example.inschool.fi", "Matti.M");
        assert!(is_keychain_login(&keychain, "https://example.inschool.fi", "MATTI.M"), "address without the slash, username in any case");
        assert!(!is_keychain_login(&file, "https://example.inschool.fi", "Matti.M"), "a file login");
        assert!(!is_keychain_login(&profile(Some("keychain"), "https://other.inschool.fi", "Matti.M"), "https://example.inschool.fi", "Matti.M"), "another Wilma");
        assert!(!is_keychain_login(&profile(Some("keychain"), "https://example.inschool.fi", "matti"), "https://example.inschool.fi", "Matti.M"), "another user");
        assert!(is_keychain_login(&profile(Some("vault"), "https://example.inschool.fi", "Matti.M"), "https://example.inschool.fi", "Matti.M"), "a store a newer CLI knows is v2 too, as in the CLI");
        assert!(!is_keychain_login("", "https://example.inschool.fi", "Matti.M"), "no CLI config");
        assert!(!is_keychain_login("not json", "https://example.inschool.fi", "Matti.M"));

        // The same login, read and written while the CLI moves it: v1 from the file, v2 from the keychain.
        assert_eq!(session_key(&file, &login(Some(v1))), Ok(Some(v1.into())), "a file login: the app's v1 key, as before");
        assert_eq!(session_key(&keychain, &login(Some(v1))), Ok(Some(v2.into())), "moved to the keychain: v2, and the password's key isn't used");
        assert_eq!(session_key(&keychain, &login(None)), Ok(Some(v2.into())), "no password needed");
        assert_eq!(session_key(&file, &login(None)), Ok(None), "a file login without the password: nothing to share under");
        assert_eq!(session_key("", &login(Some(v1))), Ok(Some(v1.into())), "no CLI at all");
        assert!(session_key(&file, &login(Some("../etc/passwd"))).is_err());
        assert!(session_key(&file, &login(Some(&"A".repeat(64)))).is_err(), "the CLI writes lowercase hex");
        let wire: SessionLogin = serde_json::from_str(r#"{"baseUrl":"https://example.inschool.fi","username":"Matti.M","v1Key":"x"}"#).unwrap();
        assert_eq!(wire.v1_key.as_deref(), Some("x"), "the page's field names");
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
