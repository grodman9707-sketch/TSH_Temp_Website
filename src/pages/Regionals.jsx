import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Globe, Search } from "lucide-react";
import { api } from "../lib/api.js";
import { ArenaPage, Panel } from "../components/Layout.jsx";

export function Regionals() {
  const [regionals, setRegionals] = useState([]);
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("All Regions");

  useEffect(() => {
    api("/api/regionals").then((d) => setRegionals(d.regionals)).catch(() => {});
  }, []);

  const options = ["All Regions", ...new Set(regionals.map((r) => r.region))];
  const filtered = useMemo(
    () =>
      regionals.filter((r) => {
        const matchesQ = r.name.toLowerCase().includes(q.toLowerCase()) || r.fullTitle.toLowerCase().includes(q.toLowerCase());
        const matchesRegion = region === "All Regions" || r.region === region;
        return matchesQ && matchesRegion;
      }),
    [regionals, q, region]
  );

  return (
    <ArenaPage>
      <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-primary">
        <ArrowLeft className="h-4 w-4" /> TSH
      </Link>
      <Panel className="mx-auto max-w-xl text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Globe className="h-5 w-5" />
        </div>
        <h1 className="text-3xl font-extrabold tracking-widest">REGIONALS</h1>
        <p className="mt-2 text-sm text-muted-foreground">Find your region and compete</p>
      </Panel>
      <Panel className="mx-auto mt-4 max-w-xl">
        <div className="flex items-center gap-2 rounded-lg border border-border px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            className="w-full border-0 bg-transparent py-3 outline-none"
            placeholder="Search Regions…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <label className="mt-4 block text-xs font-semibold uppercase tracking-widest text-muted-foreground">Region</label>
        <select className="mt-2 w-full px-3 py-3" value={region} onChange={(e) => setRegion(e.target.value)}>
          {options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </Panel>
      <div className="mx-auto mt-4 grid max-w-xl gap-3">
        {filtered.map((r) => (
          <Link key={r.id} to={`/regionals/${r.slug}`} className="glass flex items-center justify-between rounded-xl px-5 py-4 hover:border-primary/40">
            <div>
              <div className="text-lg font-bold">{r.fullTitle}</div>
              <div className="text-sm text-muted-foreground">{r.region}</div>
            </div>
            <span className="text-2xl font-extrabold text-primary">{r.flag}</span>
          </Link>
        ))}
      </div>
    </ArenaPage>
  );
}
