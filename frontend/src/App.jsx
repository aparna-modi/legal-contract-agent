import { useEffect, useState } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { useAuth } from "./context/AuthContext";
import ErrorBoundary from "./components/ErrorBoundary";
import LibrarySearchModal from "./components/LibrarySearchModal";
import { BrandMark, LogOutIcon, SearchIcon, ShieldCheckIcon } from "./components/Icons";
import { SPRING_SNAPPY } from "./components/motionTokens";
import Dashboard from "./pages/Dashboard";
import UploadScreen from "./pages/UploadScreen";
import DraftContract from "./pages/DraftContract";
import Compare from "./pages/Compare";
import Playbook from "./pages/Playbook";
import Analytics from "./pages/Analytics";
import SecuritySettings from "./pages/SecuritySettings";
import AdminDashboard from "./pages/AdminDashboard";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";

const NAV_LINKS = [
  { to: "/", label: "Workspace", end: true },
  { to: "/upload", label: "Upload" },
  { to: "/draft", label: "Draft" },
  { to: "/compare", label: "Compare" },
  { to: "/playbook", label: "Playbook" },
  { to: "/analytics", label: "Analytics" },
];

function ProtectedRoute({ children }) {
  const { isAuthenticated, sessionReady } = useAuth();
  const location = useLocation();

  if (!sessionReady) {
    return (
      <div className="state-box">
        <div className="spinner" />
        <p>Verifying session...</p>
      </div>
    );
  }
  if (!isAuthenticated) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  return children;
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, token, logout, isAuthenticated } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isAuthenticated]);

  const initials = (user?.name || "U")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const navItems = user?.role === "admin" ? [...NAV_LINKS, { to: "/admin", label: "Admin" }] : NAV_LINKS;

  return (
    <MotionConfig reducedMotion="user">
      <ErrorBoundary>
        <div className="app-shell">
          <a href="#main-content" className="skip-link">Skip to main content</a>
          <header className="topbar">
            <div className="topbar-inner">
              <div className="topbar-left">
                <NavLink to="/" className="brand">
                  <BrandMark size={26} />
                  <span className="brand-name">Legal Contract Agent</span>
                </NavLink>

                {isAuthenticated && (
                  <nav className="nav-tabs" aria-label="Primary">
                    {navItems.map((item) => {
                      const isActive = item.end
                        ? location.pathname === item.to
                        : location.pathname.startsWith(item.to);
                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={item.end}
                          className={`nav-item ${isActive ? "active" : ""}`}
                        >
                          <span className="nav-item-label">{item.label}</span>
                          {isActive && (
                            <motion.span
                              layoutId="nav-active-pill"
                              className="nav-active-bg"
                              transition={SPRING_SNAPPY}
                            />
                          )}
                        </NavLink>
                      );
                    })}
                  </nav>
                )}
              </div>

              <div className="topbar-right">
                {isAuthenticated ? (
                  <div className="account-menu">
                    <button
                      type="button"
                      className="cmd-trigger-btn"
                      onClick={() => setSearchOpen(true)}
                      title="Search contracts (Ctrl+K)"
                    >
                      <SearchIcon size={14} />
                      <span>Search</span>
                      <kbd>Ctrl K</kbd>
                    </button>

                    <NavLink
                      to="/security"
                      className={({ isActive }) => `account-pill ${isActive ? "active" : ""}`}
                      title="Account, Team & Security"
                    >
                      <span className="avatar-initials">{initials}</span>
                      <span className="account-name">{user?.name || "Account"}</span>
                      <ShieldCheckIcon size={14} className="text-accent" />
                    </NavLink>

                    <button type="button" className="btn btn-ghost btn-sm" onClick={handleLogout}>
                      <LogOutIcon size={15} />
                      <span>Sign out</span>
                    </button>
                  </div>
                ) : (
                  <div className="auth-nav">
                    <NavLink to="/login" className="btn btn-ghost btn-sm">Sign in</NavLink>
                    <NavLink to="/register" className="btn btn-primary btn-sm">Get started</NavLink>
                  </div>
                )}
              </div>
            </div>
          </header>

          <main id="main-content" className="main-content" tabIndex={-1}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/upload" element={<ProtectedRoute><UploadScreen /></ProtectedRoute>} />
              <Route path="/draft" element={<ProtectedRoute><DraftContract /></ProtectedRoute>} />
              <Route path="/compare" element={<ProtectedRoute><Compare /></ProtectedRoute>} />
              <Route path="/playbook" element={<ProtectedRoute><Playbook /></ProtectedRoute>} />
              <Route path="/analytics" element={<ProtectedRoute><Analytics /></ProtectedRoute>} />
              <Route path="/security" element={<ProtectedRoute><SecuritySettings /></ProtectedRoute>} />
              <Route path="/admin" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
              <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <Login />} />
              <Route path="/register" element={isAuthenticated ? <Navigate to="/" replace /> : <Register />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route
                path="*"
                element={
                  <div className="surface-card empty-box centered-card">
                    <span className="mono-tag">404</span>
                    <h3>Page not found</h3>
                    <p>The requested page does not exist.</p>
                    <Link to="/" className="btn btn-primary">Back to Workspace</Link>
                  </div>
                }
              />
            </Routes>
          </main>

          <footer className="app-footer">
            <div className="app-footer-inner">
              <span>Legal Contract Agent — Document-grounded contract review workspace.</span>
              <span>Informational first-pass review only; not legal advice.</span>
            </div>
          </footer>

          <AnimatePresence>
            {searchOpen && isAuthenticated && (
              <LibrarySearchModal initialQuery="" token={token} onClose={() => setSearchOpen(false)} />
            )}
          </AnimatePresence>
        </div>
      </ErrorBoundary>
    </MotionConfig>
  );
}
