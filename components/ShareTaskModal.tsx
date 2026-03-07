import React, { useState, useEffect } from 'react';
import { X, Link as LinkIcon, Copy, Check, Clock, Trash2 } from 'lucide-react';
import { Task, TaskShareLink, FieldDefinition } from '../types';
import { Language, translations } from '../i18n';

interface ShareTaskModalProps {
    isOpen: boolean;
    onClose: () => void;
    task: Task;
    stageId: string;
    stageFields: FieldDefinition[];
    onGenerateLink: (fields: string[], expiresInDays: number) => void;
    onRevokeLink: (linkId: string) => void;
    language: Language;
}

export function ShareTaskModal({ isOpen, onClose, task, stageId, stageFields, onGenerateLink, onRevokeLink, language }: ShareTaskModalProps) {
    const t = translations[language];
    const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
    const [expiresInDays, setExpiresInDays] = useState<number>(3);
    const [copied, setCopied] = useState(false);

    // Find active link for this stage
    const activeLink = task.shareLinks?.find(l => l.stageId === stageId && l.status === 'pending');

    useEffect(() => {
        if (isOpen) {
            setSelectedFields(new Set(stageFields.map(f => f.key)));
            setCopied(false);
        }
    }, [isOpen, stageFields]);

    if (!isOpen) return null;

    const handleToggleField = (key: string) => {
        const newSet = new Set(selectedFields);
        if (newSet.has(key)) {
            newSet.delete(key);
        } else {
            newSet.add(key);
        }
        setSelectedFields(newSet);
    };

    const handleGenerate = () => {
        if (selectedFields.size === 0) return;
        onGenerateLink(Array.from(selectedFields), expiresInDays);
    };

    const handleCopy = () => {
        if (!activeLink) return;
        const url = `${window.location.origin}/share/${activeLink.id}`;
        navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                    <h3 className="font-bold text-gray-800 flex items-center gap-2">
                        <LinkIcon size={18} className="text-indigo-600" />
                        {t.share_modal_title}
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1">
                    {activeLink ? (
                        <div className="space-y-6">
                            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800">
                                <h4 className="font-bold flex items-center gap-2 mb-2">
                                    <Clock size={16} />
                                    {t.share_waiting}
                                </h4>
                                <p className="text-sm mb-4">
                                    {t.share_active_desc.replace('{date}', new Date(activeLink.expiresAt).toLocaleDateString())}
                                </p>
                                
                                <div className="flex items-center gap-2">
                                    <div className="flex-1 bg-white border border-amber-200 rounded-lg px-3 py-2 text-sm font-mono text-gray-600 truncate select-all">
                                        {`${window.location.origin}/share/${activeLink.id}`}
                                    </div>
                                    <button 
                                        onClick={handleCopy}
                                        className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shrink-0"
                                        title={t.share_copy}
                                    >
                                        {copied ? <Check size={18} /> : <Copy size={18} />}
                                    </button>
                                </div>
                            </div>

                            <div>
                                <h4 className="text-sm font-bold text-gray-700 mb-2">{t.share_requested_fields}</h4>
                                <div className="flex flex-wrap gap-2">
                                    {activeLink.fields.map(key => {
                                        const field = stageFields.find(f => f.key === key);
                                        return (
                                            <span key={key} className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs border border-gray-200">
                                                {field?.label || key}
                                            </span>
                                        );
                                    })}
                                </div>
                            </div>

                            <button 
                                onClick={() => onRevokeLink(activeLink.id)}
                                className="w-full py-2 flex items-center justify-center gap-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors font-medium text-sm"
                            >
                                <Trash2 size={16} />
                                {t.share_revoke}
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <p className="text-sm text-gray-600">
                                {t.share_intro}
                            </p>

                            <div>
                                <h4 className="text-sm font-bold text-gray-700 mb-3 flex justify-between items-center">
                                    {t.share_select_fields}
                                    <button 
                                        onClick={() => setSelectedFields(selectedFields.size === stageFields.length ? new Set() : new Set(stageFields.map(f => f.key)))}
                                        className="text-xs text-indigo-600 hover:text-indigo-800 font-normal"
                                    >
                                        {selectedFields.size === stageFields.length ? t.share_deselect_all : t.share_select_all}
                                    </button>
                                </h4>
                                <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                                    {stageFields.map(field => (
                                        <label key={field.key} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg cursor-pointer border border-transparent hover:border-gray-200 transition-colors">
                                            <input 
                                                type="checkbox" 
                                                checked={selectedFields.has(field.key)}
                                                onChange={() => handleToggleField(field.key)}
                                                className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                                            />
                                            <div>
                                                <div className="text-sm font-medium text-gray-800">{field.label}</div>
                                                {field.description && <div className="text-xs text-gray-500">{field.description}</div>}
                                            </div>
                                        </label>
                                    ))}
                                    {stageFields.length === 0 && (
                                        <div className="text-sm text-gray-500 italic py-2">{t.share_no_fields}</div>
                                    )}
                                </div>
                            </div>

                            <div>
                                <h4 className="text-sm font-bold text-gray-700 mb-2">{t.share_expiration}</h4>
                                <select 
                                    value={expiresInDays}
                                    onChange={(e) => setExpiresInDays(Number(e.target.value))}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                >
                                    <option value={1}>1 {t.share_day}</option>
                                    <option value={3}>3 {t.share_days}</option>
                                    <option value={7}>7 {t.share_days}</option>
                                    <option value={14}>14 {t.share_days}</option>
                                </select>
                            </div>

                            <button 
                                onClick={handleGenerate}
                                disabled={selectedFields.size === 0}
                                className="w-full py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                <LinkIcon size={18} />
                                {t.share_generate}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
