/* eslint-disable */
'use client';

import React, { useEffect, useState } from 'react';
import RequireRole from '@/components/RequireRole';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { UserCheck, UserX } from 'lucide-react';
import { API_URL } from '@/config';
import { isMockData } from '@/lib/api/client';

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const { t } = useLanguage();

  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchUsers = async () => {
    if (currentUser?.role !== "admin") return;
    try {
      const res = await fetch(isMockData ? '/users' : `${API_URL}/users`);
      if (!res.ok) throw new Error("Could not fetch users");
      const data = await res.json();
      setUsers(data.users || []);
    } catch (err) {
      setError(t.pages?.common?.error || 'Error fetching users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [currentUser?.role]);

  const handleUpdate = async (userId: string, updates: any) => {
    try {
      const res = await fetch(`${isMockData ? "" : API_URL}/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        fetchUsers();
      } else {
        const data = await res.json();
        setError(data.detail || "Update failed");
      }
    } catch (err) {
      alert(t.pages?.common?.error || 'Update failed');
    }
  };

  const isLastAdmin = (userId: string) => {
    const adminCount = users.filter(u => u.role === 'admin' && u.status === 'active').length;
    const targetUser = users.find(u => u.id === userId);
    return adminCount <= 1 && targetUser?.role === 'admin';
  };

  const handleRoleChange = (userId: string, newRole: string) => {
    if (userId === currentUser?.id || (isLastAdmin(userId) && newRole !== 'admin')) {
      alert(t.pages?.users?.demoteError || 'Cannot demote or block the last admin or yourself.');
      return;
    }
    handleUpdate(userId, { role: newRole });
  };

  const handleToggleStatus = (userId: string, currentStatus: string) => {
    if (userId === currentUser?.id || (isLastAdmin(userId) && currentStatus === 'active')) {
      alert(t.pages?.users?.demoteError || 'Cannot demote or block the last admin or yourself.');
      return;
    }
    handleUpdate(userId, { status: currentStatus === 'active' ? 'blocked' : 'active' });
  };

  if (loading) return <RequireRole roles={['admin']}><div className="p-8 text-center">{t.pages?.common?.loading || 'Loading...'}</div></RequireRole>;

  return (
    <RequireRole roles={['admin']}>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">{t.pages?.users?.title || 'Users Management'}</h1>
        </div>
        
        {error && <div className="p-4 bg-red-50 text-red-600 rounded-lg">{error}</div>}

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="p-4 font-medium text-gray-600">{t.pages?.users?.name || 'Name'}</th>
                  <th className="p-4 font-medium text-gray-600">{t.pages?.users?.username || 'Username'}</th>
                  <th className="p-4 font-medium text-gray-600">{t.pages?.users?.role || 'Role'}</th>
                  <th className="p-4 font-medium text-gray-600">{t.pages?.users?.status || 'Status'}</th>
                  <th className="p-4 font-medium text-gray-600 text-right">{t.pages?.cameras?.actions || 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="p-4 font-medium text-gray-900">
                      {u.name} {u.username === currentUser?.username && <span className="text-sky-600 text-sm font-normal ml-2">(You)</span>}
                    </td>
                    <td className="p-4 text-gray-600">{u.username}</td>
                    <td className="p-4">
                      <select 
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.id, e.target.value)}
                        disabled={u.username === currentUser?.username}
                        className="border rounded p-1 text-sm bg-white text-gray-700 disabled:opacity-50 disabled:bg-gray-100"
                      >
                        <option value="user">User</option>

                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${u.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {u.status}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <button 
                        onClick={() => handleToggleStatus(u.id, u.status)}
                        disabled={u.username === currentUser?.username}
                        className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${u.status === 'active' ? 'text-red-600 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'}`}
                        title={u.status === 'active' ? (t.pages?.users?.block || 'Block') : (t.pages?.users?.unblock || 'Unblock')}
                      >
                        {u.status === 'active' ? <UserX className="w-5 h-5" /> : <UserCheck className="w-5 h-5" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </RequireRole>
  );
}
