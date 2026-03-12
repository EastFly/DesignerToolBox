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
  const [usageData, setUsageData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | 'all'>('7d');

  useEffect(() => {
    const fetchStats = async () => {
      setIsLoading(true);
      try {
        const data = await db.getModelUsageStats();
        setUsageData(data);
      } catch (error) {
        console.error('Failed to fetch model stats:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchStats();
  }, []);

  const filteredData = useMemo(() => {
    if (timeRange === 'all') return usageData;
    const days = timeRange === '7d' ? 7 : 30;
    const cutoff = subDays(new Date(), days);
    return usageData.filter(item => new Date(item.created_at) >= cutoff);
  }, [usageData, timeRange]);

  // 1. Trend Data (Requests per day)
  const trendData = useMemo(() => {
    const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 30; // Default to 30 for 'all' to avoid huge charts
    const data: Record<string, number> = {};
    
    // Initialize dates
    for (let i = days - 1; i >= 0; i--) {
      const date = subDays(new Date(), i);
      data[format(date, 'MMM dd')] = 0;
    }

    filteredData.forEach(item => {
      const dateStr = format(new Date(item.created_at), 'MMM dd');
      if (data[dateStr] !== undefined) {
        data[dateStr]++;
      } else if (timeRange === 'all') {
         data[dateStr] = (data[dateStr] || 0) + 1;
      }
    });

    return Object.entries(data).map(([date, count]) => ({ date, count }));
  }, [filteredData, timeRange]);

  // 2. Module Usage (Pie Chart)
  const moduleData = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredData.forEach(item => {
      const mod = item.module || 'Unknown';
      counts[mod] = (counts[mod] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredData]);

  // 3. User Usage (Bar Chart)
  const userUsageData = useMemo(() => {
    const counts: Record<string, { name: string, count: number }> = {};
    filteredData.forEach(item => {
      const userId = item.user_id;
      const userName = item.profiles?.full_name || item.profiles?.email || 'Unknown User';
      if (!counts[userId]) {
        counts[userId] = { name: userName, count: 0 };
      }
      counts[userId].count++;
    });
    return Object.values(counts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Top 10 users
  }, [filteredData]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 h-full">
        <Loader2 className="animate-spin text-indigo-600" size={48} />
      </div>
    );
  }

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
                <p className="text-3xl font-bold text-gray-900">{filteredData.length}</p>
              </div>
            </div>
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center">
                <Layers size={24} />
              </div>
              <div>
                <p className="text-sm text-gray-500 font-medium">{t.ms_active_modules}</p>
                <p className="text-3xl font-bold text-gray-900">{moduleData.length}</p>
              </div>
            </div>
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
                <Users size={24} />
              </div>
              <div>
                <p className="text-sm text-gray-500 font-medium">{t.ms_active_users}</p>
                <p className="text-3xl font-bold text-gray-900">{userUsageData.length}</p>
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
                  <LineChart data={trendData}>
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
                {moduleData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={moduleData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {moduleData.map((entry, index) => (
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

          {/* Charts Row 2 */}
          <div className="grid grid-cols-1 gap-6">
            {/* User Bar Chart */}
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
              <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
                <Users className="mr-2 text-green-500" size={20}/>
                {t.ms_top_users}
              </h3>
              <div className="h-[300px] w-full">
                {userUsageData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={userUsageData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f3f4f6" />
                      <XAxis type="number" axisLine={false} tickLine={false} tick={{fill: '#6b7280', fontSize: 12}} />
                      <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{fill: '#374151', fontSize: 12, fontWeight: 500}} width={150} />
                      <RechartsTooltip 
                        cursor={{fill: '#f3f4f6'}}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                      />
                      <Bar dataKey="count" fill="#10b981" radius={[0, 4, 4, 0]} barSize={24} name={t.ms_requests} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-400 text-sm italic">{t.ms_no_data}</div>
                )}
              </div>
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
                  {filteredData.slice(0, 20).map((item, idx) => (
                    <tr key={idx} className="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
                      <td className="py-3 text-gray-500 whitespace-nowrap">
                        {format(new Date(item.created_at), 'MMM dd, HH:mm:ss')}
                      </td>
                      <td className="py-3 font-medium text-gray-900">
                        {item.profiles?.full_name || item.profiles?.email || 'Unknown'}
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
                  {filteredData.length === 0 && (
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
