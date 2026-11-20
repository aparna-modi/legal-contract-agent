import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { BrandMark, LogOutIcon } from "./components/Icons";
import Dashboard from "./pages/Dashboard";
import UploadScreen from "./pages/UploadScreen";
import Compare from "./pages/Compare";
import Analytics from "./pages/Analytics";
import Login from "./pages/Login";
import Register from "./pages/Register";

function App() {
  const navigate = useNavigate();
  const { user, logout, isAuthenticated } = useAuth();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const initials = (user?.name || "U")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="topbar-left">
            <NavLink to="/" className="brand">
              <BrandMark size={26} />
              <span className="brand-name">Legal Contract Agent</span>
            </NavLink>

            {isAuthenticated && (
              <nav className="nav-tabs" aria-label="Primary">
                <NavLink
                  to="/"
                  end
                  className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                >
                  Workspace
                </NavLink>
                <NavLink
                  to="/upload"
                  className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                >
                  Upload
                </NavLink>
                <NavLink
                  to="/compare"
                  className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                >
                  Compare
                </NavLink>
                <NavLink
                  to="/analytics"
                  className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                >
                  Analytics
                </NavLink>
              </nav>
            )}
          </div>

          <div className="topbar-right">
            {isAuthenticated ? (
              <div className="account-menu">
                <span className="account-pill">
                  <span className="avatar-initials">{initials}</span>
                  <span className="account-name">{user?.name || "Account"}</span>
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleLogout}
                  title="Sign out"
                >
                  <LogOutIcon size={15} />
                  <span>Sign out</span>
                </button>
              </div>
            ) : (
              <div className="auth-nav">
                <NavLink to="/login" className="btn btn-ghost btn-sm">
                  Sign in
                </NavLink>
                <NavLink to="/register" className="btn btn-primary btn-sm">
                  Get started
                </NavLink>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/upload" element={<UploadScreen />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
