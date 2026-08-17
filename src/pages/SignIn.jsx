import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth.jsx";
import { ArenaPage, Panel } from "../components/Layout.jsx";

export function SignIn() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@tshdarts.com");
  const [password, setPassword] = useState("TSHAdmin2026");
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    try {
      const user = await login(email, password);
      navigate(user.role === "admin" ? "/admin" : "/dashboard");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <ArenaPage>
      <Panel className="mx-auto max-w-md">
        <h1 className="text-3xl font-extrabold">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">Demo admin is pre-filled. Player logins use player123.</p>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <input className="w-full px-3 py-3" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className="w-full px-3 py-3" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <button className="w-full rounded-md bg-primary py-3 text-sm font-bold tracking-widest text-primary-foreground">SIGN IN</button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          New here? <Link className="text-primary" to="/sign-up">Create an account</Link>
        </p>
      </Panel>
    </ArenaPage>
  );
}

export function SignUp() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    try {
      await register(form.name, form.email, form.password);
      navigate("/apply");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <ArenaPage>
      <Panel className="mx-auto max-w-md">
        <h1 className="text-3xl font-extrabold">Sign up</h1>
        <p className="mt-2 text-sm text-muted-foreground">Create a free TSH Darts League account.</p>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <input className="w-full px-3 py-3" placeholder="Display name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input className="w-full px-3 py-3" type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <input className="w-full px-3 py-3" type="password" placeholder="Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <button className="w-full rounded-md bg-primary py-3 text-sm font-bold tracking-widest text-primary-foreground">CREATE ACCOUNT</button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already registered? <Link className="text-primary" to="/sign-in">Sign in</Link>
        </p>
      </Panel>
    </ArenaPage>
  );
}
