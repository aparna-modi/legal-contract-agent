/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { authApi, configureAuthCallbacks } from "../api/client";

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(() => localStorage.getItem("jwt") || null);
  const [user, setUser] = useState(() => {
    try {
      const savedUser = localStorage.getItem("user");
      return savedUser ? JSON.parse(savedUser) : null;
    } catch {
      return null;
    }
  });
  const [sessionReady, setSessionReady] = useState(() => !localStorage.getItem("jwt"));

  const persistSession = useCallback((userData, jwtToken) => {
    setUser(userData);
    setToken(jwtToken);
    if (jwtToken) localStorage.setItem("jwt", jwtToken);
    if (userData) localStorage.setItem("user", JSON.stringify(userData));
  }, []);

  const clearLocalSession = useCallback(() => {
    setUser(null);
    setToken(null);
    localStorage.removeItem("jwt");
    localStorage.removeItem("user");
  }, []);

  useEffect(() => {
    configureAuthCallbacks({
      onRefresh: (newToken, newUser) => {
        setToken(newToken);
        localStorage.setItem("jwt", newToken);
        if (newUser) {
          setUser(newUser);
          localStorage.setItem("user", JSON.stringify(newUser));
        }
      },
      onExpired: () => {
        clearLocalSession();
      },
    });
  }, [clearLocalSession]);

  // Verify or silently refresh session on initial boot.
  useEffect(() => {
    let active = true;
    const savedToken = localStorage.getItem("jwt");

    if (!savedToken) {
      return undefined;
    }

    authApi
      .me(savedToken)
      .then((res) => {
        if (!active) return;
        if (res?.user) {
          setUser(res.user);
          localStorage.setItem("user", JSON.stringify(res.user));
        }
      })
      .catch(() => {
        if (!active) return;
        // Token may have been refreshed silently; if still invalid, clearLocalSession already ran.
      })
      .finally(() => {
        if (active) setSessionReady(true);
      });

    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(
    (userData, jwtToken) => {
      persistSession(userData, jwtToken);
    },
    [persistSession]
  );

  const register = useCallback(
    (userData, jwtToken) => {
      persistSession(userData, jwtToken);
    },
    [persistSession]
  );

  const updateUser = useCallback((updatedUser) => {
    setUser(updatedUser);
    localStorage.setItem("user", JSON.stringify(updatedUser));
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Clear local session even if server is unreachable
    } finally {
      clearLocalSession();
    }
  }, [clearLocalSession]);

  const logoutAll = useCallback(async () => {
    if (token) {
      try {
        await authApi.logoutAll(token);
      } catch {
        // Proceed with local clear
      }
    }
    clearLocalSession();
  }, [token, clearLocalSession]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        sessionReady,
        login,
        register,
        updateUser,
        logout,
        logoutAll,
        isAuthenticated: Boolean(token),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export default AuthProvider;
