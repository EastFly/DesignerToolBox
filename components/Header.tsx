
import React, { useState, useRef, useEffect } from 'react';
import { Search, Bell, Filter, LayoutGrid, Settings, Globe, Wifi, WifiOff, LogOut, ChevronDown, Check, X, Clock, AlertTriangle, User as UserIcon, CheckCircle, UserCircle, Briefcase, Download, Upload, Trash2, LayoutDashboard, Lock, BarChart2, RefreshCw } from 'lucide-react';
import { User, Priority, FullUserProfile } from '../types';
import { Language, translations } from '../i18n';
import { ConnectionStatus } from '../services/db';

export interface FilterState {
  priority: Priority[];
  timeStatus: 'overdue' | 'soon' | null;
  assigneeId: string | null;
  myTasks: boolean;
}

interface HeaderProps {
  currentUser: User;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  filters: FilterState;
  setFilters: (f: FilterState) => void;
  language: Language;
  setLanguage: (l: Language) => void;
  onOpenSettings: () => void;
  onOpenProfile: () => void;
  onOpenTrash: () => void;
  onImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
  connectionStatus: ConnectionStatus;
  onLogout: () => void;
  users: FullUserProfile[];
  canViewAll: boolean; 
  canManageSettings: boolean; // New Prop
  onRefresh?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  searchQuery,
  setSearchQuery,
  filters,
  setFilters,
  language,
  setLanguage,
  onOpenSettings,
  onOpenProfile,
  onOpenTrash,
  onImport,
  connectionStatus,
  onLogout,
  users,
  canViewAll,
  canManageSettings,
  onRefresh,
}) => {
  const t = translations[language];
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  
  const [isAssigneeOpen, setIsAssigneeOpen] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState('');
  
  const filterRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false);
        setIsAssigneeOpen(false);
      }
      if (toolsRef.current && !toolsRef.current.contains(event.target as Node)) {
        setIsToolsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const togglePriority = (p: Priority) => {
      const current = filters.priority;
      if (current.includes(p)) {
          setFilters({ ...filters, priority: current.filter(x => x !== p) });
      } else {
          setFilters({ ...filters, priority: [...current, p] });
      }
  };

  const getActiveFilterCount = () => {
      let count = 0;
      if (filters.priority.length > 0) count++;
      if (filters.timeStatus) count++;
      if (filters.assigneeId) count++;
      if (filters.myTasks) count++;
      return count;
  };

  const filteredUsers = users.filter(u => u.name.toLowerCase().includes(assigneeSearch.toLowerCase()) || u.role.toLowerCase().includes(assigneeSearch.toLowerCase()));
  const selectedUser = users.find(u => u.id === filters.assigneeId);

  return (
    <header className="bg-white border-b border-gray-200 h-16 px-6 flex items-center justify-between z-20 relative">
      <div className="flex items-center space-x-6 flex-1">
        
        <div className="relative flex-1 max-w-xl flex items-center gap-2" ref={filterRef}>
            <div className="relative flex-1">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                <input 
                    type="text" 
                    placeholder={t.searchPlaceholder} 
                    className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>
            
            <button 
                onClick={() => setIsFilterOpen(!isFilterOpen)}
                className={`relative p-2 rounded-lg border flex items-center gap-2 transition-all ${isFilterOpen || getActiveFilterCount() > 0 ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                title="Filter"
            >
                <Filter size={18} />
                {getActiveFilterCount() > 0 && (
                    <span className="bg-indigo-600 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                        {getActiveFilterCount()}
                    </span>
                )}
            </button>

            {onRefresh && (
                <button 
                    onClick={onRefresh}
                    className="p-2 rounded-lg border bg-white border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-indigo-600 transition-all"
                    title="Refresh Tasks"
                >
                    <RefreshCw size={18} />
                </button>
            )}

            {isFilterOpen && (
                <div className="absolute top-full right-0 mt-2 w-80 bg-white rounded-xl shadow-2xl border border-gray-100 p-4 z-50 animate-fade-in-up">
                    <div className="flex justify-between items-center mb-4">
                        <h4 className="text-sm font-bold text-gray-800">{t.settings} / {t.tools}</h4>
                        <button onClick={() => setFilters({ priority: [], timeStatus: null, assigneeId: null, myTasks: false })} className="text-xs text-gray-400 hover:text-red-500">
                            {t.filter_clear}
                        </button>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">{t.filter_status_time}</label>
                            <div className="flex gap-2">
                                <button 
                                    onClick={() => setFilters({ ...filters, timeStatus: filters.timeStatus === 'overdue' ? null : 'overdue' })}
                                    className={`flex-1 py-1.5 px-2 rounded text-xs font-medium border flex items-center justify-center gap-1 ${filters.timeStatus === 'overdue' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                                >
                                    <AlertTriangle size={12}/> {t.overdue}
                                </button>
                                <button 
                                    onClick={() => setFilters({ ...filters, timeStatus: filters.timeStatus === 'soon' ? null : 'soon' })}
                                    className={`flex-1 py-1.5 px-2 rounded text-xs font-medium border flex items-center justify-center gap-1 ${filters.timeStatus === 'soon' ? 'bg-yellow-50 border-yellow-200 text-yellow-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                                >
                                    <Clock size={12}/> {t.soon}
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">{t.filter_priority}</label>
                            <div className="flex gap-2">
                                {Object.values(Priority).map(p => (
                                    <button 
                                        key={p}
                                        onClick={() => togglePriority(p)}
                                        className={`flex-1 py-1.5 rounded text-xs font-bold border ${filters.priority.includes(p) ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                                    >
                                        {p}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="relative">
                            <div className="flex justify-between items-center mb-2">
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block">{t.filter_assignee}</label>
                                {!canViewAll && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded border border-gray-200 flex items-center"><Lock size={8} className="mr-1"/> Restricted</span>}
                            </div>
                            
                            <button 
                                onClick={() => canViewAll && setIsAssigneeOpen(!isAssigneeOpen)}
                                disabled={!canViewAll}
                                className={`w-full text-left border rounded-lg px-3 py-2 text-sm flex items-center justify-between focus:outline-none ${!canViewAll ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed' : 'bg-white border-gray-200 hover:border-indigo-400 focus:ring-1 focus:ring-indigo-500'}`}
                            >
                                {selectedUser ? (
                                    <div className="flex items-center gap-2">
                                        <img src={selectedUser.avatar || undefined} className="w-5 h-5 rounded-full border border-gray-200" />
                                        <span className="font-medium text-gray-800">{selectedUser.name}</span>
                                    </div>
                                ) : (
                                    <span className={!canViewAll ? 'text-gray-400' : 'text-gray-500'}>{!canViewAll ? 'Restricted to Self' : t.allAssignees}</span>
                                )}
                                <ChevronDown size={14} className="text-gray-400"/>
                            </button>

                            {isAssigneeOpen && canViewAll && (
                                <div className="absolute top-full left-0 mt-1 w-full bg-white rounded-lg shadow-xl border border-gray-200 z-[60] overflow-hidden animate-fade-in-up">
                                    <div className="p-2 border-b border-gray-100 bg-gray-50">
                                        <div className="relative">
                                            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"/>
                                            <input 
                                                autoFocus
                                                className="w-full pl-8 pr-2 py-1.5 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-indigo-500 outline-none"
                                                placeholder={t.search_users}
                                                value={assigneeSearch}
                                                onChange={(e) => setAssigneeSearch(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <div className="max-h-48 overflow-y-auto">
                                        <button 
                                            onClick={() => { setFilters({...filters, assigneeId: null}); setIsAssigneeOpen(false); }}
                                            className="w-full text-left px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 flex items-center gap-2"
                                        >
                                            <div className="w-5 h-5 rounded-full border border-dashed border-gray-400 flex items-center justify-center"><UserIcon size={12}/></div>
                                            {t.allAssignees}
                                        </button>
                                        {filteredUsers.map(user => (
                                            <button 
                                                key={user.id} 
                                                onClick={() => {
                                                    setFilters({...filters, assigneeId: user.id});
                                                    setIsAssigneeOpen(false);
                                                }}
                                                className={`w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-indigo-50 transition-colors ${user.id === filters.assigneeId ? 'bg-indigo-50/50' : ''}`}
                                            >
                                                <img src={user.avatar || undefined} className="w-6 h-6 rounded-full border border-gray-200" />
                                                <div className="flex-1 overflow-hidden">
                                                    <div className="text-sm font-medium text-gray-900 truncate">{user.name}</div>
                                                    <div className="text-[10px] text-gray-500 truncate">{user.role}</div>
                                                </div>
                                                {user.id === filters.assigneeId && <CheckCircle size={14} className="text-indigo-600"/>}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                        
                        {canViewAll && (
                            <div className="pt-2 border-t border-gray-100">
                                 <label className="flex items-center justify-between cursor-pointer group">
                                     <span className="text-sm text-gray-700 font-medium group-hover:text-indigo-600 transition-colors">{t.myTasks}</span>
                                     <div 
                                        onClick={() => setFilters({ ...filters, myTasks: !filters.myTasks })}
                                        className={`w-10 h-5 rounded-full relative transition-colors ${filters.myTasks ? 'bg-indigo-600' : 'bg-gray-200'}`}
                                     >
                                         <div className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform ${filters.myTasks ? 'translate-x-5' : ''}`}></div>
                                     </div>
                                 </label>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
      </div>

      <div className="flex items-center space-x-6">
        
        <div className="text-[10px] text-gray-400 font-mono bg-gray-50 px-2 py-1 rounded border border-gray-100 hidden md:block" title="Current Build Version">
          Build: {new Date().toISOString().split('T')[0].replace(/-/g, '')}.{new Date().getHours().toString().padStart(2, '0')}
        </div>

        <div className={`flex items-center space-x-1.5 px-2 py-1 rounded-full text-xs font-medium border ${
            connectionStatus === 'CONNECTED' 
            ? 'bg-green-50 text-green-700 border-green-200' 
            : 'bg-gray-100 text-gray-600 border-gray-200'
        }`} title={connectionStatus === 'CONNECTED' ? 'Database Connected' : 'Running locally / Offline'}>
            {connectionStatus === 'CONNECTED' ? (
                <>
                    <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
                    <span className="hidden sm:inline">Online</span>
                </>
            ) : (
                <>
                    <WifiOff size={12} />
                    <span className="hidden sm:inline">Offline</span>
                </>
            )}
        </div>

        <div className="relative" ref={toolsRef}>
            <button 
                onClick={() => setIsToolsOpen(!isToolsOpen)}
                className="text-gray-500 hover:text-indigo-600 transition-colors flex items-center space-x-1"
                title={t.tools}
            >
                <Briefcase size={20} />
            </button>
            {isToolsOpen && (
                <div className="absolute top-10 right-0 bg-white shadow-xl border border-gray-100 rounded-lg p-2 min-w-[160px] z-50 animate-fade-in-up">
                    <label className="flex items-center text-sm text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 w-full px-3 py-2 rounded transition-colors cursor-pointer mb-1">
                        <Upload size={16} className="mr-2" /> {t.importTasks}
                        <input type="file" className="hidden" accept=".json" onChange={(e) => {onImport(e); setIsToolsOpen(false);}} />
                    </label>
                    <div className="border-t border-gray-100 my-1"></div>
                    <button onClick={() => {onOpenTrash(); setIsToolsOpen(false);}} className="flex items-center text-sm text-red-600 hover:bg-red-50 w-full px-3 py-2 rounded transition-colors text-left">
                        <Trash2 size={16} className="mr-2" /> {t.recycleBin}
                    </button>
                </div>
            )}
        </div>

        <button 
            onClick={() => setLanguage(language === 'en' ? 'cn' : 'en')}
            className="text-gray-500 hover:text-indigo-600 transition-colors flex items-center space-x-1"
        >
            <Globe size={18} />
            <span className="text-sm font-medium uppercase">{language}</span>
        </button>

        {canManageSettings && (
            <button 
                onClick={onOpenSettings}
                className="text-gray-500 hover:text-indigo-600 transition-colors"
                title={t.settings}
            >
                <Settings size={20} />
            </button>
        )}

        <div className="w-px h-6 bg-gray-200"></div>

        <div className="flex items-center space-x-4 border-l pl-6 border-gray-200">
          <button className="relative p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors">
            <Bell className="w-5 h-5" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border border-white"></span>
          </button>
          
          <div className="flex items-center space-x-3 group relative">
            <img src={currentUser.avatar || undefined} alt="Profile" className="w-10 h-10 rounded-full border border-gray-200 shadow-sm cursor-pointer" />
            
            <div className="hidden group-hover:block absolute top-10 right-0 bg-white shadow-xl border border-gray-100 rounded-lg p-2 min-w-[160px] z-50 animate-fade-in-up">
                <div className="px-3 py-2 border-b border-gray-50 mb-1">
                    <p className="text-sm font-bold text-gray-800 truncate">{currentUser.name}</p>
                    <p className="text-xs text-gray-500">{currentUser.role}</p>
                </div>
                
                <button onClick={onOpenProfile} className="flex items-center text-sm text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 w-full px-3 py-2 rounded transition-colors text-left mb-1">
                    <UserCircle size={16} className="mr-2" /> {t.myProfile}
                </button>

                <button onClick={onLogout} className="flex items-center text-sm text-red-600 hover:bg-red-50 w-full px-3 py-2 rounded transition-colors text-left">
                    <LogOut size={16} className="mr-2" /> {t.logout}
                </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
