
import React, { useEffect, useState } from 'react';
import { MidnightMission } from '../types';
import { db } from '../services/db';
import { Moon, RefreshCw, CheckCircle, Loader2, AlertCircle, Clock, Package, X, Maximize2, Play } from 'lucide-react';
import { format } from 'date-fns';
import { GoogleGenAI } from "@google/genai";

// Helper to convert URL to Base64
const urlToBase64 = async (url: string): Promise<string> => {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const res = reader.result as string;
                const base64 = res.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.error("Failed to convert image", e);
        return "";
    }
};

// Helper to convert Base64 to File
const base64ToFile = (base64Data: string, mimeType: string, filename: string): File => {
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new File([byteArray], filename, { type: mimeType });
};

import { getApiKey } from '../services/geminiService';

export const MidnightMissionsView: React.FC = () => {
    const [missions, setMissions] = useState<MidnightMission[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

    const loadMissions = async () => {
        setIsLoading(true);
        try {
            const data = await db.getMidnightMissions();
            setMissions(data);
        } catch (e) {
            console.error("Failed to load missions", e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadMissions();
        // Optional: Polling for updates every 30 seconds
        const interval = setInterval(loadMissions, 30000);
        return () => clearInterval(interval);
    }, []);

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'completed': return <span className="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-bold flex items-center gap-1"><CheckCircle size={12}/> Completed</span>;
            case 'processing': return <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-bold flex items-center gap-1"><Loader2 size={12} className="animate-spin"/> Processing</span>;
            case 'failed': return <span className="bg-red-100 text-red-700 px-2 py-1 rounded text-xs font-bold flex items-center gap-1"><AlertCircle size={12}/> Failed</span>;
            default: return <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs font-bold flex items-center gap-1"><Clock size={12}/> Pending</span>;
        }
    };

    const handleExecuteMission = async (mission: MidnightMission) => {
        if (mission.status === 'processing') return;

        try {
            const apiKey = await getApiKey();
            if (!apiKey) return;
            const ai = new GoogleGenAI({ apiKey });

            // 1. Mark as processing
            const processingMission = { ...mission, status: 'processing' as const };
            await db.updateMidnightMission(processingMission);
            setMissions(prev => prev.map(m => m.id === mission.id ? processingMission : m));

            const outputs: { slotId: string; url: string; error?: string }[] = [];
            let hasErrors = false;

            // 2. Execute tasks sequentially
            for (const task of mission.payload.tasks) {
                try {
                    const parts: any[] = [{ text: task.prompt }];

                    // Load references
                    for (const ref of task.referenceImages) {
                        const base64 = await urlToBase64(ref.url);
                        if (base64) {
                            if (ref.type === 'product') parts.push({ text: "Product Reference (Subject):" });
                            else if (ref.type === 'layout') parts.push({ text: "Layout Reference (Strict Composition):" });
                            else if (ref.type === 'style') parts.push({ text: "Style Reference (Lighting/Mood):" });
                            
                            parts.push({ inlineData: { mimeType: 'image/jpeg', data: base64 } });
                        }
                    }

                    const response = await ai.models.generateContent({
                        model: task.model,
                        contents: { parts },
                        config: {
                            imageConfig: {
                                aspectRatio: task.config.aspectRatio,
                                imageSize: task.config.imageSize
                            }
                        }
                    });

                    let outputUrl = '';
                    for (const part of response.candidates?.[0]?.content?.parts || []) {
                        if (part.inlineData) {
                            const mimeType = part.inlineData.mimeType || 'image/jpeg';
                            const ext = mimeType.split('/')[1] || 'jpg';
                            const filename = `mission_${mission.id}_${task.slotId}.${ext}`;
                            
                            // Convert base64 to File and upload to Supabase
                            const file = base64ToFile(part.inlineData.data, mimeType, filename);
                            outputUrl = await db.uploadFile(file);
                            break;
                        }
                    }

                    if (outputUrl) {
                        outputs.push({ slotId: task.slotId, url: outputUrl });
                    } else {
                        throw new Error("No image generated");
                    }

                } catch (e: any) {
                    console.error(`Task ${task.slotId} failed:`, e);
                    outputs.push({ slotId: task.slotId, url: '', error: e.message });
                    hasErrors = true;
                }
            }

            // 3. Save results
            const finalMission = {
                ...processingMission,
                status: (hasErrors && outputs.every(o => o.error)) ? 'failed' as const : 'completed' as const,
                result: { outputs },
                updatedAt: new Date()
            };

            await db.updateMidnightMission(finalMission);
            setMissions(prev => prev.map(m => m.id === mission.id ? finalMission : m));

        } catch (e: any) {
            console.error("Mission execution failed", e);
            const failedMission = { ...mission, status: 'failed' as const, updatedAt: new Date() };
            await db.updateMidnightMission(failedMission);
            setMissions(prev => prev.map(m => m.id === mission.id ? failedMission : m));
            alert("Mission execution failed: " + e.message);
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-8 py-6 shrink-0 flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
                        <div className="p-2 bg-indigo-900 text-white rounded-lg shadow-lg shadow-indigo-200">
                            <Moon size={24} fill="currentColor" />
                        </div>
                        Midnight Missions
                    </h2>
                    <p className="text-gray-500 text-sm mt-1 ml-14">Background generation queue managed by Agents.</p>
                </div>
                <button onClick={loadMissions} className="p-2 text-gray-500 hover:text-indigo-600 bg-white border border-gray-200 rounded-full hover:bg-gray-50 transition-colors shadow-sm">
                    <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                <div className="max-w-5xl mx-auto space-y-6">
                    {missions.length === 0 && (
                        <div className="text-center py-20 text-gray-400 italic">
                            No missions found. Queue one from Dice Storm!
                        </div>
                    )}

                    {missions.map(mission => (
                        <div key={mission.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                            <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                                <div className="flex items-center gap-4">
                                    <div className="flex flex-col">
                                        <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2">
                                            <Package size={14} className="text-indigo-500"/>
                                            {mission.productName}
                                        </h3>
                                        <span className="text-[10px] text-gray-400 font-mono">{mission.id}</span>
                                    </div>
                                    <div className="h-8 w-px bg-gray-200 mx-2"></div>
                                    <div className="flex flex-col text-xs text-gray-500">
                                        <span>Tasks: {mission.payload.tasks.length}</span>
                                        <span>Created: {format(mission.createdAt, 'MMM dd, HH:mm')}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    {mission.status === 'pending' && (
                                        <button 
                                            onClick={() => handleExecuteMission(mission)}
                                            className="flex items-center gap-1 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors border border-indigo-200"
                                        >
                                            <Play size={12} fill="currentColor"/> Execute Now
                                        </button>
                                    )}
                                    {getStatusBadge(mission.status)}
                                </div>
                            </div>

                            {/* Task Grid */}
                            <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 bg-white">
                                {mission.payload.tasks.map((task, idx) => {
                                    // Try to find result
                                    const result = mission.result?.outputs?.find(o => o.slotId === task.slotId);
                                    
                                    return (
                                        <div key={idx} className="border border-gray-100 rounded-lg p-3 flex gap-3 relative group">
                                            {/* Status / Image */}
                                            <div className="w-20 h-20 bg-gray-100 rounded-lg shrink-0 overflow-hidden flex items-center justify-center border border-gray-200">
                                                {result?.url ? (
                                                    <div className="relative w-full h-full cursor-zoom-in" onClick={() => setLightboxUrl(result.url)}>
                                                        <img src={result.url || undefined} className="w-full h-full object-cover"/>
                                                        <div className="absolute inset-0 bg-black/20 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                                                            <Maximize2 size={16} className="text-white"/>
                                                        </div>
                                                    </div>
                                                ) : result?.error ? (
                                                    <X size={20} className="text-red-400"/>
                                                ) : (
                                                    <Loader2 size={20} className="text-gray-300 animate-spin"/>
                                                )}
                                            </div>
                                            
                                            <div className="flex-1 min-w-0">
                                                <div className="text-xs font-bold text-gray-700 truncate mb-1">{task.diceName}</div>
                                                
                                                {task.structuredCall ? (
                                                    <div className="text-[10px] text-gray-500 mb-2 space-y-1">
                                                        <div className="truncate" title={task.structuredCall.basePrompt}>
                                                            <span className="font-semibold text-gray-400">Base:</span> {task.structuredCall.basePrompt}
                                                        </div>
                                                        {task.structuredCall.localPrompt && (
                                                            <div className="truncate" title={task.structuredCall.localPrompt}>
                                                                <span className="font-semibold text-gray-400">Local:</span> {task.structuredCall.localPrompt}
                                                            </div>
                                                        )}
                                                        {task.structuredCall.globalPrompt && (
                                                            <div className="truncate" title={task.structuredCall.globalPrompt}>
                                                                <span className="font-semibold text-gray-400">Global:</span> {task.structuredCall.globalPrompt}
                                                            </div>
                                                        )}
                                                        {task.structuredCall.featuresText && (
                                                            <div className="truncate" title={task.structuredCall.featuresText}>
                                                                <span className="font-semibold text-gray-400">Features:</span> {task.structuredCall.featuresText.substring(0, 50)}...
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div className="text-[10px] text-gray-400 line-clamp-2 leading-tight mb-2" title={task.prompt}>{task.prompt}</div>
                                                )}
                                                
                                                {result?.error && (
                                                    <div className="text-[9px] text-red-500 bg-red-50 p-1 rounded border border-red-100 truncate">
                                                        {result.error}
                                                    </div>
                                                )}
                                                
                                                {/* Reference Count Badge */}
                                                <div className="flex gap-1 mt-1">
                                                    {task.referenceImages.map((ref, rIdx) => (
                                                        <span key={rIdx} className="text-[9px] px-1.5 py-0.5 bg-gray-100 rounded text-gray-500 border border-gray-200 capitalize">
                                                            {ref.type}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* LIGHTBOX */}
            {lightboxUrl && (
                <div className="fixed inset-0 z-[120] bg-black/95 flex items-center justify-center p-8 animate-fade-in-up" onClick={() => setLightboxUrl(null)}>
                    <button className="absolute top-6 right-6 text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors">
                        <X size={32} />
                    </button>
                    <img src={lightboxUrl || undefined} className="max-w-full max-h-full object-contain rounded shadow-2xl" onClick={(e) => e.stopPropagation()}/>
                </div>
            )}
        </div>
    );
};
