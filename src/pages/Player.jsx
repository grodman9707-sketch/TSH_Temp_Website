import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { ArenaPage, Panel } from "../components/Layout.jsx";

export function Player() {
  const { id } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    api(`/api/player/${id}`).then(setData).catch(() => {});
  }, [id]);

  if (!data) {
    return (
      <ArenaPage>
        <p className="text-center text-primary">Loading...</p>
      </ArenaPage>
    );
  }

  return (
    <ArenaPage>
      <Panel>
        <p className="text-xs tracking-[0.3em] text-primary">{data.regional?.fullTitle || "Unplaced"}</p>
        <h1 className="mt-2 text-4xl font-extrabold">{data.player.name}</h1>
        <p className="mt-2 text-muted-foreground">
          {data.league?.name || "Awaiting division"} · Avg {data.player.avg}
        </p>
      </Panel>
      <div className="mt-4 space-y-3">
        {data.fixtures.map((f) => (
          <Panel key={f.id} className="flex items-center justify-between">
            <div>
              {f.homeName} vs {f.awayName}
              <div className="text-xs text-muted-foreground">{f.date}</div>
            </div>
            <div className="font-bold text-primary">{f.status === "played" ? `${f.homeLegs}–${f.awayLegs}` : "TBD"}</div>
          </Panel>
        ))}
      </div>
      {data.regional ? (
        <Link to={`/regionals/${data.regional.slug}`} className="mt-6 inline-block text-sm text-primary">
          Back to {data.regional.fullTitle}
        </Link>
      ) : null}
    </ArenaPage>
  );
}
