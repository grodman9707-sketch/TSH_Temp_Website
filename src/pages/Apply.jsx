import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { ArenaPage, Panel } from "../components/Layout.jsx";

export function Apply() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [regionals, setRegionals] = useState([]);
  const [form, setForm] = useState({ regionalId: "1", avg: "", dartcounterName: "" });
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/regionals").then((d) => setRegionals(d.regionals)).catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!user) {
      navigate("/sign-up");
      return;
    }
    try {
      await api("/api/apply", { method: "POST", body: JSON.stringify(form) });
      setMsg("Application received. An admin will place you in a division.");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <ArenaPage>
      <Panel className="mx-auto max-w-lg">
        <p className="text-xs font-semibold tracking-[0.3em] text-primary">JOIN THE LEAGUE</p>
        <h1 className="mt-2 text-3xl font-extrabold">Apply to TSH</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Free to enter. Tell us your DartCounter average and we will place you in Europe or Americas.
        </p>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <label className="block text-xs font-semibold uppercase tracking-widest text-muted-foreground">Regional</label>
          <select
            className="w-full px-3 py-3"
            value={form.regionalId}
            onChange={(e) => setForm({ ...form, regionalId: e.target.value })}
          >
            {regionals.map((r) => (
              <option key={r.id} value={r.id}>
                {r.fullTitle}
              </option>
            ))}
          </select>
          <label className="block text-xs font-semibold uppercase tracking-widest text-muted-foreground">DartCounter name</label>
          <input
            className="w-full px-3 py-3"
            value={form.dartcounterName}
            onChange={(e) => setForm({ ...form, dartcounterName: e.target.value })}
            placeholder="Your DartCounter username"
          />
          <label className="block text-xs font-semibold uppercase tracking-widest text-muted-foreground">3-dart average</label>
          <input
            className="w-full px-3 py-3"
            type="number"
            step="0.1"
            value={form.avg}
            onChange={(e) => setForm({ ...form, avg: e.target.value })}
            placeholder="e.g. 62.5"
            required
          />
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          {msg ? <p className="text-sm text-primary">{msg}</p> : null}
          <button className="w-full rounded-md bg-primary py-3 text-sm font-bold tracking-widest text-primary-foreground">
            {user ? "SUBMIT APPLICATION" : "SIGN UP TO APPLY"}
          </button>
        </form>
        {!user ? (
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Already have an account? <Link to="/sign-in" className="text-primary">Sign in</Link>
          </p>
        ) : null}
      </Panel>
    </ArenaPage>
  );
}
