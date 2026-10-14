/* eslint-disable */
'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { authApi } from '@/lib/api/auth';
import { isMockAuth } from '@/lib/api/client';
import { UserCircle, Key, Link as LinkIcon, Eye, EyeOff, Check, Camera } from 'lucide-react';
import Link from 'next/link';

const GoogleIcon = () => (
  <svg className="w-6 h-6" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

const FacebookIcon = () => (
  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="#1877F2">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.469h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.469h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
  </svg>
);

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

  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState<string | null>(null);
  const [googleLinked, setGoogleLinked] = useState(true);
  const [facebookLinked, setFacebookLinked] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [disconnectMsg, setDisconnectMsg] = useState('');
  
  const googleEmail = user?.email || 'user@gmail.com';
  const isOnlyLoginMethod = googleLinked && !facebookLinked && !user?.username;

  const confirmDisconnect = async () => {
    if (!showDisconnectConfirm || isOnlyLoginMethod) return;
    setIsDisconnecting(true);
    setDisconnectMsg('');
    try {
      await authApi.disconnect(showDisconnectConfirm);
      setDisconnectMsg(t.pages?.profile?.disconnectSuccess || 'Đã ngắt kết nối thành công');
      if (showDisconnectConfirm === 'google') setGoogleLinked(false);
      if (showDisconnectConfirm === 'facebook') setFacebookLinked(false);
      setTimeout(() => setShowDisconnectConfirm(null), 1000);
    } catch {
      setDisconnectMsg(t.pages?.profile?.disconnectError || 'Lỗi khi ngắt kết nối');
    } finally {
      setIsDisconnecting(false);
      setTimeout(() => setDisconnectMsg(''), 3000);
    }
  };

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

  const handleDisconnect = (provider: string) => {
    if (isOnlyLoginMethod && provider === 'google') return;
    setShowDisconnectConfirm(provider);
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

      {/* Linked Accounts Block */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <LinkIcon className="w-5 h-5" />
          {t.pages?.profile?.linkedAccounts || 'Tài khoản liên kết'}
        </h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded-lg hover:border-slate-300 transition-colors">
            <div className="flex items-center gap-3">
              <GoogleIcon />
              <div>
                <p className="font-medium text-gray-900">Google</p>
                {googleLinked ? (
                  <p className="text-sm text-gray-500">{t.pages?.profile?.linkedWith || 'Đã liên kết với'} {googleEmail}</p>
                ) : (
                  <p className="text-sm text-gray-500">{t.pages?.profile?.notLinked || 'Chưa liên kết'}</p>
                )}
              </div>
            </div>
            {googleLinked ? (
              <div className="relative group">
                <button 
                  onClick={() => handleDisconnect('google')}
                  disabled={isOnlyLoginMethod}
                  className={`text-sm ${isOnlyLoginMethod ? 'text-gray-400 cursor-not-allowed' : 'text-red-600 hover:underline'}`}
                >
                  {t.pages?.profile?.disconnect || 'Ngắt kết nối'}
                </button>
                {isOnlyLoginMethod && (
                  <div className="absolute right-0 bottom-full mb-2 w-48 bg-gray-800 text-white text-xs p-2 rounded hidden group-hover:block z-10 text-center">
                    Không thể ngắt kết nối phương thức đăng nhập duy nhất
                  </div>
                )}
              </div>
            ) : (
              <button className="text-sky-600 text-sm font-medium hover:underline">{t.pages?.profile?.link || 'Liên kết'}</button>
            )}
          </div>
          
          <div className="flex items-center justify-between p-4 border rounded-lg hover:border-slate-300 transition-colors">
            <div className="flex items-center gap-3">
              <FacebookIcon />
              <div>
                <p className="font-medium text-gray-900">Facebook</p>
                {facebookLinked ? (
                  <p className="text-sm text-gray-500">{t.pages?.profile?.linkedWith || 'Đã liên kết với'} Facebook</p>
                ) : (
                  <p className="text-sm text-gray-500">{t.pages?.profile?.notLinked || 'Chưa liên kết'}</p>
                )}
              </div>
            </div>
            {facebookLinked ? (
              <button onClick={() => handleDisconnect('facebook')} className="text-red-600 text-sm hover:underline">
                {t.pages?.profile?.disconnect || 'Ngắt kết nối'}
              </button>
            ) : (
              <button className="text-sky-600 text-sm font-medium hover:underline">{t.pages?.profile?.link || 'Liên kết'}</button>
            )}
          </div>
          
          <div className="pt-4 border-t mt-4 flex">
            <Link href="/dashboard/notifications" className="text-sky-600 hover:text-sky-700 text-sm font-medium flex items-center gap-1">
              {t.pages?.profile?.configAlerts || 'Cấu hình nhận cảnh báo Telegram/Zalo'} &rarr;
            </Link>
          </div>
        </div>
      </div>

      {showDisconnectConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl max-w-sm w-full shadow-2xl">
            <h3 className="text-lg font-bold mb-2">{t.pages?.profile?.confirmDisconnectTitle || 'Xác nhận'}</h3>
            <p className="text-gray-600 mb-6">{t.pages?.profile?.confirmDisconnectMsg || 'Bạn có chắc chắn muốn ngắt kết nối tài khoản này không?'}</p>
            <div className="flex justify-end gap-3">
              <button disabled={isDisconnecting} onClick={() => setShowDisconnectConfirm(null)} className="px-4 py-2 border rounded-lg font-medium text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50">
                {t.pages?.profile?.cancel || 'Hủy'}
              </button>
              <button disabled={isDisconnecting} onClick={confirmDisconnect} className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors shadow-sm disabled:opacity-50">
                {isDisconnecting ? (t.pages?.profile?.processing || 'Đang xử lý...') : (t.pages?.profile?.disconnect || 'Ngắt kết nối')}
              </button>
            </div>
            {disconnectMsg && <p className="text-sm mt-4 text-center font-medium text-green-600">{disconnectMsg}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
