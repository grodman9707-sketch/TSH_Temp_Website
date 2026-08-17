import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ArenaPage, Panel } from "../components/Layout.jsx";

export function MyMatches() {
  const [fixtures, setFixtures] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ homeLegs: "", awayLegs: "", oneEighties: "", topCheckout: "" });
  const [error, setError] = useState("");

  function load() {
    api("/api/my-fixtures").then((d) => setFixtures(d.fixtures)).catch(() => {});
  }

  useEffect(load, []);

  async function submit(e) {
    e.preventDefault();
    setError("");
    try {
      await api(`/api/my-fixtures/${editing}/result`, { method: "POST", body: JSON.stringify(form) });
      setEditing(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <ArenaPage>
      <h1 className="text-3xl font-extrabold">My Matches</h1>
      <p className="mt-2 text-sm text-muted-foreground">Play on DartCounter, then enter the legs here so the table updates.</p>
      <div className="mt-6 space-y-3">
        {fixtures.map((f) => (
          <Panel key={f.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  {f.leagueName} · Week {f.week} · {f.date}
                </div>
                <div className="mt-1 text-lg font-semibold">
                  {f.homeName} vs {f.awayName}
                </div>
              </div>
              {f.status === "played" ? (
                <div className="text-2xl font-extrabold text-primary">
                  {f.homeLegs} – {f.awayLegs}
                </div>
              ) : (
                <button
                  className="rounded-md bg-primary px-4 py-2 text-xs font-bold tracking-widest text-primary-foreground"
                  onClick={() => {
                    setEditing(f.id);
                    setForm({ homeLegs: "", awayLegs: "", oneEighties: "", topCheckout: "" });
                  }}
                >
                  ENTER RESULT
                </button>
              )}
            </div>
            {editing === f.id ? (
              <form className="mt-4 grid gap-3 md:grid-cols-4" onSubmit={submit}>
                <input className="px-3 py-2" placeholder="Home legs" value={form.homeLegs} onChange={(e) => setForm({ ...form, homeLegs: e.target.value })} required />
                <input className="px-3 py-2" placeholder="Away legs" value={form.awayLegs} onChange={(e) => setForm({ ...form, awayLegs: e.target.value })} required />
                <input className="px-3 py-2" placeholder="180s" value={form.oneEighties} onChange={(e) => setForm({ ...form, oneEighties: e.target.value })} />
                <input className="px-3 py-2" placeholder="Top checkout" value={form.topCheckout} onChange={(e) => setForm({ ...form, topCheckout: e.target.value })} />
                <button className="rounded-md bg-primary py-2 text-xs font-bold tracking-widest text-primary-foreground md:col-span-4">SAVE RESULT</button>
                {error ? <p className="text-sm text-red-400 md:col-span-4">{error}</p> : null}
              </form>
            ) : null}
          </Panel>
        ))}
      </div>
    </ArenaPage>
  );
}
