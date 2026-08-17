import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, BookOpen, List, Users } from "lucide-react";
import { api } from "../lib/api.js";
import { ArenaPage, Panel } from "../components/Layout.jsx";

export function RegionalHome() {
  const { slug } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    api(`/api/regionals/${slug}`).then(setData).catch(() => setData(null));
  }, [slug]);

  if (!data) {
    return (
      <ArenaPage>
        <p className="text-center text-primary">Loading...</p>
      </ArenaPage>
    );
  }

  const { regional, leagues, counts } = data;

  return (
    <ArenaPage>
      <div className="mb-8 flex items-center gap-3">
        <Link to="/regionals" className="text-primary">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <div className="text-xl font-bold">
            {regional.flag} {regional.fullTitle}
          </div>
          <div className="mt-1 flex gap-4 text-sm">
            <span className="font-semibold text-primary underline decoration-primary underline-offset-8">Home</span>
            <a href="#leagues" className="text-muted-foreground">
              Leagues
            </a>
          </div>
        </div>
      </div>

      <Panel className="mx-auto max-w-xl text-center">
        <div className="text-6xl font-extrabold">{regional.flag}</div>
        <div className="mt-2 text-sm font-bold tracking-[0.3em] text-primary">{regional.name.toUpperCase()}</div>
      </Panel>
      <Link to="/rules" className="glass mx-auto mt-3 flex max-w-xl items-center justify-between rounded-xl px-5 py-4">
        <span className="flex items-center gap-3">
          <BookOpen className="h-5 w-5 text-primary" />
          {regional.fullTitle} Rules
        </span>
        <span className="text-sm text-muted-foreground">Read more &gt;</span>
      </Link>
      <div className="mx-auto mt-4 grid max-w-xl grid-cols-3 gap-3">
        {[
          [counts.players, "PLAYERS", Users],
          [counts.teams, "TEAMS", Users],
          [counts.leagues, "LEAGUES", List],
        ].map(([value, label, Icon]) => (
          <Panel key={label} className="text-center">
            <Icon className="mx-auto h-5 w-5 text-primary" />
            <div className="mt-2 text-3xl font-extrabold">{value}</div>
            <div className="mt-1 text-[11px] tracking-widest text-muted-foreground">{label}</div>
          </Panel>
        ))}
      </div>

      <h2 id="leagues" className="mx-auto mt-10 max-w-xl text-sm font-bold tracking-widest text-primary">
        LEAGUES
      </h2>
      <div className="mx-auto mt-3 grid max-w-xl gap-3">
        {leagues.map((league) => (
          <Link
            key={league.id}
            to={`/regionals/${slug}/leagues/${league.id}`}
            className="glass flex items-center justify-between rounded-xl px-5 py-4 hover:border-primary/40"
          >
            <div>
              <div className="font-bold">{league.name}</div>
              <div className="text-sm text-muted-foreground">{league.format}</div>
            </div>
            <span className="text-xs font-semibold tracking-widest text-primary">TABLE</span>
          </Link>
        ))}
      </div>
    </ArenaPage>
  );
}
