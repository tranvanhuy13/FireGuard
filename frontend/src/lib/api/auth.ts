/* eslint-disable */
import { apiClient, isMockAuth, ApiError, getAuthHeader, setAuthHeader, clearAuthSession } from "./client";
import { MIN_PASSWORD_LENGTH } from "@/config";

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

            const trimmedIdentifier = credentials.identifier.trim();
            const user = users.find((u: any) => 
              (u.username.toLowerCase() === trimmedIdentifier.toLowerCase() || u.email.toLowerCase() === trimmedIdentifier.toLowerCase()) && 
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

    const trimmedIdentifier = credentials.identifier.trim();
    const rawCreds = `${trimmedIdentifier}:${credentials.password}`;
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
      return new Promise((resolve, reject) =>
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
          reject(new ApiError("UNAUTHORIZED", 401));
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
    if (isMockAuth && typeof window !== 'undefined') {
      localStorage.removeItem('mockRole');
      localStorage.removeItem('mockUsername');
      localStorage.removeItem('mockUserFull');
    }
    clearAuthSession();
    return { message: "Logged out" };
  },

  disconnect: async (provider: string): Promise<{ message: string }> => {
    if (isMockAuth) {
      return new Promise((resolve) => setTimeout(() => resolve({ message: "Disconnected" }), 500));
    }
    throw new ApiError("FEATURE_NOT_IMPLEMENTED", 501, { detail: "Tính năng chưa được kích hoạt trên máy chủ" });
  },

  forgotPassword: async (email: string): Promise<{ message: string }> => {
    const trimmedEmail = email.trim().toLowerCase();
    if (isMockAuth) {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (typeof window !== 'undefined') {
            const lastSent = sessionStorage.getItem('mockForgotLastSent');
            const now = Date.now();
            if (lastSent && now - parseInt(lastSent, 10) < 60000) {
              const waitSec = Math.ceil((60000 - (now - parseInt(lastSent, 10))) / 1000);
              return reject(new ApiError("TOO_MANY_REQUESTS", 429, { retryAfter: waitSec }));
            }
            sessionStorage.setItem('mockForgotLastSent', now.toString());
            // Randomly generate OTP in mock instead of fixed code
            const mockOtp = String(Math.floor(100000 + Math.random() * 900000));
            sessionStorage.setItem('mockForgotOtp', mockOtp);
            sessionStorage.setItem('mockForgotAttempts', "0");
          }
          resolve({ message: "If that account exists, a reset code has been sent." });
        }, 500);
      });
    }

    return apiClient<{ message: string }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: trimmedEmail }),
    });
  },

  resetPassword: async (data: { email: string; otp: string; new_password: string }): Promise<{ message: string }> => {
    const trimmedEmail = data.email.trim().toLowerCase();
    const trimmedOtp = data.otp.trim();

    if (isMockAuth) {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (typeof window !== 'undefined') {
            // Check password rules: alphanumeric only, at least MIN_PASSWORD_LENGTH chars
            if (!/^[A-Za-z0-9]+$/.test(data.new_password)) {
              return reject(new ApiError("Password must not contain special characters", 400));
            }
            if (data.new_password.length < MIN_PASSWORD_LENGTH) {
              return reject(new ApiError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400));
            }

            const expectedOtp = sessionStorage.getItem('mockForgotOtp');
            let attempts = parseInt(sessionStorage.getItem('mockForgotAttempts') || '0', 10);

            if (attempts >= 5) {
              sessionStorage.removeItem('mockForgotOtp');
              return reject(new ApiError("Too many attempts. Please request a new code.", 429));
            }

            if (!expectedOtp || trimmedOtp !== expectedOtp) {
              attempts += 1;
              sessionStorage.setItem('mockForgotAttempts', attempts.toString());
              if (attempts >= 5) {
                sessionStorage.removeItem('mockForgotOtp');
                return reject(new ApiError("Too many attempts. Please request a new code.", 429));
              }
              return reject(new ApiError("Invalid or expired code", 400));
            }

            // Correct OTP: update password in mockUsers
            sessionStorage.removeItem('mockForgotOtp');
            sessionStorage.removeItem('mockForgotAttempts');
            const usersStr = localStorage.getItem('mockUsers');
            if (usersStr) {
              try {
                const users = JSON.parse(usersStr);
                const userIndex = users.findIndex((u: any) => u.email.toLowerCase() === trimmedEmail);
                if (userIndex !== -1) {
                  users[userIndex].password = data.new_password;
                  localStorage.setItem('mockUsers', JSON.stringify(users));
                }
              } catch (e) {}
            }
            resolve({ message: "Password has been reset" });
          } else {
            resolve({ message: "Password has been reset" });
          }
        }, 500);
      });
    }

    return apiClient<{ message: string }>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({
        email: trimmedEmail,
        otp: trimmedOtp,
        new_password: data.new_password,
      }),
    });
  },
};

export const authApi = api;
