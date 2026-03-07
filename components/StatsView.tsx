
import React, { useMemo, useState } from 'react';
import { BarChart2, PlayCircle, CheckCircle, Clock, Calendar, FileImage, Users, Filter, ChevronDown, Zap } from 'lucide-react';
import { Task, StageDef, FullUserProfile, Priority, ProductLevel, TaskDifficulty } from '../types';
import { Language, translations } from '../i18n';
import { PRODUCT_LEVEL_WEIGHTS, DIFFICULTY_WEIGHTS } from '../constants';
import { format, isSameDay, isSameWeek, endOfWeek, isWithinInterval } from 'date-fns';

interface StatsViewProps {
  tasks: Task[];
  users: FullUserProfile[];
  stages: StageDef[];
  language: Language;
}

type MetricType = 'active' | 'done_yesterday' | 'done_week' | 'done_last_week';
type ChartPeriod = '7d' | '14d' | '30d';
type ViewMode = 'count' | 'value'; // New View Mode

// Helpers to replace missing date-fns exports
type Interval = { start: Date | number; end: Date | number };

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const subDays = (d: Date, n: number) => {
    const res = new Date(d);
    res.setDate(res.getDate() - n);
    return res;
};

const subWeeks = (d: Date, n: number) => subDays(d, n * 7);

const startOfWeek = (d: Date, options?: { weekStartsOn: number }) => {
    const date = new Date(d);
    const day = date.getDay();
    // Defaulting logic for weekStartsOn: 1 (Monday) as per usage
    // getDay returns 0 for Sunday, 1 for Monday...
    // If week starts on Monday (1):
    // Mon(1) -> 0 diff
    // Sun(0) -> -6 diff
    const diff = date.getDate() - day + (day === 0 ? -6 : 1); 
    date.setDate(diff);
    date.setHours(0, 0, 0, 0);
    return date;
};

