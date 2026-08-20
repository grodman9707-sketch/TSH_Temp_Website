import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu } from "lucide-react";
import { useAuth } from "../lib/auth.jsx";
import { Sidebar } from "./Sidebar.jsx";
import { Crest } from "./Crest.jsx";

export function Layout({ children, transparentNav = false }) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const location = useLocation();
  const home = location.pathname === "/";

  return (
    <div className={`min-h-screen bg-background text-foreground ${home ? "arena-bg arena-home" : ""}`}>
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <nav className={`sticky top-0 z-30 border-b border-border/50 ${transparentNav ? "bg-background/40 backdrop-blur-md" : "bg-background"}`}>
        <div className="flex h-14 items-center justify-between px-4">
          <button
            onClick={() => setOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded border border-border/50 hover:border-primary/50 hover:text-primary"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link to="/" className="flex items-center">
            <Crest className="h-12 w-12" />
          </Link>
          <div className="flex items-center gap-2">
            {user ? (
              <Link
                to="/dashboard"
                className="rounded-md border border-primary bg-primary px-4 py-2 text-xs font-bold tracking-wider text-primary-foreground hover:bg-primary/90"
              >
                {user.name.split(" ")[0].toUpperCase()}
              </Link>
            ) : (
              <>
                <Link
                  to="/sign-up"
                  className="rounded-md border border-primary bg-primary px-4 py-2 text-xs font-bold tracking-wider text-primary-foreground hover:bg-primary/90"
                >
                  SIGN UP
                </Link>
                <Link
                  to="/sign-in"
                  className="hidden rounded-md border border-border px-4 py-2 text-xs font-bold tracking-wider sm:inline-flex"
                >
                  SIGN IN
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>
      {children}
    </div>
  );
}

export function ArenaPage({ children }) {
  return (
    <div className="arena-bg min-h-[calc(100vh-3.5rem)]">
      <div className="mx-auto max-w-5xl px-4 py-10">{children}</div>
    </div>
  );
}

export function Panel({ children, className = "" }) {
  return <div className={`glass rounded-xl p-5 ${className}`}>{children}</div>;
}
