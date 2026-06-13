self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(clients.claim()));

self.addEventListener("push", (e) => {
  if (!e.data) return;
  let data;
  try { data = JSON.parse(e.data.text()); }
  catch { data = { title: "WC2026", body: e.data.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || "⚽ WC2026", {
    body: data.body || "Time to predict!",
    icon: "/favicon.ico",
    tag: "wc2026",
    vibrate: [200, 100, 200],
    data: { url: "/" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type:"window" }).then(list => {
    for (const c of list) if ("focus" in c) return c.focus();
    if (clients.openWindow) return clients.openWindow("/");
  }));
});