export const StatsView: React.FC<StatsViewProps> = ({ tasks, users, stages, language }) => {
  const t = translations[language];
  const now = new Date();

  // --- STATE ---
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>('14d');
  const [chartUser, setChartUser] = useState<string>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('count');
  
  // Track active metric tab for EACH user card (and 'team' card)
  // Key = userId (or 'team'), Value = MetricType
  const [cardStates, setCardStates] = useState<Record<string, MetricType>>({});

  const setCardState = (id: string, metric: MetricType) => {
      setCardStates(prev => ({ ...prev, [id]: metric }));
  };

  // --- HELPER: Calculate Task Value ---
  const calculateTaskValue = (task: Task): number => {
      const levelWeight = PRODUCT_LEVEL_WEIGHTS[task.productLevel || 'B'] || 1.0;
      const difficultyWeight = DIFFICULTY_WEIGHTS[task.difficulty || 'Medium'] || 1.0;
      const hours = task.estimatedHours || 4; // Default 4 hours if missing
      
      // Formula: Value = Hours * Level * Difficulty
      return Math.round(hours * levelWeight * difficultyWeight * 10) / 10;
  };

  // --- HELPER: CHECK IF TASK DONE ---
  const isTaskCompletedOn = (task: Task, date: Date, period: 'day' | 'week' | 'specific_range', interval?: Interval) => {
      const lastStageId = stages[stages.length - 1]?.id;
      const isDone = task.workStatus === 'completed' || task.stage === lastStageId;
      if (!isDone) return false;

      // Find "Completed" event
      const doneEvent = [...task.timeline].reverse().find(e => 
          e.action.toLowerCase().includes('completed') || 
          e.action.toLowerCase().includes('done') ||
          (lastStageId && e.action.includes(lastStageId.toUpperCase()))
      );

      if (!doneEvent) return false;
      const doneDate = new Date(doneEvent.timestamp);

      if (period === 'day') return isSameDay(doneDate, date);
      if (period === 'week') return isSameWeek(doneDate, date, { weekStartsOn: 1 });
      if (period === 'specific_range' && interval) return isWithinInterval(doneDate, interval);
      
      return false;
  };

  // --- CHART DATA GENERATION ---
  const chartData = useMemo(() => {
      const days = chartPeriod === '7d' ? 7 : chartPeriod === '30d' ? 30 : 14;
      const data = [];
      
      // Filter tasks by user first, and exclude deleted tasks
      const relevantTasks = (chartUser === 'all' 
          ? tasks 
          : tasks.filter(t => t.owner.id === chartUser))
          .filter(t => t.lifecycleStatus !== 'deleted');

      for (let i = days - 1; i >= 0; i--) {
          const date = startOfDay(subDays(now, i));
          
          const createdTasks = relevantTasks.filter(t => isSameDay(new Date(t.createdAt), date));
          const completedTasks = relevantTasks.filter(t => isTaskCompletedOn(t, date, 'day'));

          // Calculate counts or sum of values
          const createdMetric = viewMode === 'count' 
              ? createdTasks.length 
              : createdTasks.reduce((sum, t) => sum + calculateTaskValue(t), 0);
          
          const completedMetric = viewMode === 'count'
              ? completedTasks.length
              : completedTasks.reduce((sum, t) => sum + calculateTaskValue(t), 0);

          data.push({ 
              date, 
              created: Math.round(createdMetric), 
              completed: Math.round(completedMetric), 
              label: format(date, 'MM/dd') 
          });
      }
      return data;
  }, [tasks, stages, chartPeriod, chartUser, viewMode]);

  // Dynamic Y-Axis Scale
  const maxChartValue = Math.max(...chartData.map(d => Math.max(d.created, d.completed))) + 1; // +1 to avoid 0 div and header overlap

  // --- CARD DATA GENERATION HELPER ---
  const generateStatsForTasks = (subsetTasks: Task[]) => {
      // 1. Currently Active
      const activeTasks = subsetTasks.filter(t => t.workStatus === 'in_progress').sort((a,b) => {
          if (a.priority === Priority.P0 && b.priority !== Priority.P0) return -1;
          if (a.priority !== Priority.P0 && b.priority === Priority.P0) return 1;
          return 0;
      });

      // 2. Done Yesterday
      const yesterday = subDays(now, 1);
      const doneYesterdayTasks = subsetTasks.filter(t => isTaskCompletedOn(t, yesterday, 'day'));

      // 3. Done This Week (Mon-Sun)
      const doneWeekTasks = subsetTasks.filter(t => isTaskCompletedOn(t, now, 'week'));

      // 4. Done Last Week
      const lastWeekStart = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
      const lastWeekEnd = endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
      const doneLastWeekTasks = subsetTasks.filter(t => isTaskCompletedOn(t, now, 'specific_range', { start: lastWeekStart, end: lastWeekEnd }));

      // helper sum
      const sumValue = (list: Task[]) => list.reduce((acc, t) => acc + calculateTaskValue(t), 0);

      return {
          activeTasks,
          doneYesterdayTasks,
          doneWeekTasks,
          doneLastWeekTasks,
          metrics: {
              active: viewMode === 'count' ? activeTasks.length : Math.round(sumValue(activeTasks)),
              doneYesterday: viewMode === 'count' ? doneYesterdayTasks.length : Math.round(sumValue(doneYesterdayTasks)),
              doneWeek: viewMode === 'count' ? doneWeekTasks.length : Math.round(sumValue(doneWeekTasks)),
              doneLastWeek: viewMode === 'count' ? doneLastWeekTasks.length : Math.round(sumValue(doneLastWeekTasks))
          }
      };
  };

  // --- TEAM & USER STATS ---
  const allStats = useMemo(() => {
      // Exclude deleted tasks
      const activeTasks = tasks.filter(t => t.lifecycleStatus !== 'deleted');

      // 1. Aggregate Team Stats (First Card)
      const teamAgg = generateStatsForTasks(activeTasks);
      const teamCard = {
          id: 'team',
          isTeam: true,
          name: t.stats_all_team,
          avatar: null,
          role: 'Organization',
          data: teamAgg
      };

      // 2. Individual User Stats
      const userCards = users.map(user => {
          const userTasks = activeTasks.filter(t => t.owner.id === user.id);
          return {
              id: user.id,
              isTeam: false,
              name: user.name,
              avatar: user.avatar,
              role: user.role,
              data: generateStatsForTasks(userTasks)
          };
      });

      return [teamCard, ...userCards];
  }, [users, tasks, stages, viewMode]); // Re-run if data or viewMode changes

  // --- RENDERERS ---

  const renderTaskList = (taskList: Task[], emptyMsg: string) => {
      if (taskList.length === 0) {
          return (
              <div className="text-center py-8 text-gray-400 text-xs italic flex flex-col items-center">
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center mb-2"><CheckCircle size={14} className="text-gray-300"/></div>
                  {emptyMsg}
              </div>
          );
      }
      return (
          <div className="space-y-2 max-h-[200px] overflow-y-auto custom-scrollbar pr-1">
              {taskList.map(task => {
                  const productImage = task.identity?.productImage?.[0];
                  const val = calculateTaskValue(task);
                  return (
                      <div key={task.id} className="bg-white p-2 rounded border border-gray-200 flex items-center gap-3 shadow-sm hover:border-indigo-300 transition-colors">
                          <div className="w-8 h-8 rounded bg-gray-100 shrink-0 overflow-hidden border border-gray-100">
                              {productImage ? <img src={productImage || undefined} className="w-full h-full object-cover"/> : <div className="w-full h-full flex items-center justify-center text-gray-300"><FileImage size={14}/></div>}
                          </div>
                          <div className="flex-1 min-w-0">
                              <div className="text-xs font-bold text-gray-800 truncate" title={task.identity.productName}>{task.identity.productName}</div>
                              <div className="flex items-center gap-2 mt-0.5">
                                  <span className={`text-[9px] px-1 rounded border ${task.priority === Priority.P0 ? 'bg-red-50 text-red-600 border-red-100' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                                      {task.priority}
                                  </span>
                                  {viewMode === 'value' && (
                                      <span className="text-[9px] bg-yellow-50 text-yellow-700 px-1 rounded border border-yellow-100 font-bold flex items-center">
                                          <Zap size={8} className="mr-0.5 fill-yellow-400 text-yellow-600"/> {val}
                                      </span>
                                  )}
                                  <span className="text-[9px] text-gray-400 font-mono truncate">{task.stage}</span>
                              </div>
                          </div>
                      </div>
                  );
              })}
          </div>
      );
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-8 py-6 flex justify-between items-center shrink-0">
             <div>
                 <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
                     <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg"><BarChart2 size={24} /></div>
                     {t.stats_title}
                 </h2>
                 <p className="text-gray-500 text-sm mt-1 ml-14">{t.stats_subtitle}</p>
             </div>
             
             {/* VIEW MODE TOGGLE */}
             <div className="flex bg-gray-100 rounded-lg p-1 border border-gray-200 shadow-inner">
                 <button 
                    onClick={() => setViewMode('count')} 
                    className={`px-4 py-2 rounded-md text-sm font-bold transition-all flex items-center gap-2 ${viewMode === 'count' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
                 >
                     # Task Count
                 </button>
                 <button 
                    onClick={() => setViewMode('value')} 
                    className={`px-4 py-2 rounded-md text-sm font-bold transition-all flex items-center gap-2 ${viewMode === 'value' ? 'bg-white text-yellow-600 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
                 >
                     <Zap size={14} className={viewMode === 'value' ? 'fill-yellow-400' : ''}/> Contribution Value
                 </button>
             </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
            <div className="max-w-7xl mx-auto space-y-8">
                
                {/* SECTION 1: DYNAMIC CHART */}
                <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-lg font-bold text-gray-800 flex items-center">
                            <Calendar className="mr-2 text-indigo-500" size={20}/>
                            {t.stats_chart_title} <span className="ml-2 text-xs font-normal text-gray-400">({viewMode === 'value' ? 'Total Value Points' : 'Number of Tasks'})</span>
                        </h3>
                        
                        {/* Chart Controls */}
                        <div className="flex gap-2">
                            <div className="relative">
                                <select 
                                    className="appearance-none bg-gray-50 border border-gray-200 text-gray-700 text-xs font-medium py-1.5 pl-3 pr-8 rounded-lg cursor-pointer hover:border-gray-300 focus:outline-none"
                                    value={chartUser}
                                    onChange={(e) => setChartUser(e.target.value)}
                                >
                                    <option value="all">{t.stats_all_members}</option>
                                    {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                                </select>
                                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
                            </div>
                            <div className="bg-gray-100 rounded-lg p-0.5 flex text-xs font-bold">
                                <button onClick={() => setChartPeriod('7d')} className={`px-3 py-1 rounded-md transition-all ${chartPeriod === '7d' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{t.stats_period_7d}</button>
                                <button onClick={() => setChartPeriod('14d')} className={`px-3 py-1 rounded-md transition-all ${chartPeriod === '14d' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{t.stats_period_14d}</button>
                                <button onClick={() => setChartPeriod('30d')} className={`px-3 py-1 rounded-md transition-all ${chartPeriod === '30d' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{t.stats_period_30d}</button>
                            </div>
                        </div>
                    </div>
                    
                    <div className="overflow-x-auto overflow-y-hidden">
                        <div className="h-64 flex items-end justify-between gap-2 border-b border-gray-100 relative pt-6 min-w-[600px] mb-2">
                            {/* Y-Axis Guidelines (Simplified) */}
                            <div className="absolute inset-0 pointer-events-none flex flex-col justify-between text-[10px] text-gray-300 pb-6 pr-2">
                                <div className="border-t border-dashed border-gray-100 w-full h-0 relative"><span className="absolute -top-2 right-0">{maxChartValue}</span></div>
                                <div className="border-t border-dashed border-gray-100 w-full h-0 relative"><span className="absolute -top-2 right-0">{Math.round(maxChartValue/2)}</span></div>
                                <div className="border-t border-transparent w-full h-0"></div>
                            </div>

                            {chartData.map((d, i) => {
                                const hCreated = (d.created / maxChartValue) * 100;
                                const hCompleted = (d.completed / maxChartValue) * 100;
                                return (
                                    <div key={i} className="flex-1 flex flex-col items-center gap-2 group relative z-10 h-full justify-end min-w-[20px]">
                                        {/* Tooltip */}
                                        <div className="absolute bottom-full mb-1 bg-gray-800 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none">
                                            <div className="font-bold border-b border-white/20 pb-1 mb-1">{d.label}</div>
                                            <div className="flex gap-3">
                                                <span className="text-blue-300">+{d.created}</span>
                                                <span className="text-green-300">-{d.completed}</span>
                                            </div>
                                        </div>
                                        
                                        <div className="w-full flex items-end justify-center gap-1 px-0.5 h-full">
                                            {/* Created Bar */}
                                            <div 
                                                style={{ height: `${Math.max(hCreated, 2)}%` }} 
                                                className={`w-1/2 rounded-t-sm transition-all ${d.created > 0 ? 'bg-blue-500 opacity-90 group-hover:opacity-100' : 'bg-gray-100'}`}
                                            ></div>
                                            {/* Completed Bar */}
                                            <div 
                                                style={{ height: `${Math.max(hCompleted, 2)}%` }} 
                                                className={`w-1/2 rounded-t-sm transition-all ${d.completed > 0 ? 'bg-green-500 opacity-90 group-hover:opacity-100' : 'bg-gray-100'}`}
                                            ></div>
                                        </div>
                                        <span className="text-[9px] text-gray-400 font-mono -mb-6 h-4">{d.label}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <div className="flex justify-center gap-6 mt-6">
                        <div className="flex items-center text-xs text-gray-600"><div className="w-3 h-3 bg-blue-500 rounded-sm mr-2"></div> {t.stats_created}</div>
                        <div className="flex items-center text-xs text-gray-600"><div className="w-3 h-3 bg-green-500 rounded-sm mr-2"></div> {t.stats_completed}</div>
                    </div>
                </div>

                {/* SECTION 2: TEAM CARDS */}
                <div>
                    <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
                        {t.stats_team_overview} 
                        {viewMode === 'value' && <span className="ml-2 bg-yellow-100 text-yellow-700 text-xs px-2 py-0.5 rounded-full border border-yellow-200">Value Mode</span>}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {allStats.map((stat) => {
                            const activeMetric = cardStates[stat.id] || 'active'; // Default to active
                            
                            // Determine which list to show
                            let displayList: Task[] = [];
                            if (activeMetric === 'active') displayList = stat.data.activeTasks;
                            if (activeMetric === 'done_yesterday') displayList = stat.data.doneYesterdayTasks;
                            if (activeMetric === 'done_week') displayList = stat.data.doneWeekTasks;
                            if (activeMetric === 'done_last_week') displayList = stat.data.doneLastWeekTasks;

                            return (
                                <div key={stat.id} className={`rounded-xl shadow-sm border overflow-hidden flex flex-col transition-all hover:shadow-md ${stat.isTeam ? 'bg-indigo-50/50 border-indigo-200' : 'bg-white border-gray-200'}`}>
                                    
                                    {/* Card Header */}
                                    <div className={`p-4 border-b flex items-center gap-4 ${stat.isTeam ? 'bg-indigo-100/50 border-indigo-100' : 'bg-gray-50/50 border-gray-100'}`}>
                                        <div className="relative">
                                            {stat.isTeam ? (
                                                <div className="w-12 h-12 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-indigo-200 shadow-md">
                                                    <Users size={20} />
                                                </div>
                                            ) : (
                                                <div className="relative">
                                                    <img src={stat.avatar || undefined} className="w-12 h-12 rounded-full border-2 border-white shadow-sm object-cover"/>
                                                    <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${stat.data.metrics.active > 0 ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                                                </div>
                                            )}
                                        </div>
                                        <div>
                                            <h4 className={`font-bold ${stat.isTeam ? 'text-indigo-900 text-lg' : 'text-gray-900'}`}>{stat.name}</h4>
                                            <span className={`text-xs font-medium px-2 py-0.5 rounded uppercase ${stat.isTeam ? 'bg-indigo-200 text-indigo-700' : 'bg-gray-200 text-gray-500'}`}>{stat.role}</span>
                                        </div>
                                    </div>

                                    {/* Metrics Grid (Clickable) */}
                                    <div className="grid grid-cols-4 divide-x divide-gray-100 border-b border-gray-100 bg-white">
                                        {[
                                            { key: 'active', label: t.stats_metric_in_progress, val: stat.data.metrics.active, color: 'text-indigo-600' },
                                            { key: 'done_yesterday', label: t.stats_metric_done_yesterday, val: stat.data.metrics.doneYesterday, color: 'text-gray-700' },
                                            { key: 'done_week', label: t.stats_metric_done_week, val: stat.data.metrics.doneWeek, color: 'text-gray-700' },
                                            { key: 'done_last_week', label: t.stats_metric_done_last_week, val: stat.data.metrics.doneLastWeek, color: 'text-gray-700' }
                                        ].map((m) => (
                                            <div 
                                                key={m.key} 
                                                onClick={() => setCardState(stat.id, m.key as MetricType)}
                                                className={`p-3 text-center cursor-pointer transition-colors hover:bg-gray-50 relative ${activeMetric === m.key ? 'bg-indigo-50/60' : ''}`}
                                            >
                                                <div className="text-[9px] text-gray-400 uppercase font-bold mb-1 truncate" title={m.label}>{m.label.split(' ')[1] || m.label.substring(0, 4)}</div>
                                                <div className={`text-lg font-bold ${m.color}`}>{m.val}</div>
                                                {activeMetric === m.key && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500"></div>}
                                            </div>
                                        ))}
                                    </div>

                                    {/* Task List Area */}
                                    <div className="p-4 flex-1 bg-gray-50/30 min-h-[150px] flex flex-col">
                                        <h5 className="text-xs font-bold text-gray-500 uppercase mb-3 flex items-center justify-between">
                                            <span className="flex items-center gap-1.5">
                                                <PlayCircle size={12} /> 
                                                {(t as any)[`stats_metric_${activeMetric}`] || activeMetric}
                                            </span>
                                            <span className="bg-gray-200 text-gray-600 px-1.5 rounded text-[10px]">{displayList.length}</span>
                                        </h5>
                                        {renderTaskList(displayList, t.stats_no_active_tasks)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    </div>
  );
};
