import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api } from "../lib/api.js";
import { ArenaPage, Panel } from "../components/Layout.jsx";

export function LeaguePage() {
  const { slug, leagueId } = useParams();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("table");

  useEffect(() => {
    api(`/api/leagues/${leagueId}`).then(setData).catch(() => {});
  }, [leagueId]);

  if (!data) {
    return (
      <ArenaPage>
        <p className="text-center text-primary">Loading...</p>
      </ArenaPage>
    );
  }

  return (
    <ArenaPage>
      <Link to={`/regionals/${slug}`} className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-primary">
        <ArrowLeft className="h-4 w-4" /> {data.regional?.fullTitle}
      </Link>
      <Panel className="text-center">
        <h1 className="text-3xl font-extrabold tracking-widest">{data.league.name.toUpperCase()}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{data.league.format} · 2 points for a win</p>
      </Panel>
      <div className="mt-4 flex gap-2">
        {["table", "fixtures"].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-4 py-2 text-xs font-bold uppercase tracking-widest ${
              tab === t ? "bg-primary text-primary-foreground" : "border border-border"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "table" ? (
        <div className="glass mt-4 overflow-x-auto rounded-xl">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase tracking-widest text-muted-foreground">
              <tr>
                {["#", "Player", "P", "W", "L", "LF", "LA", "+/-", "Pts", "Avg"].map((h) => (
                  <th key={h} className="px-3 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.standings.map((row, i) => (
                <tr key={row.playerId} className="border-t border-border/70">
                  <td className="px-3 py-3 text-primary">{i + 1}</td>
                  <td className="px-3 py-3 font-semibold">
                    <Link to={`/player/${row.playerId}`}>{row.name}</Link>
                  </td>
                  <td className="px-3 py-3">{row.played}</td>
                  <td className="px-3 py-3">{row.won}</td>
                  <td className="px-3 py-3">{row.lost}</td>
                  <td className="px-3 py-3">{row.legsFor}</td>
                  <td className="px-3 py-3">{row.legsAgainst}</td>
                  <td className="px-3 py-3">{row.diff}</td>
                  <td className="px-3 py-3 font-bold text-primary">{row.points}</td>
                  <td className="px-3 py-3">{row.avg?.toFixed?.(1) ?? row.avg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {data.fixtures.map((f) => (
            <Panel key={f.id} className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  Week {f.week} · {f.date}
                </div>
                <div className="mt-1 font-semibold">
                  {f.homeName} vs {f.awayName}
                </div>
              </div>
              <div className="text-right">
                {f.status === "played" ? (
                  <div className="text-2xl font-extrabold text-primary">
                    {f.homeLegs} – {f.awayLegs}
                  </div>
                ) : (
                  <div className="text-xs font-bold tracking-widest text-red-500">SCHEDULED</div>
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </ArenaPage>
  );
}
