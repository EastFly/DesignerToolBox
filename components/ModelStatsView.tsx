import React, { useState, useEffect, useMemo } from 'react';
import { Database, Activity, Users, Layers, Calendar, Loader2 } from 'lucide-react';
import { db } from '../services/db';
import { Language, translations } from '../i18n';
import { format, subDays, isSameDay, parseISO } from 'date-fns';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell
} from 'recharts';

interface ModelStatsViewProps {
  language: Language;
}

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];

export const ModelStatsView: React.FC<ModelStatsViewProps> = ({ language }) => {
  const t = translations[language];
  const [stats, setStats] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | 'all'>('7d');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 0;
        const data = await db.getModelUsageStats(days);
        setStats(data);
      } catch (error: any) {
        console.error('Failed to fetch model stats:', error);
        setError(error.message || 'Failed to load stats. Please ensure the database is updated.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchStats();
  }, [timeRange]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 h-full">
        <Loader2 className="animate-spin text-indigo-600" size={48} />
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 h-full p-8 text-center">
        <Database className="text-red-400 mb-4" size={48} />
        <h2 className="text-xl font-bold text-gray-800 mb-2">Database Update Required</h2>
        <p className="text-gray-600 max-w-md">
          {error}
        </p>
        <p className="text-sm text-gray-500 mt-4">
          Please go to Settings &gt; Database Setup and run the latest SQL script to create the required RPC functions.
        </p>
      </div>
    );
  }

  const { total_requests, trend, modules, users, recent } = stats;

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-6 flex justify-between items-center shrink-0">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
            <div className="p-2 bg-purple-100 text-purple-600 rounded-lg"><Database size={24} /></div>
            {t.modelStats || 'Model Usage Statistics'}
          </h2>
          <p className="text-gray-500 text-sm mt-1 ml-14">{t.ms_desc}</p>
        </div>
        
        {/* Time Range Toggle */}
        <div className="flex bg-gray-100 rounded-lg p-1 border border-gray-200 shadow-inner">
          <button 
            onClick={() => setTimeRange('7d')} 
            className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${timeRange === '7d' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
          >
            {t.ms_last_7d}
          </button>
          <button 
            onClick={() => setTimeRange('30d')} 
            className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${timeRange === '30d' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
          >
            {t.ms_last_30d}
          </button>
          <button 
            onClick={() => setTimeRange('all')} 
            className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${timeRange === 'all' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
          >
            {t.ms_all_time}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="max-w-7xl mx-auto space-y-8">
          
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center">
                <Activity size={24} />
              </div>
              <div>
                <p className="text-sm text-gray-500 font-medium">{t.ms_total_requests}</p>
                <p className="text-3xl font-bold text-gray-900">{total_requests}</p>
              </div>
            </div>
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center">
                <Layers size={24} />
              </div>
              <div>
                <p className="text-sm text-gray-500 font-medium">{t.ms_active_modules}</p>
                <p className="text-3xl font-bold text-gray-900">{modules.length}</p>
              </div>
            </div>
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
                <Users size={24} />
              </div>
              <div>
                <p className="text-sm text-gray-500 font-medium">{t.ms_active_users}</p>
                <p className="text-3xl font-bold text-gray-900">{users.length}</p>
              </div>
            </div>
          </div>

          {/* Charts Row 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Trend Chart */}
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm lg:col-span-2">
              <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
                <Calendar className="mr-2 text-purple-500" size={20}/>
                {t.ms_request_trends}
              </h3>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill: '#6b7280', fontSize: 12}} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{fill: '#6b7280', fontSize: 12}} dx={-10} />
                    <RechartsTooltip 
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                      cursor={{ stroke: '#e5e7eb', strokeWidth: 2 }}
                    />
                    <Line type="monotone" dataKey="count" stroke="#8b5cf6" strokeWidth={3} dot={{r: 4, strokeWidth: 2}} activeDot={{r: 6}} name={t.ms_requests} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Module Pie Chart */}
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
              <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
                <Layers className="mr-2 text-blue-500" size={20}/>
                {t.ms_usage_by_module}
              </h3>
              <div className="h-[300px] w-full flex items-center justify-center">
                {modules.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={modules}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {modules.map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip 
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                      />
                      <Legend verticalAlign="bottom" height={36} iconType="circle" />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-gray-400 text-sm italic">{t.ms_no_data}</div>
                )}
              </div>
            </div>
          </div>

          {/* User Usage List */}
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2">
              <Users size={20} className="text-green-500" />
              {language === 'cn' ? '用户使用统计' : 'User Usage Statistics'}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="py-3 px-4 text-sm font-semibold text-gray-600 rounded-tl-lg">{language === 'cn' ? '用户' : 'User'}</th>
                    <th className="py-3 px-4 text-sm font-semibold text-gray-600">{language === 'cn' ? '总请求数' : 'Total Requests'}</th>
                    <th className="py-3 px-4 text-sm font-semibold text-gray-600 rounded-tr-lg">{language === 'cn' ? '模块使用明细' : 'Module Breakdown'}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user: any) => (
                    <tr key={user.user_id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-medium text-gray-900">{user.name}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-800">
                          {user.total_count}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(user.modules).map(([mod, count]: [string, any]) => (
                            <span key={mod} className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-white text-gray-700 border border-gray-200 shadow-sm">
                              {mod}: <span className="ml-1 font-bold text-indigo-600">{count}</span>
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-gray-500 italic">
                        {t.ms_no_data}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Requests Table */}
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <h3 className="text-lg font-bold text-gray-800 mb-6">{t.ms_recent_requests}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 text-xs uppercase text-gray-500 tracking-wider">
                    <th className="pb-3 font-semibold">{t.ms_time}</th>
                    <th className="pb-3 font-semibold">{t.ms_user}</th>
                    <th className="pb-3 font-semibold">{t.ms_module}</th>
                    <th className="pb-3 font-semibold">{t.ms_model}</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {recent.map((item: any, idx: number) => (
                    <tr key={idx} className="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
                      <td className="py-3 text-gray-500 whitespace-nowrap">
                        {format(new Date(item.created_at), 'MMM dd, HH:mm:ss')}
                      </td>
                      <td className="py-3 font-medium text-gray-900">
                        {item.user_name}
                      </td>
                      <td className="py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                          {item.module}
                        </span>
                      </td>
                      <td className="py-3 text-gray-600 font-mono text-xs">
                        {item.model_name}
                      </td>
                    </tr>
                  ))}
                  {recent.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-gray-400 italic">{t.ms_no_recent}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
