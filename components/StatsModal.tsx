
import React, { useMemo, useState, useEffect } from 'react';
import { X, Clock, BarChart2, User as UserIcon, Calendar, Filter, Download, Database } from 'lucide-react';
import { Task, StageDef, FullUserProfile, TimeLog } from '../types';
import { Language, translations } from '../i18n';
import { differenceInMinutes, format, isWithinInterval, endOfMonth } from 'date-fns';
import { db } from '../services/db';

interface StatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: Task[];
  users: FullUserProfile[];
  stages: StageDef[];
  language: Language;
}

export const StatsModal: React.FC<StatsModalProps> = ({ isOpen, onClose, tasks, users, stages, language }) => {
  const t = translations[language];
  const [dateRange, setDateRange] = useState<'all' | 'this_month' | 'last_month'>('this_month');
  const [modelUsage, setModelUsage] = useState<any[]>([]);

  useEffect(() => {
      if (isOpen) {
          db.getModelUsageStats().then(data => setModelUsage(data)).catch(console.error);
      }
  }, [isOpen]);
  
  // Helpers to replace missing date-fns imports
  const getStartOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
  
  const subtractMonths = (d: Date, n: number) => {
      const result = new Date(d);
      result.setMonth(result.getMonth() - n);
      return result;
  };

  // Filtering logic
  const now = new Date();
  const getInterval = () => {
      if (dateRange === 'this_month') return { start: getStartOfMonth(now), end: endOfMonth(now) };
      if (dateRange === 'last_month') {
          const lastMonth = subtractMonths(now, 1);
          return { start: getStartOfMonth(lastMonth), end: endOfMonth(lastMonth) };
      }
      return null;
  };

  const filterInterval = getInterval();

  const aggregatedStats = useMemo(() => {
    const stats: Record<string, { 
        userName: string, 
        role: string,
        assignmentCount: number, 
        totalAssignmentMins: number,
        workSessionCount: number,
        totalWorkMins: number,
        modelUsageCount: number
    }> = {};

    tasks.forEach(task => {
        if (!task.timeLogs) return;

        task.timeLogs.forEach(log => {
            // Apply Date Filter based on Log Start Time
            if (filterInterval && !isWithinInterval(new Date(log.startTime), filterInterval)) return;

            if (!stats[log.userId]) {
                stats[log.userId] = {
                    userName: log.userName,
                    role: log.userRole,
                    assignmentCount: 0,
                    totalAssignmentMins: 0,
                    workSessionCount: 0,
                    totalWorkMins: 0,
                    modelUsageCount: 0
                };
            }

            // Calculate duration: if no endTime, assume NOW for live stats
            const duration = log.durationMinutes ?? differenceInMinutes(new Date(), new Date(log.startTime));
            
            if (log.type === 'assignment') {
                stats[log.userId].assignmentCount++;
                stats[log.userId].totalAssignmentMins += duration;
            } else if (log.type === 'work') {
                stats[log.userId].workSessionCount++;
                stats[log.userId].totalWorkMins += duration;
            }
        });
    });

    modelUsage.forEach(usage => {
        if (filterInterval && !isWithinInterval(new Date(usage.created_at), filterInterval)) return;
        
        if (stats[usage.user_id]) {
            stats[usage.user_id].modelUsageCount++;
        } else if (usage.profiles) {
            stats[usage.user_id] = {
                userName: usage.profiles.full_name || usage.profiles.email || 'Unknown',
                role: 'User', // Fallback role
                assignmentCount: 0,
                totalAssignmentMins: 0,
                workSessionCount: 0,
                totalWorkMins: 0,
                modelUsageCount: 1
            };
        }
    });

    return Object.values(stats);
  }, [tasks, filterInterval, modelUsage]);

  const formatDuration = (mins: number) => {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${h}h ${m}m`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-6xl h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-fade-in-up">
        
        <div className="bg-indigo-900 p-6 flex justify-between items-center text-white shrink-0">
             <div className="flex items-center gap-4">
                 <div className="p-3 bg-white/10 rounded-lg">
                     <BarChart2 size={24} />
                 </div>
                 <div>
                     <h2 className="text-xl font-bold">Team Performance Statistics</h2>
                     <p className="text-indigo-200 text-sm">Automated Time Tracking Analysis</p>
                 </div>
             </div>
             <div className="flex items-center gap-4">
                 <div className="flex bg-indigo-800 rounded-lg p-1">
                     <button onClick={() => setDateRange('this_month')} className={`px-3 py-1.5 text-xs font-bold rounded ${dateRange === 'this_month' ? 'bg-white text-indigo-900' : 'text-indigo-300 hover:text-white'}`}>This Month</button>
                     <button onClick={() => setDateRange('last_month')} className={`px-3 py-1.5 text-xs font-bold rounded ${dateRange === 'last_month' ? 'bg-white text-indigo-900' : 'text-indigo-300 hover:text-white'}`}>Last Month</button>
                     <button onClick={() => setDateRange('all')} className={`px-3 py-1.5 text-xs font-bold rounded ${dateRange === 'all' ? 'bg-white text-indigo-900' : 'text-indigo-300 hover:text-white'}`}>All Time</button>
                 </div>
                 <button onClick={onClose} className="text-white/70 hover:text-white"><X size={24} /></button>
             </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8 bg-gray-50">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {aggregatedStats.map((stat, idx) => (
                    <div key={idx} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-all">
                        <div className="p-6 border-b border-gray-100 flex items-center gap-4">
                            <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center font-bold text-xl">
                                {stat.userName.charAt(0)}
                            </div>
                            <div>
                                <h3 className="font-bold text-gray-800 text-lg">{stat.userName}</h3>
                                <span className="text-xs font-medium bg-gray-100 text-gray-500 px-2 py-0.5 rounded uppercase">{stat.role}</span>
                            </div>
                        </div>
                        <div className="p-6 grid grid-cols-3 gap-4">
                            {/* Work Time Stats */}
                            <div className="space-y-1">
                                <div className="text-xs font-bold text-green-600 uppercase tracking-wide flex items-center">
                                    <Clock size={12} className="mr-1.5" /> Work Time
                                </div>
                                <div className="text-2xl font-bold text-gray-900">{formatDuration(stat.totalWorkMins)}</div>
                                <div className="text-xs text-gray-400">{stat.workSessionCount} sessions</div>
                            </div>

                            {/* Assignment Time Stats */}
                            <div className="space-y-1">
                                <div className="text-xs font-bold text-blue-600 uppercase tracking-wide flex items-center">
                                    <Calendar size={12} className="mr-1.5" /> Assigned
                                </div>
                                <div className="text-2xl font-bold text-gray-900">{formatDuration(stat.totalAssignmentMins)}</div>
                                <div className="text-xs text-gray-400">{stat.assignmentCount} assignments</div>
                            </div>

                            {/* Model Usage Stats */}
                            <div className="space-y-1">
                                <div className="text-xs font-bold text-purple-600 uppercase tracking-wide flex items-center">
                                    <Database size={12} className="mr-1.5" /> AI Usage
                                </div>
                                <div className="text-2xl font-bold text-gray-900">{stat.modelUsageCount}</div>
                                <div className="text-xs text-gray-400">requests</div>
                            </div>
                        </div>
                        <div className="bg-gray-50 px-6 py-3 text-xs text-gray-500 flex justify-between">
                            <span>Efficiency Ratio</span>
                            <span className="font-mono font-bold">
                                {stat.totalAssignmentMins > 0 
                                    ? Math.round((stat.totalWorkMins / stat.totalAssignmentMins) * 100) 
                                    : 0}%
                            </span>
                        </div>
                    </div>
                ))}

                {aggregatedStats.length === 0 && (
                    <div className="col-span-full flex flex-col items-center justify-center py-20 text-gray-400">
                        <BarChart2 size={48} className="mb-4 opacity-20"/>
                        <p>No activity found for the selected period.</p>
                    </div>
                )}
            </div>
        </div>
      </div>
    </div>
  );
};
