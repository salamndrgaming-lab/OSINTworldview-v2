use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A single tab in the browser.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tab {
    pub id: String,
    pub url: String,
    pub title: String,
    pub favicon: Option<String>,
    pub is_loading: bool,
    /// Per-tab back stack. Most recent URL last.
    pub history: Vec<String>,
    /// Per-tab forward stack (populated after a back).
    pub forward: Vec<String>,
}

impl Tab {
    pub fn new(url: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            url: url.clone(),
            title: "New Tab".to_string(),
            favicon: None,
            is_loading: false,
            history: vec![url],
            forward: Vec::new(),
        }
    }
}

/// Global browser state shared across Tauri commands.
#[derive(Debug, Default)]
pub struct BrowserState {
    inner: Mutex<BrowserInner>,
}

#[derive(Debug, Default)]
struct BrowserInner {
    tabs: Vec<Tab>,
    active_tab_id: Option<String>,
}

impl BrowserState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn tabs(&self) -> Vec<Tab> {
        self.inner.lock().tabs.clone()
    }

    pub fn active_tab_id(&self) -> Option<String> {
        self.inner.lock().active_tab_id.clone()
    }

    pub fn open_tab(&self, url: String) -> Tab {
        let mut inner = self.inner.lock();
        let tab = Tab::new(url);
        inner.tabs.push(tab.clone());
        inner.active_tab_id = Some(tab.id.clone());
        tab
    }

    pub fn close_tab(&self, id: &str) -> Option<String> {
        let mut inner = self.inner.lock();
        let pos = inner.tabs.iter().position(|t| t.id == id)?;
        inner.tabs.remove(pos);

        // Update active tab if we just closed it.
        if inner.active_tab_id.as_deref() == Some(id) {
            let new_active = inner
                .tabs
                .get(pos.saturating_sub(0).min(inner.tabs.len().saturating_sub(1)))
                .or_else(|| inner.tabs.last())
                .map(|t| t.id.clone());
            inner.active_tab_id = new_active.clone();
            return new_active;
        }
        inner.active_tab_id.clone()
    }

    pub fn activate_tab(&self, id: &str) -> bool {
        let mut inner = self.inner.lock();
        if inner.tabs.iter().any(|t| t.id == id) {
            inner.active_tab_id = Some(id.to_string());
            true
        } else {
            false
        }
    }

    pub fn navigate_active(&self, url: String) -> Option<Tab> {
        let mut inner = self.inner.lock();
        let active_id = inner.active_tab_id.clone()?;
        let tab = inner.tabs.iter_mut().find(|t| t.id == active_id)?;
        if tab.url != url {
            tab.history.push(url.clone());
            tab.forward.clear();
        }
        tab.url = url;
        tab.is_loading = true;
        Some(tab.clone())
    }

    pub fn go_back(&self) -> Option<Tab> {
        let mut inner = self.inner.lock();
        let active_id = inner.active_tab_id.clone()?;
        let tab = inner.tabs.iter_mut().find(|t| t.id == active_id)?;
        if tab.history.len() < 2 {
            return None;
        }
        let current = tab.history.pop()?;
        tab.forward.push(current);
        let prev = tab.history.last()?.clone();
        tab.url = prev;
        tab.is_loading = true;
        Some(tab.clone())
    }

    pub fn go_forward(&self) -> Option<Tab> {
        let mut inner = self.inner.lock();
        let active_id = inner.active_tab_id.clone()?;
        let tab = inner.tabs.iter_mut().find(|t| t.id == active_id)?;
        let next = tab.forward.pop()?;
        tab.history.push(next.clone());
        tab.url = next;
        tab.is_loading = true;
        Some(tab.clone())
    }

    pub fn reload(&self) -> Option<Tab> {
        let mut inner = self.inner.lock();
        let active_id = inner.active_tab_id.clone()?;
        let tab = inner.tabs.iter_mut().find(|t| t.id == active_id)?;
        tab.is_loading = true;
        Some(tab.clone())
    }

    pub fn set_tab_meta(
        &self,
        id: &str,
        title: Option<String>,
        favicon: Option<String>,
        is_loading: Option<bool>,
    ) -> Option<Tab> {
        let mut inner = self.inner.lock();
        let tab = inner.tabs.iter_mut().find(|t| t.id == id)?;
        if let Some(t) = title {
            tab.title = t;
        }
        if let Some(f) = favicon {
            tab.favicon = Some(f);
        }
        if let Some(l) = is_loading {
            tab.is_loading = l;
        }
        Some(tab.clone())
    }
}
