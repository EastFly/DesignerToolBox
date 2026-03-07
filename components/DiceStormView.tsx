
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { Zap, Plus, Trash2, X, Maximize2, Loader2, Dices, ChevronRight, ChevronLeft, Image as ImageIcon, Box, LayoutTemplate, Sun, Scaling, Ban, Type, Sparkles, History, Check, Tag, Clock, Download, Save, CheckCircle2, Moon, Settings, Globe, PenTool, FileJson, Info } from 'lucide-react';
import { Product, StyleDice, User, DiceMetadata, GenConfig, AssetMetadata, MidnightMission, ExecutionUnit } from '../types';
import { db } from '../services/db';
import { translations, Language } from '../i18n';
import { ProductSelector } from './ProductSelector';
import { format } from 'date-fns';

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

interface DiceStormViewProps {
    language: Language;
    currentUser: User | null;
    canManageGlobalDice: boolean;
}

// Result Item for History
interface StormResult {
    id: string;
    url: string;
    timestamp: Date;
}

// Slot represents a "Card" in the Storm deck
interface DiceSlot {
    id: string; // Unique ID for the slot
    diceId: string; // Original Dice ID
    name: string;
    
    // Config Overrides
    config: GenConfig; 
    
    // Advanced Prompts
    template: string; 
    localPrompt?: string; // New: Local context for this specific slot
    negativePrompt?: string; // New: Full negative prompt support
    styleDirectives?: {      // New: Structured directives support
        textRendering?: string;
        featureHighlight?: string;
        compositionRules?: string;
    };
    structuredPrompt?: {
        environment?: string;
        lighting?: string;
        composition?: string;
    };

    referenceUrls?: {
        layout?: string;
        style?: string;
    };
    
    status: 'idle' | 'pending' | 'success' | 'error';
    errorMsg?: string;

    // Context Overrides (Initialized from Dice Metadata, editable per slot)
    activeProductImageIndex: number; 
    activeSellingPoints: string[];
    
    // Result History
    history: StormResult[];
}

// Selection Item
interface SelectedItem {
    url: string;
    diceName: string;
    slotId: string;
}

const SUPPORTED_LANGUAGES = [
    { value: 'English (US)', label: 'English (US)' },
    { value: 'Chinese (Simplified)', label: 'Chinese (中文)' },
    { value: 'Japanese', label: 'Japanese (日本語)' },
    { value: 'German', label: 'German (Deutsch)' },
    { value: 'French', label: 'French (Français)' },
    { value: 'Spanish', label: 'Spanish (Español)' },
    { value: 'Korean', label: 'Korean (한국어)' }
];

const FONT_STYLES = [
    { value: 'Modern Sans-Serif', label: 'Modern Sans' },
    { value: 'Elegant Serif', label: 'Elegant Serif' },
    { value: 'Bold Industrial', label: 'Bold Industrial' },
    { value: 'Handwritten Script', label: 'Handwritten' },
    { value: 'Tech Futuristic', label: 'Tech / Sci-Fi' },
    { value: 'Playful Rounded', label: 'Playful / Kids' }
];

// Helper to convert URL to Base64 (Same as Playground)
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

import { getApiKey } from '../services/geminiService';

