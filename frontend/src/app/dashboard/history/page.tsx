/* eslint-disable */
"use client";
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { fetchPage, clearPageCache } from '@/lib/api/pageCache';
import EvidenceImage from "@/components/EvidenceImage";
import { Download } from 'lucide-react';
import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { API_URL } from '@/config';
import { motion, AnimatePresence } from 'framer-motion';

export default function HistoryPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [reload, setReload] = useState(0);
  const [requestError, setRequestError] = useState(false);
  const [exporting, setExporting] = useState(false);
  
  // filters, sort, pagination
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc'|'desc' }>({ key: 'timestamp', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // modal
  const [selectedAlert, setSelectedAlert] = useState<any>(null);

  const queryFor = useCallback((limit: number, offset: number) => new URLSearchParams({
    limit: String(limit), offset: String(offset), search: debouncedSearch, event_type: typeFilter,
    status: statusFilter, sort: sortConfig.key, direction: sortConfig.direction,
  }), [debouncedSearch, typeFilter, statusFilter, sortConfig]);

  useEffect(() => {
    if (search !== debouncedSearch) return;
    const controller = new AbortController();
    let disposed = false;
    setLoading(true);
    setRequestError(false);
    fetchPage(`${API_URL}/history?${queryFor(itemsPerPage, (currentPage - 1) * itemsPerPage)}`, controller.signal)
      .then(async res => { if (!res.ok) throw new Error('History failed'); return res.json(); })
      .then(data => {
        if (disposed) return;
        setAlerts(data.events.map((event: any) => ({ ...event, snapshot: event.snapshot_path })));
        setTotal(data.total);
        setCurrentPage(page => Math.min(page, Math.max(1, Math.ceil(data.total / itemsPerPage))));
      })
      .catch(() => { if (!disposed) setRequestError(true); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; controller.abort(); };
  }, [queryFor, currentPage, reload, search, debouncedSearch]);

  const handleExportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    setRequestError(false);
    try {
    const exported = [];
    let watermark: number | undefined;
    for (let offset = 0; ; offset += 500) {
      const query = queryFor(500, offset);
      if (watermark !== undefined) query.set('max_id', String(watermark));
      const response = await fetch(`${API_URL}/history?${query}`);
      if (!response.ok) throw new Error('Export failed');
      const data = await response.json();
      watermark ??= data.max_id;
      exported.push(...data.events);
      if (offset + data.events.length >= data.total || data.events.length === 0) break;
    }
    const headers = ["ID", "Camera ID", "Type", "Time", "Confidence", "Status", "Handler"];
    const csvContent = [
      headers.join(","),
      ...exported.map(a => [
        a.id,
        a.camera_id ?? '',
        a.type,
        new Date(a.timestamp).toLocaleString(),
        (a.confidence > 1 ? a.confidence : a.confidence * 100).toFixed(1) + "%",
        a.status,
        a.handled_by || ''
      ].map(field => `"${String(field).replace(/"/g, '""')}"`).join(","))
    ].join("\n");

    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "history_export.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    } catch { setRequestError(true); }
    finally { setExporting(false); }
  };

  const handleUpdateStatus = async (status: string) => {
    if (!selectedAlert) return;
    try {
      const res = await fetch(`${API_URL}/alerts/${selectedAlert.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        clearPageCache();
        setReload(value => value + 1);
        setSelectedAlert(null);
      } else { setRequestError(true); }
    } catch {
      setRequestError(true);
    }
  };

  const filteredAlerts = alerts;
  const totalPages = Math.max(1, Math.ceil(total / itemsPerPage));
  const currentItems = alerts;

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
    setCurrentPage(1);
  };

  if (loading && alerts.length === 0 && !requestError) return <div className="p-8"><div className="animate-pulse bg-gray-200 dark:bg-slate-800 h-64 rounded-md"></div></div>;

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{t.pages.history.title}</h1>
        <button disabled={exporting || search !== debouncedSearch} onClick={handleExportCsv} className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 px-4 py-2 rounded-xl shadow-sm transition-colors font-medium"><Download className="w-4 h-4" /> {t.pages.history.exportCsv}</button>
      </div>
      
      <div className="flex flex-col md:flex-row gap-4">
        <Input placeholder="Search..." value={search} onChange={e => { setSearch(e.target.value); setCurrentPage(1); }} className="max-w-xs bg-white dark:bg-slate-800 border-gray-300 dark:border-slate-700 text-gray-900 dark:text-slate-100" />
        <select className="border border-gray-300 dark:border-slate-700 rounded-md px-3 py-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500" value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setCurrentPage(1); }}>
          <option value="all" className="bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100">{t.alerts.allTypes || 'All Types'}</option>
          <option value="fire" className="bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100">{t.notifications ? t.notifications.fire : "Fire"}</option>
          <option value="smoke" className="bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100">{t.notifications ? t.notifications.smoke : "Smoke"}</option>
        </select>
        <select className="border border-gray-300 dark:border-slate-700 rounded-md px-3 py-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setCurrentPage(1); }}>
          <option value="all" className="bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100">{t.alerts.allStatuses || 'All Statuses'}</option>
          <option value="new" className="bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100">{t.alerts.statusNew}</option>
          <option value="confirmed" className="bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100">{t.alerts.statusConfirmed}</option>
          <option value="false_alarm" className="bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100">{t.alerts.statusFalseAlarm}</option>
        </select>
      </div>

      {requestError && <p role="alert" className="text-red-600">{t.review.requestFailed}</p>}
      {filteredAlerts.length === 0 ? (
        <div className="text-center p-12 text-gray-500 dark:text-slate-400">{t.pages.common.empty}</div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow overflow-hidden flex flex-col border border-gray-200 dark:border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-slate-800/60 border-b border-gray-200 dark:border-slate-800 text-gray-700 dark:text-slate-300 text-sm">
                  <th className="p-4 font-semibold cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700/50" onClick={() => requestSort('timestamp')}>{t.pages.history.time} {sortConfig.key === 'timestamp' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                  <th className="p-4 font-semibold cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700/50" onClick={() => requestSort('camera_id')}>{t.pages.history.camera} {sortConfig.key === 'camera_id' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                  <th className="p-4 font-semibold cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700/50" onClick={() => requestSort('type')}>{t.pages.history.type} {sortConfig.key === 'type' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                  <th className="p-4 font-semibold cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700/50" onClick={() => requestSort('confidence')}>{t.pages.history.confidence} {sortConfig.key === 'confidence' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                  <th className="p-4 font-semibold cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700/50" onClick={() => requestSort('status')}>{t.pages.history.status} {sortConfig.key === 'status' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800 text-gray-800 dark:text-slate-200 text-sm">
                {currentItems.map(a => (
                  <tr key={a.id} className="border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors" onClick={() => setSelectedAlert(a)}>
                    <td className="p-4 text-gray-900 dark:text-slate-100">{new Date(a.timestamp).toLocaleString()}</td>
                    <td className="p-4 text-gray-700 dark:text-slate-300">{a.camera_name || (a.camera_id != null ? `Cam ${a.camera_id}` : t.review.unknownCamera)}</td>
                    <td className="p-4 capitalize text-gray-700 dark:text-slate-300">{a.type === 'fire' ? t.notifications.fire : t.notifications.smoke}</td>
                    <td className="p-4 text-gray-700 dark:text-slate-300">{(a.confidence > 1 ? a.confidence : a.confidence * 100).toFixed(1)}%</td>
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
          <div className="p-4 border-t border-gray-200 dark:border-slate-800 flex justify-between items-center bg-gray-50 dark:bg-slate-800/60 text-sm text-gray-700 dark:text-slate-300">
            <span>{t.pages.history.pagination}: {currentPage} / {totalPages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>Prev</Button>
              <Button size="sm" variant="outline" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}>Next</Button>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {selectedAlert && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
            <motion.div initial={{y:50, opacity:0}} animate={{y:0, opacity:1}} exit={{y:50, opacity:0}} className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg p-6 max-w-lg w-full shadow-xl text-gray-900 dark:text-slate-100">
              <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-slate-100">{t.pages.history.detailsModal}</h2>
              <div className="space-y-4">
                <EvidenceImage snapshot={selectedAlert.snapshot} alt="Snapshot" className="w-full h-48 object-cover bg-gray-100 dark:bg-slate-800 rounded-md" />
                <div className="grid grid-cols-2 gap-4">
                  <div><span className="text-gray-500 dark:text-slate-400 block text-sm">{t.pages.history.time}</span> <span className="text-gray-900 dark:text-slate-100">{new Date(selectedAlert.timestamp).toLocaleString()}</span></div>
                  <div><span className="text-gray-500 dark:text-slate-400 block text-sm">{t.pages.history.camera}</span> <span className="text-gray-900 dark:text-slate-100">{selectedAlert.camera_name || (selectedAlert.camera_id != null ? `Cam ${selectedAlert.camera_id}` : t.review.unknownCamera)}</span></div>
                  <div><span className="text-gray-500 dark:text-slate-400 block text-sm">{t.pages.history.type}</span> <span className="capitalize text-gray-900 dark:text-slate-100">{selectedAlert.type}</span></div>
                  <div><span className="text-gray-500 dark:text-slate-400 block text-sm">{t.pages.history.confidence}</span> <span className="text-gray-900 dark:text-slate-100">{(selectedAlert.confidence > 1 ? selectedAlert.confidence : selectedAlert.confidence * 100).toFixed(1)}%</span></div>
                  <div><span className="text-gray-500 dark:text-slate-400 block text-sm">{t.pages.history.status}</span> 
                    <Badge variant={selectedAlert.status === 'confirmed' ? 'danger' : selectedAlert.status === 'new' ? 'warning' : 'secondary'}>
                        {selectedAlert.status}
                    </Badge>
                  </div>
                  <div><span className="text-gray-500 dark:text-slate-400 block text-sm">{t.pages.history.handler}</span> <span className="text-gray-900 dark:text-slate-100">{selectedAlert.handled_by || '-'}</span></div>
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-slate-800">
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
