/* eslint-disable */
"use client";
import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { API_URL } from '@/config';
import { authFetch } from '@/lib/api/authFetch';
import { motion, AnimatePresence } from 'framer-motion';

export default function CamerasPage() {
  const { t } = useLanguage();
  const { user, can } = useAuth();
  const canManageCameras = can("add_camera");
  const canToggleCameras = can("toggle_camera");
  const [toggling, setToggling] = useState<Record<number, boolean>>({});
  const [cameras, setCameras] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'grid'|'table'>('grid');

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCamera, setEditingCamera] = useState<any>(null);
  const [deletingCamera, setDeletingCamera] = useState<any>(null);

  // Form State
  const [formData, setFormData] = useState({ name: '', source: '0', is_active: false });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const fetchCameras = async () => {
    try {
      setLoading(true);
      const res = await authFetch(`${API_URL}/cameras`);
      if (!res.ok) throw new Error(t.review.requestFailed);
      const data = await res.json();
      setCameras(data.cameras || []);
      setError(false);
    } catch (e) {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) fetchCameras();
  }, [user?.id]);

  const handleToggle = async (cam: any) => {
    if (!canToggleCameras || toggling[cam.id]) return;
    const nextActive = !cam.is_active;
    if (cam.is_active) {
      const confirmMsg = t.pages.cameras.confirmTurnOffCamera || "Tắt camera sẽ ngừng phát hiện cháy ở camera này. Bạn có chắc không?";
      if (!window.confirm(confirmMsg)) {
        return;
      }
    }

    setToggling(previous => ({ ...previous, [cam.id]: true }));
    // Optimistic update
    setCameras(prev => prev.map(c => c.id === cam.id ? { ...c, is_active: nextActive } : c));

    try {
      const res = await authFetch(`${API_URL}/cameras/${cam.id}/toggle?active=${nextActive}`, {
        method: 'POST'
      });

      if (!res.ok) {
        // Revert switch to real state immediately
        setCameras(prev => prev.map(c => c.id === cam.id ? { ...c, is_active: cam.is_active } : c));
        if (res.status === 401) {
          alert(t.pages.cameras.toggleError401 || "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
        } else if (res.status === 403) {
          alert(t.pages.cameras.toggleError403 || "Bạn không có quyền thực hiện thao tác này.");
        } else {
          alert(t.pages.cameras.toggleErrorNetwork || "Lỗi kết nối khi thay đổi trạng thái camera.");
        }
      }
    } catch (e) {
      console.error(e);
      // Revert switch to real state immediately
      setCameras(prev => prev.map(c => c.id === cam.id ? { ...c, is_active: cam.is_active } : c));
      alert(t.pages.cameras.toggleErrorNetwork || "Lỗi kết nối khi thay đổi trạng thái camera.");
    } finally {
      fetchCameras();
      setToggling(previous => ({ ...previous, [cam.id]: false }));
    }
  };

  const handleDelete = async () => {
    if (!deletingCamera) return;
    try {
      const res = await authFetch(`${API_URL}/cameras/${deletingCamera.id}`, { method: 'DELETE' });
      if (res.ok) {
        setDeletingCamera(null);
        fetchCameras();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError('');
    try {
      const method = editingCamera ? 'PUT' : 'POST';
      const url = editingCamera ? `${API_URL}/cameras/${editingCamera.id}` : `${API_URL}/cameras`;
      const res = await authFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        setShowAddModal(false);
        setEditingCamera(null);
        setFormData({ name: '', source: '0', is_active: false });
        setSaveError('');
        fetchCameras();
      } else {
        setSaveError(t.monitoring.saveFailed);
      }
    } catch {
      setSaveError(t.monitoring.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  const filtered = cameras.filter(c => {
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' 
      ? true 
      : statusFilter === 'active' ? c.is_active 
      : !c.is_active;
    return matchSearch && matchStatus;
  });

  if (loading && cameras.length === 0) return <div className="p-8"><div className="animate-pulse bg-gray-200 h-64 rounded-md"></div></div>;
  if (error) return <div className="p-8 text-center"><p className="mb-4 text-red-500">{t.pages.common.error}</p><Button onClick={fetchCameras}>{t.pages.common.retry}</Button></div>;

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} className="p-8 space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h1 className="text-2xl font-bold">{t.pages.cameras.title}</h1>
        <div className="flex gap-2 items-center">
          <div className="bg-gray-100 p-1 rounded-md flex gap-1">
            <button onClick={() => setViewMode('grid')} className={`px-3 py-1 text-sm rounded ${viewMode==='grid'?'bg-white shadow':''}`}>Grid</button>
            <button onClick={() => setViewMode('table')} className={`px-3 py-1 text-sm rounded ${viewMode==='table'?'bg-white shadow':''}`}>Table</button>
          </div>
          {canManageCameras && (
            <Button onClick={() => { setEditingCamera(null); setFormData({ name: '', source: '0', is_active: false }); setSaveError(''); setShowAddModal(true); }}>
              {t.pages.cameras.addCamera}
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-col md:flex-row gap-4">
        <Input placeholder={t.pages.cameras.searchPlaceholder} value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
        <select className="border rounded-md px-3 py-2 bg-white" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">{t.pages.cameras.filterAll || 'All Status'}</option>
          <option value="active">{t.pages.cameras.filterRunning || 'Running'}</option>
          <option value="inactive">{t.pages.cameras.filterDisabled || 'Disabled'}</option>
        </select>
      </div>
      
      {filtered.length === 0 ? (
        <div className="text-center p-12 text-gray-500">{t.pages.common.empty}</div>
      ) : (
        viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filtered.map(cam => (
              <div key={cam.id} className="border rounded-lg p-4 bg-white shadow-sm flex flex-col transition-all hover:shadow-md">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-semibold text-lg line-clamp-1">{cam.name}</h3>
                  <Badge variant={cam.is_active ? 'success' : 'secondary'}>{cam.is_active ? t.pages.cameras.filterRunning : t.pages.cameras.filterDisabled}</Badge>
                </div>
                <div className="text-sm text-gray-500 mb-4 break-all flex-1">{cam.source}</div>
                <div className="mt-auto pt-4 border-t flex flex-wrap gap-2">
                  {canToggleCameras && (
                    <Button role="switch" aria-checked={!!cam.is_active} aria-label={`${t.camera.power}: ${cam.name}`} aria-busy={!!toggling[cam.id]} disabled={!!toggling[cam.id]} size="sm" variant={cam.is_active ? 'secondary' : 'primary'} className="flex-1 min-w-[80px]" onClick={() => handleToggle(cam)}>
                      {cam.is_active ? "ON" : "OFF"} · {cam.is_active ? t.pages.cameras.toggleOff : t.pages.cameras.toggleOn}
                    </Button>
                  )}
                  {canManageCameras && (
                    <>
                      <Button size="sm" variant="outline" className="flex-1 min-w-[60px]" onClick={() => { setEditingCamera(cam); setFormData({ name: cam.name, source: cam.source, is_active: cam.is_active }); setSaveError(''); setShowAddModal(true); }}>{t.pages.cameras.edit || 'Edit'}</Button>
                      <Button size="sm" variant="danger" className="flex-1 min-w-[60px]" onClick={() => setDeletingCamera(cam)}>{t.pages.cameras.delete}</Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="p-4 font-medium">{t.pages.cameras.name || 'Name'}</th>
                  <th className="p-4 font-medium">{t.pages.cameras.source || 'Source'}</th>
                  <th className="p-4 font-medium">{t.pages.cameras.status || 'Status'}</th>
                  {user && <th className="p-4 font-medium text-right">{t.pages.cameras.actions || 'Actions'}</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map(cam => (
                  <tr key={cam.id} className="border-b hover:bg-gray-50">
                    <td className="p-4 font-medium">{cam.name}</td>
                    <td className="p-4 text-gray-500 text-sm max-w-xs truncate" title={cam.source}>{cam.source}</td>
                    <td className="p-4">
                      <Badge variant={cam.is_active ? 'success' : 'secondary'}>{cam.is_active ? t.pages.cameras.filterRunning : t.pages.cameras.filterDisabled}</Badge>
                    </td>
                    {user && (
                      <td className="p-4 flex gap-2 justify-end">
                        {canToggleCameras && <Button role="switch" aria-checked={!!cam.is_active} aria-label={`${t.camera.power}: ${cam.name}`} aria-busy={!!toggling[cam.id]} disabled={!!toggling[cam.id]} size="sm" variant={cam.is_active ? 'secondary' : 'primary'} onClick={() => handleToggle(cam)}>
                          {cam.is_active ? "ON" : "OFF"} · {cam.is_active ? t.pages.cameras.toggleOff : t.pages.cameras.toggleOn}
                        </Button>}
                        {canManageCameras && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => { setEditingCamera(cam); setFormData({ name: cam.name, source: cam.source, is_active: cam.is_active }); setSaveError(''); setShowAddModal(true); }}>{t.pages.cameras.edit || 'Edit'}</Button>
                            <Button size="sm" variant="danger" onClick={() => setDeletingCamera(cam)}>{t.pages.cameras.delete}</Button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      <AnimatePresence>
        {showAddModal && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
            <motion.div initial={{y:50, opacity:0}} animate={{y:0, opacity:1}} exit={{y:50, opacity:0}} className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
              <h2 className="text-xl font-bold mb-4">{editingCamera ? (t.pages.cameras.edit || 'Edit Camera') : t.pages.cameras.addCamera}</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">{t.pages.cameras.name || 'Name'}</label>
                  <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Main Gate" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t.pages.cameras.source || 'Source URL'}</label>
                  <div className="flex gap-2">
                    <Input aria-label={t.pages.cameras.source} value={formData.source} onChange={e => setFormData({...formData, source: e.target.value})} title={t.monitoring.sourceHint} className="flex-1" />
                  </div>
                  <p className="text-gray-500 text-sm mt-1">{t.monitoring.sourceHint}</p>
                  <p className="text-gray-500 text-sm mt-1">{t.monitoring.verifyAfterSave}</p>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <input type="checkbox" id="is_active" checked={formData.is_active} onChange={e => setFormData({...formData, is_active: e.target.checked})} className="rounded text-blue-600 focus:ring-blue-500" />
                  <label htmlFor="is_active" className="text-sm font-medium">{t.pages.cameras.filterRunning || 'Active'}</label>
                </div>
              </div>
              {saveError && <p role="alert" className="text-red-600 mt-3">{saveError}</p>}
              <div className="mt-6 flex justify-end gap-3 pt-4 border-t">
                <Button variant="outline" onClick={() => setShowAddModal(false)}>{t.pages.common.cancel}</Button>
                <Button onClick={handleSave} disabled={saving || !formData.name.trim() || !formData.source.trim()}>{t.pages.common.saveSuccess ? 'Save' : 'Save'}</Button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {deletingCamera && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
            <motion.div initial={{scale:0.95, opacity:0}} animate={{scale:1, opacity:1}} exit={{scale:0.95, opacity:0}} className="bg-white rounded-lg p-6 max-w-sm w-full shadow-xl text-center">
              <h2 className="text-xl font-bold mb-2 text-red-600">{t.pages.cameras.delete}</h2>
              <p className="mb-6">{t.camera.confirmDelete || 'Are you sure you want to delete this camera?'}</p>
              <div className="flex justify-center gap-3">
                <Button variant="outline" onClick={() => setDeletingCamera(null)}>{t.pages.common.cancel}</Button>
                <Button variant="danger" onClick={handleDelete}>{t.pages.cameras.delete}</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
