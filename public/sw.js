// Lock-screen alerts for TSH Darts League. No fetch handler, so page loads stay
// on the network. iPhone only delivers these after Add to Home Screen (iOS 16.4+).

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "TSH Darts League";
  const body = data.body || "You have a match update.";
  const url = data.url || "/my-matches";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: { url },
      icon: "/images/tsh-main-crest.png",
      badge: "/images/tsh-main-crest.png",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/my-matches", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (!client.url.startsWith(self.location.origin)) continue;
        if ("navigate" in client) {
          try {
            await client.navigate(target);
          } catch {
            /* keep the open page if navigation is blocked */
          }
        }
        return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })()
  );
});
