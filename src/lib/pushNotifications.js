/**
 * Push Notifications helper
 * Uses the Notifications API for in-browser notifications.
 * Service worker (public/sw.js) handles background push when available.
 */

const PREF_KEY = 'otx_notif_prefs';

export function getNotifPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveNotifPrefs(prefs) {
  localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
}

export async function requestPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  const result = await Notification.requestPermission();
  return result;
}

export function getPermissionStatus() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

export function showNotification(title, options = {}) {
  if (Notification.permission !== 'granted') return;
  const n = new Notification(title, {
    icon: '/logo.jpeg',
    badge: '/logo.jpeg',
    dir: 'rtl',
    lang: 'he',
    ...options,
  });
  n.onclick = () => {
    window.focus();
    if (options.url) window.location.href = options.url;
    n.close();
  };
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    return reg;
  } catch (err) {
    console.warn('[SW] Registration failed:', err);
    return null;
  }
}

/** Check if we should send a notification based on user prefs */
export function shouldNotify(category) {
  const prefs = getNotifPrefs();
  if (!prefs.enabled) return false;
  if (prefs[category] === false) return false;
  return true;
}
