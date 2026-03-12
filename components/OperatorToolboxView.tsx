import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileText, Image as ImageIcon, Sparkles, Download, Loader2, X, ChevronDown, ChevronUp, RefreshCw, Plus, Trash2, Save, AlertCircle } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import { translations } from '../i18n';
import { Product } from '../types';
import { db } from '../services/db';
import { ProductSelector } from './ProductSelector';

interface OperatorToolboxViewProps {
    language: string;
}

interface GenerationCard {
    id: string;
    title: string;
    description: string;
    scene: string;
    style: string;
    layout: string;
    copywriting: string;
    recommendedAngle: string;
    specificProductImage?: { file: File, preview: string };
    selectedImageUrl?: string;
    status: 'idle' | 'generating' | 'success' | 'error';
    resultUrl?: string;
    debugPayload?: any;
    errorMsg?: string;
}

const MODELS = [
    { id: 'gemini-3.1-flash-image-preview', name: 'Gemini 3.1 Flash Image (Nano Banana 2)' },
    { id: 'gemini-3-pro-image-preview', name: 'Gemini 3 Pro Image' }
];

const ASPECT_RATIOS = [
    '1:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9'
];

const RESOLUTIONS = ['1K', '2K', '4K'];

import { getApiKey } from '../services/geminiService';

