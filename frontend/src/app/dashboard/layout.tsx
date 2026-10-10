/* eslint-disable */
'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { 
  LayoutDashboard, 
  BellRing, 
  Users, 
  History, 
  LogOut, 
  Menu, 
  X,
  Volume2,
  VolumeX,
  Globe,
  Camera,
  UserCircle,
  ShieldCheck,
  Settings
} from 'lucide-react';
import { Logo } from '@/components/Logo';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/ui/Button';
import { isMockMode } from '@/lib/api/client';
import { setupMockService } from '@/lib/api/mockService';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, logout, can, setUser, isLoading } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isOnline, setIsOnline] = useState(true);

  React.useEffect(() => {
    if (isMockMode) {
      setupMockService();
    }
    setIsOnline(navigator.onLine);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isLoading || !user) {
    return (
      <div className="min-h-screen bg-navy-50 flex">
        <div className="w-64 bg-white border-r border-gray-200 animate-pulse hidden md:block"></div>
        <div className="flex-1 flex flex-col">
          <div className="h-16 bg-white border-b border-gray-200 animate-pulse"></div>
          <div className="flex-1 p-8">
             <div className="h-full bg-gray-200 rounded-2xl animate-pulse"></div>
          </div>
        </div>
      </div>
    );
  }

  const navItems = [
    { name: t.dashboard.dashboard, href: '/dashboard', icon: <LayoutDashboard className="w-5 h-5" />, roles: ['viewer', 'operator', 'admin'] },
    { name: t.dashboard.cameras, href: '/dashboard/cameras', icon: <Camera className="w-5 h-5" />, roles: ['viewer', 'operator', 'admin'] },
    { name: t.dashboard.history || t.history.title, href: '/dashboard/history', icon: <History className="w-5 h-5" />, roles: ['viewer', 'operator', 'admin'] },
    { name: t.dashboard.notifications, href: '/dashboard/notifications', icon: <BellRing className="w-5 h-5" />, roles: ['viewer', 'operator', 'admin'] },
    { name: t.dashboard.profile, href: '/dashboard/profile', icon: <UserCircle className="w-5 h-5" />, roles: ['viewer', 'operator', 'admin'] },
    { name: t.dashboard.users, href: '/dashboard/users', icon: <Users className="w-5 h-5" />, roles: ['admin'] },
    { name: t.dashboard.auditLog, href: '/dashboard/audit-log', icon: <ShieldCheck className="w-5 h-5" />, roles: ['admin'] },
    { name: t.dashboard.aiSettings, href: '/dashboard/ai-settings', icon: <Settings className="w-5 h-5" />, roles: ['admin'] },
  ];

  const visibleNavItems = navItems.filter(item => item.roles.includes(user.role));

  return (
    <div className="min-h-screen bg-navy-50 flex">
      <aside className={`fixed inset-y-0 left-0 z-40 bg-white border-r border-gray-200 transition-all duration-300 flex flex-col ${sidebarOpen ? 'w-64' : 'w-20 -translate-x-full md:translate-x-0'}`}>
        <div className="h-16 flex items-center justify-center border-b border-gray-200">
          <Logo iconOnly={!sidebarOpen} />
        </div>
        
        <nav className="flex-1 py-6 px-3 flex flex-col gap-2">
          {visibleNavItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link key={item.name} href={item.href}>
                <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${isActive ? 'bg-sky-50 text-sky-600' : 'text-gray-600 hover:bg-gray-50'}`}>
                  {item.icon}
                  {sidebarOpen && <span className="font-medium">{item.name}</span>}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gray-200">
          <button onClick={logout} className="flex items-center gap-3 px-3 py-2 w-full text-red-600 hover:bg-red-50 rounded-lg transition-colors">
            <LogOut className="w-5 h-5" />
            {sidebarOpen && <span className="font-medium">{t.dashboard.logout}</span>}
          </button>
        </div>
      </aside>

      <main className={`flex-1 flex flex-col transition-all duration-300 ${sidebarOpen ? 'md:ml-64' : 'md:ml-20'}`}>
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 lg:px-8 z-30 sticky top-0">
          <div className="flex items-center gap-4">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-gray-500 hover:text-navy-900">
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold text-navy-900 hidden sm:block">
              {visibleNavItems.find(i => i.href === pathname)?.name || t.dashboard.dashboard}
            </h2>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
              title={soundEnabled ? t.dashboard.muteAlerts : t.dashboard.unmuteAlerts}
            >
              {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </button>
            
            <button 
              onClick={() => setLanguage(language === 'en' ? 'vi' : 'en')}
              className="flex items-center gap-1 p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors font-medium text-sm uppercase"
            >
              <Globe className="w-4 h-4" />
              {language}
            </button>

            {isMockMode && (
              <select
                className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white text-gray-700"
                value={user.role}
                onChange={(e) => setUser({ ...user, role: e.target.value as any })}
              >
                <option value="viewer">Viewer</option>
                <option value="operator">Operator</option>
                <option value="admin">Admin</option>
              </select>
            )}

            <div className={`px-2 py-1 rounded-full text-xs font-medium ${isOnline ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {isOnline ? 'Online' : 'Offline'}
            </div>

            <div className="h-8 w-px bg-gray-200 mx-2" />
            
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <div className="text-sm font-semibold text-navy-900">{user.fullName}</div>
                <div className="text-xs text-gray-500 capitalize">
                  {user.role === 'admin' ? t.dashboard.roleAdmin : user.role === 'operator' ? t.dashboard.roleOperator : t.dashboard.roleViewer}
                </div>
              </div>
              <div className="w-9 h-9 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center font-bold text-sm overflow-hidden shadow-sm">
                {(user as any).avatarUrl ? <img src={(user as any).avatarUrl} alt="Avatar" className="w-full h-full object-cover" /> : user.fullName.charAt(0).toUpperCase()}
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 p-4 lg:p-8 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  );
}

