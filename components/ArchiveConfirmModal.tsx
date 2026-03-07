
import React from 'react';
import { Archive, X, Loader2 } from 'lucide-react';
import { Language, translations } from '../i18n';

interface ArchiveConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  language: Language;
  taskName?: string;
  isArchiving?: boolean;
}

export const ArchiveConfirmModal: React.FC<ArchiveConfirmModalProps> = ({ 
    isOpen, onClose, onConfirm, language, taskName, isArchiving 
}) => {
  const t = translations[language];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in-up">
        <div className="bg-white p-8 rounded-2xl shadow-2xl border border-gray-100 max-w-sm w-full text-center">
            <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Archive size={32} />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">{t.archiveConfirm}</h3>
            {taskName && <p className="text-gray-800 font-medium text-sm mb-2 px-4 truncate">{taskName}</p>}
            <p className="text-gray-500 mb-8 text-sm">{t.archiveTooltip}</p>
            <div className="flex gap-3">
                <button onClick={onClose} className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-colors text-sm">
                    {t.cancel}
                </button>
                <button 
                    onClick={onConfirm} 
                    disabled={isArchiving}
                    className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 text-sm flex items-center justify-center"
                >
                    {isArchiving ? <Loader2 size={16} className="animate-spin mr-2"/> : null}
                    {t.archive}
                </button>
            </div>
        </div>
    </div>
  );
};