export const OperatorToolboxView: React.FC<OperatorToolboxViewProps> = ({ language }) => {
    // @ts-ignore
    const t = translations[language] || translations['en'];
    
    // Configuration State
    const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
    const [aspectRatio, setAspectRatio] = useState('3:4'); // Default to 3:4 as per SOP examples
    const [resolution, setResolution] = useState('1K');
    const [sopFile, setSopFile] = useState<File | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    
    // Product State
    const [products, setProducts] = useState<Product[]>([]);
    const [selectedProductId, setSelectedProductId] = useState<string>('');
    const [globalProductImages, setGlobalProductImages] = useState<string[]>([]);
    
    // Cards State
    const [cards, setCards] = useState<GenerationCard[]>([]);
    const [globalAdditionalInstructions, setGlobalAdditionalInstructions] = useState('');
    const [isGeneratingBatch, setIsGeneratingBatch] = useState(false);

    // Refs
    const sopInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        db.getProducts().then(setProducts);
    }, []);

    useEffect(() => {
        if (selectedProductId) {
            const product = products.find(p => p.id === selectedProductId);
            if (product) {
                const images: string[] = [];
                const syncedImg = product.data['productImage'];
                if (Array.isArray(syncedImg)) images.push(...syncedImg);
                else if (typeof syncedImg === 'string' && syncedImg) images.push(syncedImg);
                const gallery = product.data['galleryImages'];
                if (Array.isArray(gallery)) images.push(...gallery);
                
                const uniqueImages = Array.from(new Set(images.filter(url => typeof url === 'string' && url.trim() !== '')));
                setGlobalProductImages(uniqueImages);
            }
        } else {
            setGlobalProductImages([]);
        }
    }, [selectedProductId, products]);

    const handleSopUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setSopFile(e.target.files[0]);
        }
    };

    const fileToBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => {
                const result = reader.result as string;
                const base64 = result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = error => reject(error);
        });
    };

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

    const analyzeSop = async () => {
        if (!sopFile) return;
        const apiKey = await getApiKey();
        if (!apiKey) {
            alert("API Key is missing. Please ensure GEMINI_API_KEY is set in your environment.");
            return;
        }

        setIsAnalyzing(true);
        try {
            const ai = new GoogleGenAI({ apiKey });
            const base64Data = await fileToBase64(sopFile);
            
            const systemPrompt = `You are an expert E-commerce Operation Specialist and Art Director.
            Your task is to analyze the provided SOP document (Standard Operating Procedure for Visual Strategy).
            
            The document typically contains:
            1. Product Parameters & General Description (Intro)
            2. Part 1: Visual DNA (Core Identity, Colors, Style)
            3. Part 2: A list of specific render requests (often numbered, e.g., No.01, No.02...)

            TASK:
            Extract the "Global Visual DNA" and a list of "Render Items".
            
            For each Render Item in Part 2, extract:
            - Title: Look for keywords like "主标题" (Main Title) or "副标题" (Subtitle). If the title is bilingual (e.g., separated by '|' or '/'), extract ONLY the English portion (e.g., from "150 PSI 强劲动力 | 150 PSI Power", extract "150 PSI Power"). If no explicit main/subtitle is found, use a clean and concise core name without numbering.
            - Description: Combine '画面剧情' (Plot), '逻辑与痛点' (Logic/Pain Points), and '构图与运镜' (Composition) into a comprehensive visual description. Translate to English if it's in another language.
            - Scene: The environment/setting context.
            - Style: The lighting, mood, and vibe.
            - Layout: Specific composition instructions (e.g., Split screen, Knolling, Center composition).
            - Copywriting: Extract any specific text, slogans, or labels that need to be rendered or annotated (e.g., from "后期合成与执行建议", "标注", or "Slogan"). Only include the exact English text to be rendered (e.g., "Max 150 PSI", "Portable Size"). Default to English for all text rendering.
            - Recommended Angle: Infer the best camera angle for the product (e.g., Front, Top-down, 45-degree).

            If any field is missing, infer it reasonably from the context of the item. All output values should be in English.

            OUTPUT JSON FORMAT:
            {
                "global_dna": "Summary of Visual DNA, Colors, and Core Style...",
                "items": [
                    {
                        "title": "...",
                        "description": "...",
                        "scene": "...",
                        "style": "...",
                        "layout": "...",
                        "copywriting": "...",
                        "recommended_angle": "..."
                    }
                ]
            }`;

            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: [
                    { role: 'user', parts: [{ text: systemPrompt }] },
                    { role: 'user', parts: [{ inlineData: { data: base64Data, mimeType: sopFile.type } }] }
                ],
                config: { responseMimeType: 'application/json' }
            });

            const cleanJson = (response.text || '{}').replace(/```json|```/g, '').trim();
            const parsed = JSON.parse(cleanJson);

            if (parsed.items && Array.isArray(parsed.items)) {
                const newCards: GenerationCard[] = parsed.items.map((item: any, index: number) => {
                    let rawTitle = item.title || `Item ${index + 1}`;
                    let cleanTitle = rawTitle.replace(/^(No\.\s*\d+\s*|\d+[\.\-]?\s+)/i, '').trim();
                    if (cleanTitle.startsWith('[') && cleanTitle.endsWith(']')) {
                        cleanTitle = cleanTitle.substring(1, cleanTitle.length - 1).trim();
                    }

                    return {
                        id: `card-${Date.now()}-${index}`,
                        title: cleanTitle || `Item ${index + 1}`,
                        description: item.description || '',
                        scene: item.scene || '',
                        style: `${parsed.global_dna || ''} ${item.style || ''}`.trim(),
                        layout: item.layout || '',
                        copywriting: item.copywriting || '',
                        recommendedAngle: item.recommended_angle || '',
                        status: 'idle'
                    };
                });
                setCards(newCards);
            }

        } catch (e) {
            console.error("Analysis failed", e);
            alert("Failed to analyze SOP file. Please ensure it is a valid document.");
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleCardImageUpload = (cardId: string, file: File) => {
        setCards(prev => prev.map(c => c.id === cardId ? {
            ...c,
            specificProductImage: {
                file,
                preview: URL.createObjectURL(file)
            }
        } : c));
    };

    const generateBatch = async () => {
        const apiKey = await getApiKey();
        if (!apiKey) return;

        setIsGeneratingBatch(true);
        const ai = new GoogleGenAI({ apiKey });

        // Helper to process one card
        const processCard = async (card: GenerationCard) => {
            if (card.status === 'success') return; // Skip already done

            setCards(prev => prev.map(c => c.id === card.id ? { ...c, status: 'generating', errorMsg: undefined } : c));

            try {
                // Determine Product Image
                let productBase64 = '';
                let productMimeType = 'image/jpeg';

                const targetImageUrl = card.selectedImageUrl || (globalProductImages.length > 0 ? globalProductImages[0] : null);

                if (card.specificProductImage && card.selectedImageUrl === card.specificProductImage.preview) {
                    productBase64 = await fileToBase64(card.specificProductImage.file);
                    productMimeType = card.specificProductImage.file.type;
                } else if (targetImageUrl) {
                    productBase64 = await urlToBase64(targetImageUrl);
                    if (targetImageUrl.endsWith('.png') || targetImageUrl.includes('image/png')) productMimeType = 'image/png';
                }

                if (!productBase64) {
                    throw new Error("No product image selected or available");
                }

                // Construct Prompt
                const prompt = `
                Role: Expert 3D Product Photographer & AI Artist.
                Task: Generate a high-end e-commerce product render.

                PRODUCT CONTEXT:
                - The input image provided is the PRODUCT REFERENCE. 
                - CRITICAL: You MUST render this exact product with 100% fidelity to its shape, details, logo, and materials.
                - Camera Angle Recommendation: ${card.recommendedAngle}

                SCENE SPECIFICATIONS:
                - Title/Theme: ${card.title}
                - Visual Description: ${card.description}
                - Environment/Scene: ${card.scene}
                - Lighting/Mood/Style: ${card.style}
                - Composition/Layout: ${card.layout}
                
                ${card.copywriting ? `TEXT/COPYWRITING INSTRUCTIONS:
                - The user mentioned: "${card.copywriting}"
                - If this is a slogan or label, try to incorporate it naturally if the layout permits, or ensure the composition leaves space for it.` : ''}

                GLOBAL INSTRUCTIONS:
                ${globalAdditionalInstructions}

                Technical: Photorealistic, 8k resolution, commercial photography, sharp focus.
                CRITICAL: Ensure the output strictly follows the requested aspect ratio and composition.
                `;

                const parts: any[] = [
                    { text: prompt },
                    { 
                        inlineData: { 
                            data: productBase64, 
                            mimeType: productMimeType 
                        } 
                    }
                ];

                const config = {
                    imageConfig: {
                        imageSize: resolution as any,
                        aspectRatio: aspectRatio as any // We might need to map this if it's not standard
                    }
                };

                const response = await ai.models.generateContent({
                    model: selectedModel,
                    contents: { parts },
                    config: config as any
                });

                let resultUrl = '';
                if (response.candidates && response.candidates[0]?.content?.parts) {
                    for (const part of response.candidates[0].content.parts) {
                        if (part.inlineData) {
                            resultUrl = `data:${part.inlineData.mimeType || 'image/jpeg'};base64,${part.inlineData.data}`;
                            break;
                        }
                    }
                }

                if (resultUrl) {
                    setCards(prev => prev.map(c => c.id === card.id ? { 
                        ...c, 
                        status: 'success', 
                        resultUrl,
                        debugPayload: { prompt, config }
                    } : c));
                } else {
                    throw new Error("No image returned");
                }

            } catch (e: any) {
                console.error(`Failed to generate card ${card.id}`, e);
                setCards(prev => prev.map(c => c.id === card.id ? { ...c, status: 'error', errorMsg: e.message } : c));
            }
        };

        // Execute sequentially or parallel? Parallel limit 2 is safer for rate limits.
        // Let's do sequential for safety first.
        for (const card of cards) {
            if (card.status !== 'success') {
                await processCard(card);
            }
        }

        setIsGeneratingBatch(false);
    };

    const downloadAll = () => {
        const successfulCards = cards.filter(c => c.status === 'success' && c.resultUrl);
        successfulCards.forEach((card, index) => {
            const a = document.createElement('a');
            a.href = card.resultUrl!;
            // Clean title for filename
            const cleanTitle = card.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            a.download = `${index + 1}_${cleanTitle}.jpeg`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });
    };

    return (
        <div className="h-full flex flex-col bg-slate-50">
             <div className="flex-1 overflow-hidden flex">
                {/* Left Sidebar - Configuration */}
                <div className="w-96 bg-white border-r border-gray-200 flex flex-col h-full shrink-0 overflow-y-auto custom-scrollbar">
                    <div className="p-6 space-y-8">
                        
                        {/* 1. Product Selection */}
                        <section>
                            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">1. Select Product</h3>
                            <ProductSelector 
                                products={products}
                                selectedProductId={selectedProductId}
                                onSelect={setSelectedProductId}
                                placeholder="Choose a product..."
                            />
                            {selectedProductId && (
                                <div className="mt-3 grid grid-cols-4 gap-2">
                                    {globalProductImages.slice(0, 4).map((img, i) => (
                                        <div key={i} className="aspect-square rounded border border-gray-200 overflow-hidden bg-gray-50">
                                            <img src={img} className="w-full h-full object-contain" />
                                        </div>
                                    ))}
                                    {globalProductImages.length > 4 && (
                                        <div className="aspect-square rounded border border-gray-200 flex items-center justify-center bg-gray-50 text-xs text-gray-400">
                                            +{globalProductImages.length - 4}
                                        </div>
                                    )}
                                </div>
                            )}
                        </section>

                        {/* 2. SOP Upload */}
                        <section>
                            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">2. Upload SOP File</h3>
                            <div 
                                onClick={() => sopInputRef.current?.click()}
                                className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${sopFile ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 hover:border-indigo-400 hover:bg-gray-50'}`}
                            >
                                <FileText size={32} className={sopFile ? "text-indigo-600 mb-2" : "text-gray-400 mb-2"} />
                                {sopFile ? (
                                    <>
                                        <p className="text-sm font-bold text-indigo-700 break-all">{sopFile.name}</p>
                                        <p className="text-xs text-indigo-500 mt-1">{(sopFile.size / 1024).toFixed(1)} KB</p>
                                    </>
                                ) : (
                                    <>
                                        <p className="text-sm font-medium text-gray-600">Click to upload SOP</p>
                                        <p className="text-xs text-gray-400 mt-1">PDF, TXT, MD supported</p>
                                    </>
                                )}
                                <input 
                                    type="file" 
                                    ref={sopInputRef} 
                                    className="hidden" 
                                    accept=".pdf,.txt,.md,.json"
                                    onChange={handleSopUpload}
                                />
                            </div>
                            
                            <button
                                onClick={analyzeSop}
                                disabled={!sopFile || isAnalyzing}
                                className="w-full mt-3 bg-indigo-600 text-white py-2 rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {isAnalyzing ? <Loader2 size={16} className="animate-spin"/> : <Sparkles size={16}/>}
                                {isAnalyzing ? 'Analyzing SOP...' : 'Analyze & Extract Cards'}
                            </button>
                        </section>

                        {/* 3. Global Settings */}
                        <section className="space-y-4">
                            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">3. Global Settings</h3>
                            
                            <div>
                                <label className="text-xs font-medium text-gray-500 mb-1 block">AI Model</label>
                                <select 
                                    value={selectedModel}
                                    onChange={(e) => setSelectedModel(e.target.value)}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                >
                                    {MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-medium text-gray-500 mb-1 block">Aspect Ratio</label>
                                    <select 
                                        value={aspectRatio}
                                        onChange={(e) => setAspectRatio(e.target.value)}
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                    >
                                        {ASPECT_RATIOS.map(r => <option key={r} value={r}>{r}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-gray-500 mb-1 block">Resolution</label>
                                    <select 
                                        value={resolution}
                                        onChange={(e) => setResolution(e.target.value)}
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                    >
                                        {RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                                    </select>
                                </div>
                            </div>
                        </section>

                        {/* 4. Additional Instructions */}
                        <section>
                            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">4. Additional Instructions</h3>
                            <textarea 
                                value={globalAdditionalInstructions}
                                onChange={(e) => setGlobalAdditionalInstructions(e.target.value)}
                                placeholder="E.g., Make all backgrounds dark themed..."
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm h-24 resize-none"
                            />
                        </section>

                        {/* Generate Button */}
                        <div className="pt-4 border-t border-gray-100">
                            <button 
                                onClick={generateBatch}
                                disabled={cards.length === 0 || isGeneratingBatch || !selectedProductId}
                                className="w-full bg-gradient-to-r from-rose-600 to-pink-600 text-white py-3 rounded-xl font-bold shadow-md hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {isGeneratingBatch ? <Loader2 size={18} className="animate-spin"/> : <Sparkles size={18}/>}
                                {isGeneratingBatch ? `Generating (${cards.filter(c => c.status === 'success').length}/${cards.length})...` : 'Generate All Images'}
                            </button>
                            {!selectedProductId && (
                                <p className="text-xs text-red-400 text-center mt-2">Please select a product first</p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Main Content - Cards */}
                <div className="flex-1 bg-slate-50 overflow-y-auto custom-scrollbar p-8">
                    {cards.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-50">
                            <FileText size={64} className="mb-4"/>
                            <p className="text-lg font-medium">Upload and Analyze an SOP to begin</p>
                        </div>
                    ) : (
                        <div className="max-w-5xl mx-auto space-y-6">
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-2xl font-bold text-gray-800">Generation Cards ({cards.length})</h2>
                                {cards.some(c => c.status === 'success') && (
                                    <button 
                                        onClick={downloadAll}
                                        className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 font-medium shadow-sm"
                                    >
                                        <Download size={16}/> Download All
                                    </button>
                                )}
                            </div>

                            {cards.map((card, index) => (
                                <div key={card.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col md:flex-row">
                                    {/* Left: Config & Info */}
                                    <div className="flex-1 p-6 border-b md:border-b-0 md:border-r border-gray-100">
                                        <div className="flex items-start justify-between mb-4">
                                            <div className="flex items-center gap-3">
                                                <span className="bg-gray-100 text-gray-500 text-xs font-bold px-2 py-1 rounded">#{index + 1}</span>
                                                <input 
                                                    value={card.title}
                                                    onChange={(e) => setCards(prev => prev.map(c => c.id === card.id ? {...c, title: e.target.value} : c))}
                                                    className="font-bold text-gray-800 text-lg bg-transparent border-none focus:ring-0 p-0 w-full"
                                                />
                                            </div>
                                            <div className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                                                card.status === 'success' ? 'bg-green-100 text-green-700' :
                                                card.status === 'generating' ? 'bg-blue-100 text-blue-700' :
                                                card.status === 'error' ? 'bg-red-100 text-red-700' :
                                                'bg-gray-100 text-gray-500'
                                            }`}>
                                                {card.status}
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <div>
                                                <label className="text-xs font-bold text-gray-400 uppercase block mb-1">Visual Description</label>
                                                <textarea 
                                                    value={card.description}
                                                    onChange={(e) => setCards(prev => prev.map(c => c.id === card.id ? {...c, description: e.target.value} : c))}
                                                    className="w-full text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2 h-20 resize-none focus:bg-white focus:border-indigo-300 transition-colors"
                                                />
                                            </div>
                                            
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className="text-xs font-bold text-gray-400 uppercase block mb-1">Scene / Environment</label>
                                                    <input 
                                                        value={card.scene}
                                                        onChange={(e) => setCards(prev => prev.map(c => c.id === card.id ? {...c, scene: e.target.value} : c))}
                                                        className="w-full text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-xs font-bold text-gray-400 uppercase block mb-1">Style / Mood</label>
                                                    <input 
                                                        value={card.style}
                                                        onChange={(e) => setCards(prev => prev.map(c => c.id === card.id ? {...c, style: e.target.value} : c))}
                                                        className="w-full text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2"
                                                    />
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className="text-xs font-bold text-gray-400 uppercase block mb-1">Layout</label>
                                                    <input 
                                                        value={card.layout}
                                                        onChange={(e) => setCards(prev => prev.map(c => c.id === card.id ? {...c, layout: e.target.value} : c))}
                                                        className="w-full text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-xs font-bold text-gray-400 uppercase block mb-1">Angle</label>
                                                    <input 
                                                        value={card.recommendedAngle}
                                                        onChange={(e) => setCards(prev => prev.map(c => c.id === card.id ? {...c, recommendedAngle: e.target.value} : c))}
                                                        className="w-full text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right: Image & Result */}
                                    <div className="w-full md:w-80 bg-gray-50 p-6 flex flex-col gap-4 border-l border-gray-100">
                                        
                                        {/* Specific Product Image Upload */}
                                        <div>
                                            <label className="text-xs font-bold text-gray-400 uppercase block mb-2">Product Image for this Card</label>
                                            <div className="flex flex-wrap gap-2">
                                                {globalProductImages.map((img, i) => {
                                                    const isSelected = (!card.specificProductImage && (card.selectedImageUrl === img || (!card.selectedImageUrl && i === 0)));
                                                    return (
                                                        <div 
                                                            key={i}
                                                            onClick={() => setCards(prev => prev.map(c => c.id === card.id ? {...c, selectedImageUrl: img, specificProductImage: undefined} : c))}
                                                            className={`w-16 h-16 rounded-lg border-2 cursor-pointer overflow-hidden ${isSelected ? 'border-indigo-500' : 'border-transparent hover:border-gray-300'}`}
                                                        >
                                                            <img src={img} className="w-full h-full object-cover" />
                                                        </div>
                                                    );
                                                })}
                                                
                                                {/* Uploaded specific image if any */}
                                                {card.specificProductImage && (
                                                    <div 
                                                        onClick={() => setCards(prev => prev.map(c => c.id === card.id ? {...c, selectedImageUrl: card.specificProductImage!.preview} : c))}
                                                        className={`w-16 h-16 rounded-lg border-2 cursor-pointer overflow-hidden ${card.selectedImageUrl === card.specificProductImage.preview ? 'border-indigo-500' : 'border-transparent hover:border-gray-300'}`}
                                                    >
                                                        <img src={card.specificProductImage.preview} className="w-full h-full object-cover" />
                                                    </div>
                                                )}

                                                {/* Upload Button */}
                                                <div className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 relative">
                                                    <Plus size={16} className="text-gray-400 mb-1" />
                                                    <span className="text-[10px] text-gray-500">Upload</span>
                                                    <input 
                                                        type="file" 
                                                        className="absolute inset-0 opacity-0 cursor-pointer"
                                                        accept="image/*"
                                                        onChange={(e) => {
                                                            if (e.target.files && e.target.files[0]) {
                                                                const file = e.target.files[0];
                                                                const preview = URL.createObjectURL(file);
                                                                setCards(prev => prev.map(c => c.id === card.id ? {
                                                                    ...c, 
                                                                    specificProductImage: { file, preview },
                                                                    selectedImageUrl: preview
                                                                } : c));
                                                            }
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Result Area */}
                                        <div 
                                            className="w-full bg-gray-200 rounded-lg border border-gray-300 flex items-center justify-center overflow-hidden relative group"
                                            style={{ aspectRatio: aspectRatio.replace(':', '/') }}
                                        >
                                            {card.status === 'success' && card.resultUrl ? (
                                                <>
                                                    <img src={card.resultUrl} className="w-full h-full object-cover" />
                                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                                        <a href={card.resultUrl} download={`${card.title}.jpeg`} className="p-2 bg-white rounded-full text-gray-800 hover:text-indigo-600">
                                                            <Download size={20} />
                                                        </a>
                                                    </div>
                                                </>
                                            ) : card.status === 'generating' ? (
                                                <div className="flex flex-col items-center text-indigo-600">
                                                    <Loader2 size={32} className="animate-spin mb-2" />
                                                    <span className="text-xs font-bold">Generating...</span>
                                                </div>
                                            ) : card.status === 'error' ? (
                                                <div className="text-center p-4">
                                                    <AlertCircle size={24} className="text-red-500 mx-auto mb-2" />
                                                    <p className="text-xs text-red-600">{card.errorMsg || "Generation failed"}</p>
                                                </div>
                                            ) : (
                                                <span className="text-xs text-gray-400 font-medium">Ready to generate</span>
                                            )}
                                        </div>

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
