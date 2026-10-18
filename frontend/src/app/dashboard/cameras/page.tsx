/* eslint-disable */
"use client";
import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { API_URL } from '@/config';
import { motion, AnimatePresence } from 'framer-motion';

export default function CamerasPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [cameras, setCameras] = useState<any[]>([]);
  const [togglingCameraId, setTogglingCameraId] = useState<number | null>(null);
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
  const [formData, setFormData] = useState({ name: '', source: '', is_active: true });
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<'success'|'error'|null>(null);

  const fetchCameras = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/cameras`);
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
    fetchCameras();
  }, []);

  const handleToggle = async (cam: any) => {
    if (togglingCameraId !== null) return;
    setTogglingCameraId(cam.id);
    try {
      const res = await fetch(`${API_URL}/cameras/${cam.id}/toggle?active=${!cam.is_active}`, {
        method: 'POST'
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || error.message || `Backend responded with ${res.status}`);
      }
      await fetchCameras();
    } catch (error) {
      console.error(error);
      window.alert(error instanceof Error ? error.message : 'Failed to toggle camera status');
    } finally {
      setTogglingCameraId(null);
    }
  };

  const handleDelete = async () => {
    if (!deletingCamera) return;
    try {
      const res = await fetch(`${API_URL}/cameras/${deletingCamera.id}`, { method: 'DELETE' });
      if (res.ok) {
        setDeletingCamera(null);
        fetchCameras();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSave = async () => {
    try {
      const method = editingCamera ? 'PUT' : 'POST';
      const url = editingCamera ? `${API_URL}/cameras/${editingCamera.id}` : `${API_URL}/cameras`;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        setShowAddModal(false);
        setEditingCamera(null);
        setFormData({ name: '', source: '', is_active: true });
        setTestResult(null);
        fetchCameras();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleTestConnection = () => {
    setTestingConnection(true);
    setTestResult(null);
    setTimeout(() => {
      setTestingConnection(false);
      setTestResult(formData.source.length > 5 ? 'success' : 'error');
    }, 1000);
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
          {user?.role === 'admin' && (
            <Button onClick={() => { setEditingCamera(null); setFormData({ name: '', source: '', is_active: true }); setTestResult(null); setShowAddModal(true); }}>
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
                  <Button size="sm" variant={cam.is_active ? 'secondary' : 'primary'} className="flex-1 min-w-[80px]" onClick={() => handleToggle(cam)} disabled={togglingCameraId === cam.id}>
                    {cam.is_active ? t.pages.cameras.toggleOff : t.pages.cameras.toggleOn}
                  </Button>
                  {user?.role === 'admin' && (
                    <>
                      <Button size="sm" variant="outline" className="flex-1 min-w-[60px]" onClick={() => { setEditingCamera(cam); setFormData({ name: cam.name, source: cam.source, is_active: cam.is_active }); setTestResult(null); setShowAddModal(true); }}>{t.pages.cameras.edit || 'Edit'}</Button>
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
                  <th className="p-4 font-medium text-right">{t.pages.cameras.actions || 'Actions'}</th>
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
                    <td className="p-4 flex gap-2 justify-end">
                      <Button size="sm" variant={cam.is_active ? 'secondary' : 'primary'} onClick={() => handleToggle(cam)} disabled={togglingCameraId === cam.id}>
                        {cam.is_active ? t.pages.cameras.toggleOff : t.pages.cameras.toggleOn}
                      </Button>
                      {user?.role === 'admin' && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => { setEditingCamera(cam); setFormData({ name: cam.name, source: cam.source, is_active: cam.is_active }); setTestResult(null); setShowAddModal(true); }}>{t.pages.cameras.edit || 'Edit'}</Button>
                          <Button size="sm" variant="danger" onClick={() => setDeletingCamera(cam)}>{t.pages.cameras.delete}</Button>
                        </>
                      )}
                    </td>
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
                    <Input value={formData.source} onChange={e => setFormData({...formData, source: e.target.value})} placeholder="rtsp://..." className="flex-1" />
                    <Button variant="outline" onClick={handleTestConnection} disabled={testingConnection}>{testingConnection ? '...' : (t.pages.cameras.testConnection || 'Test')}</Button>
                  </div>
                  {testResult === 'success' && <p className="text-green-600 text-sm mt-1">Connection successful</p>}
                  {testResult === 'error' && <p className="text-red-600 text-sm mt-1">Connection failed</p>}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <input type="checkbox" id="is_active" checked={formData.is_active} onChange={e => setFormData({...formData, is_active: e.target.checked})} className="rounded text-blue-600 focus:ring-blue-500" />
                  <label htmlFor="is_active" className="text-sm font-medium">{t.pages.cameras.filterRunning || 'Active'}</label>
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3 pt-4 border-t">
                <Button variant="outline" onClick={() => setShowAddModal(false)}>{t.pages.common.cancel}</Button>
                <Button onClick={handleSave} disabled={!formData.name || !formData.source}>{t.pages.common.saveSuccess ? 'Save' : 'Save'}</Button>
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
