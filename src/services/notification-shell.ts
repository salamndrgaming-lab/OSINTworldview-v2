/**
 * Notification Shell Service
 * 
 * Provides the notification bell UI, dropdown panel, and a public API
 * for other services to push notifications. This is the infrastructure
 * layer — actual notification sources (breaking news, threat alerts,
 * watchlist matches, market moves) get wired in separately.
 * 
 * Notifications are stored in memory (not persisted across sessions
 * intentionally — stale notifications are worse than no notifications).
 */

export interface AppNotification {
  id: string;
  type: 'threat' | 'intel' | 'market' | 'system';
  title: string;
  body: string;
  timestamp: number;
  /** Optional: which panel to focus when clicked */
  panelId?: string;
  /** Whether the user has seen this notification */
  read: boolean;
}

const MAX_NOTIFICATIONS = 50;
let notifications: AppNotification[] = [];
let isDropdownOpen = false;

/** Type icons by category */
const TYPE_ICONS: Record<AppNotification['type'], string> = {
  threat: '⚠',
  intel: '🔍',
  market: '📊',
  system: '⚙',
};

/** Push a new notification (called by other services) */
export function pushNotification(
  type: AppNotification['type'],
  title: string,
  body: string,
  panelId?: string
): void {
  const notification: AppNotification = {
    id: `notif-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    title,
    body,
    timestamp: Date.now(),
    panelId,
    read: false,
  };

  notifications.unshift(notification);

  // Trim to max
  if (notifications.length > MAX_NOTIFICATIONS) {
    notifications = notifications.slice(0, MAX_NOTIFICATIONS);
  }

  updateBadgeCount();
  
  // If dropdown is open, refresh it
  if (isDropdownOpen) {
    renderDropdownBody();
  }

  // Dispatch event for external listeners
  window.dispatchEvent(new CustomEvent('notification-pushed', { detail: notification }));
}

/** Get unread count */
export function getUnreadCount(): number {
  return notifications.filter(n => !n.read).length;
}

/** Mark all as read */
export function markAllRead(): void {
  for (const n of notifications) n.read = true;
  updateBadgeCount();
}

/** Clear all notifications */
export function clearAll(): void {
  notifications = [];
  updateBadgeCount();
  if (isDropdownOpen) renderDropdownBody();
}

/** Render the notification bell HTML (injected into header) */
export function renderNotificationBell(): string {
  const count = getUnreadCount();
  return `<div class="notification-bell-wrapper" style="position:relative">
    <button class="notification-bell" id="notifBellBtn" title="Notifications" aria-label="Notifications">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg>
      <span class="notif-badge" id="notifBadge" data-count="${count}">${count > 0 ? count : ''}</span>
    </button>
    <div class="notification-dropdown" id="notifDropdown">
      <div class="notification-dropdown-header">
        <span>Notifications</span>
        <button class="notif-clear-btn" id="notifClearBtn">Clear all</button>
      </div>
      <div class="notification-dropdown-body" id="notifDropdownBody"></div>
    </div>
  </div>`;
}

/** Initialize notification bell event listeners */
export function initNotificationBell(): void {
  const bellBtn = document.getElementById('notifBellBtn');
  const dropdown = document.getElementById('notifDropdown');
  const clearBtn = document.getElementById('notifClearBtn');

  if (!bellBtn || !dropdown) return;

  // Toggle dropdown
  bellBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    isDropdownOpen = !isDropdownOpen;
    dropdown.classList.toggle('open', isDropdownOpen);
    if (isDropdownOpen) {
      markAllRead();
      renderDropdownBody();
    }
  });

  // Clear all
  clearBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    clearAll();
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (isDropdownOpen && !dropdown.contains(e.target as Node) && e.target !== bellBtn) {
      isDropdownOpen = false;
      dropdown.classList.remove('open');
    }
  });

  // Initial render
  renderDropdownBody();

  // Push a welcome notification so the bell isn't empty on first load
  setTimeout(() => {
    if (notifications.length === 0) {
      pushNotification(
        'system',
        'Welcome to OSINTview',
        'Notifications will appear here for threat alerts, market moves, and intelligence updates.'
      );
    }
  }, 3000);
}

/** Update the badge count in the DOM */
function updateBadgeCount(): void {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  const count = getUnreadCount();
  badge.dataset.count = String(count);
  badge.textContent = count > 0 ? String(count) : '';
}

/** Render the dropdown body content */
function renderDropdownBody(): void {
  const body = document.getElementById('notifDropdownBody');
  if (!body) return;

  if (notifications.length === 0) {
    body.innerHTML = `<div class="notification-dropdown-empty">
      <span class="notif-empty-icon">🔔</span>
      <span>No notifications yet</span>
    </div>`;
    return;
  }

  body.innerHTML = notifications.map(n => {
    const age = formatAge(n.timestamp);
    return `<div class="notification-item${n.read ? '' : ' unread'}" data-notif-id="${n.id}"${n.panelId ? ` data-panel="${n.panelId}"` : ''}>
      <div class="notif-icon ${n.type}">${TYPE_ICONS[n.type]}</div>
      <div class="notif-content">
        <div class="notif-title">${escapeHtml(n.title)}</div>
        <div class="notif-body">${escapeHtml(n.body)}</div>
        <div class="notif-time">${age}</div>
      </div>
    </div>`;
  }).join('');

  // Click handler for individual notifications
  body.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.notification-item') as HTMLElement;
    if (!item) return;
    const panelId = item.dataset.panel;
    if (panelId) {
      // Scroll to the referenced panel
      const panelEl = document.querySelector(`[data-panel="${panelId}"]`);
      if (panelEl) panelEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Close dropdown
      isDropdownOpen = false;
      document.getElementById('notifDropdown')?.classList.remove('open');
    }
  });
}

/** Format a timestamp as "2m ago", "1h ago", etc. */
function formatAge(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Basic HTML escaping */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
