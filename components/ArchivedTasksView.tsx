
import React, { useState } from 'react';
import { Archive, Search, RefreshCw, Trash2, Calendar, User } from 'lucide-react';
import { Task, StageDef } from '../types';
import { Language, translations } from '../i18n';
import { format } from 'date-fns';

interface ArchivedTasksViewProps {
  archivedTasks: Task[];
  onUnarchive: (taskId: string) => Promise<void>;
  onDeleteForever: (taskId: string) => Promise<void>;
  language: Language;
  stages: StageDef[];
}

export const ArchivedTasksView: React.FC<ArchivedTasksViewProps> = ({ 
    archivedTasks, onUnarchive, onDeleteForever, language, stages 
}) => {
  const t = translations[language];
  const [search, setSearch] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);

  const filtered = archivedTasks.filter(t => 
      t.identity.productName.toLowerCase().includes(search.toLowerCase()) || 
      t.id.toLowerCase().includes(search.toLowerCase()) ||
      t.identity.sku?.toLowerCase().includes(search.toLowerCase())
  );

  const handleUnarchive = async (id: string) => {
      setProcessingId(id);
      await onUnarchive(id);
      setProcessingId(null);
  };

  const handleDelete = async (id: string) => {
      if(!window.confirm(t.deleteForeverConfirm)) return;
      setProcessingId(id);
      await onDeleteForever(id);
      setProcessingId(null);
  };

  return (
    <div className="flex h-full flex-col bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-8 py-6 flex justify-between items-center shrink-0">
            <div>
                <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
                    <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg"><Archive size={24} /></div>
                    {t.archivedTasks}
                </h2>
                <p className="text-gray-500 text-sm mt-1 ml-14">Long-term storage for completed work.</p>
            </div>
            <div className="relative w-64">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input 
                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-indigo-500"
                    placeholder={t.searchPlaceholder}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
            {filtered.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-60">
                    <Archive size={48} className="mb-4" />
                    <p>{t.archivedEmpty}</p>
                </div>
            ) : (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500 font-bold">
                                <th className="p-4 w-20">ID</th>
                                <th className="p-4">Product / Task Name</th>
                                <th className="p-4">Archived Date</th>
                                <th className="p-4">Original Owner</th>
                                <th className="p-4">Original Stage</th>
                                <th className="p-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filtered.map(task => (
                                <tr key={task.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="p-4">
                                        <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{task.id}</span>
                                    </td>
                                    <td className="p-4">
                                        <div className="font-bold text-sm text-gray-800">{task.identity.productName}</div>
                                        <div className="text-xs text-gray-500 font-mono mt-0.5">{task.identity.sku}</div>
                                    </td>
                                    <td className="p-4 text-sm text-gray-600">
                                        <div className="flex items-center gap-2">
                                            <Calendar size={14} className="text-gray-400"/>
                                            {task.archivedAt ? format(new Date(task.archivedAt), 'MMM dd, yyyy') : '-'}
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex items-center gap-2 text-sm text-gray-700">
                                            <div className="w-6 h-6 rounded-full bg-gray-200 overflow-hidden">
                                                <img src={task.owner.avatar || undefined} className="w-full h-full object-cover"/>
                                            </div>
                                            {task.owner.name}
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full border border-gray-200">
                                            {stages.find(s => s.id === task.stage)?.title || task.stage}
                                        </span>
                                    </td>
                                    <td className="p-4 text-right">
                                        <div className="flex justify-end gap-2">
                                            <button 
                                                onClick={() => handleUnarchive(task.id)}
                                                disabled={!!processingId}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 text-gray-600 rounded hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 text-xs font-bold transition-colors disabled:opacity-50"
                                                title={t.unarchive}
                                            >
                                                <RefreshCw size={14} className={processingId === task.id ? 'animate-spin' : ''}/> Unarchive
                                            </button>
                                            <button 
                                                onClick={() => handleDelete(task.id)}
                                                disabled={!!processingId}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 text-red-600 rounded hover:bg-red-50 hover:border-red-200 text-xs font-bold transition-colors disabled:opacity-50"
                                                title={t.deletePermanently}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    </div>
  );
};
