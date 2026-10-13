'use client';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';

export default function RequireRole({
  roles,
  children
}: {
  roles: string[];
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const { t } = useLanguage();

  if (!user || !roles.includes(user.role)) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <h1 className="text-4xl font-bold text-red-600 mb-4">403</h1>
        <h2 className="text-xl font-semibold text-gray-800 mb-2">Access Denied</h2>
        <p className="text-gray-600">{t.pages?.common?.forbidden || 'Forbidden: You do not have access to this page.'}</p>
      </div>
    );
  }

  return <>{children}</>;
}
