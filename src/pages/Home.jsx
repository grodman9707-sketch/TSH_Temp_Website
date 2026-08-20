import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { ChevronDown } from "lucide-react";

export function Home() {
  const [stats, setStats] = useState({ activePlayers: 0, divisions: 0, total180s: 0, topCheckout: 0 });
  const [content, setContent] = useState(null);
  const [openFaq, setOpenFaq] = useState(null);
  const [ticker, setTicker] = useState([]);

  useEffect(() => {
    api("/api/stats").then(setStats).catch(() => {});
    api("/api/content").then(setContent).catch(() => {});
    api("/api/regionals")
      .then(async (d) => {
        const items = [];
        for (const r of d.regionals) {
          const detail = await api(`/api/regionals/${r.slug}`);
          for (const league of detail.leagues) {
            const table = await api(`/api/leagues/${league.id}`);
            for (const f of table.fixtures.filter((x) => x.status === "played").slice(0, 2)) {
              items.push({
                div: league.name.toUpperCase(),
                text: `${f.homeName} vs ${f.awayName} — ${f.homeLegs}-${f.awayLegs}`,
                live: false,
              });
            }
            for (const f of table.fixtures.filter((x) => x.status === "scheduled").slice(0, 1)) {
              items.push({
                div: league.name.toUpperCase(),
                text: `${f.homeName} vs ${f.awayName}`,
                live: true,
              });
            }
          }
        }
        setTicker(items.length ? items : [{ div: "LEAGUE 1", text: "Season 1 is live — apply now", live: true }]);
      })
      .catch(() => {});
  }, []);

  const faq = content?.content?.faq || [];
  const premium = content?.content?.premium || [];
  const loop = [...ticker, ...ticker];

  return (
    <div>
      <section className="relative flex min-h-[calc(100vh-3.5rem)] flex-col justify-end pb-24 pt-10">
        <div className="relative z-10 px-6 md:px-12">
          <p className="mb-3 text-xs font-semibold tracking-[0.35em] text-primary">THE SOCIAL HUB PRESENTS</p>
          <h1 className="max-w-xl text-5xl font-extrabold leading-[0.95] tracking-tight sm:text-7xl">
            WHERE THE
            <br />
            <span className="text-primary">CHAMPIONS</span>
            <br />
            COMPETE
          </h1>
        </div>
        <p className="relative z-10 mx-auto mt-16 max-w-3xl px-6 text-center text-sm leading-relaxed text-white/80">
          {content?.content?.hero_description ||
            "Where competitive darts truly comes to life. TSH Darts League delivers structured league play built on fairness, progression, and real competition."}
        </p>
        <div className="absolute bottom-0 left-0 right-0 overflow-hidden border-t border-border/60 bg-black/70">
          <div className="ticker flex w-max gap-10 whitespace-nowrap py-2 text-xs font-semibold tracking-wider">
            {loop.map((item, i) => (
              <span key={i} className="flex items-center gap-3">
                <span className="text-primary">{item.div}</span>
                <span className="text-white/80">• {item.text}</span>
                {item.live ? <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] text-white">LIVE</span> : null}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-background px-6 py-20">
        <div className="mx-auto max-w-5xl text-center">
          <h2 className="text-3xl font-bold">TSH In Numbers</h2>
          <p className="mt-3 text-muted-foreground">
            Formerly World Darts League. Here are a few of the numbers that make TSH the home for competitive darts.
          </p>
          <p className="mt-2 text-xs text-primary">● Live data</p>
          <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-4">
            {[
              [stats.activePlayers, "Active Players"],
              [stats.divisions, "Divisions"],
              [stats.total180s, "Total 180s"],
              [stats.topCheckout, "Top Checkout"],
            ].map(([value, label]) => (
              <div key={label} className="glass rounded-xl px-4 py-8">
                <div className="text-4xl font-extrabold text-primary">{value}</div>
                <div className="mt-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-background px-6 pb-20">
        <div className="mx-auto max-w-5xl text-center">
          <h2 className="text-3xl font-bold">Join Our Active Communities</h2>
          <p className="mt-3 text-muted-foreground">
            {content?.content?.communities_description || "Everything runs through DartCounter."}
          </p>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <Link to="/regionals/europe" className="glass rounded-xl p-8 text-left hover:border-primary/40">
              <h3 className="text-xl font-bold">TSH Europe</h3>
              <p className="mt-2 text-sm text-muted-foreground">United Kingdom & Europe — climb the divisions weekly.</p>
            </Link>
            <Link to="/regionals/americas" className="glass rounded-xl p-8 text-left hover:border-primary/40">
              <h3 className="text-xl font-bold">TSH Americas</h3>
              <p className="mt-2 text-sm text-muted-foreground">North and South America — same format, same fight.</p>
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-background px-6 pb-20">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-3xl font-bold">Frequently Asked Questions</h2>
          <p className="mt-3 text-center text-muted-foreground">Find answers to the most common questions about TSH and our competitions.</p>
          <div className="mt-8 space-y-2">
            {faq.map((item, i) => (
              <button
                key={item.q}
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="glass flex w-full flex-col rounded-xl px-5 py-4 text-left"
              >
                <span className="flex items-center justify-between font-semibold">
                  {item.q}
                  <ChevronDown className={`h-4 w-4 transition ${openFaq === i ? "rotate-180" : ""}`} />
                </span>
                {openFaq === i ? <span className="mt-3 text-sm text-muted-foreground">{item.a}</span> : null}
              </button>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border bg-[#07090f] px-6 py-12">
        <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-2">
          <div>
            <h3 className="text-lg font-bold">The Social Hub Darts League</h3>
            <p className="mt-2 text-sm text-muted-foreground">Formerly World Darts League (WDL)</p>
            <a className="mt-3 inline-block text-sm text-primary" href="mailto:worlddartsleagueinfo@gmail.com">
              worlddartsleagueinfo@gmail.com
            </a>
          </div>
          <div>
            <h3 className="text-lg font-bold">Player Premium</h3>
            <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
              {premium.map((p) => (
                <li key={p}>• {p}</li>
              ))}
            </ul>
            <div className="mt-4 flex gap-3">
              <Link to="/apply" className="rounded-md bg-primary px-4 py-2 text-xs font-bold tracking-wider text-primary-foreground">
                GET PREMIUM
              </Link>
              <Link to="/rules" className="rounded-md border border-border px-4 py-2 text-xs font-bold tracking-wider">
                Rules
              </Link>
            </div>
          </div>
        </div>
        <p className="mx-auto mt-10 max-w-5xl text-xs text-muted-foreground">© 2026 The Social Hub Darts League. All rights reserved.</p>
      </footer>
    </div>
  );
}
