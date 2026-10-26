"use client";

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { User, authApi } from "../lib/api/auth";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  streamToken: string | null;
  refreshStreamToken: () => Promise<string | null>;
  hasRole: (roles: User["role"][]) => boolean;
  can: (permission: string) => boolean;
  logout: () => Promise<void>;
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
  login: (user: User) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const normalizeUser = (u: unknown): User | null => {
  if (!u || typeof u !== 'object') return null;
  const userObj = u as User;
  return {
    ...userObj,
    role: userObj.role === 'admin' ? 'admin' : 'viewer',
  };
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = sessionStorage.getItem("user_profile");
        if (stored) {
          return normalizeUser(JSON.parse(stored));
        }
      } catch {}
    }
    return null;
  });
  const [isLoading, setIsLoading] = useState(true);

  const setUser = useCallback((val: User | null | ((prev: User | null) => User | null)) => {
    setUserState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      return normalizeUser(next);
    });
  }, []);
  const [streamToken, setStreamToken] = useState<string | null>(null);
  const tokenRefreshTimerRef = useRef<NodeJS.Timeout | null>(null);
  const refreshStreamTokenRef = useRef<() => Promise<string | null>>(async () => null);

  const refreshStreamToken = useCallback(async (): Promise<string | null> => {
    try {
      const data = await authApi.getStreamToken();
      setStreamToken(data.token);

      if (tokenRefreshTimerRef.current) {
        clearTimeout(tokenRefreshTimerRef.current);
      }

      // Schedule refresh 60 seconds before expiration (never logged or saved to localStorage)
      const ttlSec = Math.max(30, (data.expires_in || 3600) - 60);
      tokenRefreshTimerRef.current = setTimeout(() => {
        refreshStreamTokenRef.current();
      }, ttlSec * 1000);

      return data.token;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    refreshStreamTokenRef.current = refreshStreamToken;
  }, [refreshStreamToken, setUser]);

  const login = useCallback(async (newUser: User) => {
    setUser(newUser);
    if (typeof window !== "undefined") {
      sessionStorage.setItem("user_profile", JSON.stringify(newUser));
    }
    await refreshStreamToken();
  }, [refreshStreamToken, setUser]);

  useEffect(() => {
    const initAuth = async () => {
      // 1. Immediately restore user from sessionStorage if available on client mount (e.g. F5)
      if (typeof window !== "undefined") {
        try {
          const stored = sessionStorage.getItem("user_profile");
          if (stored) {
            setUser(JSON.parse(stored));
          }
        } catch {}
      }

      try {
        const { user: fetchedUser } = await authApi.me();
        setUser(fetchedUser);
        if (fetchedUser) {
          if (typeof window !== "undefined") {
            sessionStorage.setItem("user_profile", JSON.stringify(fetchedUser));
          }
          refreshStreamToken();
        }
      } catch {
        setUser(null);
        if (typeof window !== "undefined") {
          sessionStorage.removeItem("user_profile");
        }
      } finally {
        setIsLoading(false);
      }
    };
    initAuth();

    return () => {
      if (tokenRefreshTimerRef.current) {
        clearTimeout(tokenRefreshTimerRef.current);
      }
    };
  }, [refreshStreamToken, setUser]);

  const hasRole = (roles: User["role"][]) => {
    if (!user) return false;
    return roles.includes(user.role);
  };

  const can = (permission: string) => {
    if (!user) return false;
    if (permission === 'toggle_camera' || permission === 'toggle:camera') return true;
    if (user.role === 'admin') return true;
    if (user.role === 'viewer') {
      const adminOnly = ['manage_users', 'manage_settings', 'add_camera', 'edit_camera', 'delete_camera', 'audit_log'];
      return !adminOnly.includes(permission);
    }

    return false;
  };

  const logout = async () => {
    if (tokenRefreshTimerRef.current) {
      clearTimeout(tokenRefreshTimerRef.current);
    }
    setStreamToken(null);
    await authApi.logout();
    setUser(null);
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("user_profile");
    }
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, streamToken, refreshStreamToken, hasRole, can, logout, setUser, login }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
