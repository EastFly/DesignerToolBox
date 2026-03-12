import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, Image as ImageIcon, Type, Settings, Download, Loader2, X, Maximize2, CheckCircle, AlertCircle, Sparkles, Box, LayoutTemplate, ChevronLeft, ChevronRight, Bug, History, RefreshCw, Trash2 } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import { translations } from '../i18n';
import { Product } from '../types';
import { db } from '../services/db';
import { ProductSelector } from './ProductSelector';
import { HistoryItem, saveHistoryItem, getHistoryItems, deleteHistoryItem, clearHistory } from '../services/localHistory';
import JSZip from 'jszip';

interface DesignerToolboxViewProps {
    language: string;
}

interface UploadedImage {
    id: string;
    file: File;
    preview: string;
    status: 'pending' | 'processing' | 'success' | 'error';
    resultUrl?: string;
    errorMsg?: string;
    debugPayload?: any;
}

interface RemixAsset {
    id: string;
    file: File;
    preview: string;
    role: 'product' | 'scenario' | 'layout' | 'inline';
    label: string;
}

const MODELS = [
    { id: 'gemini-3.1-flash-image-preview', name: 'Gemini 3.1 Flash Image (Nano Banana 2)' },
    { id: 'gemini-3-pro-image-preview', name: 'Gemini 3 Pro Image' }
];

const ASPECT_RATIOS = [
    '1:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9'
];

const RESOLUTIONS = ['1K', '2K', '4K'];

const TARGET_LANGUAGES = [
    'Chinese (Simplified)', 'English', 'German', 'French', 'Dutch',
    'Spanish', 'Japanese', 'Korean', 'Italian', 'Portuguese',
    'Russian', 'Arabic'
];

// Map requested aspect ratios to API supported ones
const mapAspectRatio = (ratio: string): string => {
    // User claims 21:9 is supported. We will trust the user and pass it through if selected.
    const supported = ['1:1', '3:4', '4:3', '9:16', '16:9', '1:4', '1:8', '4:1', '8:1', '21:9'];
    if (supported.includes(ratio)) return ratio;
    
    // Fallbacks
    switch (ratio) {
        case '3:2': return '4:3';
        case '2:3': return '3:4';
        case '5:4': return '4:3';
        case '4:5': return '3:4';
        default: return '1:1';
    }
};

