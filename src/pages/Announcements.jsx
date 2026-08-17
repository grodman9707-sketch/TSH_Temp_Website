import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ArenaPage, Panel } from "../components/Layout.jsx";

export function Announcements() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    api("/api/announcements").then((d) => setItems(d.announcements)).catch(() => {});
  }, []);

  return (
    <ArenaPage>
      <h1 className="text-3xl font-extrabold">News</h1>
      <div className="mt-6 space-y-3">
        {items.map((item) => (
          <Panel key={item.id}>
            <div className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleDateString()}</div>
            <h2 className="mt-1 text-xl font-bold">{item.title}</h2>
            <p className="mt-2 text-sm text-white/80">{item.body}</p>
          </Panel>
        ))}
      </div>
    </ArenaPage>
  );
}
