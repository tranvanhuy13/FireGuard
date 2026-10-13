/* eslint-disable */
import { apiClient, isMockAuth, ApiError } from "./client";

export interface User {
  id: string;
  username: string;
  fullName: string;
  email: string;
  role: "admin" | "operator" | "viewer";
}

export const api = {
  login: async (credentials: any): Promise<{ user: User; token: string }> => {
    if (isMockAuth) {
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
    if (isMockAuth) {
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
    if (isMockAuth) {
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
    if (isMockAuth) {
      return new Promise((resolve) =>
        setTimeout(() => resolve({ message: "Logged out" }), 500)
      );
    }
    return apiClient<{ message: string }>("/api/auth/logout", {
      method: "POST",
    });
  },
  disconnect: async (provider: string): Promise<{ message: string }> => {
    if (isMockAuth) {
      return new Promise((resolve) => setTimeout(() => resolve({ message: "Disconnected" }), 500));
    }
    return apiClient<{ message: string }>("/api/auth/disconnect", {
      method: "POST",
      body: JSON.stringify({ provider })
    });
  },
  forgotPassword: async (email: string): Promise<{ message: string; cooldown?: number }> => {
    if (isMockAuth) {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (typeof window !== 'undefined') {
            const lastSent = sessionStorage.getItem('mockForgotLastSent');
            const now = Date.now();
            if (lastSent && now - parseInt(lastSent) < 5000) {
              const waitSec = Math.ceil((5000 - (now - parseInt(lastSent))) / 1000);
              return reject(new ApiError("TOO_MANY_REQUESTS", 429, { retryAfter: waitSec }));
            }
            sessionStorage.setItem('mockForgotLastSent', now.toString());
            resolve({ 
              message: "neutralNotice",
              cooldown: 30
            });
          } else {
            resolve({ message: "neutralNotice" });
          }
        }, 500);
      });
    }
    return apiClient<{ message: string; cooldown?: number }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },
  verifyResetOtp: async (data: { email: string; otp: string }): Promise<{ resetToken: string; expiresIn: number }> => {
    if (isMockAuth) {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (typeof window !== 'undefined') {
            const lockedUntil = parseInt(sessionStorage.getItem('resetLockedUntil') || '0', 10);
            const now = Date.now();

            if (lockedUntil > now) {
              const remainingSec = Math.ceil((lockedUntil - now) / 1000);
              return reject(new ApiError("TOO_MANY_ATTEMPTS", 429, { remainingSec }));
            }

            const expiresAt = parseInt(sessionStorage.getItem('resetExpiresAt') || '0', 10);
            if (expiresAt > 0 && now > expiresAt) {
              return reject(new ApiError("OTP_EXPIRED", 400));
            }

            let attempts = parseInt(sessionStorage.getItem('resetAttempts') || '5', 10);

            if (data.otp !== '123456') {
              attempts -= 1;
              sessionStorage.setItem('resetAttempts', Math.max(0, attempts).toString());

              if (attempts <= 0) {
                const lockTime = now + 5 * 60 * 1000; // Lock 5 minutes
                sessionStorage.setItem('resetLockedUntil', lockTime.toString());
                return reject(new ApiError("TOO_MANY_ATTEMPTS", 429, { remainingSec: 300 }));
              }

              return reject(new ApiError("INVALID_OTP", 400, { remainingAttempts: attempts }));
            }

            // Valid OTP -> return resetToken valid for 10 mins (600s)
            const resetToken = `mock-reset-token-${Date.now()}`;
            resolve({
              resetToken,
              expiresIn: 600,
            });
          } else {
            resolve({
              resetToken: `mock-reset-token-${Date.now()}`,
              expiresIn: 600,
            });
          }
        }, 500);
      });
    }
    return apiClient<{ resetToken: string; expiresIn: number }>("/auth/verify-reset-otp", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  resetPassword: async (data: { resetToken: string; newPassword: string; email?: string }): Promise<{ message: string }> => {
    if (isMockAuth) {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (typeof window !== 'undefined') {
            if (!data.resetToken) {
              return reject(new ApiError("INVALID_RESET_TOKEN", 400));
            }

            // Success: update password in mockUsers if user exists
            const targetEmail = data.email || sessionStorage.getItem('resetEmail');
            const usersStr = localStorage.getItem('mockUsers');
            if (usersStr && targetEmail) {
              try {
                const users = JSON.parse(usersStr);
                const userIndex = users.findIndex((u: any) => u.email === targetEmail);
                if (userIndex !== -1) {
                  users[userIndex].password = data.newPassword;
                  localStorage.setItem('mockUsers', JSON.stringify(users));
                }
              } catch (e) {}
            }

            resolve({ message: "RESET_SUCCESS" });
          } else {
            resolve({ message: "RESET_SUCCESS" });
          }
        }, 500);
      });
    }
    return apiClient<{ message: string }>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({
        resetToken: data.resetToken,
        newPassword: data.newPassword,
      }),
    });
  },
};

export const authApi = api;
