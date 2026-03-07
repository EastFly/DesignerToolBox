
import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, Sparkles, Loader2, Image as ImageIcon, FileText, CheckCircle, ArrowRight, X, Table, Target, UploadCloud, Plus, Trash2, Paperclip, FileJson, Link as LinkIcon, Eye } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { Product, ProductSpec, CompetitorAnalysis } from '../types';
import { db } from '../services/db';

interface ProductCopilotProps {
    productName: string;
    productData?: Partial<Product>; // Added for Context
    onApplySpecs: (specs: ProductSpec[]) => void;
    onApplyCompetitor: (comp: CompetitorAnalysis) => void;
    onApplyImages: (urls: string[]) => void;
    onApplySmartImport?: (data: any) => void; // New
    onClose: () => void;
}

interface Message {
    id: string;
    role: 'user' | 'ai';
    content: string;
    type: 'text' | 'specs_proposal' | 'competitor_proposal' | 'image_proposal' | 'smart_import_proposal';
    data?: any;
}

import { getApiKey } from '../services/geminiService';

export const ProductCopilot: React.FC<ProductCopilotProps> = ({ 
    productName, productData, onApplySpecs, onApplyCompetitor, onApplyImages, onApplySmartImport, onClose 
}) => {
    const [messages, setMessages] = useState<Message[]>([
        { id: '1', role: 'ai', content: `Hello! I'm your Product Assistant for "${productName}".\n\nUpload a PDF/Image to **Import Data**, paste a URL for **Competitor Analysis**, or ask me to help with Specs.`, type: 'text' }
    ]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    
    // Attachment State
    const [pendingFile, setPendingFile] = useState<{ file: File, preview: string, type: 'image' | 'pdf' } | null>(null);
    const [uploading, setUploading] = useState(false); // Used only during final send processing
    
    const chatEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Auto-scroll
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isThinking]);

    const updateMessageData = (id: string, newData: any) => {
        setMessages(prev => prev.map(m => m.id === id ? { ...m, data: newData } : m));
    };

    // Helper to convert file to Base64
    const fileToBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                const base64 = result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];
            const isImage = file.type.startsWith('image/');
            const preview = isImage ? URL.createObjectURL(file) : '';
            setPendingFile({ file, preview, type: isImage ? 'image' : 'pdf' });
            // Reset input so same file can be selected again if needed
            e.target.value = ''; 
        }
    };

    const handleRemoveAttachment = () => {
        if (pendingFile?.preview) URL.revokeObjectURL(pendingFile.preview);
        setPendingFile(null);
    };

    const handleSend = async () => {
        if (!input.trim() && !pendingFile) return;
        
        let userContent = input;
        const attachments: { mimeType: string, data: string }[] = [];

        // Optimistic UI Update
        const userMsg: Message = { 
            id: Date.now().toString(), 
            role: 'user', 
            content: pendingFile ? `[Attached: ${pendingFile.file.name}]\n${userContent}` : userContent, 
            type: 'text' 
        };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsThinking(true);

        try {
            if (pendingFile) {
                setUploading(true); // Small indicator if needed, though thinking covers it
                const b64 = await fileToBase64(pendingFile.file);
                attachments.push({ mimeType: pendingFile.file.type, data: b64 });
                handleRemoveAttachment(); // Clear pending
                setUploading(false);
            }

            const apiKey = await getApiKey();
            const ai = new GoogleGenAI({ apiKey });

            // Extract Core Assets from Data for Context
            const data = productData?.data || {};
            // Filter out non-text fields from context to avoid confusion
            const cleanData: Record<string, any> = {};
            Object.keys(data).forEach(key => {
                const val = data[key];
                // Simple heuristic: if string or number or array of strings, keep it. If URL-like image path, skip.
                if (typeof val === 'string' && (val.match(/\.(jpg|jpeg|png|gif|webp)$/i) || val.startsWith('data:image'))) return;
                if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'string' && val[0].match(/\.(jpg|jpeg|png|gif|webp)$/i)) return;
                cleanData[key] = val;
            });

            const manuals = (data.manualFiles || []).join(', ');
            const sops = (data.sopFiles || []).join(', ');
            // Removed gallery images from text context prompt to reduce noise, they are visual inputs anyway if passed via multimodal
            const nasPath = data.internalAssetUrl || 'Not set';

            const systemPrompt = `You are an expert E-commerce Product Manager Assistant. 
            
            Current Product Context: 
            Name: ${productName}
            SKU: ${productData?.sku || 'N/A'}
            Data (Text Attributes Only): ${JSON.stringify(cleanData)}

            Available Assets:
            - User Manuals: [${manuals}]
            - Design SOPs: [${sops}]
            - Internal NAS Path: ${nasPath}
            
            Your capabilities:
            1. **SMART IMPORT / ANALYSIS**: If the user uploads a PDF or Image (document/manual) and asks to "analyze", "import", or "extract data", extract SKU, Name, Specs, Selling Points, and Ref Links. 
               - CRITICAL: Translate all specification labels to ENGLISH. Normalize keys (e.g. use "Battery Capacity" not "Batt"). Merge duplicates.
               - IMPORTANT: Only extract TEXT-based information. Do not try to extract image URLs or file paths unless they are explicit text links.
               - Return JSON type 'smart_import'.
            2. **SPECIFICATION EXTRACTION**: If the user provides text or asks specifically about specs, extract key parameters. 
               - Normalize to English keys.
               - Return JSON type 'specs'.
            3. **COMPETITOR ANALYSIS**: If the user provides a URL (link) or a competitor description, analyze deeply.
               - Include: Name, Summary, Pros, Cons, Price Range, Target Audience, Key Differentiators.
               - Note: You cannot browse the live web. If URL provided, try to extract from URL or ask user to paste content.
               - Return JSON type 'competitor'.
            4. **IMAGE RENDERING**: If the user uploads a raw product photo and asks for a "render" or "white background", act as a 3D artist.
            
            Output Format:
            - Always be conversational first.
            - If you extracted SPECS, append: \`\`\`json { "type": "specs", "data": [{"label": "...", "value": "..."}] } \`\`\`
            - If you analyzed COMPETITORS, append: \`\`\`json { "type": "competitor", "data": { "name": "...", "pros": ["..."], "cons": ["..."], "summary": "...", "price_range": "...", "target_audience": "...", "key_differentiators": ["..."] } } \`\`\`
            - If you performed SMART IMPORT, append: \`\`\`json { "type": "smart_import", "data": { "sku": "...", "name": "...", "specs": [{"label": "...", "value": "..."}], "sellingPoints": ["..."], "refLinks": ["..."], "competitors": [...] } } \`\`\`
            `;

            // 1. Construct History (Last 10 messages)
            const historyContents = messages.slice(-10).map(m => ({
                role: m.role === 'user' ? 'user' : 'model',
                parts: [{ text: m.content }]
            }));
            
            // 2. Construct Current Turn
            const currentParts: any[] = [{ text: userContent || (attachments.length > 0 ? "Analyze this attachment." : "") }];
            attachments.forEach(att => currentParts.push({ inlineData: att }));
            
            const contents = [
                ...historyContents,
                { role: 'user', parts: currentParts }
            ];

            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: contents,
                config: {
                    systemInstruction: systemPrompt
                }
            });

            const reply = response.text || '';
            const jsonMatch = reply.match(/```json\n([\s\S]*?)\n```/);
            
            let structuredData = null;
            let type: Message['type'] = 'text';

            if (jsonMatch) {
                try {
                    const parsed = JSON.parse(jsonMatch[1]);
                    if (parsed.type === 'specs') {
                        type = 'specs_proposal';
                        structuredData = parsed.data;
                    } else if (parsed.type === 'competitor') {
                        type = 'competitor_proposal';
                        structuredData = parsed.data;
                    } else if (parsed.type === 'smart_import') {
                        type = 'smart_import_proposal';
                        structuredData = parsed.data;
                    }
                } catch (e) { console.error("JSON parse error", e); }
            }

            setMessages(prev => [...prev, {
                id: (Date.now()+1).toString(),
                role: 'ai',
                content: reply.replace(/```json[\s\S]*?```/, '').trim(),
                type,
                data: structuredData
            }]);

        } catch (e) {
            console.error(e);
            setMessages(prev => [...prev, { id: Date.now().toString(), role: 'ai', content: "Sorry, something went wrong.", type: 'text' }]);
        } finally {
            setIsThinking(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 border-l border-slate-200 w-[450px] shadow-xl absolute right-0 top-0 bottom-0 z-50 animate-fade-in-up">
            <div className="p-4 bg-white border-b border-gray-200 flex justify-between items-center shadow-sm">
                <div className="flex items-center gap-2">
                    <div className="bg-indigo-600 p-1.5 rounded-lg text-white"><Bot size={18}/></div>
                    <div>
                        <h3 className="font-bold text-gray-800 text-sm">Product Copilot</h3>
                        <p className="text-[10px] text-indigo-500 font-medium">Context: {productName}</p>
                    </div>
                </div>
                <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {messages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[95%] ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-white border border-gray-200 rounded-bl-none'} rounded-2xl p-3 shadow-sm text-sm`}>
                            {msg.content && <p className="whitespace-pre-wrap mb-2">{msg.content}</p>}
                            
                            {/* SMART IMPORT PROPOSAL */}
                            {msg.type === 'smart_import_proposal' && msg.data && (
                                <div className="mt-2 bg-slate-50 rounded border border-slate-200 p-3 text-xs">
                                    <div className="font-bold text-indigo-700 mb-2 flex items-center gap-2 border-b border-slate-200 pb-2">
                                        <FileJson size={14}/> Smart Import Data
                                    </div>
                                    <div className="space-y-2 mb-3">
                                        <div><span className="text-gray-400">Name:</span> <span className="font-bold text-gray-800">{msg.data.name}</span></div>
                                        <div><span className="text-gray-400">SKU:</span> <span className="font-mono text-gray-700">{msg.data.sku}</span></div>
                                        <div><span className="text-gray-400">Specs:</span> <span className="text-gray-600">{msg.data.specs?.length || 0} items</span></div>
                                        <div><span className="text-gray-400">Sell Points:</span> <span className="text-gray-600">{msg.data.sellingPoints?.length || 0} items</span></div>
                                    </div>
                                    {onApplySmartImport && (
                                        <button onClick={() => onApplySmartImport(msg.data)} className="w-full py-2 bg-indigo-600 text-white rounded font-bold hover:bg-indigo-700 flex items-center justify-center gap-1 transition-colors">
                                            <Eye size={12}/> Review & Apply
                                        </button>
                                    )}
                                </div>
                            )}

                            {/* SPECS PROPOSAL */}
                            {msg.type === 'specs_proposal' && msg.data && (
                                <div className="mt-2 bg-slate-50 rounded border border-slate-200 p-2 text-xs">
                                    <div className="font-bold text-slate-500 mb-2 flex items-center justify-between">
                                        <span className="flex items-center gap-1"><Table size={12}/> Extracted Specs</span>
                                        <button onClick={() => updateMessageData(msg.id, [...msg.data, { label: "", value: "" }])} className="text-indigo-600 hover:text-indigo-700 bg-indigo-50 p-1 rounded"><Plus size={10}/></button>
                                    </div>
                                    <div className="space-y-1 mb-3 max-h-48 overflow-y-auto custom-scrollbar">
                                        {msg.data.map((s: any, i: number) => (
                                            <div key={i} className="flex gap-2 items-center mb-1">
                                                <input className="w-1/3 p-1 border border-slate-200 rounded text-xs bg-white" value={s.label} onChange={(e) => { const n = [...msg.data]; n[i].label = e.target.value; updateMessageData(msg.id, n); }} placeholder="Label"/>
                                                <input className="flex-1 p-1 border border-slate-200 rounded text-xs bg-white" value={s.value} onChange={(e) => { const n = [...msg.data]; n[i].value = e.target.value; updateMessageData(msg.id, n); }} placeholder="Value"/>
                                                <button onClick={() => updateMessageData(msg.id, msg.data.filter((_:any, idx:number) => idx !== i))} className="text-gray-300 hover:text-red-500"><X size={10}/></button>
                                            </div>
                                        ))}
                                    </div>
                                    <button onClick={() => onApplySpecs(msg.data.filter((s:any) => s.label && s.value))} className="w-full py-1.5 bg-indigo-600 text-white rounded font-bold hover:bg-indigo-700 flex items-center justify-center gap-1 transition-colors">
                                        <CheckCircle size={12}/> Apply Specs
                                    </button>
                                </div>
                            )}

                            {/* COMPETITOR PROPOSAL */}
                            {msg.type === 'competitor_proposal' && msg.data && (
                                <div className="mt-2 bg-slate-50 rounded border border-slate-200 p-2 text-xs space-y-2">
                                    <div className="font-bold text-slate-500 flex items-center gap-1"><Target size={12}/> Competitor Analysis</div>
                                    <div><label className="text-[10px] text-gray-400 uppercase font-bold">Name</label><input className="w-full p-1 border border-slate-200 rounded text-xs bg-white mb-1" value={msg.data.name} onChange={(e) => updateMessageData(msg.id, { ...msg.data, name: e.target.value })}/></div>
                                    <div><label className="text-[10px] text-gray-400 uppercase font-bold">Summary</label><textarea className="w-full p-1 border border-slate-200 rounded text-xs bg-white mb-1" rows={2} value={msg.data.summary} onChange={(e) => updateMessageData(msg.id, { ...msg.data, summary: e.target.value })}/></div>
                                    
                                    {/* Expanded Details */}
                                    <div className="grid grid-cols-2 gap-2">
                                        <div><label className="text-[10px] text-gray-400 uppercase font-bold">Target Audience</label><input className="w-full p-1 border border-slate-200 rounded text-xs bg-white" value={msg.data.target_audience || ''} onChange={(e) => updateMessageData(msg.id, { ...msg.data, target_audience: e.target.value })}/></div>
                                        <div><label className="text-[10px] text-gray-400 uppercase font-bold">Price Range</label><input className="w-full p-1 border border-slate-200 rounded text-xs bg-white" value={msg.data.price_range || ''} onChange={(e) => updateMessageData(msg.id, { ...msg.data, price_range: e.target.value })}/></div>
                                    </div>

                                    <button onClick={() => onApplyCompetitor(msg.data)} className="w-full py-1.5 bg-indigo-600 text-white rounded font-bold hover:bg-indigo-700 flex items-center justify-center gap-1 transition-colors mt-2"><CheckCircle size={12}/> Add Competitor</button>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                {isThinking && (
                    <div className="flex justify-start">
                        <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-none px-4 py-3 flex items-center gap-2 shadow-sm">
                            <Loader2 size={16} className="animate-spin text-indigo-600"/>
                            <span className="text-xs text-gray-500">{uploading ? 'Processing file...' : 'Thinking...'}</span>
                        </div>
                    </div>
                )}
                <div ref={chatEndRef}/>
            </div>

            {/* ATTACHMENT PREVIEW */}
            {pendingFile && (
                <div className="px-4 py-2 bg-gray-50 border-t border-gray-200 flex items-center gap-3">
                    <div className="relative group w-12 h-12 bg-white rounded border border-gray-300 flex items-center justify-center overflow-hidden">
                        {pendingFile.type === 'image' ? (
                            <img src={pendingFile.preview || undefined} className="w-full h-full object-cover" />
                        ) : (
                            <FileText size={20} className="text-gray-400"/>
                        )}
                        <button 
                            onClick={handleRemoveAttachment} 
                            className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <X size={16} className="text-white"/>
                        </button>
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-gray-700 truncate">{pendingFile.file.name}</div>
                        <div className="text-[10px] text-gray-400">Attached - ready to send</div>
                    </div>
                </div>
            )}

            <div className="p-3 bg-white border-t border-gray-200">
                <div className="relative flex gap-2 items-center">
                    <label className="cursor-pointer text-gray-400 hover:text-indigo-600 p-2 rounded-full hover:bg-gray-100 transition-colors" title="Upload Document/Image">
                        <Paperclip size={20}/>
                        <input 
                            ref={fileInputRef}
                            type="file" 
                            className="hidden" 
                            accept="image/*,application/pdf"
                            onChange={handleFileSelect}
                        />
                    </label>
                    <input 
                        className="flex-1 border border-gray-300 rounded-xl pl-4 pr-10 py-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm"
                        placeholder="Ask me to extract data, analyze competitors..."
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSend()}
                        disabled={isThinking}
                    />
                    <button 
                        onClick={() => handleSend()}
                        disabled={(!input.trim() && !pendingFile) || isThinking}
                        className="absolute right-2 top-2 p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                        <Send size={16}/>
                    </button>
                </div>
            </div>
        </div>
    );
};
