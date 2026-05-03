// OTX Service Worker
// Handles push events and notification clicks

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'OTX', body: event.data.text() };
  }

  const options = {
    body: payload.body || '',
    icon: '/logo.jpeg',
    badge: '/logo.jpeg',
    dir: 'rtl',
    lang: 'he',
    data: { url: payload.url || '/' },
    actions: payload.actions || [],
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'OTX', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(self.location.origin));
      if (existing) {
        existing.focus();
        existing.navigate(url);
      } else {
        self.clients.openWindow(url);
      }
    })
  );
});
