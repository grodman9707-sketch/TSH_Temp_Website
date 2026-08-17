import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth.jsx";
import { Crest } from "./Crest.jsx";
import { Home, Globe, Mail, ClipboardList, LayoutDashboard, Swords, Shield, X, ScrollText, Megaphone } from "lucide-react";

const linkClass = ({ isActive }) =>
  `flex items-center gap-3 px-4 py-3 text-sm font-semibold tracking-widest uppercase transition-colors ${
    isActive ? "text-primary" : "text-white/80 hover:text-primary"
  }`;

export function Sidebar({ open, onClose }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    onClose();
    navigate("/");
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={onClose}
      />
      <aside
        className={`fixed left-0 top-0 z-50 flex h-full w-72 flex-col border-r border-border bg-background transition-transform ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <Crest className="h-10 w-10" title={false} />
            <span className="text-sm font-bold tracking-widest text-primary">TSH</span>
          </div>
          <button onClick={onClose} className="rounded border border-border p-2 hover:border-primary/50">
            <X className="h-4 w-4" />
          </button>
        </div>
        <nav className="flex-1 py-2">
          <NavLink to="/" className={linkClass} onClick={onClose}>
            <Home className="h-4 w-4" /> Home
          </NavLink>
          <NavLink to="/regionals" className={linkClass} onClick={onClose}>
            <Globe className="h-4 w-4" /> Regionals
          </NavLink>
          <NavLink to="/apply" className={linkClass} onClick={onClose}>
            <ClipboardList className="h-4 w-4" /> Apply
          </NavLink>
          <NavLink to="/announcements" className={linkClass} onClick={onClose}>
            <Megaphone className="h-4 w-4" /> News
          </NavLink>
          <NavLink to="/rules" className={linkClass} onClick={onClose}>
            <ScrollText className="h-4 w-4" /> Rules
          </NavLink>
          <NavLink to="/contact" className={linkClass} onClick={onClose}>
            <Mail className="h-4 w-4" /> Contact
          </NavLink>
          {user ? (
            <>
              <NavLink to="/dashboard" className={linkClass} onClick={onClose}>
                <LayoutDashboard className="h-4 w-4" /> Dashboard
              </NavLink>
              <NavLink to="/my-matches" className={linkClass} onClick={onClose}>
                <Swords className="h-4 w-4" /> My Matches
              </NavLink>
            </>
          ) : null}
          {user?.role === "admin" ? (
            <NavLink to="/admin" className={linkClass} onClick={onClose}>
              <Shield className="h-4 w-4" /> Admin
            </NavLink>
          ) : null}
        </nav>
        <div className="border-t border-border p-4 text-xs text-muted-foreground">
          {user ? (
            <button onClick={handleLogout} className="w-full rounded border border-border px-3 py-2 hover:border-primary/50">
              Sign out {user.name}
            </button>
          ) : (
            <p>Formerly World Darts League</p>
          )}
        </div>
      </aside>
    </>
  );
}
