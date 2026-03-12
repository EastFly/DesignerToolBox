import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileText, Image as ImageIcon, Sparkles, Download, Loader2, X, ChevronDown, ChevronUp, RefreshCw, Plus, Trash2, Save, AlertCircle, Edit2, Send, History, CheckCircle, Briefcase } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import { translations } from '../i18n';
import { Product } from '../types';
import { db } from '../services/db';
import { ProductSelector } from './ProductSelector';
import JSZip from 'jszip';
import { OperatorHistoryItem, saveHistoryItem, getHistoryItems, deleteHistoryItem, clearHistory } from '../services/operatorHistory';

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
    // Image Selection Logic
    selectedImageSource: 'default' | 'gallery' | 'upload';
    galleryImageUrl?: string;
    uploadedImage?: { file: File, preview: string };
    
    status: 'idle' | 'generating' | 'success' | 'error';
    resultUrl?: string;
    debugPayload?: any;
    errorMsg?: string;

    // Editing Mode
    isEditing?: boolean;
    editPrompt?: string;
    editImages?: { id: string, file: File, preview: string }[];
}

const MODELS = [
    { id: 'gemini-3.1-flash-image-preview', name: 'Gemini 3.1 Flash Image (Nano Banana 2)' },
    { id: 'gemini-3-pro-image-preview', name: 'Gemini 3 Pro Image' }
];

const ASPECT_RATIOS = [
    '1:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9'
];

