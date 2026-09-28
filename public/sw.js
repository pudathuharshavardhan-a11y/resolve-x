self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  event.waitUntil(self.registration.showNotification(data.title || "Resolve-X alert", {
    body: data.body || "A new incident has been reported.",
    icon: "/icon.svg",
    badge: "/icon.svg",
    data: { incidentId: data.incidentId || "" },
    requireInteraction: true
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const id = event.notification.data?.incidentId || "";
  event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list => {
    const url = "/?incident=" + encodeURIComponent(id);
    for (const c of list) if ("focus" in c) { c.navigate(url); return c.focus(); }
    return clients.openWindow(url);
  }));
});
