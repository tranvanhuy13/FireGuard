/* eslint-disable */
import { apiClient, isMockMode } from "./client";

export interface User {
  id: string;
  username: string;
  fullName: string;
  email: string;
  role: "admin" | "operator" | "viewer";
}

export const api = {
  login: async (credentials: any): Promise<{ user: User; token: string }> => {
    if (isMockMode) {
      return new Promise((resolve, reject) =>
        setTimeout(() => {
          if (typeof window !== 'undefined') {
            const usersStr = localStorage.getItem('mockUsers');
            let users = [];
            if (usersStr) {
              users = JSON.parse(usersStr);
            } else {
              // Seed default users
              users = [
                { id: "1", username: "admin", email: "admin@fireguard.ai", password: "admin123", fullName: "Admin User", role: "admin" },
                { id: "2", username: "operator", email: "operator@fireguard.ai", password: "operator123", fullName: "Operator User", role: "operator" }
              ];
              localStorage.setItem('mockUsers', JSON.stringify(users));
            }

            const user = users.find((u: any) => 
              (u.username === credentials.identifier || u.email === credentials.identifier) && 
              u.password === credentials.password
            );

            if (user) {
              localStorage.setItem('mockRole', user.role);
              localStorage.setItem('mockUsername', user.username);
              localStorage.setItem('mockUserFull', JSON.stringify(user));
              resolve({
                user: { id: user.id, username: user.username, fullName: user.fullName, email: user.email, role: user.role },
                token: "mock-jwt-token",
              });
            } else {
              reject(new Error("invalidCredentials"));
            }
          }
        }, 500)
      );
    }
    return apiClient<{ user: User; token: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(credentials),
    });
  },
  register: async (data: any): Promise<{ message: string }> => {
    if (isMockMode) {
      return new Promise((resolve, reject) =>
        setTimeout(() => {
          if (typeof window !== 'undefined') {
            const usersStr = localStorage.getItem('mockUsers');
            let users = [];
            if (usersStr) {
              users = JSON.parse(usersStr);
            } else {
              users = [
                { id: "1", username: "admin", email: "admin@fireguard.ai", password: "admin123", fullName: "Admin User", role: "admin" },
                { id: "2", username: "operator", email: "operator@fireguard.ai", password: "operator123", fullName: "Operator User", role: "operator" }
              ];
            }

            const exists = users.some((u: any) => u.username === data.username || u.email === data.email);
            if (exists) {
              reject(new Error("emailExists"));
            } else {
              const newUser = {
                id: Date.now().toString(),
                username: data.username,
                email: data.email,
                password: data.password,
                fullName: data.fullName,
                role: "viewer"
              };
              users.push(newUser);
              localStorage.setItem('mockUsers', JSON.stringify(users));
              resolve({ message: "Registration successful" });
            }
          }
        }, 500)
      );
    }
    return apiClient<{ message: string }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  me: async (): Promise<{ user: User }> => {
    if (isMockMode) {
      return new Promise((resolve) =>
        setTimeout(() => {
          if (typeof window !== 'undefined') {
            const userStr = localStorage.getItem('mockUserFull');
            if (userStr) {
              const u = JSON.parse(userStr);
              resolve({
                user: {
                  id: u.id,
                  username: u.username,
                  fullName: u.fullName,
                  email: u.email,
                  role: u.role,
                },
              });
              return;
            }
          }
          // fallback
          resolve({
            user: { id: "0", username: "guest", fullName: "Guest", email: "guest@fireguard.ai", role: "viewer" },
          });
        }, 500)
      );
    }
    return apiClient<{ user: User }>("/api/auth/me");
  },
  logout: async (): Promise<{ message: string }> => {
    if (isMockMode) {
      return new Promise((resolve) =>
        setTimeout(() => resolve({ message: "Logged out" }), 500)
      );
    }
    return apiClient<{ message: string }>("/api/auth/logout", {
      method: "POST",
    });
  },
  disconnect: async (provider: string): Promise<{ message: string }> => {
    if (isMockMode) {
      return new Promise((resolve) => setTimeout(() => resolve({ message: "Disconnected" }), 500));
    }
    return apiClient<{ message: string }>("/api/auth/disconnect", {
      method: "POST",
      body: JSON.stringify({ provider })
    });
  },
};

export const authApi = api;
