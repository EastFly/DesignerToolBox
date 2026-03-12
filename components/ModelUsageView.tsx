import React, { useState, useEffect } from 'react';
import { db } from '../services/db';
import { Activity, Loader2, Database } from 'lucide-react';
import { format } from 'date-fns';

import { translations, Language } from '../i18n';

interface ModelUsageViewProps {
    language: Language;
}

export const ModelUsageView: React.FC<ModelUsageViewProps> = ({ language }) => {
    const t = translations[language];
    const [usage, setUsage] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadUsage();
    }, []);

    const loadUsage = async () => {
        setLoading(true);
        try {
            const data = await db.getModelUsageStats();
            setUsage(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="animate-spin text-indigo-600" size={32} />
            </div>
        );
    }

    return (
        <div className="p-6 h-full overflow-y-auto bg-gray-50">
            <div className="max-w-6xl mx-auto">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <Activity className="text-indigo-600" />
                        {t.set_usage_logs}
                    </h2>
                    <button onClick={loadUsage} className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
                        <Database size={16} /> {t.set_usage_refresh}
                    </button>
                </div>

                <div className="bg-white rounded-xl shadow border border-gray-200 overflow-hidden">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                                <th className="px-6 py-3 font-semibold text-gray-600">{t.set_usage_time}</th>
                                <th className="px-6 py-3 font-semibold text-gray-600">{t.set_usage_user}</th>
                                <th className="px-6 py-3 font-semibold text-gray-600">{t.set_usage_module}</th>
                                <th className="px-6 py-3 font-semibold text-gray-600">{t.set_usage_model}</th>
                                <th className="px-6 py-3 font-semibold text-gray-600">{t.set_usage_type}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {usage.map((log) => (
                                <tr key={log.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 text-gray-500 whitespace-nowrap">
                                        {format(new Date(log.created_at), 'MMM d, HH:mm:ss')}
                                    </td>
                                    <td className="px-6 py-4 font-medium text-gray-900">
                                        {log.profiles?.full_name || log.profiles?.email || 'Unknown'}
                                    </td>
                                    <td className="px-6 py-4 text-gray-700">
                                        <span className="bg-indigo-50 text-indigo-700 px-2 py-1 rounded-md text-xs font-medium">
                                            {log.module}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-gray-700 font-mono text-xs">
                                        {log.model_name}
                                    </td>
                                    <td className="px-6 py-4 text-gray-500">
                                        {log.parameters?.type || 'N/A'}
                                    </td>
                                </tr>
                            ))}
                            {usage.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                                        {t.set_usage_no_logs}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
