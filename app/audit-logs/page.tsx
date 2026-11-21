'use client';

import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import {
  History,
  ShieldCheck,
  Search,
  Filter,
  RefreshCw,
  User,
  Clock,
  Terminal,
} from 'lucide-react';

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedLog, setSelectedLog] = useState<any>(null);

  const fetchLogs = () => {
    setLoading(true);
    fetch('/api/v1/audit-logs')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setLogs(data.data || []);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const filteredLogs = logs.filter((l) => {
    if (!search) return true;
    return (
      l.action.toLowerCase().includes(search.toLowerCase()) ||
      l.entityType.toLowerCase().includes(search.toLowerCase()) ||
      (l.reason && l.reason.toLowerCase().includes(search.toLowerCase()))
    );
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900">سجل التدقيق الرقابي غير القابل للتعديل (Audit Log)</h1>
            <p className="text-sm text-slate-500">
              توثيق شامل لكافة العمليات المالية والإدارية، اعتمادات الإيصالات، تعديلات الأسعار، والإغلاقات
            </p>
          </div>
          <button
            onClick={fetchLogs}
            className="flex items-center space-x-1.5 space-x-reverse bg-white border border-slate-200 text-slate-700 px-3.5 py-2 rounded-xl text-xs font-bold hover:bg-slate-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>تحديث السجل</span>
          </button>
        </div>

        {/* Security Banner */}
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center space-x-3 space-x-reverse text-emerald-900 text-xs">
          <ShieldCheck className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <span>
            سجل التدقيق محمي ومثبت برمجياً ولا يمكن تعديل أو حذف أي سجل منه من قبل أي مستخدم أو مدير نظام.
          </span>
        </div>

        {/* Search */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm max-w-md">
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بنوع الحدث، الكيان، أو البيان..."
              className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          </div>
        </div>

        {/* Logs Table */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden p-6">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3">نوع الحدث (Action)</th>
                  <th className="p-3">الكيان (Entity)</th>
                  <th className="p-3">السبب / البيان</th>
                  <th className="p-3">عنوان IP</th>
                  <th className="p-3">التاريخ والوقت</th>
                  <th className="p-3 text-center">التفاصيل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="p-3 font-mono font-bold text-slate-900">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800">
                        {log.action}
                      </span>
                    </td>
                    <td className="p-3 font-bold text-blue-700">{log.entityType}</td>
                    <td className="p-3 text-slate-600">{log.reason || '—'}</td>
                    <td className="p-3 font-mono text-slate-400">{log.ipAddress || '127.0.0.1'}</td>
                    <td className="p-3 font-mono text-[11px] text-slate-500">
                      {new Date(log.createdAt).toLocaleString('ar-EG')}
                    </td>
                    <td className="p-3 text-center">
                      <button
                        onClick={() => setSelectedLog(log)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded text-xs"
                      >
                        عرض JSON
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* DETAILS MODAL */}
        {selectedLog && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
            <div className="bg-slate-900 text-white rounded-3xl shadow-2xl w-full max-w-lg p-6 border border-slate-800 text-right">
              <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
                <h3 className="font-bold text-sm text-white">تفاصيل التدقيق الرقابي</h3>
                <button onClick={() => setSelectedLog(null)} className="text-slate-400 hover:text-white text-lg font-bold">
                  ✕
                </button>
              </div>

              <div className="space-y-3 text-xs font-mono">
                <div>الحدث: <span className="text-emerald-400 font-bold">{selectedLog.action}</span></div>
                <div>الكيان: <span className="text-blue-400 font-bold">{selectedLog.entityType}</span></div>
                {selectedLog.oldValues && (
                  <div>
                    <div className="text-slate-400 mb-1">القيم السابقة:</div>
                    <pre className="bg-slate-800 p-2.5 rounded-xl overflow-x-auto text-[11px] text-amber-300">
                      {JSON.stringify(JSON.parse(selectedLog.oldValues), null, 2)}
                    </pre>
                  </div>
                )}
                {selectedLog.newValues && (
                  <div>
                    <div className="text-slate-400 mb-1">القيم الجديدة:</div>
                    <pre className="bg-slate-800 p-2.5 rounded-xl overflow-x-auto text-[11px] text-emerald-300">
                      {JSON.stringify(JSON.parse(selectedLog.newValues), null, 2)}
                    </pre>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-slate-800 mt-4 flex justify-end">
                <button
                  onClick={() => setSelectedLog(null)}
                  className="px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold hover:bg-slate-700"
                >
                  إغلاق
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
