import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { ArenaPage, Panel } from "../components/Layout.jsx";

export function Dashboard() {
  const { user } = useAuth();
  const [fixtures, setFixtures] = useState([]);

  useEffect(() => {
    api("/api/my-fixtures").then((d) => setFixtures(d.fixtures)).catch(() => {});
  }, []);

  const next = fixtures.find((f) => f.status === "scheduled");
  const played = fixtures.filter((f) => f.status === "played");

  return (
    <ArenaPage>
      <p className="text-xs font-semibold tracking-[0.3em] text-primary">PLAYER HUB</p>
      <h1 className="mt-2 text-4xl font-extrabold">{user.name}</h1>
      <p className="mt-2 text-muted-foreground">
        {user.leagueId ? `Division assigned · average ${user.avg}` : "Not yet placed — submit an application to join a division."}
      </p>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Panel>
          <div className="text-xs tracking-widest text-muted-foreground">NEXT MATCH</div>
          <div className="mt-2 font-semibold">{next ? `${next.homeName} vs ${next.awayName}` : "None scheduled"}</div>
        </Panel>
        <Panel>
          <div className="text-xs tracking-widest text-muted-foreground">RESULTS IN</div>
          <div className="mt-2 text-3xl font-extrabold text-primary">{played.length}</div>
        </Panel>
        <Panel>
          <Link to="/my-matches" className="text-sm font-bold tracking-widest text-primary">
            OPEN MY MATCHES →
          </Link>
        </Panel>
      </div>
    </ArenaPage>
  );
}
