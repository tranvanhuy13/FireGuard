/* eslint-disable react-hooks/set-state-in-effect */
'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useTheme } from '@/context/ThemeContext';
import { setAuthHeader } from '@/lib/api/client';
import { authApi } from '@/lib/api/auth';
import {
  UserCircle,
  Eye,
  EyeOff,
  Check,
  Camera,
  Upload,
  Trash2,
  Sun,
  Moon,
  Monitor,
  ShieldCheck,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Sparkles,
} from 'lucide-react';

const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2MB

export default function ProfilePage() {
  const { user, setUser, refreshStreamToken } = useAuth();
  const { t } = useLanguage();
  const { theme, setTheme, resolvedTheme } = useTheme();

  const p = (t.pages?.profile || {}) as Record<string, string>;

  // ---------------------------------------------------------------------------
  // Profile Info States
  // ---------------------------------------------------------------------------
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || '');
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [avatarMessage, setAvatarMessage] = useState('');
  const [avatarError, setAvatarError] = useState('');

  // ---------------------------------------------------------------------------
  // Password Change States
  // ---------------------------------------------------------------------------
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isPwdSaving, setIsPwdSaving] = useState(false);
  const [pwdMessage, setPwdMessage] = useState('');
  const [pwdErrorMessage, setPwdErrorMessage] = useState('');

  // ---------------------------------------------------------------------------
  // Stream Token States
  // ---------------------------------------------------------------------------
  const [isRefreshingToken, setIsRefreshingToken] = useState(false);
  const [tokenMessage, setTokenMessage] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---------------------------------------------------------------------------
  // Phone Validation Helper
  // ---------------------------------------------------------------------------
  const validatePhone = (val: string): string => {
    const trimmed = val.trim();
    if (trimmed && !/^\d{9,11}$/.test(trimmed)) {
      return p.phoneError || 'Số điện thoại không hợp lệ (9-11 chữ số)';
    }
    return '';
  };

  // ---------------------------------------------------------------------------
  // Computed Validation & Rules
  // ---------------------------------------------------------------------------
  const initialFullName = user?.fullName || user?.username || '';
  const initialPhone = user?.phone || '';
  const initialAvatar = user?.avatarUrl || '';
  const isProfileChanged =
    fullName !== initialFullName ||
    phone !== initialPhone ||
    avatarUrl !== initialAvatar;
  const canSaveProfile = isProfileChanged && !isProfileSaving;

  const rules = {
    length: newPassword.length >= 8,
    upper: /[A-Z]/.test(newPassword),
    lower: /[a-z]/.test(newPassword),
    number: /[0-9]/.test(newPassword),
  };
  const strengthScore = Object.values(rules).filter(Boolean).length;
  const strengthClass =
    strengthScore < 2
      ? 'bg-red-500'
      : strengthScore < 4
      ? 'bg-yellow-500'
      : 'bg-green-500';

  let pwdError = '';
  if (confirmPassword && confirmPassword !== newPassword) {
    pwdError = p.pwdMismatch || 'Xác nhận mật khẩu mới không khớp';
  } else if (newPassword && password && newPassword === password) {
    pwdError = p.pwdSameAsOld || 'Mật khẩu mới không được trùng mật khẩu cũ';
  }
  const canSavePwd =
    Boolean(password && newPassword && confirmPassword && strengthScore === 4 && !pwdError && !isPwdSaving);

  // ---------------------------------------------------------------------------
  // Initialize Profile on User Load
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (user) {
      setFullName(user.fullName || user.username || '');
      setPhone(user.phone || '');
      const savedAvatar =
        user.avatarUrl ||
        (typeof window !== 'undefined'
          ? localStorage.getItem(`fireguard_avatar_${user.username}`) || ''
          : '');
      setAvatarUrl(savedAvatar);
    }
  }, [user]);

  // ---------------------------------------------------------------------------
  // Avatar Upload / Remove
  // ---------------------------------------------------------------------------
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAvatarError('');
    setAvatarMessage('');
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setAvatarError(p.avatarTypeError || 'Vui lòng chọn định dạng file ảnh hợp lệ (JPG, PNG, WEBP).');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (file.size > MAX_AVATAR_SIZE) {
      setAvatarError(p.avatarSizeError || 'Ảnh vượt quá kích thước cho phép (tối đa 2MB).');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64Url = event.target?.result as string;
      setAvatarUrl(base64Url);
      setAvatarMessage(p.avatarUpdated || 'Cập nhật ảnh đại diện thành công!');
      setTimeout(() => setAvatarMessage(''), 3000);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveAvatar = () => {
    setAvatarError('');
    setAvatarUrl('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setAvatarMessage(p.avatarRemoved || 'Đã xóa ảnh đại diện!');
    setTimeout(() => setAvatarMessage(''), 3000);
  };

  // ---------------------------------------------------------------------------
  // Save Profile Handler
  // ---------------------------------------------------------------------------
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const phoneValidationError = validatePhone(phone);
    if (phoneValidationError) {
      setPhoneError(phoneValidationError);
      return;
    }
    setPhoneError('');
    if (!canSaveProfile) return;

    setIsProfileSaving(true);
    setProfileMessage('');

    try {
      const res = await authApi.updateProfile({ fullName, phone: phone.trim(), avatarUrl });
      setUser(res.user);

      if (typeof window !== 'undefined' && user?.username) {
        if (avatarUrl) {
          localStorage.setItem(`fireguard_avatar_${user.username}`, avatarUrl);
        } else {
          localStorage.removeItem(`fireguard_avatar_${user.username}`);
        }
      }

      setProfileMessage(p.saveSuccess || 'Profile information saved successfully!');
    } catch (err: unknown) {
      const error = err as { data?: { detail?: string }; message?: string };
      setProfileMessage(error?.data?.detail || error?.message || p.saveError || 'Failed to save profile information.');
    } finally {
      setIsProfileSaving(false);
      setTimeout(() => setProfileMessage(''), 3500);
    }
  };

  // ---------------------------------------------------------------------------
  // Save Password Handler
  // ---------------------------------------------------------------------------
  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSavePwd) return;

    setIsPwdSaving(true);
    setPwdMessage('');
    setPwdErrorMessage('');

    try {
      await authApi.changePassword({
        currentPassword: password,
        newPassword,
      });

      // Update Basic Auth Header with new credentials to keep the active session valid
      if (user) {
        const rawCreds = `${user.username}:${newPassword}`;
        const newBasicHeader =
          'Basic ' +
          (typeof window !== 'undefined'
            ? btoa(unescape(encodeURIComponent(rawCreds)))
            : Buffer.from(rawCreds).toString('base64'));
        setAuthHeader(newBasicHeader);
      }

      setPwdMessage(p.pwdSuccess || 'Password updated successfully!');
      setPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      const error = err as { data?: { detail?: string }; message?: string };
      const msg = error?.data?.detail || error?.message || p.pwdError || 'Lỗi đổi mật khẩu.';
      setPwdErrorMessage(msg);
    } finally {
      setIsPwdSaving(false);
      setTimeout(() => {
        setPwdMessage('');
        setPwdErrorMessage('');
      }, 4000);
    }
  };

  // ---------------------------------------------------------------------------
  // Refresh Stream Token Handler
  // ---------------------------------------------------------------------------
  const handleRefreshStreamToken = async () => {
    setIsRefreshingToken(true);
    setTokenMessage('');

    try {
      const token = await refreshStreamToken();
      if (!token) {
        setTokenMessage(p.streamTokenError || 'Lỗi làm mới mã stream token.');
        return;
      }
      setTokenMessage(p.streamTokenRefreshed || 'Đã làm mới mã kết nối thành công!');
    } catch {
      setTokenMessage(p.streamTokenError || 'Lỗi làm mới mã stream token.');
    } finally {
      setIsRefreshingToken(false);
      setTimeout(() => setTokenMessage(''), 3500);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12 pt-2">
      {/* Page Title & Description */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 flex items-center gap-3">
          <UserCircle className="w-7 h-7 text-sky-600 dark:text-sky-400" />
          {p.title || 'Hồ sơ & Cài đặt'}
        </h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
          {p.pageDesc || 'Quản lý thông tin tài khoản cá nhân, ảnh đại diện, giao diện hiển thị và bảo mật hệ thống.'}
        </p>
      </div>

      {/* Sync Status Banner */}
      <div className="bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/60 rounded-xl p-4 flex items-center gap-3 text-sky-800 dark:text-sky-300 text-sm">
        <ShieldCheck className="w-5 h-5 text-sky-600 dark:text-sky-400 shrink-0" />
        <span>
          {p.noticeDesc || 'Thông tin tài khoản, ảnh đại diện và mật khẩu đã được kết nối đồng bộ an toàn với cơ sở dữ liệu hệ thống.'}
        </span>
      </div>

      {/* ========================================================================= */}
      {/* SECTION 1: ACCOUNT INFORMATION & AVATAR */}
      {/* ========================================================================= */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-800 transition-colors">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-6 flex items-center gap-2">
          <UserCircle className="w-5 h-5 text-sky-600 dark:text-sky-400" />
          {p.accountInfo || 'Thông tin tài khoản'}
        </h2>

        {/* Avatar Area */}
        <div className="p-5 bg-slate-50/70 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-800 mb-6">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div
              className="relative group cursor-pointer shrink-0"
              onClick={() => fileInputRef.current?.click()}
              title={p.avatarClickHint || 'Nhấn để tải hoặc thay đổi ảnh đại diện'}
            >
              <div className="w-24 h-24 rounded-full bg-sky-100 dark:bg-slate-800 flex items-center justify-center border-4 border-white dark:border-slate-700 shadow-md overflow-hidden text-3xl font-bold text-sky-600 dark:text-sky-400 transition-transform group-hover:scale-105">
                {avatarUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  (fullName || user?.username || 'U').charAt(0).toUpperCase()
                )}
              </div>
              <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera className="w-7 h-7 text-white" />
              </div>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/png, image/jpeg, image/jpg, image/webp"
                onChange={handleAvatarChange}
              />
            </div>

            <div className="flex-1 text-center sm:text-left space-y-2">
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-sky-500 hover:bg-sky-700 text-white flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
                >
                  {avatarUrl ? <Camera className="w-3.5 h-3.5" /> : <Upload className="w-3.5 h-3.5" />}
                  {avatarUrl ? p.changeAvatar || 'Thay đổi ảnh' : p.uploadAvatar || 'Tải ảnh lên'}
                </button>

                {avatarUrl && (
                  <button
                    type="button"
                    onClick={handleRemoveAvatar}
                    className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {p.deleteAvatar || 'Xóa ảnh'}
                  </button>
                )}
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                {p.avatarHint || 'Hỗ trợ JPG, PNG, WEBP. Kích thước tối đa 2MB.'}
              </p>

              {avatarMessage && (
                <p className="text-xs font-medium text-green-600 dark:text-green-400 flex items-center gap-1 justify-center sm:justify-start">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {avatarMessage}
                </p>
              )}

              {avatarError && (
                <p className="text-xs font-medium text-red-600 dark:text-red-400 flex items-center gap-1 justify-center sm:justify-start">
                  <AlertTriangle className="w-3.5 h-3.5" /> {avatarError}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Profile Inputs Form */}
        <form onSubmit={handleSaveProfile} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                {p.name || 'Họ và tên'}
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 rounded-lg p-2.5 focus:ring-2 focus:ring-sky-500 focus:outline-none"
                placeholder={p.namePlaceholder || 'Nhập họ và tên...'}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                {p.phone || 'Số điện thoại'}
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (phoneError) {
                    setPhoneError(validatePhone(e.target.value));
                  }
                }}
                onBlur={() => {
                  setPhoneError(validatePhone(phone));
                }}
                className={`w-full border ${
                  phoneError ? 'border-red-500' : 'border-gray-300 dark:border-slate-700'
                } bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 rounded-lg p-2.5 focus:ring-2 focus:ring-sky-500 focus:outline-none`}
                placeholder={p.phonePlaceholder || 'VD: 0912345678'}
              />
              {phoneError && (
                <p className="text-xs text-red-500 mt-1">{phoneError}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                {p.username || 'Tên đăng nhập'}
              </label>
              <input
                type="text"
                className="w-full border border-gray-200 dark:border-slate-800 rounded-lg p-2.5 bg-gray-50 dark:bg-slate-800/50 text-gray-500 dark:text-slate-400 cursor-not-allowed"
                value={user?.username || ''}
                readOnly
                disabled
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                {p.email || 'Địa chỉ Email'}
              </label>
              <input
                type="text"
                className="w-full border border-gray-200 dark:border-slate-800 rounded-lg p-2.5 bg-gray-50 dark:bg-slate-800/50 text-gray-500 dark:text-slate-400 cursor-not-allowed"
                value={user?.email || ''}
                readOnly
                disabled
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                {p.role || 'Vai trò'}
              </label>
              <div className="w-full border border-gray-200 dark:border-slate-800 rounded-lg p-2.5 bg-gray-50 dark:bg-slate-800/50 flex items-center">
                <span
                  className={`text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize ${
                    user?.role === 'admin'
                      ? 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300'
                      : 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                  }`}
                >
                  {user?.role === 'admin' ? p.adminRole || 'Quản trị viên' : p.userRole || 'Người dùng'}
                </span>
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                {p.verificationStatus || 'Trạng thái xác thực'}
              </label>
              <div className="w-full border border-gray-200 dark:border-slate-800 rounded-lg p-2.5 bg-gray-50 dark:bg-slate-800/50 flex items-center">
                <span className="bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-300 text-xs font-medium px-2.5 py-0.5 rounded-full flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {p.verifiedGmail || 'Đã xác thực qua Gmail OTP'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 pt-2">
            <button
              type="submit"
              disabled={!canSaveProfile}
              className={`px-5 py-2.5 font-medium rounded-lg transition-colors flex items-center gap-2 ${
                canSaveProfile
                  ? 'bg-sky-600 text-white hover:bg-sky-700 cursor-pointer shadow-sm'
                  : 'bg-gray-200 dark:bg-slate-800 text-gray-400 dark:text-slate-500 cursor-not-allowed'
              }`}
            >
              {isProfileSaving ? p.savingInfo || 'Đang lưu...' : p.saveInfo || 'Lưu thông tin'}
            </button>

            {isProfileChanged && (
              <span className="text-sm text-amber-600 dark:text-amber-400">
                {p.unsavedChanges || 'Có thay đổi chưa lưu'}
              </span>
            )}

            {profileMessage && (
              <span className="text-sm text-green-600 dark:text-green-400">{profileMessage}</span>
            )}
          </div>
        </form>
      </div>

      {/* ========================================================================= */}
      {/* SECTION 2: THEME & DISPLAY MODE */}
      {/* ========================================================================= */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-800 transition-colors">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2">
            <Sun className="w-5 h-5 text-amber-500" />
            {p.theme || 'Giao diện màn hình'}
          </h2>
          <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
            {p.themeCurrent || 'Hiện tại'}: {resolvedTheme === 'dark' ? p.themeDark || 'Chế độ Tối' : p.themeLight || 'Chế độ Sáng'}
          </span>
        </div>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
          {p.themeDesc || 'Tùy chỉnh chế độ hiển thị phù hợp với điều kiện làm việc ngày hoặc đêm.'}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <button
            type="button"
            onClick={() => setTheme('light')}
            className={`p-4 rounded-xl border-2 flex flex-col items-center justify-center gap-3 transition-all cursor-pointer ${
              theme === 'light'
                ? 'border-sky-500 bg-sky-50/50 dark:bg-sky-950/20 text-sky-700 dark:text-sky-300 shadow-sm'
                : 'border-gray-200 dark:border-slate-800 hover:border-gray-300 dark:hover:border-slate-700 text-gray-700 dark:text-slate-300'
            }`}
          >
            <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
              <Sun className="w-6 h-6" />
            </div>
            <div className="text-center">
              <div className="font-semibold">{p.themeLight || 'Chế độ Sáng'}</div>
              <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                {p.themeLightDesc || 'Nền trắng tinh tế, sắc nét'}
              </div>
            </div>
            {theme === 'light' && (
              <span className="text-xs font-semibold text-sky-600 dark:text-sky-400 flex items-center gap-1">
                <Check className="w-4 h-4" /> {p.themeSelected || 'Đang chọn'}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setTheme('dark')}
            className={`p-4 rounded-xl border-2 flex flex-col items-center justify-center gap-3 transition-all cursor-pointer ${
              theme === 'dark'
                ? 'border-sky-500 bg-sky-50/50 dark:bg-sky-950/20 text-sky-700 dark:text-sky-300 shadow-sm'
                : 'border-gray-200 dark:border-slate-800 hover:border-gray-300 dark:hover:border-slate-700 text-gray-700 dark:text-slate-300'
            }`}
          >
            <div className="w-12 h-12 rounded-full bg-slate-800 text-indigo-300 flex items-center justify-center">
              <Moon className="w-6 h-6" />
            </div>
            <div className="text-center">
              <div className="font-semibold">{p.themeDark || 'Chế độ Tối'}</div>
              <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                {p.themeDarkDesc || 'Dịu mắt khi trực ca đêm'}
              </div>
            </div>
            {theme === 'dark' && (
              <span className="text-xs font-semibold text-sky-600 dark:text-sky-400 flex items-center gap-1">
                <Check className="w-4 h-4" /> {p.themeSelected || 'Đang chọn'}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setTheme('system')}
            className={`p-4 rounded-xl border-2 flex flex-col items-center justify-center gap-3 transition-all cursor-pointer ${
              theme === 'system'
                ? 'border-sky-500 bg-sky-50/50 dark:bg-sky-950/20 text-sky-700 dark:text-sky-300 shadow-sm'
                : 'border-gray-200 dark:border-slate-800 hover:border-gray-300 dark:hover:border-slate-700 text-gray-700 dark:text-slate-300'
            }`}
          >
            <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center">
              <Monitor className="w-6 h-6" />
            </div>
            <div className="text-center">
              <div className="font-semibold">{p.themeSystem || 'Theo Hệ thống'}</div>
              <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                {p.themeSystemDesc || 'Tự động theo hệ điều hành Windows/Mac'}
              </div>
            </div>
            {theme === 'system' && (
              <span className="text-xs font-semibold text-sky-600 dark:text-sky-400 flex items-center gap-1">
                <Check className="w-4 h-4" /> {p.themeSelected || 'Đang chọn'}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SECTION 3: ROLE CAPABILITIES (RBAC OVERVIEW) */}
      {/* ========================================================================= */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-800 transition-colors">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-sky-600 dark:text-sky-400" />
            {p.rbacOverview || 'Bảng quyền hạn tài khoản'}
          </h2>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full uppercase bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
            {user?.role}
          </span>
        </div>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
          {p.rbacDesc || 'Các tính năng bạn được phép truy cập theo phân quyền hiện tại.'}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div className="p-3 rounded-xl border border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/30 flex items-center justify-between">
            <span className="text-gray-700 dark:text-slate-300">{p.capLiveFeeds || 'Xem trực tiếp camera & phát hiện sự cố'}</span>
            <span className="text-green-600 dark:text-green-400 font-medium flex items-center gap-1 text-xs">
              <Check className="w-4 h-4" /> {p.capAllowed || 'Cho phép'}
            </span>
          </div>

          <div className="p-3 rounded-xl border border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/30 flex items-center justify-between">
            <span className="text-gray-700 dark:text-slate-300">{p.capToggleCameras || 'Bật / Tắt hoạt động của Camera'}</span>
            <span className="text-green-600 dark:text-green-400 font-medium flex items-center gap-1 text-xs">
              <Check className="w-4 h-4" /> {p.capAllowed || 'Cho phép'}
            </span>
          </div>

          <div className="p-3 rounded-xl border border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/30 flex items-center justify-between">
            <span className="text-gray-700 dark:text-slate-300">{p.capVideoAnalysis || 'Phân tích video ngoại tuyến tải lên'}</span>
            <span className="text-green-600 dark:text-green-400 font-medium flex items-center gap-1 text-xs">
              <Check className="w-4 h-4" /> {p.capAllowed || 'Cho phép'}
            </span>
          </div>

          <div className="p-3 rounded-xl border border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/30 flex items-center justify-between">
            <span className="text-gray-700 dark:text-slate-300">{p.capAddRecipients || 'Thêm người nhận cảnh báo Telegram / Zalo'}</span>
            <span className="text-green-600 dark:text-green-400 font-medium flex items-center gap-1 text-xs">
              <Check className="w-4 h-4" /> {p.capAllowed || 'Cho phép'}
            </span>
          </div>

          <div className="p-3 rounded-xl border border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/30 flex items-center justify-between">
            <span className="text-gray-700 dark:text-slate-300">{p.capManageCameras || 'Thêm, sửa, xóa Camera hệ thống'}</span>
            {user?.role === 'admin' ? (
              <span className="text-green-600 dark:text-green-400 font-medium flex items-center gap-1 text-xs">
                <Check className="w-4 h-4" /> {p.capAllowed || 'Cho phép'} ({p.adminRole || 'Admin'})
              </span>
            ) : (
              <span className="text-gray-400 dark:text-slate-500 text-xs">{p.capAdminOnly || 'Chỉ dành cho Admin'}</span>
            )}
          </div>

          <div className="p-3 rounded-xl border border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/30 flex items-center justify-between">
            <span className="text-gray-700 dark:text-slate-300">{p.capManageUsers || 'Quản lý người dùng & Khóa tài khoản'}</span>
            {user?.role === 'admin' ? (
              <span className="text-green-600 dark:text-green-400 font-medium flex items-center gap-1 text-xs">
                <Check className="w-4 h-4" /> {p.capAllowed || 'Cho phép'} ({p.adminRole || 'Admin'})
              </span>
            ) : (
              <span className="text-gray-400 dark:text-slate-500 text-xs">{p.capAdminOnly || 'Chỉ dành cho Admin'}</span>
            )}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SECTION 4: SECURITY & PASSWORD CHANGE */}
      {/* ========================================================================= */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-800 transition-colors">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-6 flex items-center gap-2">
          <Lock className="w-5 h-5 text-sky-600 dark:text-sky-400" />
          {p.securityTitle || 'Bảo mật & Phiên làm việc'}
        </h2>

        {/* Change Password Sub-block */}
        <form onSubmit={handleSavePassword} className="space-y-4 mb-8">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-200">
            {p.changePassword || 'Đổi mật khẩu'}
          </h3>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
              {p.currentPassword || 'Mật khẩu hiện tại'}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 rounded-lg p-2.5 pr-10 focus:ring-2 focus:ring-sky-500 focus:outline-none"
                placeholder={p.currentPasswordPlaceholder || 'Nhập mật khẩu hiện tại...'}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-3 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
              {p.newPassword || 'Mật khẩu mới'}
            </label>
            <div className="relative">
              <input
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 rounded-lg p-2.5 pr-10 focus:ring-2 focus:ring-sky-500 focus:outline-none"
                placeholder={p.newPasswordPlaceholder || 'Ít nhất 8 ký tự, bao gồm chữ hoa, thường & số...'}
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-3 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 cursor-pointer"
              >
                {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>

            {newPassword && (
              <div className="mt-3 p-3 bg-gray-50 dark:bg-slate-800/60 rounded-xl border border-gray-100 dark:border-slate-700/60">
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium text-gray-600 dark:text-slate-400">
                      {p.passwordStrength || 'Độ mạnh mật khẩu'}:
                    </span>
                    <span
                      className={
                        strengthScore < 2
                          ? 'text-red-600 font-semibold'
                          : strengthScore < 4
                          ? 'text-yellow-600 font-semibold'
                          : 'text-green-600 font-semibold'
                      }
                    >
                      {strengthScore < 2
                        ? p.strengthWeak || 'Yếu'
                        : strengthScore < 4
                        ? p.strengthMedium || 'Trung bình'
                        : p.strengthStrong || 'Mạnh'}
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${strengthClass}`}
                      style={{ width: `${(strengthScore / 4) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="text-xs space-y-1 mt-3 grid grid-cols-2 gap-1">
                  <div className={`flex items-center gap-1 ${rules.length ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-slate-500'}`}>
                    {rules.length ? <Check className="w-3.5 h-3.5" /> : <span className="w-3.5" />} {p.ruleMinLength || 'Ít nhất 8 ký tự'}
                  </div>
                  <div className={`flex items-center gap-1 ${rules.upper ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-slate-500'}`}>
                    {rules.upper ? <Check className="w-3.5 h-3.5" /> : <span className="w-3.5" />} {p.ruleUpper || 'Chữ hoa (A-Z)'}
                  </div>
                  <div className={`flex items-center gap-1 ${rules.lower ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-slate-500'}`}>
                    {rules.lower ? <Check className="w-3.5 h-3.5" /> : <span className="w-3.5" />} {p.ruleLower || 'Chữ thường (a-z)'}
                  </div>
                  <div className={`flex items-center gap-1 ${rules.number ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-slate-500'}`}>
                    {rules.number ? <Check className="w-3.5 h-3.5" /> : <span className="w-3.5" />} {p.ruleNumber || 'Chữ số (0-9)'}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
              {p.confirmNewPassword || 'Xác nhận mật khẩu mới'}
            </label>
            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 rounded-lg p-2.5 pr-10 focus:ring-2 focus:ring-sky-500 focus:outline-none"
                placeholder={p.confirmNewPasswordPlaceholder || 'Nhập lại mật khẩu mới...'}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-3 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 cursor-pointer"
              >
                {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {pwdError && <p className="text-red-500 text-xs mt-1">{pwdError}</p>}
          </div>

          <div className="flex items-center gap-4 pt-1">
            <button
              type="submit"
              disabled={!canSavePwd}
              className={`px-5 py-2.5 font-medium rounded-lg transition-colors ${
                canSavePwd
                  ? 'bg-sky-600 text-white hover:bg-sky-700 cursor-pointer shadow-sm'
                  : 'bg-gray-200 dark:bg-slate-800 text-gray-400 dark:text-slate-500 cursor-not-allowed'
              }`}
            >
              {isPwdSaving ? p.updatingPassword || 'Đang cập nhật...' : p.changePasswordBtn || 'Đổi mật khẩu'}
            </button>
            {pwdMessage && <span className="text-sm text-green-600 dark:text-green-400">{pwdMessage}</span>}
            {pwdErrorMessage && <span className="text-sm text-red-600 dark:text-red-400">{pwdErrorMessage}</span>}
          </div>
        </form>

        {/* Stream Token Sub-block */}
        <div className="pt-6 border-t border-gray-100 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h4 className="font-medium text-gray-900 dark:text-slate-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              {p.streamTokenTitle || 'Mã bảo mật luồng Camera (Stream Token)'}
            </h4>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              {p.streamTokenDesc || 'Mã chữ ký xác thực phiên xem luồng video trực tiếp qua WebSocket và MJPEG stream.'}
            </p>
          </div>

          <div className="flex items-center gap-3 self-end sm:self-auto">
            <button
              type="button"
              onClick={handleRefreshStreamToken}
              disabled={isRefreshingToken}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-gray-300 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-700 dark:text-slate-300 transition-colors flex items-center gap-2 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingToken ? 'animate-spin' : ''}`} />
              {isRefreshingToken ? p.refreshingStreamToken || 'Đang làm mới...' : p.refreshStreamToken || 'Làm mới Stream Token'}
            </button>
          </div>
        </div>

        {tokenMessage && (
          <p className="text-xs text-green-600 dark:text-green-400 mt-2 font-medium">
            {tokenMessage}
          </p>
        )}
      </div>
    </div>
  );
}
