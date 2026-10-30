//! The opt-in Small pack. Downloads contain no school data; inference is an
//! authenticated loopback worker bundled with the app. No Ollama installation.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::Notify,
};

pub const MANAGED_ENDPOINT: &str = "http://127.0.0.1:0";
const CANCELLED: &str = "Local model download cancelled.";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pack {
    id: String,
    context: u32,
    reasoning_budget: u32,
    runtime: Asset,
    template: Asset,
    models: Vec<Model>,
}
#[derive(Deserialize)]
struct Asset {
    #[serde(default)]
    version: String,
    sha256: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Model {
    name: String,
    file: String,
    url: String,
    sha256: String,
    bytes: u64,
    role: String,
    parameter_size: String,
}
fn pack() -> &'static Pack {
    static PACK: OnceLock<Pack> = OnceLock::new();
    PACK.get_or_init(|| {
        serde_json::from_str(include_str!("../resources/local-ai-pack.json"))
            .expect("pinned local pack")
    })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackStatus {
    bundled: bool,
    supported: bool,
    phase: String,
    downloaded_bytes: u64,
    total_bytes: u64,
    installed_bytes: u64,
    available_bytes: u64,
    required_free_bytes: u64,
    ram_bytes: u64,
    file: Option<String>,
    error: Option<String>,
    runtime: String,
}
struct Worker {
    process_group: bool,
    child: Child,
    model: String,
    endpoint: String,
    key: String,
}
struct Inner {
    dir: PathBuf,
    assets: PathBuf,
    status: Mutex<PackStatus>,
    installing: AtomicBool,
    cancelled: AtomicBool,
    paused: AtomicBool,
    wake: Notify,
    epoch: AtomicU64,
    lifecycle: tokio::sync::Mutex<()>,
    worker: Mutex<Option<Worker>>,
    inference: tokio::sync::Mutex<()>,
}
#[derive(Clone)]
pub struct LocalAi(Arc<Inner>);

fn modified(path: &Path) -> Option<u128> {
    std::fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_nanos())
}
fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}
fn available(path: &Path) -> u64 {
    let mut current = path;
    while !current.exists() {
        let Some(parent) = current.parent() else {
            return 0;
        };
        current = parent;
    }
    fs2::available_space(current).unwrap_or(0)
}
fn ram() -> u64 {
    if !cfg!(target_os = "macos") {
        return 0;
    }
    Command::new("/usr/sbin/sysctl")
        .args(["-n", "hw.memsize"])
        .output()
        .ok()
        .and_then(|r| String::from_utf8(r.stdout).ok())
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
}
fn local_http() -> &'static reqwest::Client {
    static HTTP: OnceLock<reqwest::Client> = OnceLock::new();
    HTTP.get_or_init(|| {
        reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(2))
            .timeout(Duration::from_secs(300))
            .build()
            .expect("local HTTP")
    })
}

/// The guard survives an app crash long enough to kill and reap the runtime.
/// Normal stop kills this private process group and waits before another load.
fn guarded_command(engine: &Path, parent: u32) -> Command {
    let mut command = Command::new("/bin/sh");
    command
        .args([
            "-c",
            r#"parent=$1; shift
"$@" & worker=$!
while kill -0 "$parent" 2>/dev/null && kill -0 "$worker" 2>/dev/null; do sleep 1; done
kill -KILL "$worker" 2>/dev/null
wait "$worker" 2>/dev/null
"#,
            "wilmai-local-worker",
            &parent.to_string(),
        ])
        .arg(engine);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
}

