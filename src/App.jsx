import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth.jsx";
import { Layout } from "./components/Layout.jsx";
import { Home } from "./pages/Home.jsx";
import { Regionals } from "./pages/Regionals.jsx";
import { RegionalHome } from "./pages/RegionalHome.jsx";
import { LeaguePage } from "./pages/LeaguePage.jsx";
import { Apply } from "./pages/Apply.jsx";
import { SignIn } from "./pages/SignIn.jsx";
import { SignUp } from "./pages/SignUp.jsx";
import { Dashboard } from "./pages/Dashboard.jsx";
import { MyMatches } from "./pages/MyMatches.jsx";
import { Player } from "./pages/Player.jsx";
import { Rules } from "./pages/Rules.jsx";
import { Contact } from "./pages/Contact.jsx";
import { Announcements } from "./pages/Announcements.jsx";
import { Admin } from "./pages/Admin.jsx";

function Guard({ children, admin }) {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Navigate to="/sign-in" replace />;
  if (admin && user.role !== "admin") return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  return (
    <Layout transparentNav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/regionals" element={<Regionals />} />
        <Route path="/regionals/:slug" element={<RegionalHome />} />
        <Route path="/regionals/:slug/leagues/:leagueId" element={<LeaguePage />} />
        <Route path="/apply" element={<Apply />} />
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/sign-up" element={<SignUp />} />
        <Route path="/rules" element={<Rules />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/announcements" element={<Announcements />} />
        <Route path="/player/:id" element={<Player />} />
        <Route
          path="/dashboard"
          element={
            <Guard>
              <Dashboard />
            </Guard>
          }
        />
        <Route
          path="/my-matches"
          element={
            <Guard>
              <MyMatches />
            </Guard>
          }
        />
        <Route
          path="/admin"
          element={
            <Guard admin>
              <Admin />
            </Guard>
          }
        />
      </Routes>
    </Layout>
  );
}
