'use client';

import React, { useEffect, useState, useMemo } from 'react';
import RequireRole from '@/components/RequireRole';
import { useLanguage } from '@/context/LanguageContext';
import { Download, Search, FilterX, ChevronDown, ChevronUp, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { isMockData } from '@/lib/api/client';

interface AuditLog {
  id: string;
  timestamp: string;
  user: string;
  fullName?: string;
  action: string;
  target: string;
  ip: string;
  result: string;
  details?: string;
  userAgent?: string;
}

export default function AuditLogPage() {
  return (
    <RequireRole roles={['admin']}>
      <AuditLogContent />
    </RequireRole>
  );
}

function AuditLogContent() {
  const { t } = useLanguage();
  const n = t.auditLog;

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(isMockData);
  
  const [search, setSearch] = useState('');
  const [filterAction, setFilterAction] = useState('ALL');
  const [filterResult, setFilterResult] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  
  const [sortCol, setSortCol] = useState<keyof AuditLog>('timestamp');
  const [sortDesc, setSortDesc] = useState(true);
  
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  useEffect(() => {
    if (!isMockData) return;
    fetch('/audit-logs')
      .then(res => res.json())
      .then(data => {
        setLogs(data.auditLogs || []);
        setLoading(false);
      });
  }, []);

  const translateAction = (action: string) => n.actions[action as keyof typeof n.actions] || action;
  const translateResult = (res: string) => n.results[res as keyof typeof n.results] || res;
  const translateTarget = (tgt: string) => {
    if (tgt === 'system') return n.system;
    const isVi = n.system === 'Hệ thống';
    if (isVi) {
      return tgt
        .replace('Alert', 'Cảnh báo')
        .replace('Main Gate', 'Cổng chính')
        .replace('Warehouse', 'Nhà kho')
        .replace('Corridor', 'Hành lang')
        .replace('Parking', 'Bãi xe')
        .replace('Fire Dept Group', 'Nhóm PCCC')
        .replace('Director', 'Giám đốc')
        .replace('Night Guard', 'Bảo vệ ca đêm');
    } else {
      return tgt
        .replace('Cảnh báo', 'Alert')
        .replace('Cổng chính', 'Main Gate')
        .replace('Nhà kho', 'Warehouse')
        .replace('Hành lang', 'Corridor')
        .replace('Bãi xe', 'Parking')
        .replace('Nhóm PCCC', 'Fire Dept Group')
        .replace('Giám đốc', 'Director')
        .replace('Bảo vệ ca đêm', 'Night Guard');
    }
  };

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      if (filterAction !== 'ALL' && log.action !== filterAction) return false;
      if (filterResult !== 'ALL' && log.result !== filterResult) return false;
      
      if (dateFrom && new Date(log.timestamp) < new Date(dateFrom)) return false;
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        if (new Date(log.timestamp) > to) return false;
      }
      
      if (search) {
        const q = search.toLowerCase();
        const searchStr = `${log.user} ${log.fullName || ''} ${translateAction(log.action)} ${translateTarget(log.target)} ${log.ip} ${translateResult(log.result)}`.toLowerCase();
        if (!searchStr.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      const aVal = a[sortCol] || '';
      const bVal = b[sortCol] || '';
      if (aVal < bVal) return sortDesc ? 1 : -1;
      if (aVal > bVal) return sortDesc ? -1 : 1;
      return 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, search, filterAction, filterResult, dateFrom, dateTo, sortCol, sortDesc, n]);

  const paginatedLogs = useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    return filteredLogs.slice(start, start + rowsPerPage);
  }, [filteredLogs, page, rowsPerPage]);

  const handleSort = (col: keyof AuditLog) => {
    if (sortCol === col) setSortDesc(!sortDesc);
    else { setSortCol(col); setSortDesc(true); }
  };

  const clearFilters = () => {
    setSearch(''); setFilterAction('ALL'); setFilterResult('ALL'); setDateFrom(''); setDateTo(''); setPage(1);
  };

  const handleExport = () => {
    const headers = [n.cols.time, n.cols.user, n.cols.action, n.cols.target, n.cols.ip, n.cols.result, n.cols.details];
    const csvContent = filteredLogs.map(log => {
      return [
        format(new Date(log.timestamp), 'yyyy-MM-dd HH:mm:ss'),
        log.user,
        translateAction(log.action),
        translateTarget(log.target),
        log.ip,
        translateResult(log.result),
        log.details || ''
      ].map(field => `"${field}"`).join(',');
    });
    
    const csv = '\\uFEFF' + [headers.join(','), ...csvContent].join('\\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'audit_log.csv';
    link.click();
  };

  if (!isMockData) {
    return (
      <div className="max-w-7xl mx-auto flex flex-col h-full bg-slate-50/30 p-4 pt-20 md:p-8 md:pt-24 rounded-3xl min-h-[calc(100vh-64px)] space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold text-slate-900">{n.title}</h1>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center text-amber-800">
          <FileText className="w-12 h-12 text-amber-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold mb-1">{t.auth.errors.featureNotImplemented}</h2>
          <p className="text-sm text-amber-700">Máy chủ chưa cung cấp API lưu vết và nhật ký thao tác hệ thống.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto flex flex-col h-full bg-slate-50/30 p-4 pt-20 md:p-8 md:pt-24 rounded-3xl min-h-[calc(100vh-64px)]">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{n.title}</h1>
          <p className="text-slate-500 mt-2">{n.subtitle}</p>
        </div>
        <button onClick={handleExport} className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 px-4 py-2 rounded-xl shadow-sm transition-colors font-medium">
          <Download className="w-4 h-4" /> {n.export}
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col flex-1">
        {/* Filters */}
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-wrap gap-4 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder={n.search} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm" />
          </div>
          
          <select value={filterAction} onChange={e => { setFilterAction(e.target.value); setPage(1); }} className="p-2 rounded-xl border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-sky-500 outline-none">
            <option value="ALL">{n.filterAction} (Tất cả)</option>
            {Object.entries(n.actions).map(([key, val]) => <option key={key} value={key}>{val as string}</option>)}
          </select>
          
          <select value={filterResult} onChange={e => { setFilterResult(e.target.value); setPage(1); }} className="p-2 rounded-xl border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-sky-500 outline-none">
            <option value="ALL">{n.filterResult} (Tất cả)</option>
            <option value="success">{n.results.success}</option>
            <option value="failed">{n.results.failed}</option>
          </select>

          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} className="p-2 rounded-xl border border-slate-200 text-sm bg-white outline-none" title="Từ ngày" />
          <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} className="p-2 rounded-xl border border-slate-200 text-sm bg-white outline-none" title="Đến ngày" />

          {(search || filterAction !== 'ALL' || filterResult !== 'ALL' || dateFrom || dateTo) && (
            <button onClick={clearFilters} className="flex items-center gap-1 text-slate-500 hover:text-red-500 text-sm font-medium px-2"><FilterX className="w-4 h-4" /> {n.clearFilters}</button>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold">
                <th className="p-4 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('timestamp')}>
                  <div className="flex items-center gap-1">{n.cols.time} {sortCol === 'timestamp' && (sortDesc ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)}</div>
                </th>
                <th className="p-4 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('user')}>
                  <div className="flex items-center gap-1">{n.cols.user} {sortCol === 'user' && (sortDesc ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)}</div>
                </th>
                <th className="p-4 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('action')}>
                  <div className="flex items-center gap-1">{n.cols.action} {sortCol === 'action' && (sortDesc ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)}</div>
                </th>
                <th className="p-4">{n.cols.target}</th>
                <th className="p-4">{n.cols.ip}</th>
                <th className="p-4 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('result')}>
                  <div className="flex items-center gap-1">{n.cols.result} {sortCol === 'result' && (sortDesc ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)}</div>
                </th>
                <th className="p-4 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-100 animate-pulse">
                    <td className="p-4"><div className="h-4 bg-slate-200 rounded w-24"></div></td>
                    <td className="p-4"><div className="h-4 bg-slate-200 rounded w-20"></div></td>
                    <td className="p-4"><div className="h-4 bg-slate-200 rounded w-32"></div></td>
                    <td className="p-4"><div className="h-4 bg-slate-200 rounded w-20"></div></td>
                    <td className="p-4"><div className="h-4 bg-slate-200 rounded w-24"></div></td>
                    <td className="p-4"><div className="h-6 bg-slate-200 rounded-full w-16"></div></td>
                    <td className="p-4"></td>
                  </tr>
                ))
              ) : paginatedLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center">
                      <FileText className="w-12 h-12 text-slate-200 mb-3" />
                      <p>{n.noData}</p>
                      <button onClick={clearFilters} className="mt-4 text-sky-600 font-medium hover:underline">{n.clearFilters}</button>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedLogs.map(log => (
                  <React.Fragment key={log.id}>
                    <tr className={`border-b border-slate-50 hover:bg-slate-50/50 transition-colors ${expandedRow === log.id ? 'bg-slate-50/80' : ''}`}>
                      <td className="p-4 text-sm text-slate-600 whitespace-nowrap">{format(new Date(log.timestamp), 'dd/MM/yyyy HH:mm:ss')}</td>
                      <td className="p-4 text-sm font-medium text-slate-800">
                        <div className="flex flex-col">
                          <span>{log.user}</span>
                          {log.fullName && <span className="text-xs text-slate-400 font-normal">{log.fullName}</span>}
                        </div>
                      </td>
                      <td className="p-4 text-sm font-medium text-sky-700">{translateAction(log.action)}</td>
                      <td className="p-4 text-sm text-slate-600">{translateTarget(log.target)}</td>
                      <td className="p-4 text-sm font-mono text-slate-500 text-xs">{log.ip}</td>
                      <td className="p-4">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${log.result === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                          {translateResult(log.result)}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <button onClick={() => setExpandedRow(expandedRow === log.id ? null : log.id)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                          <ChevronDown className={`w-4 h-4 transition-transform ${expandedRow === log.id ? 'rotate-180' : ''}`} />
                        </button>
                      </td>
                    </tr>
                    <AnimatePresence>
                      {expandedRow === log.id && (
                        <tr>
                          <td colSpan={7} className="p-0 border-b border-slate-100">
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden bg-slate-50/50 shadow-inner">
                              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                  <h4 className="text-xs font-semibold uppercase text-slate-400 mb-2">{n.cols.details}</h4>
                                  <div className="bg-white p-3 rounded-lg border border-slate-200 text-sm font-mono text-slate-700">
                                    {log.details ? log.details : 'No additional details'}
                                  </div>
                                </div>
                                <div>
                                  <h4 className="text-xs font-semibold uppercase text-slate-400 mb-2">User Agent</h4>
                                  <div className="bg-white p-3 rounded-lg border border-slate-200 text-sm text-slate-600 break-all">
                                    {log.userAgent || 'Unknown User Agent'}
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          </td>
                        </tr>
                      )}
                    </AnimatePresence>
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-4 border-t border-slate-100 flex flex-wrap justify-between items-center gap-4 bg-white">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span>{n.rowsPerPage}:</span>
            <select value={rowsPerPage} onChange={e => { setRowsPerPage(Number(e.target.value)); setPage(1); }} className="border border-slate-200 rounded p-1 outline-none">
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>
          <div className="flex gap-1">
            <button disabled={page === 1} onClick={() => setPage(page - 1)} className="px-3 py-1 rounded border border-slate-200 text-slate-600 disabled:opacity-50 hover:bg-slate-50 text-sm font-medium">Previous</button>
            <div className="px-3 py-1 text-sm text-slate-600 font-medium">Page {page} of {Math.max(1, Math.ceil(filteredLogs.length / rowsPerPage))}</div>
            <button disabled={page >= Math.ceil(filteredLogs.length / rowsPerPage)} onClick={() => setPage(page + 1)} className="px-3 py-1 rounded border border-slate-200 text-slate-600 disabled:opacity-50 hover:bg-slate-50 text-sm font-medium">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}
