use crate::browser::{BrowserState, Tab};
use serde::Serialize;
use std::time::Duration;
use tauri::{Manager, State, WebviewWindow};

#[derive(Debug, thiserror::Error, Serialize)]
pub enum CommandError {
    #[error("invalid URL: {0}")]
    InvalidUrl(String),
    #[error("no active tab")]
    NoActiveTab,
    #[error("tab not found: {0}")]
    TabNotFound(String),
    #[error("network error: {0}")]
    Network(String),
    #[error("window not found")]
    WindowNotFound,
}

type CommandResult<T> = Result<T, CommandError>;

fn normalize_url(raw: &str) -> Result<String, CommandError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(CommandError::InvalidUrl("empty".into()));
    }

    // Already absolute
    if trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("asset://")
        || trimmed.starts_with("file://")
        || trimmed.starts_with("about:")
    {
        return Ok(trimmed.to_string());
    }

    // Heuristic: bare domain (foo.bar) or IP => https
    let looks_like_domain =
        trimmed.contains('.') && !trimmed.contains(' ') && !trimmed.contains('\n');

    if looks_like_domain {
        return Ok(format!("https://{}", trimmed));
    }

    // Fall through to Google search
    let encoded = urlencode(trimmed);
    Ok(format!("https://www.google.com/search?q={}", encoded))
}

fn urlencode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => out.push(ch),
            ' ' => out.push('+'),
            _ => {
                let mut buf = [0u8; 4];
                let encoded = ch.encode_utf8(&mut buf);
                for b in encoded.bytes() {
                    out.push_str(&format!("%{:02X}", b));
                }
            }
        }
    }
    out
}

#[tauri::command]
pub fn navigate(url: String, state: State<'_, BrowserState>) -> CommandResult<Tab> {
    let normalized = normalize_url(&url)?;
    state
        .navigate_active(normalized)
        .ok_or(CommandError::NoActiveTab)
}

#[tauri::command]
pub fn new_tab(url: Option<String>, state: State<'_, BrowserState>) -> CommandResult<Tab> {
    let target = match url {
        Some(u) if !u.trim().is_empty() => normalize_url(&u)?,
        _ => "asset://localhost/homepage/index.html".to_string(),
    };
    Ok(state.open_tab(target))
}

#[tauri::command]
pub fn close_tab(id: String, state: State<'_, BrowserState>) -> CommandResult<Option<String>> {
    Ok(state.close_tab(&id))
}

#[tauri::command]
pub fn activate_tab(id: String, state: State<'_, BrowserState>) -> CommandResult<bool> {
    let ok = state.activate_tab(&id);
    if !ok {
        return Err(CommandError::TabNotFound(id));
    }
    Ok(true)
}

#[tauri::command]
pub fn get_tabs(state: State<'_, BrowserState>) -> CommandResult<Vec<Tab>> {
    Ok(state.tabs())
}

#[tauri::command]
pub fn get_active_tab_id(state: State<'_, BrowserState>) -> CommandResult<Option<String>> {
    Ok(state.active_tab_id())
}

#[tauri::command]
pub fn go_back(state: State<'_, BrowserState>) -> CommandResult<Option<Tab>> {
    Ok(state.go_back())
}

#[tauri::command]
pub fn go_forward(state: State<'_, BrowserState>) -> CommandResult<Option<Tab>> {
    Ok(state.go_forward())
}

#[tauri::command]
pub fn reload(state: State<'_, BrowserState>) -> CommandResult<Option<Tab>> {
    Ok(state.reload())
}

#[tauri::command]
pub fn set_tab_meta(
    id: String,
    title: Option<String>,
    favicon: Option<String>,
    is_loading: Option<bool>,
    state: State<'_, BrowserState>,
) -> CommandResult<Option<Tab>> {
    Ok(state.set_tab_meta(&id, title, favicon, is_loading))
}

/// Proxy HTTP fetches from Rust to sidestep webview CORS restrictions.
/// Returns the response body as a UTF-8 string. Non-text responses are lossy-decoded.
#[tauri::command]
pub async fn fetch_intel(url: String) -> CommandResult<String> {
    let parsed = url::Url::parse(&url).map_err(|e| CommandError::InvalidUrl(e.to_string()))?;

    // Basic scheme allowlist.
    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(CommandError::InvalidUrl(format!("unsupported scheme: {other}"))),
    }

    let client = reqwest::Client::builder()
        .user_agent("MonitorBrowser/1.0 (+https://osint-worldview.vercel.app)")
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| CommandError::Network(e.to_string()))?;

    let resp = client
        .get(parsed)
        .header("accept", "application/json, text/plain, */*")
        .send()
        .await
        .map_err(|e| CommandError::Network(e.to_string()))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| CommandError::Network(e.to_string()))?;

    if !status.is_success() {
        return Err(CommandError::Network(format!(
            "HTTP {}: {}",
            status.as_u16(),
            body.chars().take(200).collect::<String>()
        )));
    }

    Ok(body)
}

#[tauri::command]
pub fn open_devtools(window: WebviewWindow) -> CommandResult<()> {
    #[cfg(debug_assertions)]
    {
        if window.is_devtools_open() {
            window.close_devtools();
        } else {
            window.open_devtools();
        }
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = window;
    }
    Ok(())
}

#[tauri::command]
pub fn window_minimize(app: tauri::AppHandle) -> CommandResult<()> {
    let win = app
        .get_webview_window("main")
        .ok_or(CommandError::WindowNotFound)?;
    win.minimize().map_err(|e| CommandError::Network(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub fn window_toggle_maximize(app: tauri::AppHandle) -> CommandResult<()> {
    let win = app
        .get_webview_window("main")
        .ok_or(CommandError::WindowNotFound)?;
    let maximized = win
        .is_maximized()
        .map_err(|e| CommandError::Network(e.to_string()))?;
    if maximized {
        win.unmaximize()
            .map_err(|e| CommandError::Network(e.to_string()))?;
    } else {
        win.maximize()
            .map_err(|e| CommandError::Network(e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub fn window_close(app: tauri::AppHandle) -> CommandResult<()> {
    let win = app
        .get_webview_window("main")
        .ok_or(CommandError::WindowNotFound)?;
    win.close().map_err(|e| CommandError::Network(e.to_string()))?;
    Ok(())
}
