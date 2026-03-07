import React, { useState, useEffect } from 'react';
import { Task, FieldDefinition, TaskShareLink } from '../types';
import { db } from '../services/db';
import { Language, translations } from '../i18n';
import { Loader2, CheckCircle, AlertCircle, Send } from 'lucide-react';
import { DynamicField } from './DynamicField';

interface PublicShareViewProps {
    linkId: string;
    language: Language;
}

export const PublicShareView: React.FC<PublicShareViewProps> = ({ linkId, language }) => {
    const t = translations[language];
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [task, setTask] = useState<Task | null>(null);
    const [activeLink, setActiveLink] = useState<TaskShareLink | null>(null);
    const [fields, setFields] = useState<FieldDefinition[]>([]);
    const [formData, setFormData] = useState<any>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);

    useEffect(() => {
        const loadData = async () => {
            try {
                // 1. Fetch system settings to get field definitions
                const sysSettings = await db.getSystemSettings();
                const allFields = sysSettings.fields;

                // 2. Fetch the task by link ID
                const fetchedTask = await db.getTaskByShareLink(linkId);
                if (!fetchedTask) {
                    setError(t.public_link_not_found);
                    setIsLoading(false);
                    return;
                }

                const link = fetchedTask.shareLinks?.find(l => l.id === linkId);
                if (!link) {
                    setError(t.public_link_not_found);
                    setIsLoading(false);
                    return;
                }

                if (link.status === 'completed') {
                    setError(t.public_request_completed);
                    setIsLoading(false);
                    return;
                }

                if (new Date(link.expiresAt) < new Date()) {
                    setError(t.public_link_expired);
                    setIsLoading(false);
                    return;
                }

                // 3. Setup state
                setTask(fetchedTask);
                setActiveLink(link);
                
                // Filter fields based on what was requested
                const requestedFields = allFields.filter(f => link.fields.includes(f.key));
                setFields(requestedFields);

                // Initialize form data with existing values if any
                const initialData: any = {};
                requestedFields.forEach(f => {
                    const sectionMap: any = { 'identity': 'identity', 'assets': 'assets', 'requirements': 'requirements', 'directives': 'directives', 'custom': 'customData' };
                    const targetSection = sectionMap[f.section] || 'customData';
                    initialData[f.key] = (fetchedTask as any)[targetSection]?.[f.key];
                });
                setFormData(initialData);

            } catch (err) {
                console.error(err);
                setError(t.public_load_error);
            } finally {
                setIsLoading(false);
            }
        };

        loadData();
    }, [linkId]);

    const handleFieldChange = (key: string, value: any) => {
        setFormData(prev => ({ ...prev, [key]: value }));
    };

    const handleSubmit = async () => {
        if (!task || !activeLink) return;
        setIsSubmitting(true);

        try {
            // Update task with new data
            const updatedTask = { ...task };
            
            fields.forEach(f => {
                const sectionMap: any = { 'identity': 'identity', 'assets': 'assets', 'requirements': 'requirements', 'directives': 'directives', 'custom': 'customData' };
                const targetSection = sectionMap[f.section] || 'customData';
                
                if (!updatedTask[targetSection]) {
                    updatedTask[targetSection] = {};
                }
                updatedTask[targetSection][f.key] = formData[f.key];
            });

            // Mark link as completed
            const updatedLinks = (updatedTask.shareLinks || []).map(l => 
                l.id === linkId ? { ...l, status: 'completed' as const, submittedAt: new Date() } : l
            );
            updatedTask.shareLinks = updatedLinks;

            // Add timeline event
            updatedTask.timeline = [
                ...updatedTask.timeline,
                {
                    id: `e-${Date.now()}`,
                    actor: { id: 'external', name: 'External Contributor', role: 'Guest', email: '', avatar: '', status: 'approved', createdAt: new Date() },
                    action: 'External data submitted',
                    timestamp: new Date()
                }
            ];

            await db.updateTask(updatedTask);
            setIsSuccess(true);
        } catch (err) {
            console.error(err);
            alert(t.public_submit_error);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <Loader2 className="animate-spin text-indigo-600" size={48} />
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
                    <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                        <AlertCircle size={32} />
                    </div>
                    <h2 className="text-xl font-bold text-gray-800 mb-2">{t.public_access_denied}</h2>
                    <p className="text-gray-600">{error}</p>
                </div>
            </div>
        );
    }

    if (isSuccess) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
                    <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                        <CheckCircle size={32} />
                    </div>
                    <h2 className="text-xl font-bold text-gray-800 mb-2">{t.public_thank_you}</h2>
                    <p className="text-gray-600">{t.public_success_msg}</p>
                </div>
            </div>
        );
    }

    const getBilingualLabel = (fieldKey: string, fallback: string) => {
        const enLabel = (translations.en as any)[`field_${fieldKey}`];
        const zhLabel = (translations.cn as any)[`field_${fieldKey}`];
        
        if (enLabel && zhLabel && enLabel !== zhLabel) {
            return `${zhLabel} / ${enLabel}`;
        }
        return fallback;
    };

    return (
        <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
                <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
                    <div className="bg-indigo-600 px-6 py-8 text-white">
                        <h1 className="text-2xl font-bold mb-2">{t.public_title}</h1>
                        <p className="text-indigo-100">
                            {t.public_subtitle} <strong>{task?.identity?.productName || 'Task'}</strong>
                        </p>
                    </div>
                    
                    <div className="p-6 sm:p-8 space-y-8">
                        {fields.map(field => (
                            <div key={field.key} className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                                <label className="block text-sm font-bold text-gray-800 mb-2">
                                    {getBilingualLabel(field.key, field.label)}
                                    {field.required && <span className="text-red-500 ml-1">*</span>}
                                </label>
                                {field.description && (
                                    <p className="text-xs text-gray-500 mb-3">{field.description}</p>
                                )}
                                <DynamicField
                                    field={field}
                                    value={formData[field.key]}
                                    onChange={(val) => handleFieldChange(field.key, val)}
                                    readOnly={false}
                                    language={language}
                                />
                            </div>
                        ))}

                        <div className="pt-6 border-t border-gray-200">
                            <button
                                onClick={handleSubmit}
                                disabled={isSubmitting}
                                className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {isSubmitting ? (
                                    <><Loader2 className="animate-spin mr-2" size={20} /> {t.public_submitting}</>
                                ) : (
                                    <><Send className="mr-2" size={20} /> {t.public_submit}</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
