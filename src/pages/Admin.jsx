import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ArenaPage, Panel } from "../components/Layout.jsx";

export function Admin() {
  const [data, setData] = useState(null);
  const [place, setPlace] = useState({ userId: "", leagueId: "", applicationId: "" });
  const [fixture, setFixture] = useState({ leagueId: "", week: "1", homeId: "", awayId: "", date: "" });
  const [news, setNews] = useState({ title: "", body: "" });
  const [msg, setMsg] = useState("");

  function load() {
    api("/api/admin/overview").then(setData).catch(() => {});
  }

  useEffect(load, []);

  async function placePlayer(e) {
    e.preventDefault();
    await api("/api/admin/place-player", { method: "POST", body: JSON.stringify(place) });
    setMsg("Player placed.");
    load();
  }

  async function createFixture(e) {
    e.preventDefault();
    await api("/api/admin/fixtures", { method: "POST", body: JSON.stringify(fixture) });
    setMsg("Fixture created.");
    load();
  }

  async function postNews(e) {
    e.preventDefault();
    await api("/api/admin/announcements", { method: "POST", body: JSON.stringify(news) });
    setNews({ title: "", body: "" });
    setMsg("Announcement posted.");
    load();
  }

  if (!data) {
    return (
      <ArenaPage>
        <p className="text-primary">Loading admin…</p>
      </ArenaPage>
    );
  }

  const players = data.users.filter((u) => u.role === "player");

  return (
    <ArenaPage>
      <h1 className="text-4xl font-extrabold">League Admin</h1>
      <p className="mt-2 text-muted-foreground">Place players, schedule matches, and post news. This is how you run TSH week to week.</p>
      {msg ? <p className="mt-3 text-sm text-primary">{msg}</p> : null}

      <div className="mt-6 grid gap-4 md:grid-cols-4">
        {[
          [data.stats.activePlayers, "Players"],
          [data.stats.divisions, "Divisions"],
          [data.applications.filter((a) => a.status === "pending").length, "Pending apps"],
          [data.fixtures.filter((f) => f.status === "scheduled").length, "Open fixtures"],
        ].map(([v, l]) => (
          <Panel key={l} className="text-center">
            <div className="text-3xl font-extrabold text-primary">{v}</div>
            <div className="mt-1 text-xs tracking-widest text-muted-foreground">{l.toUpperCase()}</div>
          </Panel>
        ))}
      </div>

      <Panel className="mt-6">
        <h2 className="text-lg font-bold">Pending applications</h2>
        <div className="mt-3 space-y-2 text-sm">
          {data.applications.length === 0 ? <p className="text-muted-foreground">None yet.</p> : null}
          {data.applications.map((a) => (
            <div key={a.id} className="flex flex-wrap justify-between gap-2 border-b border-border/50 py-2">
              <span>
                {a.name} · avg {a.avg} · {a.status}
              </span>
              <span className="text-muted-foreground">{a.dartcounterName}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="mt-4">
        <h2 className="text-lg font-bold">Place a player</h2>
        <form className="mt-3 grid gap-3 md:grid-cols-3" onSubmit={placePlayer}>
          <select className="px-3 py-2" value={place.userId} onChange={(e) => setPlace({ ...place, userId: e.target.value })} required>
            <option value="">Player</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select className="px-3 py-2" value={place.leagueId} onChange={(e) => setPlace({ ...place, leagueId: e.target.value })} required>
            <option value="">League</option>
            {data.leagues.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} (#{l.regionalId})
              </option>
            ))}
          </select>
          <button className="rounded-md bg-primary py-2 text-xs font-bold tracking-widest text-primary-foreground">PLACE</button>
        </form>
      </Panel>

      <Panel className="mt-4">
        <h2 className="text-lg font-bold">Create fixture</h2>
        <form className="mt-3 grid gap-3 md:grid-cols-5" onSubmit={createFixture}>
          <select className="px-3 py-2" value={fixture.leagueId} onChange={(e) => setFixture({ ...fixture, leagueId: e.target.value })} required>
            <option value="">League</option>
            {data.leagues.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <input className="px-3 py-2" placeholder="Week" value={fixture.week} onChange={(e) => setFixture({ ...fixture, week: e.target.value })} />
          <select className="px-3 py-2" value={fixture.homeId} onChange={(e) => setFixture({ ...fixture, homeId: e.target.value })} required>
            <option value="">Home</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select className="px-3 py-2" value={fixture.awayId} onChange={(e) => setFixture({ ...fixture, awayId: e.target.value })} required>
            <option value="">Away</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input className="px-3 py-2" type="date" value={fixture.date} onChange={(e) => setFixture({ ...fixture, date: e.target.value })} />
          <button className="rounded-md bg-primary py-2 text-xs font-bold tracking-widest text-primary-foreground md:col-span-5">ADD FIXTURE</button>
        </form>
      </Panel>

      <Panel className="mt-4">
        <h2 className="text-lg font-bold">Post announcement</h2>
        <form className="mt-3 space-y-3" onSubmit={postNews}>
          <input className="w-full px-3 py-2" placeholder="Title" value={news.title} onChange={(e) => setNews({ ...news, title: e.target.value })} required />
          <textarea className="w-full px-3 py-2" rows="3" placeholder="Body" value={news.body} onChange={(e) => setNews({ ...news, body: e.target.value })} required />
          <button className="rounded-md bg-primary px-4 py-2 text-xs font-bold tracking-widest text-primary-foreground">PUBLISH</button>
        </form>
      </Panel>
    </ArenaPage>
  );
}
