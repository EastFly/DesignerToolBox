import React, { useState } from 'react';
import { X, RefreshCw, Trash2, CheckCircle, Search, AlertTriangle } from 'lucide-react';
import { Task } from '../types';
import { Language, translations } from '../i18n';
import { format } from 'date-fns';

interface TrashModalProps {
  deletedTasks: Task[];
  isOpen: boolean;
  onClose: () => void;
  onRestore: (taskId: string) => Promise<void>;
  onPermanentDelete: (taskId: string) => Promise<void>;
  language: Language;
}

export const TrashModal: React.FC<TrashModalProps> = ({ 
    deletedTasks, isOpen, onClose, onRestore, onPermanentDelete, language 
}) => {
  const t = translations[language];
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  if (!isOpen) return null;

  const filtered = deletedTasks.filter(t => 
      t.identity.productName.toLowerCase().includes(search.toLowerCase()) || 
      t.id.toLowerCase().includes(search.toLowerCase())
  );

  const handleRestore = async (id: string) => {
      setProcessingId(id);
      await onRestore(id);
      setProcessingId(null);
  };

  const handleDelete = async (id: string) => {
      if(!window.confirm(t.deleteForeverConfirm)) return;
      setProcessingId(id);
      await onPermanentDelete(id);
      setProcessingId(null);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-4xl h-[80vh] rounded-xl shadow-2xl flex flex-col overflow-hidden animate-fade-in-up">
        
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
            <div className="flex items-center gap-3">
                <div className="bg-red-100 p-2 rounded-lg text-red-600">
                    <Trash2 size={20} />
                </div>
                <div>
                    <h2 className="text-xl font-bold text-gray-800">{t.recycleBin}</h2>
                    <p className="text-xs text-gray-500">{deletedTasks.length} items</p>
                </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-2 rounded-full hover:bg-gray-200">
                <X size={24} />
            </button>
        </div>

        <div className="p-4 border-b border-gray-100">
            <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input 
                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-indigo-500"
                    placeholder={t.searchPlaceholder}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-gray-50/50">
            {filtered.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-60">
                    <Trash2 size={48} className="mb-4" />
                    <p>{t.trashEmpty}</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filtered.map(task => (
                        <div key={task.id} className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm flex items-center justify-between group hover:border-red-200 hover:shadow-md transition-all">
                            <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-mono bg-gray-100 px-1.5 rounded text-gray-500">{task.id}</span>
                                    <h4 className="font-bold text-gray-800">{task.identity.productName}</h4>
                                </div>
                                <div className="text-xs text-gray-500 flex items-center gap-3">
                                    <span>Deleted: {task.deletedAt ? format(task.deletedAt, 'MMM dd, HH:mm') : '-'}</span>
                                    <span>•</span>
                                    <span>Original Stage: {task.stage}</span>
                                </div>
                            </div>
                            
                            <div className="flex gap-2">
                                <button 
                                    onClick={() => handleRestore(task.id)}
                                    disabled={!!processingId}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 rounded border border-green-200 hover:bg-green-100 text-xs font-bold transition-colors disabled:opacity-50"
                                >
                                    <RefreshCw size={14} className={processingId === task.id ? 'animate-spin' : ''}/> {t.restore}
                                </button>
                                <button 
                                    onClick={() => handleDelete(task.id)}
                                    disabled={!!processingId}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-700 rounded border border-red-200 hover:bg-red-100 text-xs font-bold transition-colors disabled:opacity-50"
                                >
                                    <Trash2 size={14} /> {t.deletePermanently}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
      </div>
    </div>
  );
};
