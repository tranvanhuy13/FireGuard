"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { User, authApi } from "../lib/api/auth";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  hasRole: (roles: User["role"][]) => boolean;
  can: (permission: string) => boolean;
  logout: () => Promise<void>;
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      try {
        const { user } = await authApi.me();
        setUser(user);
      } catch (error) {
        console.error("Auth error:", error);
      } finally {
        setIsLoading(false);
      }
    };
    initAuth();
  }, []);

  const hasRole = (roles: User["role"][]) => {
    if (!user) return false;
    return roles.includes(user.role);
  };

  const can = (permission: string) => {
    if (!user) return false;
    // Simplistic RBAC
    if (user.role === 'admin') return true;
    if (user.role === 'operator' && permission !== 'manage_users' && permission !== 'manage_settings') return true;
    if (user.role === 'viewer' && permission === 'view') return true;
    return false;
  };

  const logout = async () => {
    await authApi.logout();
    setUser(null);
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, hasRole, can, logout, setUser }}>
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