export const DiceStormView: React.FC<DiceStormViewProps> = ({ language, currentUser, canManageGlobalDice }) => {
    const t = translations[language];
    
    // Data State
    const [products, setProducts] = useState<Product[]>([]);
    const [allDices, setAllDices] = useState<StyleDice[]>([]);
    
    // Selection State
    const [selectedProductId, setSelectedProductId] = useState<string>('');
    const [globalPrompt, setGlobalPrompt] = useState('');
    
    // Storm State
    const [slots, setSlots] = useState<DiceSlot[]>([]);
    const [isStorming, setIsStorming] = useState(false);
    const [isQueuingMission, setIsQueuingMission] = useState(false);
    
    // Batch Selection State (Set of URLs)
    const [selectedItems, setSelectedItems] = useState<Map<string, SelectedItem>>(new Map()); // Key: URL
    const [isSavingToProduct, setIsSavingToProduct] = useState(false);
    
    // UI State
    const [showDicePicker, setShowDicePicker] = useState(false);
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
    const [editingSlotId, setEditingSlotId] = useState<string | null>(null); // New: Modal for Slot Config

    // Initial Load
    useEffect(() => {
        db.getProducts().then(setProducts);
        db.getStyleDice(canManageGlobalDice).then(setAllDices);
    }, [canManageGlobalDice]);

    // Helper: Get all available images for the selected product
    const getProductContext = () => {
        const product = products.find(p => p.id === selectedProductId);
        if (!product) return { images: [], sellingPoints: [] };

        // Images
        const images: string[] = [];
        const syncedImg = product.data['productImage'];
        if (Array.isArray(syncedImg)) images.push(...syncedImg);
        else if (typeof syncedImg === 'string' && syncedImg) images.push(syncedImg);
        const gallery = product.data['galleryImages'];
        if (Array.isArray(gallery)) images.push(...gallery);
        
        const uniqueImages = Array.from(new Set(images.filter(url => typeof url === 'string' && url.trim() !== '')));

        // Selling Points
        let points: string[] = [];
        const rawPoints = product.data['sellingPoints'];
        if (Array.isArray(rawPoints)) {
            points = rawPoints.map(p => typeof p === 'string' ? p : p.text).filter(Boolean);
        }

        return { images: uniqueImages, sellingPoints: points };
    };

    const { images: productImages, sellingPoints: productSellingPoints } = getProductContext();

    // --- Actions ---

    const handleAddSlot = (dice: StyleDice) => {
        let meta: DiceMetadata = { tags: [], config: { aspectRatio: '1:1', allowText: false, resolution: '1K' } };
        try {
            if (dice.description) meta = JSON.parse(dice.description);
        } catch (e) { console.error("Parse Dice Error", e); }

        // Initialize Slot Preferences based on Dice Metadata + Current Product Context
        let initialImageIndex = 0;
        if (meta.productImageIndex !== undefined && productImages[meta.productImageIndex]) {
            initialImageIndex = meta.productImageIndex;
        }

        let initialSellingPoints: string[] = [];
        if (meta.selectedSellingPointIndices && productSellingPoints.length > 0) {
            initialSellingPoints = meta.selectedSellingPointIndices
                .map(idx => productSellingPoints[idx])
                .filter(Boolean);
        }

        const newSlot: DiceSlot = {
            id: `slot-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            diceId: dice.id,
            name: dice.name,
            config: meta.config || { aspectRatio: '1:1', allowText: false, resolution: '1K' },
            template: dice.template,
            negativePrompt: meta.negativePrompt, // Load advanced fields
            styleDirectives: meta.styleDirectives,
            structuredPrompt: meta.structuredPrompt,
            referenceUrls: meta.referenceUrls,
            status: 'idle',
            activeProductImageIndex: initialImageIndex,
            activeSellingPoints: initialSellingPoints,
            history: []
        };

        setSlots(prev => [...prev, newSlot]);
        setShowDicePicker(false);
    };

    const handleRemoveSlot = (slotId: string) => {
        setSlots(prev => prev.filter(s => s.id !== slotId));
    };

    const updateSlot = (slotId: string, updates: Partial<DiceSlot>) => {
        setSlots(prev => prev.map(s => s.id === slotId ? { ...s, ...updates } : s));
    };

    // Slot Modification Handlers
    const cycleSlotImage = (slotId: string, direction: -1 | 1) => {
        if (productImages.length === 0) return;
        setSlots(prev => prev.map(slot => {
            if (slot.id !== slotId) return slot;
            let newIndex = slot.activeProductImageIndex + direction;
            if (newIndex < 0) newIndex = productImages.length - 1;
            if (newIndex >= productImages.length) newIndex = 0;
            return { ...slot, activeProductImageIndex: newIndex };
        }));
    };

    const toggleSlotSellingPoint = (slotId: string, point: string) => {
        setSlots(prev => prev.map(slot => {
            if (slot.id !== slotId) return slot;
            const exists = slot.activeSellingPoints.includes(point);
            return {
                ...slot,
                activeSellingPoints: exists 
                    ? slot.activeSellingPoints.filter(p => p !== point)
                    : [...slot.activeSellingPoints, point]
            };
        }));
    };

    // --- SELECTION HANDLERS ---
    const toggleSelection = (url: string, diceName: string, slotId: string) => {
        const newMap = new Map(selectedItems);
        if (newMap.has(url)) {
            newMap.delete(url);
        } else {
            newMap.set(url, { url, diceName, slotId });
        }
        setSelectedItems(newMap);
    };

    // --- BATCH ACTIONS ---
    const handleBatchDownload = async () => {
        if (selectedItems.size === 0) return;
        
        for (const [url, item] of Array.from(selectedItems.entries()) as [string, SelectedItem][]) {
            try {
                const response = await fetch(url);
                const blob = await response.blob();
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                // Naming: Product_DiceStyle_Timestamp
                const product = products.find(p => p.id === selectedProductId);
                const filename = `${product?.sku || 'Product'}_${item.diceName.replace(/\s+/g, '-')}_${Date.now()}.png`;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                // Slight delay to prevent browser throttling
                await new Promise(r => setTimeout(r, 200));
            } catch (e) {
                console.error("Download failed for", url, e);
            }
        }
    };

    const handleSaveToProduct = async () => {
        if (selectedItems.size === 0 || !selectedProductId) return;
        setIsSavingToProduct(true);

        try {
            // 1. Fetch Fresh Product Data
            const product = await db.getProducts().then(list => list.find(p => p.id === selectedProductId));
            if (!product) throw new Error("Product not found");

            // 2. Prepare Data
            const currentAssets = (product.data.assets as string[]) || []; 
            const newUrls: string[] = [];
            const newMetadata: Record<string, AssetMetadata> = { ...(product.data.assetMetadata || {}) };

            // Process sequentially to upload files if they are Base64
            for (const item of Array.from(selectedItems.values()) as SelectedItem[]) {
                let finalUrl = item.url;

                // Detect Data URI and Upload to Storage
                if (item.url.startsWith('data:')) {
                    try {
                        const res = await fetch(item.url);
                        const blob = await res.blob();
                        const filename = `dice_${item.diceName.replace(/\s+/g, '_')}_${Date.now()}.png`;
                        const file = new File([blob], filename, { type: 'image/png' });
                        // Upload returns a clean URL with extension (e.g., .../xyz.png)
                        finalUrl = await db.uploadFile(file);
                    } catch (uploadErr) {
                        console.error("Failed to upload image, skipping", uploadErr);
                        continue; 
                    }
                }

                if (!currentAssets.includes(finalUrl) && !newUrls.includes(finalUrl)) {
                    newUrls.push(finalUrl);
                }
                
                // Add Metadata with special Dice Source
                newMetadata[finalUrl] = {
                    source: 'ai',
                    timestamp: new Date(),
                    model: 'dice_storm',
                    prompt: `Dice Style: ${item.diceName}` // Storing Dice Name here for visibility in Asset Manager
                };
            }

            // 3. Update Product
            const updatedProduct = {
                ...product,
                data: {
                    ...product.data,
                    assets: [...currentAssets, ...newUrls], // Save to Assets
                    assetMetadata: newMetadata 
                },
                updatedAt: new Date()
            };

            await db.saveProduct(updatedProduct);
            
            // 4. Update Local State
            setProducts(prev => prev.map(p => p.id === updatedProduct.id ? updatedProduct : p));
            alert(t.ds_saved_assets_success.replace('{count}', newUrls.length.toString()).replace('{sku}', product.sku || 'Product'));
            setSelectedItems(new Map()); // Clear selection

        } catch (e) {
            console.error("Save to product failed", e);
            alert(t.ds_save_fail);
        } finally {
            setIsSavingToProduct(false);
        }
    };

    // --- HELPER: 2-STEP PROMPT GENERATION (PLAN -> BUILD) ---
    const generateDetailedPrompt = async (slot: DiceSlot, product: Product, activeImgUrl: string | undefined, ai: GoogleGenAI) => {
        // 1. Prepare Context
        const sellingPointsContext = slot.activeSellingPoints.length > 0 
            ? `KEY FEATURES TO HIGHLIGHT: \n- ${slot.activeSellingPoints.join('\n- ')}` 
            : "No specific features selected.";

        const systemPrompt = `You are an expert AI Art Director for E-commerce.
        Your goal is to plan a high-quality product render based on the user's request and the provided references.
        
        CONTEXT:
        - Product Reference: ${activeImgUrl ? 'PROVIDED (Use this visual as the absolute source of truth for the product)' : 'MISSING'}
        - ${sellingPointsContext}
        - Layout Reference: ${slot.referenceUrls?.layout ? 'PROVIDED (Use this for strict composition, framing, and UI layout)' : 'None'}
        - Style/Lighting Reference: ${slot.referenceUrls?.style ? 'PROVIDED (Use this for mood/lighting)' : 'None'}
        ${slot.structuredPrompt?.environment ? `- Pre-defined Environment: ${slot.structuredPrompt.environment}` : ''}
        ${slot.structuredPrompt?.lighting ? `- Pre-defined Lighting: ${slot.structuredPrompt.lighting}` : ''}
        ${slot.structuredPrompt?.composition ? `- Pre-defined Composition: ${slot.structuredPrompt.composition}` : ''}
        
        TASK:
        Analyze the user's request. Break down the visual description into 4 distinct structural components:
        1. **Subject**: Detailed description of the product based on its features.
        2. **Environment**: The background, setting, or scene. (Use Pre-defined Environment if provided, adapt if user request overrides).
        3. **Lighting**: The type of light, shadows, and mood. (Use Pre-defined Lighting if provided, adapt if user request overrides).
        4. **Composition**: The camera angle, framing, spatial arrangement, and specific layout of structural elements (like text boxes, feature callouts, or frames). (Use Pre-defined Composition if provided, adapt if user request overrides).
        
        IMPORTANT:
        - Incorporate the "Key Features" into the 'Subject' or 'Lighting' description where appropriate.
        - If Layout Reference exists, meticulously describe its spatial layout, including exactly where text, feature callouts, and structural frames are positioned.
        - If Style Reference exists, explicitly describe that mood in 'Lighting'/'Environment'.

        OUTPUT FORMAT:
        Return a JSON object strictly. Do not include markdown code blocks if possible, or wrap in \`\`\`json.
        {
          "thought": "Brief strategy...",
          "structured": {
              "subject": "...",
              "environment": "...",
              "lighting": "...",
              "composition": "..."
          }
        }`;

        let basePrompt = slot.template.replace(/{{subject}}|{{product}}/gi, `the ${product.name}`);
        const userRequest = [basePrompt, globalPrompt, slot.localPrompt].filter(Boolean).join('. ');

        const planResponse = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: [
                { role: 'user', parts: [{ text: systemPrompt }] },
                { role: 'user', parts: [{ text: userRequest }] }
            ],
            config: { responseMimeType: 'application/json' }
        });

        const cleanJson = (planResponse.text || '{}').replace(/```json|```/g, '').trim();
        let structure = { subject: userRequest, environment: '', lighting: '', composition: '' };
        try {
            const parsed = JSON.parse(cleanJson);
            if (parsed.structured) structure = parsed.structured;
        } catch (e) {
            console.error("Failed to parse plan", e);
        }

        // 2. Build Final Prompt
        let featuresText = "";
        let negativePrompt = slot.negativePrompt || ""; 
        
        if (!slot.config.allowText) {
            negativePrompt += " text, writing, letters, words, watermark, signature, typography, label";
        } else {
            // CRITICAL: Scrub anti-text words from the inherited negative prompt
            negativePrompt = negativePrompt.replace(/text|writing|letters|words|watermark|signature|typography|label/gi, '').replace(/,\s*,/g, ',').trim();
        }

        if (slot.activeSellingPoints.length > 0) {
            const pointsList = slot.activeSellingPoints.map(p => `"${p}"`).join(', ');
            
            if (slot.config.allowText) {
                const targetLang = slot.config.targetLanguage || 'English (US)';
                const fontStyle = slot.config.fontStyle || 'Modern Sans-Serif';
                
                featuresText = `
                **MANDATORY TEXT RENDER**: 
                You must visually render the following text strings into the scene: ${pointsList}.
                CRITICAL LOCALIZATION RULES:
                1. **Target Language**: Translate text into **${targetLang}** before rendering.
                2. **Typography**: Use a **${fontStyle}** font style.
                `;
            } else {
                featuresText = `
                **FEATURE VISUALIZATION (NO TEXT)**:
                Do NOT write any text. Instead, visually demonstrate these features: ${pointsList}.
                Example: If "Waterproof", show water droplets.
                `;
            }
        } else if (slot.config.allowText) {
            featuresText = `
            **TEXT RENDER ALLOWED**: 
            You are permitted and encouraged to render text, typography, and labels if requested in the scene description.
            `;
        }

        let styleDirectiveText = "";
        if (slot.styleDirectives) {
            if (slot.styleDirectives.textRendering) styleDirectiveText += `\nText Rules: ${slot.styleDirectives.textRendering}`;
            if (slot.styleDirectives.featureHighlight) styleDirectiveText += `\nFeature Rules: ${slot.styleDirectives.featureHighlight}`;
            if (slot.styleDirectives.compositionRules) styleDirectiveText += `\nComposition: ${slot.styleDirectives.compositionRules}`;
        }

        const productReferenceInstruction = activeImgUrl 
            ? "CRITICAL RULE 1 (SUBJECT): The 'Product Reference' image is the ONLY source of truth for the subject. You MUST accurately extract and render this exact product. Maintain its exact shape, color, branding, materials, and details. DO NOT use the product from the layout or style references."
            : "";

        const layoutConsistency = slot.config.layoutConsistency ?? 100;
        const frameShapeVariance = slot.config.frameShapeVariance ?? 0;
        const layoutVariance = slot.config.layoutVariance ?? 0;
        const styleVariance = slot.config.styleVariance ?? 0;

        let layoutInstruction = "";
        if (slot.referenceUrls?.layout) {
            if (layoutConsistency > 80) {
                layoutInstruction = "CRITICAL RULE 2 (COMPOSITION): You MUST strictly follow the 'Composition Reference' for the structural layout, camera angle, and spatial balance. It is crucial to maintain the exact placement of any detail frames, text boxes, feature callouts, or structural elements shown in the layout reference. Place the 'Product Reference' exactly where the main subject is in the layout reference.";
            } else if (layoutConsistency > 40) {
                layoutInstruction = "CRITICAL RULE 2 (COMPOSITION): Use the 'Composition Reference' as a strong guide for the structural layout. You can slightly adapt the placement of frames and text boxes to better fit the product, but maintain the overall spatial balance.";
            } else {
                layoutInstruction = "CRITICAL RULE 2 (COMPOSITION): Use the 'Composition Reference' loosely for inspiration. Feel free to completely reimagine the layout, camera angle, and placement of elements while keeping the general vibe.";
            }

            if (frameShapeVariance > 50) {
                layoutInstruction += " For any frames, text boxes, or callouts shown in the layout reference, creatively alter their shapes (e.g., make square frames rounded, elliptical, or organic). Do NOT use the exact shapes from the reference.";
            } else if (frameShapeVariance > 20) {
                layoutInstruction += " You may slightly soften or alter the shapes of frames and text boxes compared to the layout reference.";
            } else {
                layoutInstruction += " Strictly preserve the exact geometric shapes of all frames, text boxes, and callouts from the layout reference.";
            }

            if (layoutVariance > 50) {
                layoutInstruction += " You are encouraged to dynamically rearrange the background elements and secondary frames to create a more dynamic composition, completely changing their relative positions.";
            } else if (layoutVariance > 20) {
                layoutInstruction += " You can slightly shift the background elements and secondary frames for better visual flow.";
            } else {
                layoutInstruction += " Do not change the relative positions of background elements and secondary frames.";
            }
        }

        let styleInstruction = "";
        if (slot.referenceUrls?.style) {
            if (styleVariance > 70) {
                styleInstruction = "CRITICAL RULE 3 (STYLE): Use the 'Style Reference' loosely as a starting point. Creatively reinterpret the lighting, color palette, and mood to produce a highly original and surprising environment. IGNORE the product/subject shown in the style reference.";
            } else if (styleVariance > 30) {
                styleInstruction = "CRITICAL RULE 3 (STYLE): Use the 'Style Reference' to define the lighting, color palette, and overall mood. You can adapt these aesthetic qualities to create a fresh environment while maintaining the core vibe. IGNORE the product/subject shown in the style reference.";
            } else {
                styleInstruction = "CRITICAL RULE 3 (STYLE): You MUST strictly replicate the exact lighting setup, color palette, textures, and overall mood of the 'Style Reference'. The atmosphere should feel identical. IGNORE the product/subject shown in the style reference.";
            }
        }

        const finalPrompt = `
        ${productReferenceInstruction}
        ${layoutInstruction}
        ${styleInstruction}
        
        Scene Description:
        Subject Context: ${structure.subject}
        Environment: ${structure.environment}
        Lighting: ${structure.lighting}
        Composition: ${structure.composition}
        
        ${featuresText}
        ${styleDirectiveText}
        
        Instructions: Combine these elements into a high-fidelity, photorealistic e-commerce product render. The Product Reference must be rendered with absolute accuracy. ${slot.referenceUrls?.layout ? (layoutConsistency > 80 ? 'You must strictly preserve the structural layout, framing, and feature callout placements from the Composition Reference.' : 'Adapt the layout creatively based on the Composition Reference.') : ''} Draw artistic inspiration from the Style Reference to define the mood, lighting, and textures, adapting them to build a harmonious scene. ${negativePrompt}
        `;

        return {
            finalPrompt,
            structuredCall: {
                basePrompt: userRequest,
                localPrompt: slot.localPrompt,
                globalPrompt: globalPrompt,
                featuresText,
                styleDirectiveText,
                negativePrompt
            }
        };
    };

    // --- CORE ENGINE: IGNITE STORM (UPDATED V2.15) ---
    const handleIgniteStorm = async () => {
        if (!selectedProductId) {
            alert(t.ds_select_product_first);
            return;
        }
        if (slots.length === 0) {
            alert(t.ds_no_slots);
            return;
        }

        const product = products.find(p => p.id === selectedProductId);
        if (!product) return;

        setIsStorming(true);
        const apiKey = await getApiKey();
        
        if (!apiKey) {
            setIsStorming(false);
            return;
        }
        
        const ai = new GoogleGenAI({ apiKey });

        // Execute Slots Sequentially (To avoid rate limits and better state mgmt)
        for (const slot of slots) {
            // Skip slots that are already running or stuck
            if (slot.status === 'pending') continue;

            setSlots(prev => prev.map(s => s.id === slot.id ? { ...s, status: 'pending', errorMsg: undefined } : s));

            try {
                // 1. Get Specific Product Image for this Slot
                const activeImgUrl = productImages[slot.activeProductImageIndex];
                let productBase64 = "";
                if (activeImgUrl) {
                    productBase64 = await urlToBase64(activeImgUrl);
                } else {
                    // Fallback to first if index invalid
                    if (productImages.length > 0) productBase64 = await urlToBase64(productImages[0]);
                }

                // 2. CONSTRUCT PROMPT (UPDATED LOGIC matching Playground)
                const { finalPrompt } = await generateDetailedPrompt(slot, product, activeImgUrl, ai);

                const parts: any[] = [{ text: finalPrompt }];

                // Add References
                // 1. Product (Subject)
                if (productBase64) {
                    parts.push({ text: "Product Reference (Main Subject):" });
                    parts.push({ inlineData: { mimeType: 'image/jpeg', data: productBase64 } });
                }
                
                // 2. Layout (From Dice Slot Config)
                if (slot.referenceUrls?.layout) {
                    const layoutB64 = await urlToBase64(slot.referenceUrls.layout);
                    if (layoutB64) {
                        parts.push({ text: "Composition Reference:" });
                        parts.push({ inlineData: { mimeType: 'image/jpeg', data: layoutB64 } });
                    }
                }

                // 3. Style (From Dice Slot Config)
                if (slot.referenceUrls?.style) {
                    const styleB64 = await urlToBase64(slot.referenceUrls.style);
                    if (styleB64) {
                        parts.push({ text: "Style Reference:" });
                        parts.push({ inlineData: { mimeType: 'image/jpeg', data: styleB64 } });
                    }
                }

                // Config
                const modelConfig = {
                    imageConfig: { 
                        aspectRatio: slot.config.aspectRatio, 
                        imageSize: slot.config.resolution 
                    }
                };

                const response = await ai.models.generateContent({
                    model: 'gemini-3-pro-image-preview',
                    contents: { parts },
                    config: modelConfig
                });

                // Extract Image
                let outputUrl = '';
                for (const part of response.candidates?.[0]?.content?.parts || []) {
                    if (part.inlineData) {
                        outputUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                        break;
                    }
                }

                if (outputUrl) {
                    const newResult: StormResult = {
                        id: `res-${Date.now()}`,
                        url: outputUrl,
                        timestamp: new Date()
                    };
                    
                    setSlots(prev => prev.map(s => s.id === slot.id ? { 
                        ...s, 
                        status: 'success', 
                        history: [newResult, ...s.history] // Add to history (newest first)
                    } : s));
                } else {
                    throw new Error(t.ds_no_image_generated);
                }

            } catch (e: any) {
                console.error(`Slot ${slot.id} failed`, e);
                setSlots(prev => prev.map(s => s.id === slot.id ? { ...s, status: 'error', errorMsg: e.message } : s));
            }
        }

        setIsStorming(false);
    };

    // --- QUEUE FOR BACKGROUND AGENT (Midnight Mission) ---
    const handleQueueMidnightMission = async () => {
        if (!selectedProductId) {
            alert(t.ds_select_product_first);
            return;
        }
        if (slots.length === 0) {
            alert(t.ds_no_slots);
            return;
        }

        const product = products.find(p => p.id === selectedProductId);
        if (!product) return;

        setIsQueuingMission(true);

        try {
            const apiKey = await getApiKey();
            if (!apiKey) {
                setIsQueuingMission(false);
                return;
            }
            const ai = new GoogleGenAI({ apiKey });

            const tasks: ExecutionUnit[] = [];

            for (const slot of slots) {
                // 1. Get Specific Product Image for this Slot
                const activeImgUrl = productImages[slot.activeProductImageIndex] || productImages[0];

                // 2. CONSTRUCT PROMPT (UPDATED LOGIC matching Ignite Storm)
                const { finalPrompt, structuredCall } = await generateDetailedPrompt(slot, product, activeImgUrl, ai);

                // Collect Reference Images
                const referenceImages: { type: 'product' | 'layout' | 'style'; url: string }[] = [];
                
                if (activeImgUrl) {
                    referenceImages.push({ type: 'product', url: activeImgUrl });
                }
                if (slot.referenceUrls?.layout) {
                    referenceImages.push({ type: 'layout', url: slot.referenceUrls.layout });
                }
                if (slot.referenceUrls?.style) {
                    referenceImages.push({ type: 'style', url: slot.referenceUrls.style });
                }

                tasks.push({
                    slotId: slot.id,
                    diceName: slot.name,
                    model: 'gemini-3-pro-image-preview',
                    prompt: finalPrompt,
                    structuredCall,
                    config: {
                        aspectRatio: slot.config.aspectRatio,
                        imageSize: slot.config.resolution
                    },
                    referenceImages
                });
            }

            const mission: MidnightMission = {
                id: `mm-${Date.now()}`,
                userId: currentUser?.id || 'unknown',
                status: 'pending',
                productName: product.name,
                payload: { tasks },
                createdAt: new Date(),
                updatedAt: new Date()
            };

            await db.createMidnightMission(mission);
            alert(t.mm_mission_queued);
            
        } catch (e: any) {
            console.error("Failed to queue Midnight Mission", e);
            alert(t.mm_queue_fail + ": " + e.message);
        } finally {
            setIsQueuingMission(false);
        }
    };

    // --- SLOT CONFIGURATION MODAL ---
    const renderSlotConfigModal = () => {
        if (!editingSlotId) return null;
        const slot = slots.find(s => s.id === editingSlotId);
        if (!slot) return null;

        return (
            <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in-up">
                <div className="bg-white w-full max-w-2xl rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden border border-gray-200">
                    <div className="p-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                        <h3 className="font-bold text-gray-800 flex items-center gap-2">
                            <Settings size={18} className="text-indigo-600"/> 
                            {t.ds_configure_slot}: {slot.name}
                        </h3>
                        <button onClick={() => setEditingSlotId(null)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                        
                        {/* 1. Prompt & Negative */}
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{t.ds_prompt_template}</label>
                                <textarea 
                                    className="w-full border border-gray-300 rounded-lg p-3 text-xs bg-white focus:ring-1 focus:ring-indigo-500 outline-none h-24"
                                    value={slot.template}
                                    onChange={(e) => updateSlot(slot.id, { template: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{t.ds_negative_prompt}</label>
                                <textarea 
                                    className="w-full border border-gray-300 rounded-lg p-3 text-xs bg-red-50/30 text-red-800 focus:ring-1 focus:ring-red-300 outline-none h-16"
                                    value={slot.negativePrompt || ''}
                                    onChange={(e) => updateSlot(slot.id, { negativePrompt: e.target.value })}
                                    placeholder={t.ds_negative_prompt_placeholder}
                                />
                            </div>
                        </div>

                        {/* 2. Generation Settings (Text & Aspect) */}
                        <div className="grid grid-cols-2 gap-6 bg-gray-50 p-4 rounded-xl border border-gray-200">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">{t.ds_dimensions}</label>
                                <div className="flex gap-2 mb-4">
                                    <select 
                                        className="border rounded px-2 py-1 text-xs"
                                        value={slot.config.aspectRatio}
                                        onChange={(e) => updateSlot(slot.id, { config: { ...slot.config, aspectRatio: e.target.value } })}
                                    >
                                        {["1:1", "16:9", "9:16", "4:3", "3:4"].map(r => <option key={r} value={r}>{r}</option>)}
                                    </select>
                                    <select 
                                        className="border rounded px-2 py-1 text-xs"
                                        value={slot.config.resolution}
                                        onChange={(e) => updateSlot(slot.id, { config: { ...slot.config, resolution: e.target.value as any } })}
                                    >
                                        <option value="1K">1K</option>
                                        <option value="2K">2K</option>
                                    </select>
                                </div>

                                {/* Layout & Style Controls */}
                                <div className="space-y-3">
                                    <div>
                                        <div className="flex justify-between text-[10px] font-bold text-gray-500 uppercase mb-1">
                                            <span>{t.pg_layout_consistency}</span>
                                            <span>{slot.config.layoutConsistency ?? 100}%</span>
                                        </div>
                                        <input type="range" min="0" max="100" value={slot.config.layoutConsistency ?? 100} onChange={(e) => updateSlot(slot.id, { config: { ...slot.config, layoutConsistency: parseInt(e.target.value) } })} className="w-full h-1 bg-gray-300 rounded-lg appearance-none cursor-pointer" />
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-[10px] font-bold text-gray-500 uppercase mb-1">
                                            <span>{t.pg_frame_shape_variance}</span>
                                            <span>{slot.config.frameShapeVariance ?? 0}%</span>
                                        </div>
                                        <input type="range" min="0" max="100" value={slot.config.frameShapeVariance ?? 0} onChange={(e) => updateSlot(slot.id, { config: { ...slot.config, frameShapeVariance: parseInt(e.target.value) } })} className="w-full h-1 bg-gray-300 rounded-lg appearance-none cursor-pointer" />
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-[10px] font-bold text-gray-500 uppercase mb-1">
                                            <span>{t.pg_layout_variance}</span>
                                            <span>{slot.config.layoutVariance ?? 0}%</span>
                                        </div>
                                        <input type="range" min="0" max="100" value={slot.config.layoutVariance ?? 0} onChange={(e) => updateSlot(slot.id, { config: { ...slot.config, layoutVariance: parseInt(e.target.value) } })} className="w-full h-1 bg-gray-300 rounded-lg appearance-none cursor-pointer" />
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-[10px] font-bold text-gray-500 uppercase mb-1">
                                            <span>{t.pg_style_variance}</span>
                                            <span>{slot.config.styleVariance ?? 0}%</span>
                                        </div>
                                        <input type="range" min="0" max="100" value={slot.config.styleVariance ?? 0} onChange={(e) => updateSlot(slot.id, { config: { ...slot.config, styleVariance: parseInt(e.target.value) } })} className="w-full h-1 bg-gray-300 rounded-lg appearance-none cursor-pointer" />
                                    </div>
                                </div>
                            </div>
                            
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-2 flex items-center justify-between">
                                    <span>{t.ds_text_rendering}</span>
                                    <button 
                                        onClick={() => updateSlot(slot.id, { config: { ...slot.config, allowText: !slot.config.allowText } })}
                                        className={`w-8 h-4 rounded-full relative transition-colors ${slot.config.allowText ? 'bg-green-500' : 'bg-gray-300'}`}
                                    >
                                        <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${slot.config.allowText ? 'translate-x-4' : ''}`}></div>
                                    </button>
                                </label>
                                {slot.config.allowText && (
                                    <div className="space-y-2 animate-fade-in-up">
                                        <select 
                                            className="w-full border rounded px-2 py-1 text-xs"
                                            value={slot.config.targetLanguage || 'English (US)'}
                                            onChange={(e) => updateSlot(slot.id, { config: { ...slot.config, targetLanguage: e.target.value } })}
                                        >
                                            {SUPPORTED_LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                                        </select>
                                        <select 
                                            className="w-full border rounded px-2 py-1 text-xs"
                                            value={slot.config.fontStyle || 'Modern Sans-Serif'}
                                            onChange={(e) => updateSlot(slot.id, { config: { ...slot.config, fontStyle: e.target.value } })}
                                        >
                                            {FONT_STYLES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                                        </select>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 3. Style Directives */}
                        <div className="bg-indigo-50/50 rounded-xl p-4 border border-indigo-100 space-y-3">
                            <div className="flex items-center gap-2 text-indigo-700 font-bold text-xs border-b border-indigo-200 pb-2 mb-2">
                                <FileJson size={12}/> {t.ds_style_directives}
                            </div>
                            
                            <div className="grid grid-cols-1 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{t.ds_text_rendering_rules}</label>
                                    <input 
                                        className="w-full border border-gray-200 rounded px-2 py-1 text-xs bg-white"
                                        value={slot.styleDirectives?.textRendering || ''}
                                        onChange={(e) => updateSlot(slot.id, { styleDirectives: { ...slot.styleDirectives, textRendering: e.target.value } })}
                                        placeholder={t.ds_text_rendering_placeholder}
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{t.ds_feature_highlighting}</label>
                                    <input 
                                        className="w-full border border-gray-200 rounded px-2 py-1 text-xs bg-white"
                                        value={slot.styleDirectives?.featureHighlight || ''}
                                        onChange={(e) => updateSlot(slot.id, { styleDirectives: { ...slot.styleDirectives, featureHighlight: e.target.value } })}
                                        placeholder={t.ds_feature_highlighting_placeholder}
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{t.ds_composition_rules}</label>
                                    <input 
                                        className="w-full border border-gray-200 rounded px-2 py-1 text-xs bg-white"
                                        value={slot.styleDirectives?.compositionRules || ''}
                                        onChange={(e) => updateSlot(slot.id, { styleDirectives: { ...slot.styleDirectives, compositionRules: e.target.value } })}
                                        placeholder={t.ds_composition_rules_placeholder}
                                    />
                                </div>
                            </div>
                        </div>

                    </div>

                    <div className="p-4 border-t border-gray-200 bg-white flex justify-end">
                        <button onClick={() => setEditingSlotId(null)} className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:bg-indigo-700">{t.ds_done}</button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 relative overflow-hidden">
            
            {/* Header / Control Panel */}
            <div className="bg-white border-b border-gray-200 px-8 py-6 shrink-0 z-10 shadow-sm">
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
                            <div className="p-2 bg-gradient-to-br from-yellow-400 to-orange-500 text-white rounded-lg shadow-lg shadow-orange-200">
                                <Zap size={24} fill="currentColor" />
                            </div>
                            {t.ds_title}
                        </h2>
                        <p className="text-gray-500 text-sm mt-1 ml-14">{t.ds_subtitle}</p>
                    </div>
                </div>

                <div className="flex flex-col md:flex-row gap-6 items-end">
                    {/* 1. Product Selector */}
                    <div className="w-full md:w-1/3">
                        <ProductSelector 
                            label={t.ds_select_product_first}
                            products={products}
                            selectedProductId={selectedProductId}
                            onSelect={setSelectedProductId}
                            placeholder="Search SKU..."
                            className="shadow-sm"
                        />
                    </div>

                    {/* 2. Global Prompt */}
                    <div className="flex-1 w-full">
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">
                            {t.ds_global_prompt}
                        </label>
                        <div className="relative">
                            <input 
                                className="w-full border border-gray-300 rounded-lg pl-4 pr-4 py-2.5 text-sm focus:ring-2 focus:ring-orange-500 outline-none shadow-sm"
                                placeholder={t.ds_global_prompt_placeholder}
                                value={globalPrompt}
                                onChange={(e) => setGlobalPrompt(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* 3. Action Buttons */}
                    <div className="flex gap-2">
                        {/* Midnight Mission Button */}
                        <button 
                            onClick={handleQueueMidnightMission}
                            disabled={isQueuingMission || isStorming || !selectedProductId || slots.length === 0}
                            className={`h-[42px] px-6 rounded-lg font-bold text-white shadow-lg flex items-center gap-2 transition-all transform hover:scale-105 ${
                                (isQueuingMission || isStorming) ? 'bg-gray-400 cursor-not-allowed' : 
                                (!selectedProductId || slots.length === 0) ? 'bg-indigo-300 cursor-not-allowed' :
                                'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-indigo-300'
                            }`}
                        >
                            {isQueuingMission ? <Loader2 size={18} className="animate-spin"/> : <Moon size={18} fill="currentColor"/>}
                            {isQueuingMission ? t.ds_queuing : t.ds_midnight_mission}
                        </button>
                        {/* Ignite Button (Realtime) */}
                        <button 
                            onClick={handleIgniteStorm}
                            disabled={isStorming || !selectedProductId || slots.length === 0}
                            className={`h-[42px] px-6 rounded-lg font-bold text-white shadow-lg flex items-center gap-2 transition-all transform hover:scale-105 ${
                                isStorming ? 'bg-gray-400 cursor-not-allowed' : 
                                (!selectedProductId || slots.length === 0) ? 'bg-orange-300 cursor-not-allowed' :
                                'bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 shadow-orange-300'
                            }`}
                        >
                            {isStorming ? <Loader2 size={18} className="animate-spin"/> : <Zap size={18} fill="currentColor"/>}
                            {isStorming ? t.ds_running : t.ds_ignite}
                        </button>
                    </div>
                </div>
            </div>

            {/* Main Content: The Deck */}
            <div className="flex-1 overflow-auto p-8 custom-scrollbar bg-slate-50/50">
                <div className="flex gap-6 min-w-max items-start pb-20"> {/* Extra padding for float bar */}
                    
                    {/* ADD BUTTON CARD */}
                    <button 
                        onClick={() => setShowDicePicker(true)}
                        className="w-80 h-[500px] border-2 border-dashed border-gray-300 rounded-2xl flex flex-col items-center justify-center text-gray-400 hover:border-orange-400 hover:text-orange-500 hover:bg-orange-50 transition-all group bg-white/50 shrink-0 sticky left-0"
                    >
                        <div className="p-4 bg-white rounded-full shadow-sm mb-4 group-hover:shadow-md transition-shadow">
                            <Plus size={32} />
                        </div>
                        <span className="font-bold text-sm">{t.ds_add_dice}</span>
                    </button>

                    {/* SLOTS */}
                    {slots.map((slot, idx) => {
                        // Current display image logic
                        const activeImage = productImages[slot.activeProductImageIndex] || null;
                        
                        return (
                            <div key={slot.id} className="w-96 flex flex-col gap-4">
                                {/* CARD CONTROL PANEL */}
                                <div className="bg-white rounded-2xl shadow-md border border-gray-200 flex flex-col overflow-hidden relative group transition-all hover:shadow-xl shrink-0">
                                    
                                    {/* Header */}
                                    <div className="p-3 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            <div className="w-5 h-5 bg-purple-100 text-purple-600 rounded flex items-center justify-center font-bold text-[10px] shrink-0">
                                                {idx + 1}
                                            </div>
                                            <h3 className="font-bold text-gray-800 truncate text-sm" title={slot.name}>{slot.name}</h3>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {/* Config Button (NEW) */}
                                            <button 
                                                onClick={() => setEditingSlotId(slot.id)}
                                                className="text-gray-400 hover:text-indigo-600 p-1 rounded hover:bg-indigo-50 transition-colors"
                                                title="Configure Slot Settings"
                                            >
                                                <Settings size={14}/>
                                            </button>
                                            
                                            {/* Config Badge */}
                                            <span className="text-[10px] bg-white border border-gray-200 px-1.5 rounded text-gray-500">{slot.config.aspectRatio}</span>
                                            
                                            <button onClick={() => handleRemoveSlot(slot.id)} className="text-gray-400 hover:text-red-500 p-1 rounded hover:bg-red-50 transition-colors">
                                                <X size={14}/>
                                            </button>
                                        </div>
                                    </div>

                                    {/* CONFIG: SUBJECT SOURCE */}
                                    <div className="p-3 border-b border-gray-100">
                                        <label className="text-[10px] font-bold text-gray-400 uppercase mb-2 flex items-center gap-1">
                                            <Box size={10}/> {t.ds_subject_source}
                                        </label>
                                        <div className="relative w-full h-32 bg-gray-100 rounded-lg overflow-hidden border border-gray-200 group/img">
                                            {activeImage ? (
                                                <img src={activeImage || undefined} className="w-full h-full object-contain p-1" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">{t.ds_no_product_image}</div>
                                            )}
                                            
                                            {/* Image Cycler Controls */}
                                            {productImages.length > 1 && (
                                                <div className="absolute inset-0 flex justify-between items-center px-1 opacity-0 group-hover/img:opacity-100 transition-opacity">
                                                    <button onClick={() => cycleSlotImage(slot.id, -1)} className="p-1 bg-black/30 hover:bg-black/50 text-white rounded-full"><ChevronLeft size={16}/></button>
                                                    <button onClick={() => cycleSlotImage(slot.id, 1)} className="p-1 bg-black/30 hover:bg-black/50 text-white rounded-full"><ChevronRight size={16}/></button>
                                                </div>
                                            )}
                                            <div className="absolute bottom-1 right-1 bg-black/50 text-white text-[9px] px-1.5 py-0.5 rounded backdrop-blur-sm">
                                                {slot.activeProductImageIndex + 1}/{Math.max(productImages.length, 1)}
                                            </div>
                                        </div>
                                    </div>

                                    {/* CONFIG: SELLING POINTS */}
                                    <div className="p-3 flex-1 overflow-y-auto max-h-40 custom-scrollbar bg-slate-50/50">
                                        <label className="text-[10px] font-bold text-gray-400 uppercase mb-2 flex items-center gap-1">
                                            <Tag size={10}/> {t.ds_key_features}
                                        </label>
                                        <div className="flex flex-wrap gap-1.5">
                                            {productSellingPoints.length === 0 && <span className="text-[10px] text-gray-400 italic">{t.ds_no_features}</span>}
                                            {productSellingPoints.map((point, i) => {
                                                const isActive = slot.activeSellingPoints.includes(point);
                                                return (
                                                    <button 
                                                        key={i}
                                                        onClick={() => toggleSlotSellingPoint(slot.id, point)}
                                                        className={`text-[9px] px-2 py-1 rounded-md border text-left transition-all ${
                                                            isActive 
                                                            ? 'bg-indigo-100 border-indigo-200 text-indigo-700 font-bold' 
                                                            : 'bg-white border-gray-200 text-gray-500 hover:border-indigo-200'
                                                        }`}
                                                    >
                                                        {point}
                                                        {isActive && <Check size={8} className="inline ml-1"/>}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* CONFIG: ACTIVE REFERENCES & LOCAL PROMPT */}
                                    <div className="p-3 border-t border-gray-100 bg-gray-50/50 flex flex-col gap-3">
                                        {/* References */}
                                        <div className="flex gap-2">
                                            <div className="flex-1">
                                                <label className="text-[9px] font-bold text-gray-400 uppercase mb-1 flex items-center gap-1">
                                                    <LayoutTemplate size={10}/> {t.ds_layout_ref}
                                                </label>
                                                <div className="h-16 bg-gray-100 rounded border border-gray-200 overflow-hidden flex items-center justify-center">
                                                    {slot.referenceUrls?.layout ? (
                                                        <img src={slot.referenceUrls.layout || undefined} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <span className="text-[10px] text-gray-400">{t.ds_none}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex-1">
                                                <label className="text-[9px] font-bold text-gray-400 uppercase mb-1 flex items-center gap-1">
                                                    <Sun size={10}/> {t.ds_style_ref}
                                                </label>
                                                <div className="h-16 bg-gray-100 rounded border border-gray-200 overflow-hidden flex items-center justify-center">
                                                    {slot.referenceUrls?.style ? (
                                                        <img src={slot.referenceUrls.style || undefined} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <span className="text-[10px] text-gray-400">{t.ds_none}</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Local Prompt */}
                                        <div>
                                            <label className="text-[9px] font-bold text-gray-400 uppercase mb-1 flex items-center gap-1">
                                                <PenTool size={10}/> {t.ds_local_context}
                                            </label>
                                            <textarea 
                                                className="w-full text-[10px] p-1.5 border border-gray-200 rounded resize-none focus:border-indigo-500 outline-none bg-white"
                                                rows={2}
                                                placeholder={t.ds_add_details}
                                                value={slot.localPrompt || ''}
                                                onChange={(e) => setSlots(prev => prev.map(s => s.id === slot.id ? { ...s, localPrompt: e.target.value } : s))}
                                            />
                                        </div>
                                    </div>
                                    
                                    {/* INFO FOOTER */}
                                    <div className="px-3 py-2 bg-white border-t border-gray-100 text-[9px] text-gray-400 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            {slot.config.allowText ? <span className="text-green-600 flex items-center gap-0.5"><Type size={8}/> {t.ds_text}</span> : <span className="flex items-center gap-0.5"><Ban size={8}/> {t.ds_no_text}</span>}
                                            {(slot.referenceUrls?.layout || slot.referenceUrls?.style) && <span className="text-indigo-400 flex items-center gap-0.5"><Sparkles size={8}/> {t.ds_refs}</span>}
                                        </div>
                                        {slot.config.allowText && <span>{slot.config.targetLanguage?.split(' ')[0]}</span>}
                                    </div>

                                    {/* STATUS BAR */}
                                    {slot.status === 'pending' && (
                                        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-20 flex flex-col items-center justify-center">
                                            <Loader2 size={32} className="animate-spin text-indigo-600 mb-2"/>
                                            <span className="text-xs font-bold text-indigo-800 animate-pulse">{t.ds_rolling_dice}</span>
                                        </div>
                                    )}
                                </div>

                                {/* RESULTS AREA (unchanged visual) */}
                                <div className="flex flex-col gap-3 min-h-0">
                                    {slot.history.length > 0 ? (
                                        <>
                                            {/* Latest Result (Hero) */}
                                            <div 
                                                className="bg-white rounded-2xl border border-gray-200 p-2 shadow-md relative group/res"
                                            >
                                                {/* Selection Checkbox */}
                                                <div 
                                                    className="absolute top-3 left-3 z-20"
                                                    onClick={(e) => { e.stopPropagation(); toggleSelection(slot.history[0].url, slot.name, slot.id); }}
                                                >
                                                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center cursor-pointer transition-all shadow-md ${selectedItems.has(slot.history[0].url) ? 'bg-indigo-600 border-indigo-600' : 'bg-white/80 border-gray-300 hover:border-indigo-400'}`}>
                                                        {selectedItems.has(slot.history[0].url) && <Check size={14} className="text-white"/>}
                                                    </div>
                                                </div>

                                                <div 
                                                    className="w-full h-32 bg-gray-100 rounded-xl overflow-hidden relative cursor-zoom-in"
                                                    onClick={() => setLightboxUrl(slot.history[0].url)}
                                                >
                                                    <img src={slot.history[0].url || undefined} className="w-full h-full object-cover"/>
                                                    <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded backdrop-blur-sm">
                                                        {t.ds_latest}
                                                    </div>
                                                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/res:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                                        <Maximize2 size={24} className="text-white drop-shadow-md"/>
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            {/* History Strip */}
                                            {slot.history.length > 1 && (
                                                <div className="bg-slate-100 rounded-xl p-3 border border-slate-200">
                                                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-2 flex items-center gap-1">
                                                        <History size={10}/> {t.ds_history} ({slot.history.length - 1})
                                                    </div>
                                                    <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1 h-24 items-center">
                                                        {slot.history.slice(1).map((res) => {
                                                            const isSelected = selectedItems.has(res.url);
                                                            return (
                                                                <div 
                                                                    key={res.id} 
                                                                    className={`aspect-square h-20 w-20 shrink-0 rounded-lg border-2 overflow-hidden cursor-pointer relative group/hist shadow-sm transition-all ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-gray-200 hover:border-indigo-300'}`}
                                                                >
                                                                    <div 
                                                                        className="absolute top-1 left-1 z-20"
                                                                        onClick={(e) => { e.stopPropagation(); toggleSelection(res.url, slot.name, slot.id); }}
                                                                    >
                                                                        <div className={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'bg-white/80 border-gray-300'}`}>
                                                                            {isSelected && <Check size={10} className="text-white"/>}
                                                                        </div>
                                                                    </div>
                                                                    <img src={res.url || undefined} className="w-full h-full object-cover" onClick={() => setLightboxUrl(res.url)}/>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <div className="border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center text-gray-300 py-10 bg-white/50">
                                            <Dices size={24} className="mb-2 opacity-50"/>
                                            <span className="text-xs">{t.ds_ready_roll}</span>
                                        </div>
                                    )}
                                    
                                    {slot.status === 'error' && (
                                        <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">
                                            <div className="font-bold flex items-center gap-1 mb-1"><X size={12}/> {t.ds_error}</div>
                                            {slot.errorMsg}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* FLOATING ACTION BAR */}
            {selectedItems.size > 0 && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-fade-in-up">
                    <div className="bg-gray-900 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-6 border border-gray-700">
                        <div className="font-bold text-sm flex items-center gap-2">
                            <span className="bg-white text-gray-900 w-5 h-5 rounded-full flex items-center justify-center text-xs">{selectedItems.size}</span>
                            {t.ds_selected}
                        </div>
                        <div className="h-4 w-px bg-gray-700"></div>
                        <div className="flex items-center gap-2">
                            <button 
                                onClick={handleBatchDownload}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-700 transition-colors text-xs font-bold"
                            >
                                <Download size={14}/> {t.ds_download_all}
                            </button>
                            <button 
                                onClick={handleSaveToProduct}
                                disabled={isSavingToProduct}
                                className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition-all shadow-lg shadow-indigo-900/50"
                            >
                                {isSavingToProduct ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
                                {t.ds_save_assets}
                            </button>
                        </div>
                        <button onClick={() => setSelectedItems(new Map())} className="ml-2 text-gray-500 hover:text-white"><X size={16}/></button>
                    </div>
                </div>
            )}

            {/* MODALS */}
            {showDicePicker && (
                <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in-up">
                    <div className="bg-white w-full max-w-2xl rounded-xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden">
                        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-indigo-50">
                            <h3 className="font-bold text-indigo-900 flex items-center gap-2">
                                <Dices size={18}/> {t.ds_select_style}
                            </h3>
                            <button onClick={() => setShowDicePicker(false)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-slate-50">
                            <div className="grid grid-cols-2 gap-4">
                                {allDices.filter(d => d.userId === currentUser?.id || d.isGlobal).length === 0 && (
                                    <div className="col-span-2 text-center py-10 text-gray-400 italic">
                                        {t.ds_no_saved_dice}
                                    </div>
                                )}
                                {allDices.filter(d => d.userId === currentUser?.id || d.isGlobal).map(d => (
                                    <div 
                                        key={d.id} 
                                        onClick={() => handleAddSlot(d)}
                                        className="bg-white rounded-lg border border-gray-200 cursor-pointer hover:border-indigo-400 hover:shadow-md transition-all flex gap-3 p-2 overflow-hidden h-24 relative"
                                    >
                                        {d.isGlobal && (
                                            <div className="absolute top-1 right-1 bg-indigo-100 text-indigo-700 p-0.5 rounded-full" title="Global Style">
                                                <Globe size={12} />
                                            </div>
                                        )}
                                        <div className="w-20 h-20 bg-gray-100 rounded shrink-0 overflow-hidden">
                                            {d.coverImage ? (
                                                <img src={d.coverImage || undefined} className="w-full h-full object-cover"/>
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-gray-300"><Sparkles size={20}/></div>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0 flex flex-col justify-center">
                                            <h4 className="font-bold text-gray-800 text-sm truncate mb-1">{d.name}</h4>
                                            <div className="flex flex-wrap gap-1">
                                                <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 rounded border border-indigo-100">Style</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center text-gray-300 pr-2">
                                            <ChevronRight size={20}/>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Slot Config Modal */}
            {renderSlotConfigModal()}

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