export const DesignerToolboxView: React.FC<DesignerToolboxViewProps> = ({ language }) => {
    const t = translations[language as keyof typeof translations];
    const [mode, setMode] = useState<'resize' | 'translate' | 'reimagine' | 'remix'>('resize');
    const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
    const [aspectRatio, setAspectRatio] = useState('1:1');
    const [resolution, setResolution] = useState('1K');
    const [targetLanguage, setTargetLanguage] = useState(TARGET_LANGUAGES[0]);
    const [customPrompt, setCustomPrompt] = useState('');
    const [images, setImages] = useState<UploadedImage[]>([]);
    const [remixAssets, setRemixAssets] = useState<RemixAsset[]>([]);
    const [isProcessingBatch, setIsProcessingBatch] = useState(false);
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
    const [showHistory, setShowHistory] = useState(false);
    const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);

    useEffect(() => {
        if (showHistory) {
            getHistoryItems().then(setHistoryItems).catch(console.error);
        }
    }, [showHistory]);

    // Product Selection State
    const [productSource, setProductSource] = useState<'db' | 'manual'>('db');
    const [products, setProducts] = useState<Product[]>([]);
    const [selectedProductId, setSelectedProductId] = useState<string>('');
    const [selectedProductImageIndex, setSelectedProductImageIndex] = useState(0);
    const [manualProductImage, setManualProductImage] = useState<{file: File, preview: string} | null>(null);

    // Reimagine Mode State
    const [reimagineConfig, setReimagineConfig] = useState({
        layoutVariance: 0,
        contentVariance: 50,
        modelVariance: 0
    });

    const [debugModalPayload, setDebugModalPayload] = useState<any | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const manualProductInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        db.getProducts().then(setProducts);
    }, []);

    const getProductContext = () => {
        if (productSource === 'manual') {
             return { images: manualProductImage ? [manualProductImage.preview] : [] };
        }

        const product = products.find(p => p.id === selectedProductId);
        if (!product) return { images: [] };

        const images: string[] = [];
        const syncedImg = product.data['productImage'];
        if (Array.isArray(syncedImg)) images.push(...syncedImg);
        else if (typeof syncedImg === 'string' && syncedImg) images.push(syncedImg);
        const gallery = product.data['galleryImages'];
        if (Array.isArray(gallery)) images.push(...gallery);
        
        const uniqueImages = Array.from(new Set(images.filter(url => typeof url === 'string' && url.trim() !== '')));
        return { images: uniqueImages };
    };

    const { images: productImages } = getProductContext();

    const handleManualProductUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setManualProductImage({
                file,
                preview: URL.createObjectURL(file)
            });
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const newImages = Array.from(e.target.files).map((file: File) => ({
                id: Math.random().toString(36).substring(7),
                file,
                preview: URL.createObjectURL(file),
                status: 'pending' as const
            }));
            setImages(prev => [...prev, ...newImages]);
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleRemixAssetUpload = (e: React.ChangeEvent<HTMLInputElement>, role: 'product' | 'scenario' | 'layout' | 'inline') => {
        if (e.target.files && e.target.files.length > 0) {
            const files = Array.from(e.target.files) as File[];
            const newAssets = files.map((file, index) => {
                const existingRoleCount = remixAssets.filter(a => a.role === role).length;
                return {
                    id: Math.random().toString(36).substring(7),
                    file,
                    preview: URL.createObjectURL(file),
                    role,
                    label: `[${role} ${existingRoleCount + index + 1}]`
                };
            });
            
            if (role === 'scenario' || role === 'layout') {
                // Replace existing if single
                setRemixAssets(prev => [...prev.filter(a => a.role !== role), newAssets[0]]);
            } else {
                setRemixAssets(prev => [...prev, ...newAssets]);
            }
        }
        e.target.value = '';
    };

    const handleTextareaDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
        e.preventDefault();
        if (mode !== 'remix') return;
        
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const files = Array.from(e.dataTransfer.files).filter((f: File) => f.type.startsWith('image/')) as File[];
            if (files.length === 0) return;
            
            const newAssets = files.map((file, index) => {
                const existingRoleCount = remixAssets.filter(a => a.role === 'inline').length;
                return {
                    id: Math.random().toString(36).substring(7),
                    file,
                    preview: URL.createObjectURL(file),
                    role: 'inline' as const,
                    label: `[inline ${existingRoleCount + index + 1}]`
                };
            });
            
            setRemixAssets(prev => [...prev, ...newAssets]);
            
            const labels = newAssets.map(a => a.label).join(' ');
            setCustomPrompt(prev => prev + (prev ? ' ' : '') + labels + ' ');
        }
    };

    const removeRemixAsset = (id: string) => {
        setRemixAssets(prev => prev.filter(a => a.id !== id));
    };

    const removeImage = (id: string) => {
        setImages(prev => prev.filter(img => img.id !== id));
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

    const processImages = async (targetImageId?: string) => {
        if (mode !== 'remix' && images.length === 0) return;
        if (mode === 'remix' && remixAssets.length === 0) return;

        // Priority: GEMINI_API_KEY (User provided env) -> API_KEY (Platform injected)
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
                    alert(t.dt_select_key_alert);
                    return;
                }
            }
        }

        // If still no key, we can't proceed
        if (!apiKey) {
            alert(t.dt_env_alert);
            return;
        }

        setIsProcessingBatch(true);

        const ai = new GoogleGenAI({ apiKey });

        // Prepare Product Context if selected
        let productBase64 = '';
        let productMimeType = 'image/jpeg';
        
        if (productSource === 'manual' && manualProductImage) {
             try {
                productBase64 = await fileToBase64(manualProductImage.file);
                productMimeType = manualProductImage.file.type;
             } catch (e) {
                console.error("Failed to load manual product image", e);
             }
        } else if (productSource === 'db' && selectedProductId && productImages[selectedProductImageIndex]) {
            try {
                productBase64 = await urlToBase64(productImages[selectedProductImageIndex]);
                // Simple mime type detection or default
                if (productImages[selectedProductImageIndex].endsWith('.png')) productMimeType = 'image/png';
                else if (productImages[selectedProductImageIndex].endsWith('.webp')) productMimeType = 'image/webp';
            } catch (e) {
                console.error("Failed to load product image", e);
            }
        }

        if (mode === 'remix') {
            const newImageId = targetImageId || Math.random().toString(36).substring(7);
            const scenarioAsset = remixAssets.find(a => a.role === 'scenario');
            const previewUrl = scenarioAsset ? scenarioAsset.preview : (remixAssets[0]?.preview || '');
            
            if (targetImageId) {
                setImages(prev => prev.map(p => p.id === targetImageId ? { ...p, status: 'processing' } : p));
            } else {
                setImages(prev => [{
                    id: newImageId,
                    file: new File([], 'remix.jpg'),
                    preview: previewUrl,
                    status: 'processing'
                }, ...prev]);
            }

            try {
                let prompt = `You are an expert AI Art Director. Your task is to combine the provided product images into the scenario image, following the layout image's structure.
${customPrompt ? `Additional instructions: ${customPrompt}` : ''}
Please ensure the products are placed accurately and the final image looks photorealistic and cohesive.`;
                
                const parts: any[] = [{ text: prompt }];
                
                for (const asset of remixAssets) {
                    const base64Data = await fileToBase64(asset.file);
                    parts.push({ text: `${asset.label} (${asset.role}):` });
                    parts.push({
                        inlineData: {
                            data: base64Data,
                            mimeType: asset.file.type
                        }
                    });
                }

                const config: any = {
                    imageConfig: {
                        imageSize: resolution as any,
                        aspectRatio: mapAspectRatio(aspectRatio)
                    }
                };

                const debugPayload = {
                    model: selectedModel,
                    prompt: prompt,
                    config: config,
                    assets: remixAssets.map(a => a.label)
                };

                const response = await ai.models.generateContent({
                    model: selectedModel,
                    contents: { parts },
                    config: config
                });

                db.logModelUsage('DesignerToolbox', selectedModel, { type: mode, config }).catch(console.error);

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
                    setImages(prev => prev.map(p => p.id === newImageId ? { ...p, status: 'success', resultUrl, debugPayload } : p));
                    
                    const historyItem: HistoryItem = {
                        id: Date.now().toString() + Math.random().toString(36).substring(7),
                        timestamp: Date.now(),
                        mode: mode,
                        originalImage: remixAssets[0]?.preview || '',
                        resultImage: resultUrl,
                        prompt: customPrompt
                    };
                    saveHistoryItem(historyItem).catch(console.error);
                } else {
                    throw new Error(t.dt_no_image_returned);
                }
            } catch (error: any) {
                console.error("Processing error:", error);
                setImages(prev => prev.map(p => p.id === newImageId ? { ...p, status: 'error', errorMsg: error.message || t.dt_processing_error } : p));
            }

            setIsProcessingBatch(false);
            return;
        }

        for (let i = 0; i < images.length; i++) {
            const img = images[i];
            if (targetImageId && img.id !== targetImageId) continue;
            if (!targetImageId && img.status === 'success') continue;

            setImages(prev => prev.map(p => p.id === img.id ? { ...p, status: 'processing' } : p));

            try {
                const base64Data = await fileToBase64(img.file);
                
                let prompt = '';
                let debugPayload: any = {};
                const parts: any[] = [];

                if (mode === 'resize') {
                    parts.push({
                        inlineData: {
                            data: base64Data,
                            mimeType: img.file.type,
                        }
                    });
                    if (productBase64) {
                        parts.push({
                            inlineData: {
                                data: productBase64,
                                mimeType: productMimeType
                            }
                        });
                    }

                    prompt = `Resize and relayout the FIRST image to an aspect ratio of ${aspectRatio}. 
Maintain the core content, scene, and text consistency, but adapt the layout to fit the new dimensions perfectly. 
Do not crop important elements; instead, intelligently extend or rearrange the background and subjects.
${productBase64 ? 'The SECOND image provided is the PRODUCT REFERENCE. You MUST ensure the product in the generated image matches this reference exactly in terms of details, logo, and appearance. Do not hallucinate or alter the product features.' : ''}
${customPrompt ? `Additional instructions: ${customPrompt}` : ''}`;
                    parts.push({ text: prompt });
                } else if (mode === 'translate') {
                    parts.push({
                        inlineData: {
                            data: base64Data,
                            mimeType: img.file.type,
                        }
                    });
                    if (productBase64) {
                        parts.push({
                            inlineData: {
                                data: productBase64,
                                mimeType: productMimeType
                            }
                        });
                    }

                    prompt = `Generate a new image that is identical to the FIRST image, but with all text translated into ${targetLanguage}. 
ONLY translate the text. Do NOT obscure or change the main subject, icons, products, or any non-text elements.
You may adjust line breaks and local text positions slightly to accommodate the translated text length, but keep the overall design intact.
${productBase64 ? 'The SECOND image provided is the PRODUCT REFERENCE. Use it to ensure any product details remain consistent and are not accidentally altered during the translation process.' : ''}
${customPrompt ? `Additional instructions: ${customPrompt}` : ''}`;
                    parts.push({ text: prompt });
                } else if (mode === 'reimagine') {
                    // 1. Image Understanding
                    const systemPrompt = `You are an expert AI Art Director for E-commerce.
Your goal is to analyze the provided image and break down its visual description into 4 distinct structural components.
${customPrompt ? `\nIMPORTANT - USER'S ADDITIONAL INSTRUCTIONS:\n"${customPrompt}"\nYou MUST adapt your extraction to incorporate these instructions. If the user requests a change in setting, lighting, or composition, reflect that change in your JSON output while maintaining the unmentioned aspects of the original image.` : ''}

OUTPUT FORMAT:
Return a JSON object strictly. Do not include markdown code blocks if possible, or wrap in \`\`\`json.
{
  "structured": {
      "subject": "Detailed description of the main subject/product...",
      "environment": "The background, setting, or scene...",
      "lighting": "The type of light, shadows, and mood...",
      "composition": "The camera angle, framing, spatial arrangement, and specific layout of structural elements..."
  }
}`;
                    const planResponse = await ai.models.generateContent({
                        model: 'gemini-3-flash-preview',
                        contents: [
                            { role: 'user', parts: [{ text: systemPrompt }] },
                            { role: 'user', parts: [{ inlineData: { data: base64Data, mimeType: img.file.type } }] }
                        ],
                        config: { responseMimeType: 'application/json' }
                    });

                    db.logModelUsage('DesignerToolbox', 'gemini-3-flash-preview', { type: 'reimagine_planning', config: { responseMimeType: 'application/json' } }).catch(console.error);

                    const cleanJson = (planResponse.text || '{}').replace(/```json|```/g, '').trim();
                    let structure = { subject: 'A product', environment: '', lighting: '', composition: '' };
                    try {
                        const parsed = JSON.parse(cleanJson);
                        if (parsed.structured) structure = parsed.structured;
                    } catch (e) {
                        console.error("Failed to parse plan", e);
                    }

                    // 2. Build Final Prompt
                    const productReferenceInstruction = productBase64 
                        ? "CRITICAL RULE 1 (SUBJECT - ABSOLUTE PRIORITY): You MUST REPLACE the product in the original image with the product shown in the 'Product Reference' image. The 'Product Reference' image is the ONLY source of truth for the product. You MUST accurately extract and render this exact product into the scene. Maintain its exact shape, size proportions, color, branding, materials, and details. This rule supersedes ALL other layout or style adjustments. If the product appears multiple times in the scene, EVERY instance must be perfectly replaced with the Product Reference. DO NOT use the product from the layout or style references."
                        : "";

                    let layoutInstruction = "";
                    if (reimagineConfig.layoutVariance === 0) {
                        layoutInstruction = "CRITICAL RULE 2 (COMPOSITION): You MUST strictly follow the 'Composition Reference' for the structural layout, camera angle, and spatial balance. It is crucial to maintain the exact placement of any detail frames, text boxes, feature callouts, or structural elements shown in the layout reference. Place the 'Product Reference' exactly where the main subject is in the layout reference.";
                    } else if (reimagineConfig.layoutVariance <= 50) {
                        layoutInstruction = "CRITICAL RULE 2 (COMPOSITION): Use the 'Composition Reference' as a strong guide for the structural layout. You can slightly adapt the placement of frames and text boxes to better fit the product, but maintain the overall spatial balance.";
                    } else {
                        layoutInstruction = "CRITICAL RULE 2 (COMPOSITION): Use the 'Composition Reference' loosely for inspiration. Feel free to completely reimagine the layout, camera angle, and placement of elements while keeping the general vibe.";
                    }

                    let styleInstruction = "";
                    if (reimagineConfig.contentVariance === 0) {
                        styleInstruction = "CRITICAL RULE 3 (STYLE): You MUST strictly replicate the exact lighting setup, color palette, textures, and overall mood of the 'Style Reference'. The atmosphere should feel identical. IGNORE the product/subject shown in the style reference.";
                    } else if (reimagineConfig.contentVariance <= 50) {
                        styleInstruction = "CRITICAL RULE 3 (STYLE): Use the 'Style Reference' to define the lighting, color palette, and overall mood. You can adapt these aesthetic qualities to create a fresh environment while maintaining the core vibe. IGNORE the product/subject shown in the style reference.";
                    } else {
                        styleInstruction = "CRITICAL RULE 3 (STYLE): Use the 'Style Reference' loosely as a starting point. Creatively reinterpret the lighting, color palette, and mood to produce a highly original and surprising environment. IGNORE the product/subject shown in the style reference.";
                    }

                    let modelInstruction = '';
                    if (reimagineConfig.modelVariance === 0) {
                        modelInstruction = 'If there is a human model in the image, you MUST strictly preserve their exact identity, face, pose, and clothing. Do not change the model.';
                    } else {
                        modelInstruction = `If there is a human model, you may alter their appearance, clothing, or pose (variance level: ${reimagineConfig.modelVariance}/100) to better suit the new product.`;
                    }

                    prompt = `
${productReferenceInstruction}
${layoutInstruction}
${styleInstruction}

Scene Description:
Subject Context: ${structure.subject}
Environment: ${structure.environment}
Lighting: ${structure.lighting}
Composition: ${structure.composition}

MODEL/SUBJECT: ${modelInstruction}

Instructions: Combine these elements into a high-fidelity, photorealistic e-commerce product render. 
You MUST REPLACE the product in the Composition Reference with the Product Reference.
ABSOLUTE PRIORITY: The Product Reference must be rendered with 100% accuracy in shape, detail, and scale, regardless of any layout or style changes. If the product appears multiple times, ensure every instance is perfectly consistent.
Draw artistic inspiration from the Style Reference to define the mood, lighting, and textures, adapting them to build a harmonious scene.
${customPrompt ? `Additional instructions: ${customPrompt}` : ''}`;

                    parts.push({ text: prompt });
                    
                    if (productBase64) {
                        parts.push({ text: "Product Reference (Main Subject):" });
                        parts.push({ inlineData: { data: productBase64, mimeType: productMimeType } });
                    }
                    
                    parts.push({ text: "Composition Reference:" });
                    parts.push({ inlineData: { data: base64Data, mimeType: img.file.type } });
                    
                    parts.push({ text: "Style Reference:" });
                    parts.push({ inlineData: { data: base64Data, mimeType: img.file.type } });

                    debugPayload.extractedStructure = structure;
                }

                // Construct config based on mode
                const config: any = {
                    imageConfig: {
                        imageSize: resolution as any
                    }
                };

                if (mode === 'resize' || mode === 'reimagine') {
                    // Only apply aspect ratio for Resize and Reimagine modes
                    config.imageConfig.aspectRatio = mapAspectRatio(aspectRatio);
                }

                debugPayload = {
                    ...debugPayload,
                    model: selectedModel,
                    prompt: prompt,
                    config: config,
                    references: {
                        hasSourceImage: true,
                        hasProductImage: !!productBase64
                    }
                };

                const response = await ai.models.generateContent({
                    model: selectedModel,
                    contents: { parts },
                    config: config
                });

                db.logModelUsage('DesignerToolbox', selectedModel, { type: mode, config }).catch(console.error);

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
                    setImages(prev => prev.map(p => p.id === img.id ? { ...p, status: 'success', resultUrl, debugPayload } : p));
                    
                    // Save to history
                    const historyItem: HistoryItem = {
                        id: Date.now().toString() + Math.random().toString(36).substring(7),
                        timestamp: Date.now(),
                        mode: mode,
                        originalImage: `data:${img.file.type};base64,${base64Data}`,
                        resultImage: resultUrl,
                        prompt: customPrompt
                    };
                    saveHistoryItem(historyItem).catch(console.error);
                } else {
                    throw new Error(t.dt_no_image_returned);
                }

            } catch (error: any) {
                console.error("Processing error:", error);
                setImages(prev => prev.map(p => p.id === img.id ? { ...p, status: 'error', errorMsg: error.message || t.dt_processing_error } : p));
            }
        }

        setIsProcessingBatch(false);
    };

    const downloadAll = async () => {
        const successfulImages = images.filter(img => img.status === 'success' && img.resultUrl);
        if (successfulImages.length === 0) return;

        const zip = new JSZip();
        
        for (let index = 0; index < successfulImages.length; index++) {
            const img = successfulImages[index];
            try {
                const response = await fetch(img.resultUrl!);
                const blob = await response.blob();
                zip.file(`processed_${mode}_${index + 1}.jpeg`, blob);
            } catch (error) {
                console.error("Failed to add image to zip", error);
            }
        }

        try {
            const content = await zip.generateAsync({ type: 'blob' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(content);
            a.download = `designer_toolbox_${mode}_${Date.now()}.zip`;
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
                    <div className="w-10 h-10 bg-gradient-to-br from-pink-500 to-rose-600 rounded-xl flex items-center justify-center text-white shadow-lg">
                        <LayoutTemplate size={20} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">{t.dt_title}</h1>
                        <p className="text-sm text-gray-500">{t.dt_subtitle}</p>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-hidden flex">
                {/* Left Sidebar - Controls */}
                <div className="w-80 bg-white border-r border-gray-200 flex flex-col h-full shrink-0 overflow-y-auto custom-scrollbar">
                    <div className="p-6 space-y-6">
                        {/* Product Selection */}
                        {mode !== 'remix' && (
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t.dt_product_constraint}</label>
                                <div className="flex bg-gray-100 rounded p-0.5">
                                    <button 
                                        onClick={() => setProductSource('db')}
                                        className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${productSource === 'db' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
                                    >
                                        {t.dt_select_from_db}
                                    </button>
                                    <button 
                                        onClick={() => setProductSource('manual')}
                                        className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${productSource === 'manual' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
                                    >
                                        {t.dt_manual_upload}
                                    </button>
                                </div>
                            </div>

                            {productSource === 'db' ? (
                                <>
                                    <ProductSelector 
                                        products={products}
                                        selectedProductId={selectedProductId}
                                        onSelect={(id) => {
                                            setSelectedProductId(id);
                                            setSelectedProductImageIndex(0);
                                        }}
                                        placeholder={t.dt_select_product}
                                    />
                                    
                                    {selectedProductId && productImages.length > 0 && (
                                        <div className="mt-3 bg-gray-50 rounded-lg p-3 border border-gray-200">
                                            <div className="relative aspect-square bg-white rounded border border-gray-200 overflow-hidden group">
                                                <img 
                                                    src={productImages[selectedProductImageIndex]} 
                                                    className="w-full h-full object-contain p-2" 
                                                />
                                                
                                                {/* Navigation */}
                                                {productImages.length > 1 && (
                                                    <>
                                                        <button 
                                                            onClick={() => setSelectedProductImageIndex(prev => prev === 0 ? productImages.length - 1 : prev - 1)}
                                                            className="absolute left-1 top-1/2 -translate-y-1/2 bg-black/50 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                                        >
                                                            <ChevronLeft size={14}/>
                                                        </button>
                                                        <button 
                                                            onClick={() => setSelectedProductImageIndex(prev => prev === productImages.length - 1 ? 0 : prev + 1)}
                                                            className="absolute right-1 top-1/2 -translate-y-1/2 bg-black/50 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                                        >
                                                            <ChevronRight size={14}/>
                                                        </button>
                                                        
                                                        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 bg-black/50 text-white text-[10px] px-1.5 rounded-full backdrop-blur-sm">
                                                            {selectedProductImageIndex + 1} / {productImages.length}
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                            <p className="text-[10px] text-gray-400 mt-1.5 leading-tight">
                                                {t.dt_use_product_ref}
                                            </p>
                                        </div>
                                    )}

                                    {selectedProductId && productImages.length === 0 && (
                                        <div className="mt-2 text-xs text-red-400 flex items-center gap-1">
                                            <AlertCircle size={12}/> {t.dt_no_product_images}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="mt-2">
                                    <div 
                                        onClick={() => manualProductInputRef.current?.click()}
                                        className="border-2 border-dashed border-gray-300 rounded-lg p-4 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-colors h-40"
                                    >
                                        {manualProductImage ? (
                                            <div className="relative w-full h-full">
                                                <img src={manualProductImage.preview} className="w-full h-full object-contain" />
                                                <button 
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setManualProductImage(null);
                                                        if (manualProductInputRef.current) manualProductInputRef.current.value = '';
                                                    }}
                                                    className="absolute top-0 right-0 bg-white rounded-full p-1 shadow-sm hover:bg-red-50 text-gray-500 hover:text-red-500"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        ) : (
                                            <>
                                                <UploadCloud size={24} className="text-gray-400 mb-2" />
                                                <span className="text-xs font-medium text-gray-500">{t.dt_upload_product_image}</span>
                                            </>
                                        )}
                                        <input 
                                            type="file" 
                                            ref={manualProductInputRef}
                                            className="hidden" 
                                            accept="image/*"
                                            onChange={handleManualProductUpload}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                        )}

                        {/* Remix Assets */}
                        {mode === 'remix' && (
                            <div className="space-y-4">
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Remix Assets</label>
                                
                                {/* Products */}
                                <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-[10px] font-bold text-gray-600 uppercase">Products (Multiple)</span>
                                        <label className="cursor-pointer text-[10px] bg-white border border-gray-200 px-2 py-1 rounded hover:bg-gray-50">
                                            Add
                                            <input type="file" multiple className="hidden" accept="image/*" onChange={e => handleRemixAssetUpload(e, 'product')} />
                                        </label>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {remixAssets.filter(a => a.role === 'product').map(asset => (
                                            <div key={asset.id} className="relative w-12 h-12 border border-gray-200 rounded bg-white group">
                                                <img src={asset.preview} className="w-full h-full object-contain p-1" />
                                                <button onClick={() => removeRemixAsset(asset.id)} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100"><X size={10}/></button>
                                                <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[8px] whitespace-nowrap text-gray-500">{asset.label}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Scenario */}
                                <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-[10px] font-bold text-gray-600 uppercase">Scenario (1)</span>
                                        <label className="cursor-pointer text-[10px] bg-white border border-gray-200 px-2 py-1 rounded hover:bg-gray-50">
                                            Upload
                                            <input type="file" className="hidden" accept="image/*" onChange={e => handleRemixAssetUpload(e, 'scenario')} />
                                        </label>
                                    </div>
                                    {remixAssets.find(a => a.role === 'scenario') && (
                                        <div className="relative w-full aspect-video border border-gray-200 rounded bg-white group">
                                            <img src={remixAssets.find(a => a.role === 'scenario')!.preview} className="w-full h-full object-contain p-1" />
                                            <button onClick={() => removeRemixAsset(remixAssets.find(a => a.role === 'scenario')!.id)} className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100"><X size={12}/></button>
                                            <div className="absolute bottom-1 left-1 bg-black/50 text-white text-[10px] px-1 rounded">{remixAssets.find(a => a.role === 'scenario')!.label}</div>
                                        </div>
                                    )}
                                </div>

                                {/* Layout */}
                                <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-[10px] font-bold text-gray-600 uppercase">Layout (1)</span>
                                        <label className="cursor-pointer text-[10px] bg-white border border-gray-200 px-2 py-1 rounded hover:bg-gray-50">
                                            Upload
                                            <input type="file" className="hidden" accept="image/*" onChange={e => handleRemixAssetUpload(e, 'layout')} />
                                        </label>
                                    </div>
                                    {remixAssets.find(a => a.role === 'layout') && (
                                        <div className="relative w-full aspect-video border border-gray-200 rounded bg-white group">
                                            <img src={remixAssets.find(a => a.role === 'layout')!.preview} className="w-full h-full object-contain p-1" />
                                            <button onClick={() => removeRemixAsset(remixAssets.find(a => a.role === 'layout')!.id)} className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100"><X size={12}/></button>
                                            <div className="absolute bottom-1 left-1 bg-black/50 text-white text-[10px] px-1 rounded">{remixAssets.find(a => a.role === 'layout')!.label}</div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Mode Selection */}
                        <div>
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">{t.dt_mode}</label>
                            <div className="grid grid-cols-2 gap-2">
                                <button 
                                    onClick={() => setMode('resize')}
                                    className={`py-2 px-1 rounded-lg border text-[10px] font-medium flex flex-col items-center justify-center gap-1 transition-colors ${mode === 'resize' ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                                >
                                    <Maximize2 size={14}/> {t.dt_resize}
                                </button>
                                <button 
                                    onClick={() => setMode('translate')}
                                    className={`py-2 px-1 rounded-lg border text-[10px] font-medium flex flex-col items-center justify-center gap-1 transition-colors ${mode === 'translate' ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                                >
                                    <Type size={14}/> {t.dt_translate}
                                </button>
                                <button 
                                    onClick={() => setMode('reimagine')}
                                    className={`py-2 px-1 rounded-lg border text-[10px] font-medium flex flex-col items-center justify-center gap-1 transition-colors ${mode === 'reimagine' ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                                >
                                    <Sparkles size={14}/> {t.dt_reimagine}
                                </button>
                                <button 
                                    onClick={() => setMode('remix')}
                                    className={`py-2 px-1 rounded-lg border text-[10px] font-medium flex flex-col items-center justify-center gap-1 transition-colors ${mode === 'remix' ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                                >
                                    <Box size={14}/> Remix
                                </button>
                            </div>
                            {mode === 'reimagine' && (
                                <p className="text-[10px] text-gray-500 mt-2 leading-tight bg-blue-50 p-2 rounded border border-blue-100">
                                    {t.dt_reimagine_desc}
                                </p>
                            )}
                            {mode === 'remix' && (
                                <p className="text-[10px] text-gray-500 mt-2 leading-tight bg-blue-50 p-2 rounded border border-blue-100">
                                    Combine multiple products, a scenario, and a layout into a new image.
                                </p>
                            )}
                        </div>

                        {/* Reimagine Specific Controls */}
                        {mode === 'reimagine' && (
                            <>
                                <div className="space-y-4 pt-4 border-t border-gray-100">
                                    <div>
                                        <div className="flex justify-between text-xs font-bold text-gray-500 uppercase mb-1">
                                            <span>{t.dt_layout_variance}</span>
                                            <span>{reimagineConfig.layoutVariance}%</span>
                                        </div>
                                        <input 
                                            type="range" 
                                            min="0" max="100" 
                                            value={reimagineConfig.layoutVariance} 
                                            onChange={(e) => setReimagineConfig({...reimagineConfig, layoutVariance: parseInt(e.target.value)})} 
                                            className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer" 
                                        />
                                        <p className="text-[10px] text-gray-400 mt-1">{t.dt_preserve_hierarchy}</p>
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-xs font-bold text-gray-500 uppercase mb-1">
                                            <span>{t.dt_content_variance}</span>
                                            <span>{reimagineConfig.contentVariance}%</span>
                                        </div>
                                        <input 
                                            type="range" 
                                            min="0" max="100" 
                                            value={reimagineConfig.contentVariance} 
                                            onChange={(e) => setReimagineConfig({...reimagineConfig, contentVariance: parseInt(e.target.value)})} 
                                            className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer" 
                                        />
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-xs font-bold text-gray-500 uppercase mb-1">
                                            <span>{t.dt_model_variance}</span>
                                            <span>{reimagineConfig.modelVariance}%</span>
                                        </div>
                                        <input 
                                            type="range" 
                                            min="0" max="100" 
                                            value={reimagineConfig.modelVariance} 
                                            onChange={(e) => setReimagineConfig({...reimagineConfig, modelVariance: parseInt(e.target.value)})} 
                                            className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer" 
                                        />
                                    </div>
                                </div>
                            </>
                        )}

                        {/* Model Selection */}
                        <div>
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">{t.dt_model}</label>
                            <select 
                                value={selectedModel}
                                onChange={(e) => setSelectedModel(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500 outline-none"
                            >
                                {MODELS.map(m => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                            </select>
                        </div>

                        {/* Resize or Reimagine Specific Controls */}
                        {(mode === 'resize' || mode === 'reimagine' || mode === 'remix') && (
                            <>
                                <div>
                                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">{t.dt_aspect_ratio}</label>
                                    <div className="flex flex-wrap gap-2">
                                        {ASPECT_RATIOS.map(ratio => (
                                            <button
                                                key={ratio}
                                                onClick={() => setAspectRatio(ratio)}
                                                className={`px-3 py-1.5 rounded border text-xs font-medium transition-colors ${aspectRatio === ratio ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                                            >
                                                {ratio}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}

                        {/* Translate Specific Controls */}
                        {mode === 'translate' && (
                            <div>
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">{t.dt_target_lang}</label>
                                <select 
                                    value={targetLanguage}
                                    onChange={(e) => setTargetLanguage(e.target.value)}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500 outline-none"
                                >
                                    {TARGET_LANGUAGES.map(lang => (
                                        <option key={lang} value={lang}>{lang}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Resolution */}
                        <div>
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">{t.dt_resolution}</label>
                            <div className="flex gap-2">
                                {RESOLUTIONS.map(res => (
                                    <button
                                        key={res}
                                        onClick={() => setResolution(res)}
                                        className={`flex-1 py-1.5 rounded border text-xs font-medium transition-colors ${resolution === res ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                                    >
                                        {res}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Custom Prompt */}
                        <div>
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">{t.dt_instructions}</label>
                            
                            {mode === 'remix' && remixAssets.length > 0 && (
                                <div className="mb-3">
                                    <div className="text-[10px] text-gray-500 mb-1.5 flex items-center justify-between">
                                        <span>Available Assets</span>
                                        <span className="text-gray-400">Click or drag to insert</span>
                                    </div>
                                    <div className="flex flex-wrap gap-x-2 gap-y-4 pb-2">
                                        {remixAssets.map(asset => (
                                            <div 
                                                key={asset.id} 
                                                className="relative w-8 h-8 border border-gray-200 rounded bg-white cursor-grab active:cursor-grabbing hover:border-indigo-300 transition-colors"
                                                draggable
                                                onDragStart={(e) => {
                                                    e.dataTransfer.setData('text/plain', ` ${asset.label} `);
                                                }}
                                                onClick={() => {
                                                    setCustomPrompt(prev => prev + (prev ? ' ' : '') + asset.label + ' ');
                                                }}
                                                title={`Click or drag to insert ${asset.label}`}
                                            >
                                                <img src={asset.preview} className="w-full h-full object-contain p-0.5" />
                                                <div className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 text-[7px] whitespace-nowrap text-gray-500">{asset.label}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <textarea 
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500 outline-none resize-none"
                                rows={3}
                                placeholder={mode === 'remix' ? "Drag and drop images here to reference them inline..." : "E.g., Make the background more vibrant..."}
                                value={customPrompt}
                                onChange={(e) => setCustomPrompt(e.target.value)}
                                onDrop={handleTextareaDrop}
                                onDragOver={(e) => e.preventDefault()}
                            />
                            {mode === 'remix' && remixAssets.filter(a => a.role === 'inline').length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {remixAssets.filter(a => a.role === 'inline').map(asset => (
                                        <div key={asset.id} className="relative w-10 h-10 border border-gray-200 rounded bg-white group">
                                            <img src={asset.preview} className="w-full h-full object-contain p-1" />
                                            <button onClick={() => removeRemixAsset(asset.id)} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100"><X size={10}/></button>
                                            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[8px] whitespace-nowrap text-gray-500">{asset.label}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Action Button */}
                        <button 
                            onClick={() => processImages()}
                            disabled={(mode !== 'remix' && images.length === 0) || (mode === 'remix' && remixAssets.length === 0) || isProcessingBatch}
                            className="w-full bg-gradient-to-r from-rose-600 to-pink-600 text-white py-3 rounded-xl font-bold shadow-md hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {isProcessingBatch ? <Loader2 size={18} className="animate-spin"/> : <Sparkles size={18}/>}
                            {isProcessingBatch ? t.dt_generating : t.dt_generate}
                        </button>
                    </div>
                </div>

                {/* Main Content - Image Grid */}
                <div className="flex-1 flex flex-col h-full overflow-hidden relative">
                    {showHistory ? (
                        <div className="absolute inset-0 bg-slate-50 z-20 flex flex-col">
                            <div className="bg-white border-b border-gray-200 p-4 flex justify-between items-center shrink-0">
                                <div className="flex items-center gap-4">
                                    <button 
                                        onClick={() => setShowHistory(false)}
                                        className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
                                    >
                                        <ChevronLeft size={16}/> Back
                                    </button>
                                    <h2 className="text-lg font-bold text-gray-900">Generation History</h2>
                                </div>
                                <button 
                                    onClick={async () => {
                                        if (confirm("Are you sure you want to clear all history?")) {
                                            await clearHistory();
                                            setHistoryItems([]);
                                        }
                                    }}
                                    className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors"
                                >
                                    <Trash2 size={16}/> Clear All
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                                {historyItems.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-gray-400">
                                        <History size={48} className="mb-4 opacity-20"/>
                                        <p>No history found.</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                        {historyItems.map(item => (
                                            <div key={item.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm flex flex-col">
                                                <div className="p-3 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                                                    <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">{item.mode}</span>
                                                    <span className="text-[10px] text-gray-400">{new Date(item.timestamp).toLocaleString()}</span>
                                                </div>
                                                <div className="relative aspect-square bg-gray-100 border-b border-gray-100">
                                                    <img src={item.originalImage} className="w-full h-full object-contain p-2" />
                                                    <div className="absolute top-2 left-2 bg-black/50 text-white text-[10px] px-2 py-1 rounded backdrop-blur-sm">Original</div>
                                                </div>
                                                <div className="relative aspect-square bg-gray-50 flex items-center justify-center">
                                                    <img 
                                                        src={item.resultImage} 
                                                        className="w-full h-full object-contain p-2 cursor-zoom-in" 
                                                        onClick={() => setLightboxUrl(item.resultImage)}
                                                    />
                                                    <div className="absolute top-2 left-2 bg-green-500/90 text-white text-[10px] px-2 py-1 rounded backdrop-blur-sm flex items-center gap-1">
                                                        <CheckCircle size={10}/> Generated
                                                    </div>
                                                    <button 
                                                        onClick={async () => {
                                                            await deleteHistoryItem(item.id);
                                                            setHistoryItems(prev => prev.filter(i => i.id !== item.id));
                                                        }}
                                                        className="absolute top-2 right-2 bg-white/90 hover:bg-red-50 text-gray-700 hover:text-red-600 p-1.5 rounded shadow-sm transition-colors z-10"
                                                        title="Delete"
                                                    >
                                                        <Trash2 size={14}/>
                                                    </button>
                                                </div>
                                                {item.prompt && (
                                                    <div className="p-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-600 line-clamp-2" title={item.prompt}>
                                                        {item.prompt}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                    <>
                    {/* Toolbar */}
                    <div className="bg-white border-b border-gray-200 p-4 flex justify-between items-center shrink-0">
                        <div className="flex items-center gap-4">
                            {mode !== 'remix' && (
                                <button 
                                    onClick={() => fileInputRef.current?.click()}
                                    className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
                                >
                                    <UploadCloud size={16}/> {t.dt_upload}
                                    <input 
                                        type="file" 
                                        ref={fileInputRef} 
                                        className="hidden" 
                                        multiple 
                                        accept="image/*"
                                        onChange={handleFileUpload}
                                    />
                                </button>
                            )}
                            <span className="text-sm text-gray-500">{images.length} {mode === 'remix' ? 'Generated' : t.dt_selected}</span>
                        </div>
                        
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setShowHistory(true)}
                                className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 border border-gray-200 rounded-lg text-sm font-bold hover:bg-gray-200 transition-colors"
                            >
                                <History size={16}/> History
                            </button>
                            {images.some(img => img.status === 'success') && (
                                <button 
                                    onClick={downloadAll}
                                    className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-sm font-bold hover:bg-indigo-100 transition-colors"
                                >
                                    <Download size={16}/> {t.dt_download_all}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Grid */}
                    <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                        {images.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-gray-400">
                                <ImageIcon size={48} className="mb-4 opacity-20"/>
                                <p>{mode === 'remix' ? "Add Remix Assets and click Generate" : t.dt_empty_state}</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                {images.map(img => (
                                    <div key={img.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm flex flex-col">
                                        {/* Original */}
                                        <div className="relative aspect-square bg-gray-100 border-b border-gray-100">
                                            <img src={img.preview || undefined} className="w-full h-full object-contain p-2" />
                                            <div className="absolute top-2 left-2 bg-black/50 text-white text-[10px] px-2 py-1 rounded backdrop-blur-sm">{t.dt_original}</div>
                                            <button 
                                                onClick={() => removeImage(img.id)}
                                                className="absolute top-2 right-2 bg-white/80 hover:bg-white text-gray-600 p-1 rounded-full shadow-sm transition-colors"
                                            >
                                                <X size={14}/>
                                            </button>
                                        </div>
                                        
                                        {/* Result */}
                                        <div className="relative aspect-square bg-gray-50 flex items-center justify-center">
                                            {img.status === 'pending' && <span className="text-xs text-gray-400">{t.dt_ready}</span>}
                                            {img.status === 'processing' && (
                                                <div className="flex flex-col items-center text-indigo-500">
                                                    <Loader2 size={24} className="animate-spin mb-2"/>
                                                    <span className="text-xs font-medium">{t.dt_generating}</span>
                                                </div>
                                            )}
                                            {img.status === 'error' && (
                                                <div className="flex flex-col items-center text-red-500 p-4 text-center">
                                                    <AlertCircle size={24} className="mb-2"/>
                                                    <span className="text-xs">{img.errorMsg}</span>
                                                </div>
                                            )}
                                            {img.status === 'success' && img.resultUrl && (
                                                <>
                                                    <img 
                                                        src={img.resultUrl || undefined} 
                                                        className="w-full h-full object-contain p-2 cursor-zoom-in" 
                                                        onClick={() => setLightboxUrl(img.resultUrl!)}
                                                    />
                                                    <div className="absolute top-2 left-2 bg-green-500/90 text-white text-[10px] px-2 py-1 rounded backdrop-blur-sm flex items-center gap-1">
                                                        <CheckCircle size={10}/> {t.dt_generated}
                                                    </div>
                                                    <button
                                                        onClick={() => processImages(img.id)}
                                                        disabled={isProcessingBatch}
                                                        className="absolute top-2 right-10 bg-white/90 hover:bg-white text-gray-700 p-1.5 rounded shadow-sm transition-colors z-10 disabled:opacity-50"
                                                        title="Regenerate"
                                                    >
                                                        <RefreshCw size={14}/>
                                                    </button>
                                                    {img.debugPayload && (
                                                        <button 
                                                            onClick={() => setDebugModalPayload(img.debugPayload)}
                                                            className="absolute top-2 right-2 bg-white/90 hover:bg-white text-gray-700 p-1.5 rounded shadow-sm transition-colors z-10"
                                                            title="Debug Payload"
                                                        >
                                                            <Bug size={14}/>
                                                        </button>
                                                    )}
                                                    <button 
                                                        onClick={() => {
                                                            const a = document.createElement('a');
                                                            a.href = img.resultUrl!;
                                                            a.download = `processed_${img.id}.jpeg`;
                                                            a.click();
                                                        }}
                                                        className="absolute bottom-2 right-2 bg-white/90 hover:bg-white text-gray-700 p-1.5 rounded-lg shadow-sm transition-colors"
                                                        title="Download"
                                                    >
                                                        <Download size={14}/>
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    </>
                    )}
                </div>
            </div>

            {/* Lightbox */}
            {lightboxUrl && (
                <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-8 animate-fade-in-up" onClick={() => setLightboxUrl(null)}>
                    <button className="absolute top-6 right-6 text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors">
                        <X size={32} />
                    </button>
                    <img src={lightboxUrl || undefined} className="max-w-full max-h-full object-contain rounded shadow-2xl" onClick={(e) => e.stopPropagation()}/>
                </div>
            )}
            {/* Debug Modal */}
            {debugModalPayload && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
                        <div className="flex items-center justify-between p-4 border-b border-gray-100">
                            <h3 className="font-bold text-gray-900 flex items-center gap-2">
                                <Bug size={18} className="text-indigo-600"/> Debug Payload
                            </h3>
                            <button onClick={() => setDebugModalPayload(null)} className="text-gray-400 hover:text-gray-600">
                                <X size={20}/>
                            </button>
                        </div>
                        <div className="p-4 overflow-y-auto custom-scrollbar flex-1 bg-gray-50">
                            <pre className="text-xs font-mono text-gray-800 whitespace-pre-wrap break-words">
                                {JSON.stringify(debugModalPayload, null, 2)}
                            </pre>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