const RESOLUTIONS = ['1K', '2K', '4K'];

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
    
    // Chinese Prompt Editing State
    const [editingChinesePromptCardId, setEditingChinesePromptCardId] = useState<string | null>(null);
    const [chinesePromptText, setChinesePromptText] = useState<string>('');
    const [isTranslating, setIsTranslating] = useState<boolean>(false);
    const [globalAdditionalInstructions, setGlobalAdditionalInstructions] = useState('');
    const [isGeneratingBatch, setIsGeneratingBatch] = useState(false);

    // History State
    const [showHistory, setShowHistory] = useState(false);
    const [historyItems, setHistoryItems] = useState<OperatorHistoryItem[]>([]);

    useEffect(() => {
        if (showHistory) {
            getHistoryItems().then(setHistoryItems).catch(console.error);
        }
    }, [showHistory]);

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

    const getApiKey = async () => {
        let apiKey = '';
        try {
            apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
        } catch (e) {
            try {
                apiKey = process.env.API_KEY || '';
            } catch (e2) {
                apiKey = '';
            }
        }
        // For image models, we MUST ensure the user has selected a paid key via the platform flow
        // @ts-ignore
        if (!apiKey && typeof window !== 'undefined' && window.aistudio) {
            // @ts-ignore
            if (await window.aistudio.hasSelectedApiKey()) {
                apiKey = process.env.API_KEY || '';
            } else {
                try {
                    // @ts-ignore
                    await window.aistudio.openSelectKey();
                    apiKey = process.env.API_KEY || '';
                } catch (e) {
                    return null;
                }
            }
        }
        return apiKey;
    };

    const analyzeSop = async () => {
        if (!sopFile) return;
        const apiKey = await getApiKey();
        if (!apiKey) {
            alert("API Key required");
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
            - Title: EXTRACT THE ENGLISH TITLE ONLY. If the title is in Chinese, TRANSLATE it to English. Remove numbering (e.g., "No.01", "01") and brackets. Example: "No.01 [Visual Hammer]" -> "Visual Hammer".
            - Description: Combine '画面剧情' (Plot), '逻辑与痛点' (Logic/Pain Points), and '构图与运镜' (Composition) into a comprehensive visual description.
            - Scene: The environment/setting context.
            - Style: The lighting, mood, and vibe.
            - Layout: Specific composition instructions (e.g., Split screen, Knolling, Center composition).
            - Copywriting: Systematically extract any text that needs to be rendered on the image. This includes "主标题" (Main Title / H1), "副标题" (Subtitle / H2), "Slogan", and any text mentioned in "后期合成与执行建议" (Post-production/Execution suggestions). Format this clearly, e.g., "Main Title: [text] | Subtitle: [text] | Badges/Labels: [text]". If there are English translations provided (e.g. "侧气囊安全弹出 | 100% Airbag Compatible"), prefer extracting the English text for rendering.
            - Recommended Angle: Infer the best camera angle for the product (e.g., Front, Top-down, 45-degree).

            If any field is missing, infer it reasonably from the context of the item.

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

            db.logModelUsage('OperatorToolbox', 'gemini-3-flash-preview', { type: 'sop_extraction', config: { responseMimeType: 'application/json' } }).catch(console.error);

            const cleanJson = (response.text || '{}').replace(/```json|```/g, '').trim();
            const parsed = JSON.parse(cleanJson);

            if (parsed.items && Array.isArray(parsed.items)) {
                const newCards: GenerationCard[] = parsed.items.map((item: any, index: number) => ({
                    id: `card-${Date.now()}-${index}`,
                    title: item.title || `Item ${index + 1}`,
                    description: item.description || '',
                    scene: item.scene || '',
                    style: `${parsed.global_dna || ''} ${item.style || ''}`.trim(),
                    layout: item.layout || '',
                    copywriting: item.copywriting || '',
                    recommendedAngle: item.recommended_angle || '',
                    selectedImageSource: 'default',
                    status: 'idle'
                }));
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
            selectedImageSource: 'upload',
            uploadedImage: {
                file,
                preview: URL.createObjectURL(file)
            }
        } : c));
    };

    const handleCardGallerySelect = (cardId: string, url: string) => {
        setCards(prev => prev.map(c => c.id === cardId ? {
            ...c,
            selectedImageSource: 'gallery',
            galleryImageUrl: url
        } : c));
    };

    const toggleEditMode = (cardId: string) => {
        setCards(prev => prev.map(c => c.id === cardId ? { ...c, isEditing: !c.isEditing } : c));
    };

    const handleOpenChineseEdit = async (card: GenerationCard) => {
        setEditingChinesePromptCardId(card.id);
        setIsTranslating(true);
        setChinesePromptText(''); // Clear previous
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            const prompt = `Translate the following product photography prompt details into Chinese. Keep the format exactly the same, just translate the values.
            
Title: ${card.title}
Description: ${card.description}
Scene: ${card.scene}
Style: ${card.style}
Layout: ${card.layout}
Angle: ${card.recommendedAngle}`;

            const response = await ai.models.generateContent({
                model: 'gemini-3.1-flash-lite-preview',
                contents: prompt,
            });
            
            setChinesePromptText(response.text || '');
        } catch (e) {
            console.error("Translation failed", e);
            alert("Translation failed");
        } finally {
            setIsTranslating(false);
        }
    };

    const handleSaveChineseEdit = async () => {
        if (!editingChinesePromptCardId) return;
        setIsTranslating(true);
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            const prompt = `Translate the following Chinese product photography prompt details back into English. 
You MUST output ONLY a valid JSON object with the exact keys: title, description, scene, style, layout, recommendedAngle. 
Do not include any markdown formatting like \`\`\`json.

${chinesePromptText}`;

            const response = await ai.models.generateContent({
                model: 'gemini-3.1-flash-lite-preview',
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            title: { type: Type.STRING },
                            description: { type: Type.STRING },
                            scene: { type: Type.STRING },
                            style: { type: Type.STRING },
                            layout: { type: Type.STRING },
                            recommendedAngle: { type: Type.STRING }
                        },
                        required: ["title", "description", "scene", "style", "layout", "recommendedAngle"]
                    }
                }
            });
            
            const jsonText = response.text?.trim() || '{}';
            const parsed = JSON.parse(jsonText);
            
            setCards(prev => prev.map(c => c.id === editingChinesePromptCardId ? {
                ...c,
                title: parsed.title || c.title,
                description: parsed.description || c.description,
                scene: parsed.scene || c.scene,
                style: parsed.style || c.style,
                layout: parsed.layout || c.layout,
                recommendedAngle: parsed.recommendedAngle || c.recommendedAngle
            } : c));
            
            setEditingChinesePromptCardId(null);
        } catch (e) {
            console.error("Translation back failed", e);
            alert("Failed to translate back to English");
        } finally {
            setIsTranslating(false);
        }
    };

    const updateEditPrompt = (cardId: string, prompt: string) => {
        setCards(prev => prev.map(c => c.id === cardId ? { ...c, editPrompt: prompt } : c));
    };

    const addEditImage = (cardId: string, file: File) => {
        setCards(prev => prev.map(c => {
            if (c.id === cardId) {
                const currentImages = c.editImages || [];
                if (currentImages.length >= 2) return c; // Max 2
                return {
                    ...c,
                    editImages: [...currentImages, { id: Date.now().toString(), file, preview: URL.createObjectURL(file) }]
                };
            }
            return c;
        }));
    };

    const removeEditImage = (cardId: string, imageId: string) => {
        setCards(prev => prev.map(c => {
            if (c.id === cardId && c.editImages) {
                return {
                    ...c,
                    editImages: c.editImages.filter(img => img.id !== imageId)
                };
            }
            return c;
        }));
    };

    const saveToHistory = async (card: GenerationCard, resultUrl: string, productBase64: string, productMimeType: string) => {
        try {
            const historyItem: OperatorHistoryItem = {
                id: Date.now().toString() + Math.random().toString(36).substring(7),
                timestamp: Date.now(),
                title: card.title,
                description: card.description,
                scene: card.scene,
                style: card.style,
                layout: card.layout,
                copywriting: card.copywriting,
                recommendedAngle: card.recommendedAngle,
                productImage: `data:${productMimeType};base64,${productBase64}`,
                resultImage: resultUrl
            };
            await saveHistoryItem(historyItem);
        } catch (e) {
            console.error("Failed to save history", e);
        }
    };

    const regenerateCard = async (cardId: string) => {
        const card = cards.find(c => c.id === cardId);
        if (!card) return;

        const apiKey = await getApiKey();
        if (!apiKey) return;

        setCards(prev => prev.map(c => c.id === card.id ? { ...c, status: 'generating', errorMsg: undefined } : c));

        try {
            const ai = new GoogleGenAI({ apiKey });
            
            // Determine Product Image
            let productBase64 = '';
            let productMimeType = 'image/jpeg';

            if (card.selectedImageSource === 'upload' && card.uploadedImage) {
                productBase64 = await fileToBase64(card.uploadedImage.file);
                productMimeType = card.uploadedImage.file.type;
            } else if (card.selectedImageSource === 'gallery' && card.galleryImageUrl) {
                productBase64 = await urlToBase64(card.galleryImageUrl);
                if (card.galleryImageUrl.endsWith('.png')) productMimeType = 'image/png';
            } else if (globalProductImages.length > 0) {
                productBase64 = await urlToBase64(globalProductImages[0]);
                if (globalProductImages[0].endsWith('.png')) productMimeType = 'image/png';
            }

            if (!productBase64) {
                throw new Error("No product image available (Global or Specific)");
            }

            const isEditMode = card.isEditing && (card.editPrompt || (card.editImages && card.editImages.length > 0));

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

            STRICT CONSTRAINTS:
            - Aspect Ratio: ${aspectRatio} (Ensure the composition fits this ratio perfectly)
            - Resolution: ${resolution}

            ${isEditMode ? `USER EDIT REQUEST:
            The user has requested the following changes or specific references for this regeneration:
            "${card.editPrompt || 'Please incorporate the provided reference images.'}"
            Please incorporate these changes while maintaining the product fidelity.` : ''}

            Technical: Photorealistic, 8k resolution, commercial photography, sharp focus.
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

            // Add edit images
            if (isEditMode && card.editImages) {
                let imgIndex = 1;
                for (const img of card.editImages) {
                    const base64 = await fileToBase64(img.file);
                    parts.push({ text: `\n--- Reference [Image ${imgIndex}] ---` });
                    parts.push({
                        inlineData: {
                            data: base64,
                            mimeType: img.file.type
                        }
                    });
                    imgIndex++;
                }
            }

            const config = {
                imageConfig: {
                    imageSize: resolution as any,
                    aspectRatio: aspectRatio as any
                }
            };

            const response = await ai.models.generateContent({
                model: selectedModel,
                contents: { parts },
                config: config as any
            });

            db.logModelUsage('OperatorToolbox', selectedModel, { type: 'image_generation', config }).catch(console.error);

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
                    debugPayload: { prompt, config },
                    editPrompt: '', // clear after success
                    editImages: [],
                    isEditing: false
                } : c));
                await saveToHistory(card, resultUrl, productBase64, productMimeType);
            } else {
                throw new Error("No image returned");
            }

        } catch (e: any) {
            console.error(`Failed to regenerate card ${card.id}`, e);
            setCards(prev => prev.map(c => c.id === card.id ? { ...c, status: 'error', errorMsg: e.message } : c));
        }
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

                if (card.selectedImageSource === 'upload' && card.uploadedImage) {
                    productBase64 = await fileToBase64(card.uploadedImage.file);
                    productMimeType = card.uploadedImage.file.type;
                } else if (card.selectedImageSource === 'gallery' && card.galleryImageUrl) {
                    productBase64 = await urlToBase64(card.galleryImageUrl);
                    if (card.galleryImageUrl.endsWith('.png')) productMimeType = 'image/png';
                } else if (globalProductImages.length > 0) {
                    // Default fallback
                    productBase64 = await urlToBase64(globalProductImages[0]);
                    if (globalProductImages[0].endsWith('.png')) productMimeType = 'image/png';
                }

                if (!productBase64) {
                    throw new Error("No product image available (Global or Specific)");
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

                STRICT CONSTRAINTS:
                - Aspect Ratio: ${aspectRatio} (Ensure the composition fits this ratio perfectly)
                - Resolution: ${resolution}

                Technical: Photorealistic, 8k resolution, commercial photography, sharp focus.
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

                db.logModelUsage('OperatorToolbox', selectedModel, { type: 'image_generation_with_product', config }).catch(console.error);

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
                    await saveToHistory(card, resultUrl, productBase64, productMimeType);
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

    const downloadAll = async () => {
        const successfulCards = cards.filter(c => c.status === 'success' && c.resultUrl);
        if (successfulCards.length === 0) return;

        const zip = new JSZip();

        for (let index = 0; index < successfulCards.length; index++) {
            const card = successfulCards[index];
            try {
                const response = await fetch(card.resultUrl!);
                const blob = await response.blob();
                const cleanTitle = card.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                zip.file(`${index + 1}_${cleanTitle}.jpeg`, blob);
            } catch (error) {
                console.error("Failed to add image to zip", error);
            }
        }

        try {
            const content = await zip.generateAsync({ type: 'blob' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(content);
            a.download = `operator_toolbox_${Date.now()}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
        } catch (error) {
            console.error("Failed to generate zip", error);
        }
    };

    return (
        <div className="h-full flex flex-col bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-8 py-6 shrink-0 flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg">
                        <Briefcase size={20} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">{t.ot_title}</h1>
                        <p className="text-sm text-gray-500">{t.ot_subtitle}</p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <button 
                        onClick={() => setShowHistory(true)}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                        <History size={16} />
                        {t.ot_history}
                    </button>
                </div>
            </div>

             <div className="flex-1 overflow-hidden flex">
                {/* Left Sidebar - Configuration */}
                <div className="w-96 bg-white border-r border-gray-200 flex flex-col h-full shrink-0 overflow-y-auto custom-scrollbar">
                    <div className="p-6 space-y-8">
                        
                        {/* 1. Product Selection */}
                        <section>
                            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">{t.ot_step1_select_product}</h3>
                            <ProductSelector 
                                products={products}
                                selectedProductId={selectedProductId}
                                onSelect={setSelectedProductId}
                                placeholder={t.ot_choose_product_placeholder}
                                language={language}
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
                            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">{t.ot_step2_upload_sop}</h3>
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
                                        <p className="text-sm font-medium text-gray-600">{t.ot_click_upload_sop}</p>
                                        <p className="text-xs text-gray-400 mt-1">{t.ot_supported_formats}</p>
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
                                {isAnalyzing ? t.ot_analyzing_sop : t.ot_analyze_extract}
                            </button>
                        </section>

                        {/* 3. Global Settings */}
                        <section className="space-y-4">
                            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t.ot_step3_global_settings}</h3>
                            
                            <div>
                                <label className="text-xs font-medium text-gray-500 mb-1 block">{t.ot_ai_model}</label>
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
                                    <label className="text-xs font-medium text-gray-500 mb-1 block">{t.ot_aspect_ratio}</label>
                                    <select 
                                        value={aspectRatio}
                                        onChange={(e) => setAspectRatio(e.target.value)}
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                    >
                                        {ASPECT_RATIOS.map(r => <option key={r} value={r}>{r}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-gray-500 mb-1 block">{t.ot_resolution}</label>
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
                            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">{t.ot_step4_additional_instructions}</h3>
                            <textarea 
                                value={globalAdditionalInstructions}
                                onChange={(e) => setGlobalAdditionalInstructions(e.target.value)}
                                placeholder={t.ot_additional_instructions_placeholder}
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
                                {isGeneratingBatch ? t.ot_generating_progress.replace('{success}', cards.filter(c => c.status === 'success').length.toString()).replace('{total}', cards.length.toString()) : t.ot_generate_all}
                            </button>
                            {!selectedProductId && (
                                <p className="text-xs text-red-400 text-center mt-2">{t.ot_please_select_product}</p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Main Content - Cards */}
                <div className="flex-1 bg-slate-50 overflow-y-auto custom-scrollbar p-8">
                    {cards.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-50">
                            <FileText size={64} className="mb-4"/>
                            <p className="text-lg font-medium">{t.ot_upload_analyze_to_begin}</p>
                        </div>
                    ) : (
                        <div className="max-w-5xl mx-auto space-y-6">
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-2xl font-bold text-gray-800">{t.ot_generation_cards} ({cards.length})</h2>
                                {cards.some(c => c.status === 'success') && (
                                    <button 
                                        onClick={downloadAll}
                                        className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 font-medium shadow-sm"
                                    >
                                        <Download size={16}/> {t.ot_download_all}
                                    </button>
                                )}
                            </div>

                            {cards.map((card, index) => (
                                <div key={card.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col md:flex-row">
                                    {/* Left: Config & Info */}
                                    <div className="flex-1 p-6 border-b md:border-b-0 md:border-r border-gray-100">
                                        <div className="flex items-start justify-between mb-4">
                                            <div className="flex items-center gap-3 w-full">
                                                <span className="bg-gray-100 text-gray-500 text-xs font-bold px-2 py-1 rounded shrink-0">#{index + 1}</span>
                                                <input 
                                                    value={card.title}
                                                    onChange={(e) => setCards(prev => prev.map(c => c.id === card.id ? {...c, title: e.target.value} : c))}
                                                    className="font-bold text-gray-800 text-lg bg-transparent border-none focus:ring-0 p-0 w-full"
                                                />
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0 ml-4">
                                                <button
                                                    onClick={() => regenerateCard(card.id)}
                                                    disabled={card.status === 'generating' || !selectedProductId}
                                                    className="flex items-center gap-1 px-3 py-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
                                                    title={t.ot_generate_this_card}
                                                >
                                                    {card.status === 'generating' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                                                    {card.status === 'success' || card.status === 'error' ? t.ot_regenerate : t.ot_generate}
                                                </button>
                                                <div className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                                                    card.status === 'success' ? 'bg-green-100 text-green-700' :
                                                    card.status === 'generating' ? 'bg-blue-100 text-blue-700' :
                                                    card.status === 'error' ? 'bg-red-100 text-red-700' :
                                                    'bg-gray-100 text-gray-500'
                                                }`}>
                                                    {card.status}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <div>
                                                <label className="text-xs font-bold text-gray-400 uppercase block mb-1">{t.ot_visual_description}</label>
                                                <textarea 
                                                    value={card.description}
                                                    onChange={(e) => setCards(prev => prev.map(c => c.id === card.id ? {...c, description: e.target.value} : c))}
                                                    className="w-full text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2 h-20 resize-none focus:bg-white focus:border-indigo-300 transition-colors"
                                                />
                                            </div>
                                            
                                            <div>
                                                <label className="text-xs font-bold text-gray-400 uppercase block mb-1">{t.ot_text_render}</label>
                                                <textarea 
                                                    value={card.copywriting}
                                                    onChange={(e) => setCards(prev => prev.map(c => c.id === card.id ? {...c, copywriting: e.target.value} : c))}
                                                    placeholder={t.ot_text_render_placeholder}
                                                    className="w-full text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2 h-16 resize-none focus:bg-white focus:border-indigo-300 transition-colors"
                                                />
                                            </div>
                                            
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className="text-xs font-bold text-gray-400 uppercase block mb-1">{t.ot_scene_environment}</label>
                                                    <input 
                                                        value={card.scene}
                                                        onChange={(e) => setCards(prev => prev.map(c => c.id === card.id ? {...c, scene: e.target.value} : c))}
                                                        className="w-full text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-xs font-bold text-gray-400 uppercase block mb-1">{t.ot_style_mood}</label>
                                                    <input 
                                                        value={card.style}
                                                        onChange={(e) => setCards(prev => prev.map(c => c.id === card.id ? {...c, style: e.target.value} : c))}
                                                        className="w-full text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2"
                                                    />
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className="text-xs font-bold text-gray-400 uppercase block mb-1">{t.ot_layout}</label>
                                                    <input 
                                                        value={card.layout}
                                                        onChange={(e) => setCards(prev => prev.map(c => c.id === card.id ? {...c, layout: e.target.value} : c))}
                                                        className="w-full text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-xs font-bold text-gray-400 uppercase block mb-1">{t.ot_angle}</label>
                                                    <input 
                                                        value={card.recommendedAngle}
                                                        onChange={(e) => setCards(prev => prev.map(c => c.id === card.id ? {...c, recommendedAngle: e.target.value} : c))}
                                                        className="w-full text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2"
                                                    />
                                                </div>
                                            </div>
                                            <div className="flex justify-end mt-2">
                                                <button 
                                                    onClick={() => handleOpenChineseEdit(card)}
                                                    className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1 font-medium"
                                                >
                                                    <Edit2 size={12} />
                                                    {t.ot_prompt_cn_edit}
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right: Image & Result */}
                                    <div className="w-full md:w-80 bg-gray-50 p-6 flex flex-col gap-4 border-l border-gray-100">
                                        
                                        {/* Specific Product Image Upload */}
                                        <div>
                                            <label className="text-xs font-bold text-gray-400 uppercase block mb-2">{t.ot_product_angle}</label>
                                            
                                            {/* Active Image Preview */}
                                            <div className="w-full aspect-square bg-white rounded-lg border border-gray-200 mb-2 flex items-center justify-center overflow-hidden relative group">
                                                {(() => {
                                                    let previewUrl = '';
                                                    if (card.selectedImageSource === 'upload' && card.uploadedImage) {
                                                        previewUrl = card.uploadedImage.preview;
                                                    } else if (card.selectedImageSource === 'gallery' && card.galleryImageUrl) {
                                                        previewUrl = card.galleryImageUrl;
                                                    } else if (globalProductImages.length > 0) {
                                                        previewUrl = globalProductImages[0];
                                                    }

                                                    return previewUrl ? (
                                                        <>
                                                            <img src={previewUrl} className="w-full h-full object-contain" />
                                                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                                <span className="text-xs text-white font-medium px-2 py-1 bg-black/50 rounded">
                                                                    {card.selectedImageSource === 'default' ? t.ot_default : 
                                                                     card.selectedImageSource === 'gallery' ? t.ot_from_gallery : t.ot_uploaded}
                                                                </span>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <div className="text-gray-300 flex flex-col items-center">
                                                            <ImageIcon size={24} />
                                                            <span className="text-[10px] mt-1">{t.ot_no_image}</span>
                                                        </div>
                                                    );
                                                })()}
                                            </div>

                                            {/* Selection Grid */}
                                            {globalProductImages.length > 0 && (
                                                <div className="grid grid-cols-5 gap-1">
                                                    {/* Default (First Image) */}
                                                    <button 
                                                        onClick={() => setCards(prev => prev.map(c => c.id === card.id ? {...c, selectedImageSource: 'default'} : c))}
                                                        className={`aspect-square rounded border overflow-hidden relative ${card.selectedImageSource === 'default' ? 'ring-2 ring-indigo-500 border-indigo-500' : 'border-gray-200 hover:border-gray-300'}`}
                                                        title={t.ot_default_image}
                                                    >
                                                        <img src={globalProductImages[0]} className="w-full h-full object-cover" />
                                                        {card.selectedImageSource === 'default' && <div className="absolute inset-0 bg-indigo-500/20" />}
                                                    </button>

                                                    {/* Gallery Images */}
                                                    {globalProductImages.slice(1).map((url, idx) => (
                                                        <button 
                                                            key={idx}
                                                            onClick={() => handleCardGallerySelect(card.id, url)}
                                                            className={`aspect-square rounded border overflow-hidden relative ${
                                                                card.selectedImageSource === 'gallery' && card.galleryImageUrl === url 
                                                                ? 'ring-2 ring-indigo-500 border-indigo-500' 
                                                                : 'border-gray-200 hover:border-gray-300'
                                                            }`}
                                                        >
                                                            <img src={url} className="w-full h-full object-cover" />
                                                        </button>
                                                    ))}

                                                    {/* Upload Button */}
                                                    <div className={`aspect-square rounded border border-dashed flex items-center justify-center relative hover:bg-gray-50 cursor-pointer ${
                                                        card.selectedImageSource === 'upload' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300'
                                                    }`}>
                                                        <input 
                                                            type="file" 
                                                            className="absolute inset-0 opacity-0 cursor-pointer z-10"
                                                            accept="image/*"
                                                            onChange={(e) => e.target.files && e.target.files[0] && handleCardImageUpload(card.id, e.target.files[0])}
                                                        />
                                                        {card.selectedImageSource === 'upload' && card.uploadedImage ? (
                                                            <img src={card.uploadedImage.preview} className="w-full h-full object-cover rounded-[3px]" />
                                                        ) : (
                                                            <Plus size={14} className="text-gray-400"/>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Result Area */}
                                        <div className="flex-1 min-h-[200px] bg-gray-200 rounded-lg border border-gray-300 flex items-center justify-center overflow-hidden relative group">
                                            {card.status === 'success' && card.resultUrl ? (
                                                <>
                                                    <img src={card.resultUrl} className="w-full h-full object-cover" />
                                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                                        <a href={card.resultUrl} download={`${card.title}.jpeg`} className="p-2 bg-white rounded-full text-gray-800 hover:text-indigo-600">
                                                            <Download size={20} />
                                                        </a>
                                                        <button onClick={() => toggleEditMode(card.id)} className="p-2 bg-white rounded-full text-gray-800 hover:text-indigo-600">
                                                            <Edit2 size={20} />
                                                        </button>
                                                    </div>
                                                </>
                                            ) : card.status === 'generating' ? (
                                                <div className="flex flex-col items-center text-indigo-600">
                                                    <Loader2 size={32} className="animate-spin mb-2" />
                                                    <span className="text-xs font-bold">{t.ot_generating_progress.split(' ')[0]}...</span>
                                                </div>
                                            ) : card.status === 'error' ? (
                                                <div className="text-center p-4">
                                                    <AlertCircle size={24} className="text-red-500 mx-auto mb-2" />
                                                    <p className="text-xs text-red-600">{card.errorMsg || t.ot_generation_failed}</p>
                                                </div>
                                            ) : (
                                                <span className="text-xs text-gray-400 font-medium">{t.ot_ready_to_generate}</span>
                                            )}
                                        </div>

                                        {/* Editing Mode Area */}
                                        {card.isEditing && (
                                            <div className="mt-2 border-t border-gray-200 pt-4">
                                                <div className="flex flex-col gap-2">
                                                    {/* Attached Images */}
                                                    {card.editImages && card.editImages.length > 0 && (
                                                        <div className="flex gap-2">
                                                            {card.editImages.map((img, imgIndex) => (
                                                                <div 
                                                                    key={img.id} 
                                                                    className="relative w-12 h-12 rounded border border-gray-200 overflow-hidden cursor-grab active:cursor-grabbing"
                                                                    draggable
                                                                    onDragStart={(e) => {
                                                                        e.dataTransfer.setData('text/plain', `[Image ${imgIndex + 1}]`);
                                                                    }}
                                                                    title={`Drag to insert [Image ${imgIndex + 1}] into prompt`}
                                                                >
                                                                    <img src={img.preview} className="w-full h-full object-cover pointer-events-none" />
                                                                    <button onClick={() => removeEditImage(card.id, img.id)} className="absolute top-0 right-0 bg-black/50 text-white p-0.5 rounded-bl z-10">
                                                                        <X size={10} />
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                    
                                                    <div className="flex items-end gap-2">
                                                        <div className="relative flex-1">
                                                            <textarea 
                                                                value={card.editPrompt || ''}
                                                                onChange={e => updateEditPrompt(card.id, e.target.value)}
                                                                onDrop={(e) => {
                                                                    e.preventDefault();
                                                                    const text = e.dataTransfer.getData('text/plain');
                                                                    if (text) {
                                                                        const target = e.currentTarget;
                                                                        const start = target.selectionStart;
                                                                        const end = target.selectionEnd;
                                                                        const val = target.value;
                                                                        const newVal = val.substring(0, start) + text + val.substring(end);
                                                                        updateEditPrompt(card.id, newVal);
                                                                        setTimeout(() => {
                                                                            target.selectionStart = target.selectionEnd = start + text.length;
                                                                            target.focus();
                                                                        }, 0);
                                                                    }
                                                                }}
                                                                onDragOver={(e) => e.preventDefault()}
                                                                placeholder={t.ot_edit_prompt_placeholder}
                                                                className="w-full text-sm border border-gray-300 rounded-lg p-2 pr-10 resize-none h-10 focus:h-20 transition-all"
                                                            />
                                                            <button 
                                                                onClick={() => document.getElementById(`edit-img-${card.id}`)?.click()}
                                                                className="absolute right-2 bottom-2 text-gray-400 hover:text-indigo-600"
                                                                disabled={card.editImages && card.editImages.length >= 2}
                                                            >
                                                                <ImageIcon size={18} />
                                                            </button>
                                                            <input 
                                                                id={`edit-img-${card.id}`}
                                                                type="file" 
                                                                accept="image/*" 
                                                                className="hidden" 
                                                                onChange={e => {
                                                                    if (e.target.files && e.target.files[0]) {
                                                                        addEditImage(card.id, e.target.files[0]);
                                                                    }
                                                                    e.target.value = ''; // Reset input
                                                                }}
                                                            />
                                                        </div>
                                                        <button 
                                                            onClick={() => regenerateCard(card.id)}
                                                            disabled={card.status === 'generating'}
                                                            className="bg-indigo-600 text-white p-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                                                        >
                                                            <Send size={18} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* History Panel Overlay */}
            {showHistory && (
                <div className="absolute inset-0 z-50 flex justify-end bg-black/20 backdrop-blur-sm">
                    <div className="w-[600px] h-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right">
                        <div className="flex items-center justify-between p-6 border-b border-gray-100">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600">
                                    <History size={20} />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-gray-900">{t.ot_history_title}</h2>
                                    <p className="text-sm text-gray-500">{historyItems.length} {t.ot_items_saved}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button 
                                    onClick={async () => {
                                        if (confirm(t.ot_clear_history_confirm)) {
                                            await clearHistory();
                                            setHistoryItems([]);
                                        }
                                    }}
                                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                    title={t.ot_clear_all}
                                >
                                    <Trash2 size={20} />
                                </button>
                                <button 
                                    onClick={() => setShowHistory(false)}
                                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-6 space-y-6">
                            {historyItems.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-gray-400">
                                    <History size={48} className="mb-4 opacity-20" />
                                    <p>{t.ot_no_history_yet}</p>
                                </div>
                            ) : (
                                historyItems.map(item => (
                                    <div key={item.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                                        <div className="p-4 border-b border-gray-100 flex justify-between items-start bg-gray-50">
                                            <div>
                                                <h3 className="font-bold text-gray-900">{item.title}</h3>
                                                <p className="text-xs text-gray-500 mt-1">{new Date(item.timestamp).toLocaleString()}</p>
                                            </div>
                                            <button 
                                                onClick={async () => {
                                                    await deleteHistoryItem(item.id);
                                                    setHistoryItems(prev => prev.filter(i => i.id !== item.id));
                                                }}
                                                className="text-gray-400 hover:text-red-600 p-1"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                        <div className="p-4 grid grid-cols-2 gap-4">
                                            <div>
                                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 block">{t.ot_original}</span>
                                                <div className="aspect-square bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                                                    <img src={item.productImage} className="w-full h-full object-contain" />
                                                </div>
                                            </div>
                                            <div>
                                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 block">{t.ot_generated}</span>
                                                <div className="aspect-square bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                                                    <img src={item.resultImage} className="w-full h-full object-cover" />
                                                </div>
                                            </div>
                                        </div>
                                        <div className="px-4 pb-4">
                                            <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 space-y-2 border border-gray-100">
                                                <div className="flex gap-2">
                                                    <span className="font-medium text-gray-900 w-16 shrink-0">{t.ot_scene_label}</span>
                                                    <span>{item.scene}</span>
                                                </div>
                                                <div className="flex gap-2">
                                                    <span className="font-medium text-gray-900 w-16 shrink-0">{t.ot_style_label}</span>
                                                    <span>{item.style}</span>
                                                </div>
                                                <div className="flex gap-2">
                                                    <span className="font-medium text-gray-900 w-16 shrink-0">{t.ot_layout_label}</span>
                                                    <span>{item.layout}</span>
                                                </div>
                                                {item.copywriting && (
                                                    <div className="flex gap-2">
                                                        <span className="font-medium text-gray-900 w-16 shrink-0">{t.ot_copywriting_label}</span>
                                                        <span>{item.copywriting}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Chinese Prompt Edit Modal */}
            {editingChinesePromptCardId && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col">
                        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                            <h3 className="font-bold text-gray-800 flex items-center gap-2">
                                <Edit2 size={18} className="text-indigo-600" />
                                {t.ot_prompt_cn_edit_title}
                            </h3>
                            <button 
                                onClick={() => setEditingChinesePromptCardId(null)}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 flex-1">
                            {isTranslating ? (
                                <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                                    <Loader2 size={32} className="animate-spin mb-4 text-indigo-600" />
                                    <p>{t.ot_prompt_cn_translating}</p>
                                </div>
                            ) : (
                                <textarea
                                    value={chinesePromptText}
                                    onChange={(e) => setChinesePromptText(e.target.value)}
                                    className="w-full h-64 p-4 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                                    placeholder="Chinese prompt details..."
                                />
                            )}
                        </div>
                        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
                            <button
                                onClick={() => setEditingChinesePromptCardId(null)}
                                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
                            >
                                {t.ot_prompt_cn_edit_cancel}
                            </button>
                            <button
                                onClick={handleSaveChineseEdit}
                                disabled={isTranslating}
                                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-lg transition-colors flex items-center gap-2"
                            >
                                {isTranslating ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                {t.ot_prompt_cn_edit_save}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
