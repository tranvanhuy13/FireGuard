/* eslint-disable */
"use client";
import { mediaUrl } from "@/lib/api/client";
import { Download } from 'lucide-react';
import React, { useState, useEffect, useMemo } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { API_URL } from '@/config';
import { motion, AnimatePresence } from 'framer-motion';

export default function HistoryPage() {
  const { t } = useLanguage();
  const { user, streamToken } = useAuth();
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // filters, sort, pagination
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc'|'desc' }>({ key: 'timestamp', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // modal
  const [selectedAlert, setSelectedAlert] = useState<any>(null);

  const fetchAlerts = () => {
    setLoading(true);
    fetch(`${API_URL}/history`)
      .then(res => res.json())
      .then(data => { 
        const rawEvents = data.events || data.alerts || [];
        const mappedEvents = rawEvents.map((e: any) => ({
          ...e,
          snapshot: e.snapshot || e.snapshot_path
        }));
        setAlerts(mappedEvents); 
        setLoading(false); 
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchAlerts();
  }, []);

  const handleExportCsv = () => {
    const headers = ["ID", "Camera ID", "Type", "Time", "Confidence", "Status", "Handler"];
    const csvContent = [
      headers.join(","),
      ...alerts.map(a => [
        a.id,
        a.camera_id,
        a.type,
        new Date(a.timestamp).toLocaleString(),
        (a.confidence > 1 ? a.confidence : a.confidence * 100).toFixed(1) + "%",
        a.status,
        a.handler || ''
      ].map(field => `"${field}"`).join(","))
    ].join("\n");

    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "history_export.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleUpdateStatus = async (status: string) => {
    if (!selectedAlert) return;
    try {
      const res = await fetch(`${API_URL}/alerts/${selectedAlert.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, handler: user?.username || 'user' })
      });
      if (res.ok) {
        fetchAlerts();
        setSelectedAlert(null);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const filteredAlerts = useMemo(() => {
    return alerts.filter(a => {
      const matchSearch = a.id.toLowerCase().includes(search.toLowerCase()) || a.camera_id.toString().includes(search);
      const matchType = typeFilter === 'all' || a.type === typeFilter;
      const matchStatus = statusFilter === 'all' || a.status === statusFilter;
      return matchSearch && matchType && matchStatus;
    }).sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [alerts, search, typeFilter, statusFilter, sortConfig]);

  const totalPages = Math.ceil(filteredAlerts.length / itemsPerPage);
  const currentItems = filteredAlerts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  if (loading && alerts.length === 0) return <div className="p-8"><div className="animate-pulse bg-gray-200 h-64 rounded-md"></div></div>;

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} className="p-8 space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h1 className="text-2xl font-bold">{t.pages.history.title}</h1>
        <button onClick={handleExportCsv} className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 px-4 py-2 rounded-xl shadow-sm transition-colors font-medium"><Download className="w-4 h-4" /> {t.pages.history.exportCsv}</button>
      </div>
      
      <div className="flex flex-col md:flex-row gap-4">
        <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
        <select className="border rounded-md px-3 py-2 bg-white" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="all">{t.alerts.allTypes || 'All Types'}</option>
          <option value="fire">{t.notifications ? t.notifications.fire : "Fire"}</option>
          <option value="smoke">{t.notifications ? t.notifications.smoke : "Smoke"}</option>
        </select>
        <select className="border rounded-md px-3 py-2 bg-white" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">{t.alerts.allStatuses || 'All Statuses'}</option>
          <option value="new">{t.alerts.statusNew}</option>
          <option value="confirmed">{t.alerts.statusConfirmed}</option>
          <option value="false_alarm">{t.alerts.statusFalseAlarm}</option>
        </select>
      </div>

      {filteredAlerts.length === 0 ? (
        <div className="text-center p-12 text-gray-500">{t.pages.common.empty}</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden flex flex-col">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="p-4 font-medium cursor-pointer" onClick={() => requestSort('timestamp')}>{t.pages.history.time} {sortConfig.key === 'timestamp' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                  <th className="p-4 font-medium cursor-pointer" onClick={() => requestSort('camera_id')}>{t.pages.history.camera} {sortConfig.key === 'camera_id' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                  <th className="p-4 font-medium cursor-pointer" onClick={() => requestSort('type')}>{t.pages.history.type} {sortConfig.key === 'type' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                  <th className="p-4 font-medium cursor-pointer" onClick={() => requestSort('confidence')}>{t.pages.history.confidence} {sortConfig.key === 'confidence' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                  <th className="p-4 font-medium cursor-pointer" onClick={() => requestSort('status')}>{t.pages.history.status} {sortConfig.key === 'status' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                </tr>
              </thead>
              <tbody>
                {currentItems.map(a => (
                  <tr key={a.id} className="border-b hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => setSelectedAlert(a)}>
                    <td className="p-4">{new Date(a.timestamp).toLocaleString()}</td>
                    <td className="p-4">Cam {a.camera_id}</td>
                    <td className="p-4 capitalize">{a.type === 'fire' ? t.notifications.fire : t.notifications.smoke}</td>
                    <td className="p-4">{(a.confidence > 1 ? a.confidence : a.confidence * 100).toFixed(1)}%</td>
                    <td className="p-4">
                      <Badge variant={a.status === 'confirmed' ? 'danger' : a.status === 'new' ? 'warning' : 'secondary'}>
                          {a.status === 'confirmed' ? t.alerts.statusConfirmed : a.status === 'new' ? t.alerts.statusNew : t.alerts.statusFalseAlarm}
                        </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-4 border-t flex justify-between items-center bg-gray-50 text-sm">
            <span>{t.pages.history.pagination}: {currentPage} / {totalPages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>Prev</Button>
              <Button size="sm" variant="outline" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>Next</Button>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {selectedAlert && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
            <motion.div initial={{y:50, opacity:0}} animate={{y:0, opacity:1}} exit={{y:50, opacity:0}} className="bg-white rounded-lg p-6 max-w-lg w-full shadow-xl">
              <h2 className="text-xl font-bold mb-4">{t.pages.history.detailsModal}</h2>
              <div className="space-y-4">
                <img src={selectedAlert.snapshot ? mediaUrl(selectedAlert.snapshot, streamToken) : '/placeholder.png'} alt="Snapshot" className="w-full h-48 object-cover bg-gray-100 rounded-md" />
                <div className="grid grid-cols-2 gap-4">
                  <div><span className="text-gray-500 block text-sm">{t.pages.history.time}</span> {new Date(selectedAlert.timestamp).toLocaleString()}</div>
                  <div><span className="text-gray-500 block text-sm">{t.pages.history.camera}</span> Cam {selectedAlert.camera_id}</div>
                  <div><span className="text-gray-500 block text-sm">{t.pages.history.type}</span> <span className="capitalize">{selectedAlert.type}</span></div>
                  <div><span className="text-gray-500 block text-sm">{t.pages.history.confidence}</span> {(selectedAlert.confidence > 1 ? selectedAlert.confidence : selectedAlert.confidence * 100).toFixed(1)}%</div>
                  <div><span className="text-gray-500 block text-sm">{t.pages.history.status}</span> 
                    <Badge variant={selectedAlert.status === 'confirmed' ? 'danger' : selectedAlert.status === 'new' ? 'warning' : 'secondary'}>
                        {selectedAlert.status}
                    </Badge>
                  </div>
                  <div><span className="text-gray-500 block text-sm">{t.pages.history.handler}</span> {selectedAlert.handler || '-'}</div>
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3 pt-4 border-t">
                <Button variant="outline" onClick={() => setSelectedAlert(null)}>{t.pages.common.cancel}</Button>
                {(user?.role === 'admin' || user?.role === 'user') && selectedAlert.status === 'new' && (
                  <>
                    <Button variant="secondary" onClick={() => handleUpdateStatus('false_alarm')}>{t.pages.history.falseAlarm}</Button>
                    <Button variant="danger" onClick={() => handleUpdateStatus('confirmed')}>{t.pages.history.confirm}</Button>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
