/* eslint-disable */
'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { isMockAuth } from '@/lib/api/client';
import { UserCircle, Key, Eye, EyeOff, Check, Camera } from 'lucide-react';
import Link from 'next/link';

export default function ProfilePage() {
  const { user, setUser } = useAuth();
  const { t } = useLanguage();
  
  const extendedUser = user as any;
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [phone, setPhone] = useState(extendedUser?.phone || '');
  const [avatarUrl, setAvatarUrl] = useState(extendedUser?.avatarUrl || '');
  
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');

  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isPwdSaving, setIsPwdSaving] = useState(false);
  const [pwdMessage, setPwdMessage] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Validations
  let phoneError = '';
  if (phone && !/^\d{9,11}$/.test(phone)) phoneError = 'Số điện thoại không hợp lệ';
  
  const isProfileChanged = fullName !== (user?.fullName || '') || phone !== (extendedUser?.phone || '') || avatarUrl !== (extendedUser?.avatarUrl || '');
  const canSaveProfile = isProfileChanged && !phoneError;

  const rules = {
    length: newPassword.length >= 8,
    upper: /[A-Z]/.test(newPassword),
    lower: /[a-z]/.test(newPassword),
    number: /[0-9]/.test(newPassword)
  };
  const strengthScore = Object.values(rules).filter(Boolean).length;
  const strengthClass = strengthScore < 2 ? 'bg-red-500' : strengthScore < 4 ? 'bg-yellow-500' : 'bg-green-500';

  let pwdError = '';
  if (confirmPassword && confirmPassword !== newPassword) {
    pwdError = 'Xác nhận mật khẩu mới không khớp';
  } else if (newPassword && password && newPassword === password) {
    pwdError = 'Mật khẩu mới không được trùng mật khẩu cũ';
  }
  const canSavePwd = newPassword && confirmPassword && password && strengthScore === 4 && !pwdError;

  useEffect(() => {
    if (user) {
      setFullName(user.fullName || '');
      setPhone(extendedUser.phone || '');
      setAvatarUrl(extendedUser.avatarUrl || '');
    }
  }, [user, extendedUser.phone, extendedUser.avatarUrl]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSaveProfile) return;
    setIsProfileSaving(true);
    setProfileMessage('');
    try {
      await new Promise(r => setTimeout(r, 800));
      if (user) setUser({ ...user, fullName, phone, avatarUrl } as any);
      setProfileMessage('Lưu thành công');
    } catch {
      setProfileMessage('Lỗi lưu thông tin');
    } finally {
      setIsProfileSaving(false);
      setTimeout(() => setProfileMessage(''), 3000);
    }
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSavePwd) return;
    setIsPwdSaving(true);
    setPwdMessage('');
    try {
      await new Promise(r => setTimeout(r, 800));
      setPwdMessage('Đổi mật khẩu thành công');
      setPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      setPwdMessage('Lỗi đổi mật khẩu');
    } finally {
      setIsPwdSaving(false);
      setTimeout(() => setPwdMessage(''), 3000);
    }
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const url = URL.createObjectURL(e.target.files[0]);
      setAvatarUrl(url);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pt-4">
      <h1 className="text-2xl font-bold text-gray-900">{t.pages?.profile?.title || 'Hồ sơ'}</h1>
      
      {!isMockAuth && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3 text-amber-800 text-sm">
          <UserCircle className="w-5 h-5 text-amber-600 shrink-0" />
          <span>{t.auth.errors.featureNotImplemented}: Máy chủ chỉ hỗ trợ hiển thị thông tin tài khoản cơ bản. Tính năng đổi mật khẩu, cập nhật hồ sơ và liên kết mạng xã hội chưa được triển khai.</span>
        </div>
      )}

      {/* Profile Block */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
          <UserCircle className="w-5 h-5" />
          {t.pages?.profile?.title || 'Hồ sơ'}
        </h2>
        <form onSubmit={handleSaveProfile} className="space-y-6">
          
          <div className="flex items-center gap-6 mb-6">
            <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
              <div className="w-24 h-24 rounded-full bg-slate-100 flex items-center justify-center border-4 border-white shadow-md overflow-hidden text-3xl font-bold text-sky-600">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  (fullName || user?.username || 'U').charAt(0).toUpperCase()
                )}
              </div>
              <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera className="w-8 h-8 text-white" />
              </div>
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleAvatarChange} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-800">{fullName || user?.username}</h3>
              <p className="text-slate-500">{user?.email}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t.pages?.profile?.name || 'Tên'}</label>
              <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} className="w-full border rounded-lg p-2" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
              <input type="text" className="w-full border rounded-lg p-2 bg-gray-50 text-gray-500" value={user?.username || ''} readOnly disabled />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t.pages?.profile?.phone || 'Điện thoại'}</label>
              <input type="text" value={phone} onChange={e => setPhone(e.target.value)} className="w-full border rounded-lg p-2" placeholder="VD: 0912345678" />
              {phoneError && <p className="text-red-500 text-xs mt-1">{phoneError}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="text" className="w-full border rounded-lg p-2 bg-gray-50 text-gray-500" value={user?.email || ''} readOnly disabled />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t.pages?.profile?.role || 'Vai trò'}</label>
              <div className="w-full border rounded-lg p-2 bg-gray-50 flex items-center">
                <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded capitalize">
                  {user?.role === 'admin' ? (t.pages?.profile?.adminRole || 'Quản trị viên') : user?.role}
                </span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ngày tạo</label>
              <input type="text" className="w-full border rounded-lg p-2 bg-gray-50 text-gray-500" value={extendedUser?.createdAt || '2023-01-01'} readOnly disabled />
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <button type="submit" disabled={!canSaveProfile || isProfileSaving} className={`px-4 py-2 font-medium rounded-lg transition-colors ${canSaveProfile ? 'bg-sky-600 text-white hover:bg-sky-700' : 'bg-gray-200 text-gray-500 cursor-not-allowed'}`}>
              {isProfileSaving ? '...' : (t.pages?.profile?.saveInfo || 'Lưu thông tin')}
            </button>
            {isProfileChanged && <span className="text-sm text-yellow-600">Có thay đổi chưa lưu</span>}
            {profileMessage && <span className="text-sm text-green-600">{profileMessage}</span>}
          </div>
        </form>
      </div>

      {/* Password Block */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Key className="w-5 h-5" />
          {t.pages?.profile?.changePasswordBtn || 'Đổi mật khẩu'}
        </h2>
        <form onSubmit={handleSavePassword} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t.pages?.profile?.currentPassword || 'Mật khẩu hiện tại'}</label>
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} className="w-full border rounded-lg p-2 pr-10" />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-2 top-2.5 text-gray-500">
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t.pages?.profile?.newPassword || 'Mật khẩu mới'}</label>
            <div className="relative">
              <input type={showNewPassword ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full border rounded-lg p-2 pr-10" />
              <button type="button" onClick={() => setShowNewPassword(!showNewPassword)} className="absolute right-2 top-2.5 text-gray-500">
                {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            
            {newPassword && (
              <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium text-gray-600">{t.pages?.profile?.passwordStrength || 'Độ mạnh mật khẩu'}:</span>
                    <span className={strengthScore < 2 ? 'text-red-600 font-semibold' : strengthScore < 4 ? 'text-yellow-600 font-semibold' : 'text-green-600 font-semibold'}>
                      {strengthScore < 2 ? 'Yếu' : strengthScore < 4 ? 'Trung bình' : 'Mạnh'}
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                    <div className={`h-full transition-all ${strengthClass}`} style={{ width: `${(strengthScore / 4) * 100}%` }} />
                  </div>
                </div>
                <div className="text-xs space-y-1 mt-3 grid grid-cols-2 gap-1">
                  <div className={`flex items-center gap-1 ${rules.length ? 'text-green-600' : 'text-gray-500'}`}>
                    {rules.length ? <Check className="w-3 h-3" /> : <span className="w-3" />} Ít nhất 8 ký tự
                  </div>
                  <div className={`flex items-center gap-1 ${rules.upper ? 'text-green-600' : 'text-gray-500'}`}>
                    {rules.upper ? <Check className="w-3 h-3" /> : <span className="w-3" />} Chữ hoa
                  </div>
                  <div className={`flex items-center gap-1 ${rules.lower ? 'text-green-600' : 'text-gray-500'}`}>
                    {rules.lower ? <Check className="w-3 h-3" /> : <span className="w-3" />} Chữ thường
                  </div>
                  <div className={`flex items-center gap-1 ${rules.number ? 'text-green-600' : 'text-gray-500'}`}>
                    {rules.number ? <Check className="w-3 h-3" /> : <span className="w-3" />} Chữ số
                  </div>
                </div>
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t.pages?.profile?.confirmNewPassword || 'Xác nhận mật khẩu mới'}</label>
            <div className="relative">
              <input type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full border rounded-lg p-2 pr-10" />
              <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-2 top-2.5 text-gray-500">
                {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {pwdError && <p className="text-red-500 text-xs mt-1">{pwdError}</p>}
          </div>
          
          <div className="flex items-center gap-4 pt-2">
            <button type="submit" disabled={!canSavePwd || isPwdSaving} className={`px-4 py-2 font-medium rounded-lg transition-colors ${canSavePwd ? 'bg-sky-600 text-white hover:bg-sky-700' : 'bg-gray-200 text-gray-500 cursor-not-allowed'}`}>
              {isPwdSaving ? '...' : (t.pages?.profile?.changePasswordBtn || 'Đổi mật khẩu')}
            </button>
            {pwdMessage && <span className="text-sm text-green-600">{pwdMessage}</span>}
          </div>
        </form>
      </div>

      {/* Quick Link to Notifications */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{t.pages?.profile?.configAlerts || 'Cấu hình nhận cảnh báo Telegram/Zalo'}</h2>
        </div>
        <Link href="/dashboard/notifications" className="text-sky-600 hover:text-sky-700 text-sm font-medium flex items-center gap-1">
          {t.pages?.profile?.configAlerts || 'Cấu hình nhận cảnh báo Telegram/Zalo'} &rarr;
        </Link>
      </div>
    </div>
  );
}