impl LocalAi {
    pub fn new(dir: PathBuf, assets: PathBuf) -> Self {
        let ram_bytes = ram();
        let bundled = cfg!(feature = "local-ai");
        let supported = cfg!(all(feature = "local-ai", target_os = "macos", target_arch = "aarch64"))
            && ram_bytes >= 16 * 1024_u64.pow(3);
        let status = PackStatus {
            bundled,
            supported,
            phase: "not-installed".into(),
            downloaded_bytes: 0,
            total_bytes: pack().models.iter().map(|m| m.bytes).sum(),
            installed_bytes: 0,
            available_bytes: available(&dir),
            required_free_bytes: 0,
            ram_bytes,
            file: None,
            error: None,
            runtime: pack().runtime.version.clone(),
        };
        Self(Arc::new(Inner {
            dir,
            assets,
            status: Mutex::new(status),
            installing: AtomicBool::new(false),
            cancelled: AtomicBool::new(false),
            paused: AtomicBool::new(false),
            wake: Notify::new(),
            epoch: AtomicU64::new(0),
            lifecycle: tokio::sync::Mutex::new(()),
            worker: Mutex::new(None),
            inference: tokio::sync::Mutex::new(()),
        }))
    }
    fn engine(&self) -> PathBuf {
        self.0
            .assets
            .join(format!("llama-{}", pack().runtime.version))
            .join("llama-server")
    }
    fn template(&self) -> PathBuf {
        self.0.assets.join("qwen-chat-template.jinja")
    }
    fn partial(&self, model: &Model) -> PathBuf {
        self.0.dir.join(format!("{}.part", model.file))
    }
    fn bytes(&self) -> u64 {
        pack()
            .models
            .iter()
            .map(|m| {
                file_size(&self.0.dir.join(&m.file))
                    .max(file_size(&self.partial(m)))
                    .min(m.bytes)
            })
            .sum()
    }
    fn installed(&self) -> bool {
        let Ok(text) = std::fs::read_to_string(self.0.dir.join("installed.json")) else {
            return false;
        };
        let Ok(marker) = serde_json::from_str::<Value>(&text) else {
            return false;
        };
        marker["id"] == pack().id
            && pack().models.iter().all(|m| {
                let path = self.0.dir.join(&m.file);
                marker["models"][&m.file]["sha256"] == m.sha256
                    && file_size(&path) == m.bytes
                    && marker["models"][&m.file]["modified"].as_str()
                        == modified(&path).map(|t| t.to_string()).as_deref()
            })
    }
    pub fn status(&self) -> PackStatus {
        let mut status = self.0.status.lock().expect("pack status");
        if !self.0.installing.load(Ordering::Acquire) {
            let installed = self.installed();
            status.installed_bytes = if installed { status.total_bytes } else { 0 };
            status.downloaded_bytes = self.bytes();
            if installed {
                status.phase = "ready".into();
                status.error = None;
            } else if status.error.is_none() {
                status.phase = "not-installed".into();
            }
        }
        status.available_bytes = available(&self.0.dir);
        status.required_free_bytes =
            status.total_bytes.saturating_sub(self.bytes()) + 1024_u64.pow(3);
        status.clone()
    }
    fn progress(&self, phase: &str, model: &Model, bytes: u64) {
        let mut status = self.0.status.lock().expect("pack status");
        status.phase = phase.into();
        status.file = Some(model.role.clone());
        status.downloaded_bytes = bytes;
        status.error = None;
    }
    fn not_cancelled(&self) -> Result<(), String> {
        if self.0.cancelled.load(Ordering::Acquire) {
            Err(CANCELLED.into())
        } else {
            Ok(())
        }
    }
    async fn hash(&self, path: &Path) -> Result<String, String> {
        let mut file = tokio::fs::File::open(path)
            .await
            .map_err(|e| e.to_string())?;
        let mut hash = Sha256::new();
        let mut buf = vec![0; 1024 * 1024];
        loop {
            self.not_cancelled()?;
            let n = file.read(&mut buf).await.map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            hash.update(&buf[..n]);
        }
        Ok(format!("{:x}", hash.finalize()))
    }
    async fn download(&self, model: &Model, client: &reqwest::Client) -> Result<(), String> {
        let path = self.0.dir.join(&model.file);
        let partial = self.partial(model);
        let other: u64 = pack()
            .models
            .iter()
            .filter(|m| m.file != model.file)
            .map(|m| {
                file_size(&self.0.dir.join(&m.file))
                    .max(file_size(&self.partial(m)))
                    .min(m.bytes)
            })
            .sum();
        if file_size(&path) == model.bytes {
            self.progress("verifying", model, other + model.bytes);
            if self.hash(&path).await? == model.sha256 {
                return Ok(());
            }
        }
        if path.exists() {
            tokio::fs::remove_file(&path)
                .await
                .map_err(|e| e.to_string())?;
        }
        let mut offset = file_size(&partial);
        if offset > model.bytes {
            tokio::fs::remove_file(&partial)
                .await
                .map_err(|e| e.to_string())?;
            offset = 0;
        }
        if offset < model.bytes {
            self.not_cancelled()?;
            let mut request = client
                .get(&model.url)
                .header(reqwest::header::ACCEPT_ENCODING, "identity");
            if offset > 0 {
                request = request.header(reqwest::header::RANGE, format!("bytes={offset}-"));
            }
            let mut response = tokio::select! { r = request.send() => r.map_err(|e| format!("Model download failed: {e}"))?, _ = self.0.wake.notified() => return Err(CANCELLED.into()) };
            if !response.status().is_success() {
                return Err(format!(
                    "Model download returned HTTP {}. Retry to resume.",
                    response.status()
                ));
            }
            if response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
                let expected = format!("bytes {offset}-");
                if !response
                    .headers()
                    .get(reqwest::header::CONTENT_RANGE)
                    .and_then(|v| v.to_str().ok())
                    .is_some_and(|v| {
                        v.starts_with(&expected) && v.ends_with(&format!("/{}", model.bytes))
                    })
                {
                    return Err("The model server returned an unexpected resume range.".into());
                }
            } else if offset > 0 {
                offset = 0;
            }
            let mut file = tokio::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .append(offset > 0)
                .truncate(offset == 0)
                .open(&partial)
                .await
                .map_err(|e| e.to_string())?;
            self.progress("downloading", model, other + offset);
            loop {
                self.not_cancelled()?;
                let chunk = tokio::select! { r = response.chunk() => r.map_err(|e| format!("Download interrupted: {e}. Retry to resume."))?, _ = self.0.wake.notified() => return Err(CANCELLED.into()) };
                let Some(chunk) = chunk else {
                    break;
                };
                if offset + chunk.len() as u64 > model.bytes {
                    return Err("Downloaded model exceeds the pinned size.".into());
                }
                file.write_all(&chunk).await.map_err(|e| e.to_string())?;
                offset += chunk.len() as u64;
                self.progress("downloading", model, other + offset);
            }
            file.sync_all().await.map_err(|e| e.to_string())?;
        }
        if file_size(&partial) != model.bytes {
            return Err("The model download is incomplete. Retry to resume.".into());
        }
        self.progress("verifying", model, other + model.bytes);
        if self.hash(&partial).await? != model.sha256 {
            tokio::fs::remove_file(&partial)
                .await
                .map_err(|e| e.to_string())?;
            return Err("Model verification failed; the invalid download was removed. Retry to download again.".into());
        }
        self.not_cancelled()?;
        tokio::fs::rename(&partial, &path)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub async fn install(&self) -> Result<PackStatus, String> {
        let _lifecycle = self.0.lifecycle.lock().await;
        if self.0.paused.load(Ordering::Acquire) { return Err("Local AI is paused for an app update.".into()); }
        let status = self.status();
        if !status.supported {
            return Err(
                "Local AI requires an Apple Silicon Mac with at least 16 GB memory.".into(),
            );
        }
        if !self.engine().is_file() || !self.template().is_file() {
            return Err(
                "This build is missing its bundled local runtime. Rebuild or update the app."
                    .into(),
            );
        }
        if self.installed() || self.0.installing.swap(true, Ordering::AcqRel) {
            return Ok(self.status());
        }
        if status.available_bytes < status.required_free_bytes {
            self.0.installing.store(false, Ordering::Release);
            return Err("Not enough free disk space for the local model pack.".into());
        }
        while tokio::time::timeout(Duration::from_millis(1), self.0.wake.notified())
            .await
            .is_ok()
        {}
        self.0.cancelled.store(false, Ordering::Release);
        {
            let mut status = self.0.status.lock().expect("pack status");
            status.phase = "downloading".into();
            status.error = None;
        }
        let manager = self.clone();
        tauri::async_runtime::spawn(async move {
            let result = manager.install_files().await;
            {
                let mut status = manager.0.status.lock().expect("pack status");
                status.file = None;
                if let Err(error) = result {
                    status.phase = if error == CANCELLED {
                        "not-installed"
                    } else {
                        "error"
                    }
                    .into();
                    status.error = (error != CANCELLED).then_some(error);
                } else {
                    status.phase = "ready".into();
                    status.error = None;
                }
            }
            manager.0.installing.store(false, Ordering::Release);
        });
        Ok(self.status())
    }
    async fn install_files(&self) -> Result<(), String> {
        tokio::fs::create_dir_all(&self.0.dir)
            .await
            .map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&self.0.dir, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| e.to_string())?;
        }
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::limited(10))
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| e.to_string())?;
        for model in &pack().models {
            self.not_cancelled()?;
            self.download(model, &client).await?;
        }
        self.not_cancelled()?;
        let models: serde_json::Map<String, Value> = pack().models.iter().map(|m| (m.file.clone(), json!({ "sha256": m.sha256, "modified": modified(&self.0.dir.join(&m.file)).map(|t| t.to_string()) }))).collect();
        let marker = json!({ "id": pack().id, "models": models });
        tokio::fs::write(self.0.dir.join("installed.json.tmp"), marker.to_string())
            .await
            .map_err(|e| e.to_string())?;
        tokio::fs::rename(
            self.0.dir.join("installed.json.tmp"),
            self.0.dir.join("installed.json"),
        )
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn stop(&self) {
        self.0.epoch.fetch_add(1, Ordering::AcqRel);
        let mut slot = self.0.worker.lock().expect("local worker");
        if let Some(mut worker) = slot.take() {
            #[cfg(unix)]
            if worker.process_group {
                unsafe {
                    libc::kill(-(worker.child.id() as i32), libc::SIGKILL);
                }
            }
            let _ = worker.child.kill();
            let _ = worker.child.wait();
        }
    }
    pub fn shutdown(&self) {
        self.0.paused.store(true, Ordering::Release);
        self.0.cancelled.store(true, Ordering::Release);
        self.0.wake.notify_one();
        self.stop();
    }
    pub fn resume_after_update_failure(&self) {
        self.0.paused.store(false, Ordering::Release);
    }
    pub async fn cancel(&self) -> Result<(), String> {
        let _lifecycle = self.0.lifecycle.lock().await;
        self.cancel_inner().await
    }
    async fn cancel_inner(&self) -> Result<(), String> {
        let downloading = self.0.installing.load(Ordering::Acquire);
        if !downloading {
            return Ok(());
        }
        self.0.cancelled.store(true, Ordering::Release);
        self.0.wake.notify_one();
        for _ in 0..300 {
            if !self.0.installing.load(Ordering::Acquire) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        if self.0.installing.load(Ordering::Acquire) {
            return Err("The download is still stopping. Try again shortly.".into());
        }
        self.remove_files().await
    }
    async fn remove_files(&self) -> Result<(), String> {
        match tokio::fs::remove_dir_all(&self.0.dir).await {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.to_string()),
        }
        let mut status = self.0.status.lock().expect("pack status");
        status.phase = "not-installed".into();
        status.downloaded_bytes = 0;
        status.installed_bytes = 0;
        status.error = None;
        Ok(())
    }
    pub async fn remove(&self) -> Result<(), String> {
        let _lifecycle = self.0.lifecycle.lock().await;
        self.cancel_inner().await?;
        self.stop();
        let _serial = self.0.inference.lock().await;
        self.remove_files().await
    }
    fn resident(&self) -> Value {
        let mut slot = self.0.worker.lock().expect("local worker");
        if let Some(worker) = slot.as_mut() {
            if matches!(worker.child.try_wait(), Ok(None)) {
                let model = pack()
                    .models
                    .iter()
                    .find(|m| m.name == worker.model)
                    .expect("owned model");
                return json!({ "models": [{"name": model.name, "size": model.bytes, "context_length": pack().context}] });
            }
        }
        *slot = None;
        json!({"models": []})
    }
    async fn load(&self, model: &Model, epoch: u64) -> Result<(String, String), String> {
        if self.0.paused.load(Ordering::Acquire) {
            return Err("Local AI is paused for an app update.".into());
        }
        if !self.status().supported {
            return Err("Local AI requires the local edition on an Apple Silicon Mac with at least 16 GB memory.".into());
        }
        if !self.installed() {
            return Err("Download and verify the local model pack in Settings first.".into());
        }
        {
            let mut slot = self.0.worker.lock().expect("local worker");
            if let Some(worker) = slot.as_mut() {
                if matches!(worker.child.try_wait(), Ok(None)) {
                    if worker.model == model.name {
                        return Ok((worker.endpoint.clone(), worker.key.clone()));
                    }
                    return Err(
                        "The previous local model is still loaded. Processing stopped.".into(),
                    );
                }
                *slot = None;
            }
        }
        let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        drop(listener);
        let mut secret = [0_u8; 32];
        getrandom::getrandom(&mut secret).map_err(|e| e.to_string())?;
        let key: String = secret.iter().map(|b| format!("{b:02x}")).collect();
        let key_path = self.0.dir.join("worker.key");
        std::fs::write(&key_path, &key).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600))
                .map_err(|e| e.to_string())?;
        }
        let engine = self.engine();
        let reader = model.role == "reading";
        let mut command = guarded_command(&engine, std::process::id());
        command
            .current_dir(engine.parent().ok_or("Missing runtime directory")?)
            .env_remove("DYLD_LIBRARY_PATH")
            .env_remove("GGML_BACKEND_PATH")
            .arg("--model")
            .arg(self.0.dir.join(&model.file))
            .arg("--alias")
            .arg(&model.name)
            .args([
                "--host",
                "127.0.0.1",
                "--port",
                &port.to_string(),
                "--api-key-file",
            ])
            .arg(&key_path)
            .args([
                "--ctx-size",
                &pack().context.to_string(),
                "--batch-size",
                if reader { "2048" } else { "16384" },
                "--ubatch-size",
                if reader { "512" } else { "16384" },
                "--parallel",
                "1",
                "--flash-attn",
                "on",
                "--cache-ram",
                "0",
                "--no-context-shift",
                "--offline",
                "--no-webui",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if reader {
            command
                .arg("--chat-template-file")
                .arg(self.template())
                .args([
                    "--jinja",
                    "--reasoning-format",
                    "deepseek",
                    "--reasoning-budget",
                    &pack().reasoning_budget.to_string(),
                ]);
        }
        let endpoint = format!("http://127.0.0.1:{port}");
        {
            let mut slot = self.0.worker.lock().expect("local worker");
            if self.0.epoch.load(Ordering::Acquire) != epoch || self.0.paused.load(Ordering::Acquire) {
                return Err("Local processing was stopped.".into());
            }
            let child = command
                .spawn()
                .map_err(|e| format!("Couldn't start the bundled local runtime: {e}"))?;
            *slot = Some(Worker {
                process_group: true,
                child,
                model: model.name.clone(),
                endpoint: endpoint.clone(),
                key: key.clone(),
            });
        }
        let deadline = std::time::Instant::now() + Duration::from_secs(120);
        loop {
            if self.0.epoch.load(Ordering::Acquire) != epoch {
                return Err("Local processing was stopped.".into());
            }
            if self.resident()["models"]
                .as_array()
                .is_none_or(|m| m.is_empty())
            {
                return Err("The local runtime stopped while loading the model.".into());
            }
            if std::time::Instant::now() > deadline {
                self.stop();
                return Err("Loading the local model timed out.".into());
            }
            if let Ok(response) = local_http()
                .get(format!("{endpoint}/health"))
                .bearer_auth(&key)
                .timeout(Duration::from_secs(1))
                .send()
                .await
            {
                if response.status().is_success() {
                    return Ok((endpoint, key));
                }
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
    pub async fn call(
        &self,
        path: &str,
        body: Option<Value>,
    ) -> Result<super::JevResponse, String> {
        let reply = |value: Value| {
            Ok(super::JevResponse {
                status: 200,
                retry_after: None,
                body: value.to_string(),
                from_openai: None,
                from_anthropic: None,
            })
        };
        match path {
            "/api/version" => {
                return reply(
                    json!({"version": pack().runtime.version, "wilmai_managed": true, "wilmai_engine": format!("native managed {}; template {}; reasoning {}; ctx {}; text only; cache RAM 0", pack().id, pack().template.sha256, pack().reasoning_budget, pack().context)}),
                )
            }
            "/api/tags" => {
                return reply(
                    json!({"models": if self.installed() {pack().models.iter().map(|m| json!({"name": m.name, "digest": m.sha256, "size": m.bytes})).collect::<Vec<_>>()} else {vec![]}}),
                )
            }
            "/api/ps" => return reply(self.resident()),
            _ => (),
        }
        let body = body.ok_or("Missing local request")?;
        let model = pack()
            .models
            .iter()
            .find(|m| body["model"].as_str() == Some(&m.name))
            .ok_or("Only the app's Small model pack is supported.")?;
        if path == "/api/show" {
            if !self.installed() {
                return Err("Local model pack is not installed.".into());
            }
            return reply(
                json!({"capabilities": if model.role == "decision" {vec!["decision"]} else {vec!["completion", "thinking"]}, "details": {"format": "gguf", "quantization_level": "Q4_K_M", "parameter_size": model.parameter_size}, "parameters": format!("num_ctx {}", pack().context)}),
            );
        }
        let epoch = self.0.epoch.load(Ordering::Acquire);
        let _serial = self.0.inference.lock().await;
        if self.0.epoch.load(Ordering::Acquire) != epoch {
            return Err("Local processing was stopped.".into());
        }
        if path == "/api/generate" && body["keep_alive"] == 0 {
            let active = self
                .0
                .worker
                .lock()
                .expect("local worker")
                .as_ref()
                .is_some_and(|w| w.model == model.name);
            if active {
                self.stop();
            }
            return reply(json!({"done": true}));
        }
        let native_path = match (path, model.role.as_str()) {
            ("/v1/systemone", "decision") => "/v1/systemone",
            ("/api/chat", "reading") => "/v1/chat/completions",
            _ => return Err("Unsupported local inference request.".into()),
        };
        let request = if model.role == "decision" {
            body
        } else {
            let count = body["options"]["num_predict"]
                .as_u64()
                .unwrap_or(4096)
                .clamp(1, 4096);
            json!({"model": model.name, "messages": body["messages"], "stream": false, "temperature": 0, "max_tokens": count,
                "chat_template_kwargs": {"enable_thinking": body["think"] == true}, "reasoning_budget_tokens": pack().reasoning_budget,
                "response_format": {"type": "json_schema", "json_schema": {"name": "extraction", "schema": body["format"]}}})
        };
        let (endpoint, key) = self.load(model, epoch).await?;
        let response = local_http()
            .post(format!("{endpoint}{native_path}"))
            .bearer_auth(key)
            .json(&request)
            .send()
            .await
            .map_err(|_| {
                "Local inference stopped or timed out. Nothing was sent to a cloud model."
            })?;
        let status = response.status().as_u16();
        let text = response.text().await.map_err(|e| e.to_string())?;
        if status != 200 || model.role == "decision" {
            return Ok(super::JevResponse {
                status,
                retry_after: None,
                body: text,
                from_openai: None,
                from_anthropic: None,
            });
        }
        let data: Value = serde_json::from_str(&text)
            .map_err(|_| "Local extraction returned an invalid response.")?;
        let choice = &data["choices"][0];
        if !choice["message"]["content"].is_string()
            || !matches!(choice["finish_reason"].as_str(), Some("stop" | "length"))
        {
            return Err("Local extraction returned an incomplete response.".into());
        }
        reply(
            json!({"model": model.name, "done": true, "done_reason": choice["finish_reason"], "message": {"role": "assistant", "content": choice["message"]["content"], "thinking": choice["message"]["reasoning_content"].as_str().unwrap_or("")}}),
        )
    }
}

#[tauri::command]
pub async fn local_ai_status(manager: tauri::State<'_, LocalAi>) -> Result<PackStatus, String> {
    Ok(manager.status())
}
#[tauri::command]
pub async fn local_ai_install(manager: tauri::State<'_, LocalAi>) -> Result<PackStatus, String> {
    manager.install().await
}
#[tauri::command]
pub async fn local_ai_cancel(manager: tauri::State<'_, LocalAi>) -> Result<(), String> {
    manager.cancel().await
}
#[tauri::command]
pub async fn local_ai_stop(manager: tauri::State<'_, LocalAi>) -> Result<(), String> {
    manager.stop();
    Ok(())
}
#[tauri::command]
pub async fn local_ai_remove(manager: tauri::State<'_, LocalAi>) -> Result<(), String> {
    manager.remove().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    struct Sandbox(PathBuf);
    impl Sandbox {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let dir = std::env::temp_dir().join(format!(
                "wilmai-native-test-{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }
    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn fixture(url: String, digest: String) -> Model {
        Model {
            name: "fixture".into(),
            file: "fixture.gguf".into(),
            url,
            sha256: digest,
            bytes: 10,
            role: "reading".into(),
            parameter_size: "tiny".into(),
        }
    }
    async fn download_fixture(resume: bool, honor_range: bool, valid_hash: bool) {
        let root = Sandbox::new();
        let manager = LocalAi::new(root.0.clone(), root.0.clone());
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/weights", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut buf = [0; 2048];
            let count = socket.read(&mut buf).unwrap();
            let request = String::from_utf8_lossy(&buf[..count]).to_lowercase();
            assert_eq!(request.contains("range: bytes=4-"), resume);
            let response = if resume && honor_range {
                "HTTP/1.1 206 Partial Content\r\nContent-Length: 6\r\nContent-Range: bytes 4-9/10\r\nConnection: close\r\n\r\n456789"
            } else {
                "HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\n0123456789"
            };
            socket.write_all(response.as_bytes()).unwrap();
        });
        let model = fixture(
            url,
            if valid_hash {
                format!("{:x}", Sha256::digest(b"0123456789"))
            } else {
                "0".repeat(64)
            },
        );
        if resume {
            std::fs::write(manager.partial(&model), b"0123").unwrap();
        }
        let result = manager
            .download(
                &model,
                &reqwest::Client::builder().no_proxy().build().unwrap(),
            )
            .await;
        server.join().unwrap();
        if valid_hash {
            result.unwrap();
            assert_eq!(
                std::fs::read(root.0.join(&model.file)).unwrap(),
                b"0123456789"
            );
        } else {
            assert!(result.unwrap_err().contains("verification failed"));
            assert!(!root.0.join(&model.file).exists());
        }
        assert!(!manager.partial(&model).exists());
    }
    #[tokio::test]
    async fn download_resumes_and_verifies() {
        download_fixture(true, true, true).await;
    }
    #[tokio::test]
    async fn ignored_range_restarts_without_duplicate_bytes() {
        download_fixture(true, false, true).await;
    }
    #[tokio::test]
    async fn invalid_hash_removes_unusable_weights() {
        download_fixture(false, false, false).await;
    }
    #[tokio::test]
    async fn removal_is_owned_and_reaps_worker() {
        let root = Sandbox::new();
        let owned = root.0.join("owned");
        let other = root.0.join("other-models");
        std::fs::create_dir_all(&owned).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(other.join("existing-model"), "keep").unwrap();
        std::fs::write(owned.join("partial.gguf"), "remove").unwrap();
        let manager = LocalAi::new(owned.clone(), root.0.clone());
        let child = Command::new("/bin/sleep").arg("60").spawn().unwrap();
        let pid = child.id();
        *manager.0.worker.lock().unwrap() = Some(Worker {
            process_group: false,
            child,
            model: pack().models[0].name.clone(),
            endpoint: String::new(),
            key: String::new(),
        });
        manager.remove().await.unwrap();
        assert!(!owned.exists());
        assert_eq!(
            std::fs::read_to_string(other.join("existing-model")).unwrap(),
            "keep"
        );
        assert!(manager.0.worker.lock().unwrap().is_none());
        assert!(!Command::new("/bin/kill")
            .args(["-0", &pid.to_string()])
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success());
    }

    #[tokio::test]
    async fn updating_blocks_new_model_work_and_failure_can_resume() {
        let root = Sandbox::new();
        let manager = LocalAi::new(root.0.clone(), root.0.join("assets"));
        manager.shutdown();
        assert!(manager.install().await.err().unwrap().contains("paused"));
        let error = manager
            .load(&pack().models[0], manager.0.epoch.load(Ordering::Acquire))
            .await
            .unwrap_err();
        assert!(error.contains("paused"));
        manager.resume_after_update_failure();
        let error = manager
            .load(&pack().models[0], manager.0.epoch.load(Ordering::Acquire))
            .await
            .unwrap_err();
        assert!(
            !error.contains("paused"),
            "normal setup/requirements checks work again after a failed update"
        );
    }
    #[test]
    fn crashed_parent_does_not_leave_runtime_behind() {
        let mut parent = Command::new("/bin/sleep").arg("60").spawn().unwrap();
        let mut guard = guarded_command(Path::new("/bin/sleep"), parent.id())
            .arg("60")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        std::thread::sleep(Duration::from_millis(100));
        let output = Command::new("/bin/ps")
            .args(["-axo", "pid=,ppid="])
            .output()
            .unwrap();
        let children: Vec<String> = String::from_utf8(output.stdout)
            .unwrap()
            .lines()
            .filter_map(|line| {
                let fields: Vec<_> = line.split_whitespace().collect();
                (fields.len() == 2 && fields[1] == guard.id().to_string())
                    .then(|| fields[0].to_owned())
            })
            .collect();
        if children.is_empty() {
            unsafe {
                libc::kill(-(guard.id() as i32), libc::SIGKILL);
            }
            guard.wait().unwrap();
            parent.kill().unwrap();
            parent.wait().unwrap();
            panic!("guard did not start a child");
        }
        parent.kill().unwrap();
        parent.wait().unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while guard.try_wait().unwrap().is_none() {
            if std::time::Instant::now() > deadline {
                unsafe {
                    libc::kill(-(guard.id() as i32), libc::SIGKILL);
                }
                guard.wait().unwrap();
                panic!("runtime guard did not exit after parent death");
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        for pid in children {
            assert!(!Command::new("/bin/kill")
                .args(["-0", &pid])
                .stderr(Stdio::null())
                .status()
                .unwrap()
                .success());
        }
    }
    /// Actual consumer downloader/runtime; opt-in because this transfers 9.1 GB.
    /// Models live only in a disposable directory, even on assertion failure.
    #[tokio::test]
    #[ignore]
    async fn live_small_setup_and_inference() {
        let root = Sandbox::new();
        let assets = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/local-ai");
        let manager = LocalAi::new(root.0.clone(), assets);
        struct StopOnDrop(LocalAi);
        impl Drop for StopOnDrop {
            fn drop(&mut self) {
                self.0.shutdown();
            }
        }
        let _stop = StopOnDrop(manager.clone());
        manager.install().await.unwrap();
        let mut last = String::new();
        loop {
            let status = manager.status();
            let progress = format!(
                "{}: {:.1} / {:.1} GB",
                status.phase,
                status.downloaded_bytes as f64 / 1e9,
                status.total_bytes as f64 / 1e9
            );
            if progress != last {
                println!("{progress}");
                last = progress;
            }
            if status.phase == "ready" {
                break;
            }
            assert!(status.error.is_none(), "{:?}", status.error);
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        let call = |path: &'static str, body| {
            let manager = manager.clone();
            async move {
                let response = manager.call(path, body).await.unwrap();
                assert_eq!(response.status, 200, "{}", response.body);
                serde_json::from_str::<Value>(&response.body).unwrap()
            }
        };
        let decision = &pack().models[0].name;
        let reading = &pack().models[1].name;
        let answer = call("/v1/systemone", Some(json!({"model": decision, "state": "Hyvää huomenta!", "questions": {"finnish": {"type": "noul", "instructions": "Is this text in Finnish?"}}}))).await;
        assert!(answer["answers"]["finnish"]["noul"].as_f64().unwrap() > 0.5);
        let endpoint = manager
            .0
            .worker
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .endpoint
            .clone();
        assert_eq!(
            local_http()
                .post(format!("{endpoint}/v1/systemone"))
                .json(&json!({}))
                .send()
                .await
                .unwrap()
                .status()
                .as_u16(),
            401
        );
        call(
            "/api/generate",
            Some(json!({"model": decision, "keep_alive": 0})),
        )
        .await;
        assert!(manager.resident()["models"].as_array().unwrap().is_empty());
        let answer = call("/api/chat", Some(json!({"model": reading, "think": false, "options": {"num_predict": 256}, "format": {"type": "object", "required": ["maximum"], "additionalProperties": false, "properties": {"maximum": {"type": "string"}}}, "messages": [{"role": "user", "content": "Read the maximum from the exam mark 24/25. Return JSON: {\"maximum\":\"25\"}."}]}))).await;
        assert_eq!(
            serde_json::from_str::<Value>(answer["message"]["content"].as_str().unwrap()).unwrap()
                ["maximum"],
            "25"
        );
        call(
            "/api/generate",
            Some(json!({"model": reading, "keep_alive": 0})),
        )
        .await;
        manager.remove().await.unwrap();
        assert!(!root.0.exists());
        println!(
            "Both local roles passed; authentication enforced; worker and test models removed."
        );
    }
}
