/*
 * Service worker di My Planner: riceve le notifiche push e apre il task al
 * clic. Non fa caching (l'app resta servita dalla rete come prima).
 * Il payload arriva cifrato dal server (Web Push) e il browser lo decifra:
 * qui e' gia' JSON { title, body, url, tag }.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "My Planner";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || undefined,
      // Stesso tag = stessa notifica aggiornata; renotify la fa suonare di nuovo.
      renotify: Boolean(data.tag),
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Riusa una finestra dell'app gia' aperta, altrimenti ne apre una nuova.
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          await client.focus();
          if ("navigate" in client) return client.navigate(target);
          return;
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});

// Il browser ha rinnovato la subscription: il profilo la registrera' di nuovo
// alla prossima apertura dell'app (vedi lib/push.ts, syncPushSubscription).
self.addEventListener("pushsubscriptionchange", () => {});
