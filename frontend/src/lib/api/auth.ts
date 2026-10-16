/* eslint-disable */
import { apiClient, isMockAuth, ApiError, getAuthHeader, setAuthHeader, clearAuthSession } from "./client";

export interface User {
  id: string;
  username: string;
  fullName: string;
  email: string;
  role: "admin" | "operator" | "viewer";
  is_active?: boolean;
}

export const api = {
  login: async (credentials: { identifier: string; password: string }): Promise<{ user: User; token: string }> => {
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
              const userProfile: User = { id: user.id, username: user.username, fullName: user.fullName, email: user.email, role: user.role, is_active: true };
              localStorage.setItem('mockRole', user.role);
              localStorage.setItem('mockUsername', user.username);
              localStorage.setItem('mockUserFull', JSON.stringify(user));
              if (typeof window !== 'undefined') {
                sessionStorage.setItem('user_profile', JSON.stringify(userProfile));
              }
              resolve({
                user: userProfile,
                token: "mock-jwt-token",
              });
            } else {
              reject(new ApiError("invalidCredentials", 401));
            }
          }
        }, 500)
      );
    }

    const rawCreds = `${credentials.identifier.trim()}:${credentials.password}`;
    const basicHeader = "Basic " + (typeof window !== 'undefined' ? btoa(unescape(encodeURIComponent(rawCreds))) : Buffer.from(rawCreds).toString('base64'));

    try {
      const res = await apiClient<{ id: number; username: string; email: string; is_active: boolean }>("/auth/login", {
        method: "GET",
        headers: {
          Authorization: basicHeader,
        },
      });

      // Session saved in memory and sessionStorage only
      setAuthHeader(basicHeader);
      const user: User = {
        id: String(res.id),
        username: res.username,
        fullName: res.username,
        email: res.email,
        role: "viewer", // Real backend has no roles, default to viewer
        is_active: res.is_active,
      };

      if (typeof window !== 'undefined') {
        sessionStorage.setItem('user_profile', JSON.stringify(user));
      }

      return { user, token: basicHeader };
    } catch (err: any) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          throw new ApiError("invalidCredentials", 401);
        }
        if (err.status === 403 || err.message === "Account not verified") {
          throw new ApiError("accountNotVerified", 403, { email: credentials.identifier });
        }
      }
      throw err;
    }
  },

  register: async (data: { username: string; email: string; password: string }): Promise<{ message: string }> => {
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
              reject(new ApiError("emailExists", 400));
            } else {
              const newUser = {
                id: Date.now().toString(),
                username: data.username,
                email: data.email,
                password: data.password,
                fullName: data.username,
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

    await apiClient<{ id: number; username: string }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify({
        username: data.username.trim(),
        email: data.email.trim().toLowerCase(),
        password: data.password,
      }),
    });
    return { message: "Registration successful" };
  },

  verifyOtp: async (data: { email: string; otp: string }): Promise<{ message: string }> => {
    if (isMockAuth) {
      return new Promise((resolve, reject) =>
        setTimeout(() => {
          if (data.otp === "123456") {
            resolve({ message: "Account verified" });
          } else {
            reject(new ApiError("invalidOtp", 400));
          }
        }, 500)
      );
    }

    return apiClient<{ message: string }>("/auth/verify-otp", {
      method: "POST",
      body: JSON.stringify({
        email: data.email.trim().toLowerCase(),
        otp: data.otp.trim(),
      }),
    });
  },

  resendOtp: async (data: { email: string }): Promise<{ message: string }> => {
    if (isMockAuth) {
      return new Promise((resolve) =>
        setTimeout(() => {
          resolve({ message: "OTP sent" });
        }, 500)
      );
    }

    return apiClient<{ message: string }>("/auth/resend-otp", {
      method: "POST",
      body: JSON.stringify({
        email: data.email.trim().toLowerCase(),
      }),
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
                  fullName: u.fullName || u.username,
                  email: u.email,
                  role: u.role,
                  is_active: true,
                },
              });
              return;
            }
          }
          // fallback
          resolve({
            user: { id: "0", username: "guest", fullName: "Guest", email: "guest@fireguard.ai", role: "viewer", is_active: false },
          });
        }, 500)
      );
    }

    const authHeader = getAuthHeader();
    if (!authHeader) {
      throw new ApiError("UNAUTHORIZED", 401);
    }

    const res = await apiClient<{ id: number; username: string; email: string; is_active: boolean }>("/users/me");
    const user: User = {
      id: String(res.id),
      username: res.username,
      fullName: res.username,
      email: res.email,
      role: "viewer", // Real backend defaults to viewer
      is_active: res.is_active,
    };

    if (typeof window !== 'undefined') {
      sessionStorage.setItem('user_profile', JSON.stringify(user));
    }

    return { user };
  },

  getStreamToken: async (): Promise<{ token: string; expires_in: number }> => {
    if (isMockAuth) {
      return { token: "mock-stream-token", expires_in: 3600 };
    }
    return apiClient<{ token: string; expires_in: number }>("/auth/stream-token");
  },

  logout: async (): Promise<{ message: string }> => {
    clearAuthSession();
    return { message: "Logged out" };
  },

  disconnect: async (provider: string): Promise<{ message: string }> => {
    if (isMockAuth) {
      return new Promise((resolve) => setTimeout(() => resolve({ message: "Disconnected" }), 500));
    }
    throw new ApiError("FEATURE_NOT_IMPLEMENTED", 501, { detail: "Tính năng chưa được kích hoạt trên máy chủ" });
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
    throw new ApiError("FEATURE_NOT_IMPLEMENTED", 501, { detail: "Tính năng chưa được kích hoạt trên máy chủ" });
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
    throw new ApiError("FEATURE_NOT_IMPLEMENTED", 501, { detail: "Tính năng chưa được kích hoạt trên máy chủ" });
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
    throw new ApiError("FEATURE_NOT_IMPLEMENTED", 501, { detail: "Tính năng chưa được kích hoạt trên máy chủ" });
  },
};

export const authApi = api;
