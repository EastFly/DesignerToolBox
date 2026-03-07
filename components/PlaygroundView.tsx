
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { Send, Image as ImageIcon, Loader2, Sparkles, Box, Trash2, X, Maximize2, RefreshCw, Wand2, ArrowRight, Dices, Save, MessageSquare, Bot, AlertCircle, Settings, Layers, Zap, LayoutTemplate, Sun, Camera, UploadCloud, GripHorizontal, CheckCircle, Sliders, Type, Grid as GridIcon, Info, Monitor, Smartphone, Scaling, Ban, Tag, Edit3, Plus, Check, FileJson, Minus, Globe, PenTool, Bug } from 'lucide-react';
import { Product, StyleDice, User, DiceMetadata, GenConfig } from '../types';
import { db } from '../services/db';
import { translations, Language } from '../i18n';
import { ProductSelector } from './ProductSelector';

interface PlaygroundViewProps {
    language: Language;
    currentUser: User | null;
    canManageGlobalDice: boolean;
}

// Structured Prompt Definition
interface StructuredPrompt {
    subject: string;
    environment: string;
    lighting: string;
    composition: string;
}

// Reference Image Config
interface ReferenceSlot {
    type: 'product' | 'layout' | 'style';
    url: string;
    base64: string;
    label: string;
}

interface Message {
    id: string;
    role: 'user' | 'ai' | 'system';
    content: string; // Text content
    type: 'text' | 'image' | 'proposal';
    proposalData?: {
        thought: string;
        structured: StructuredPrompt; // NEW: Structured data
    };
    meta?: any; // Stores product ID, prompt used, related proposal ID, CONFIG USED
}

// Helper to convert URL to Base64
const urlToBase64 = async (url: string): Promise<string> => {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const res = reader.result as string;
                // Remove data:image/...;base64, prefix for API
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

import { getApiKey } from '../services/geminiService';

export const PlaygroundView: React.FC<PlaygroundViewProps> = ({ language, currentUser, canManageGlobalDice }) => {
    const t = translations[language];
    
    // Data State
    const [products, setProducts] = useState<Product[]>([]);
    const [dice, setDice] = useState<StyleDice[]>([]);
    const [selectedProductId, setSelectedProductId] = useState<string>('');
    const [selectedDiceId, setSelectedDiceId] = useState<string | null>(null);
    
    // Workflow Configuration State (Plan vs Build)
    const [activeMode, setActiveMode] = useState<'plan' | 'build'>('plan');
    const [planModel, setPlanModel] = useState<string>('gemini-3-flash-preview');
    const [buildModel, setBuildModel] = useState<string>('gemini-3-pro-image-preview');

    // Reference Slots State (New)
    const [references, setReferences] = useState<Record<string, ReferenceSlot>>({});
    
    // Product Images for Selection
    const [availableProductImages, setAvailableProductImages] = useState<string[]>([]);

    // Selling Points State (New)
    const [productSellingPoints, setProductSellingPoints] = useState<string[]>([]);
    const [activeSellingPoints, setActiveSellingPoints] = useState<string[]>([]);
    const [newPointInput, setNewPointInput] = useState('');
    const [isAddingPoint, setIsAddingPoint] = useState(false);

    // Advanced Config State
    const [genConfig, setGenConfig] = useState<GenConfig>({
        aspectRatio: '1:1',
        allowText: false,
        resolution: '1K',
        targetLanguage: 'English (US)',
        fontStyle: 'Modern Sans-Serif',
        layoutConsistency: 100,
        frameShapeVariance: 0,
        layoutVariance: 0,
        styleVariance: 0
    });
    
    // Chat State
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false); // For Flash (Planning)
    const [isGenerating, setIsGenerating] = useState(false); // For Pro (Building)
    const [isExtracting, setIsExtracting] = useState(false);
    const [isSavingDice, setIsSavingDice] = useState(false);
    const [debugPayload, setDebugPayload] = useState<any>(null);
    
    // Extraction Modal State (ENHANCED for V2.14)
    const [extractData, setExtractData] = useState<{
        name: string;
        template: string; // The core prompt
        negativePrompt: string; // NEW
        styleDirectives: { // NEW: Structured directives
            textRendering: string;
            featureHighlight: string;
            compositionRules: string;
        };
        structuredPrompt?: {
            environment?: string;
            lighting?: string;
            composition?: string;
        };
        tags: string[];
        coverImage: string;
        originalConfig: GenConfig; // Editable in modal
        snapshotReferences: Record<string, ReferenceSlot>;
        isGlobal: boolean;
    } | null>(null);

    // UI State
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
    const [restoringDice, setRestoringDice] = useState(false);
    const chatEndRef = useRef<HTMLDivElement>(null);

    // Load Initial Data
    useEffect(() => {
        db.getProducts().then(setProducts);
        db.getStyleDice(canManageGlobalDice).then(setDice);
        
        // Initial Greeting
        setMessages([{
            id: 'init',
            role: 'ai',
            content: t.pg_greeting,
            type: 'text'
        }]);
    }, [language]);

    // Handle Product Selection -> Load ALL Images & Selling Points -> Default to first OR Dice preference
    useEffect(() => {
        const loadProductContext = async () => {
            if (!selectedProductId) {
                // Clear product reference if deselected
                setReferences(prev => {
                    const next = { ...prev };
                    delete next['product'];
                    return next;
                });
                setAvailableProductImages([]);
                setProductSellingPoints([]);
                setActiveSellingPoints([]);
                return;
            }
            
            const product = products.find(p => p.id === selectedProductId);
            if (!product) return;

            // 1. Gather ALL images
            const images: string[] = [];
            const syncedImg = product.data['productImage'];
            if (Array.isArray(syncedImg)) images.push(...syncedImg);
            else if (typeof syncedImg === 'string' && syncedImg) images.push(syncedImg);

            const gallery = product.data['galleryImages'];
            if (Array.isArray(gallery)) images.push(...gallery);

            const uniqueImages = Array.from(new Set(images.filter(url => typeof url === 'string' && url.trim() !== '')));
            setAvailableProductImages(uniqueImages);

            // LOGIC: Default select image based on Dice Metadata (if active) OR first image
            if (uniqueImages.length > 0) {
                let targetIndex = 0; // Default to first
                
                // Check if a Dice is active and has a preference
                if (selectedDiceId) {
                    const activeDice = dice.find(d => d.id === selectedDiceId);
                    if (activeDice && activeDice.description) {
                        try {
                            const meta = JSON.parse(activeDice.description) as DiceMetadata;
                            if (meta.productImageIndex !== undefined && uniqueImages[meta.productImageIndex]) {
                                targetIndex = meta.productImageIndex;
                            }
                        } catch (e) { /* ignore */ }
                    }
                }

                const targetUrl = uniqueImages[targetIndex];
                const currentRefUrl = references['product']?.url;
                
                // Only update if different
                if (!currentRefUrl || currentRefUrl !== targetUrl) {
                    await setActiveProductReference(targetUrl);
                }
            } else {
                 setReferences(prev => {
                    const next = { ...prev };
                    delete next['product'];
                    return next;
                });
            }

            // 2. Load Selling Points
            let points: string[] = [];
            const rawPoints = product.data['sellingPoints'];
            if (Array.isArray(rawPoints)) {
                // Handle both simple strings and object {text: string}
                points = rawPoints.map(p => typeof p === 'string' ? p : p.text).filter(Boolean);
            }
            setProductSellingPoints(points);
            
            // Logic: If Dice is active, restore selling points too
            if (selectedDiceId) {
                 const activeDice = dice.find(d => d.id === selectedDiceId);
                 if (activeDice && activeDice.description) {
                     try {
                         const meta = JSON.parse(activeDice.description) as DiceMetadata;
                         if (meta.selectedSellingPointIndices && points.length > 0) {
                             const restoredPoints = meta.selectedSellingPointIndices
                                 .map(idx => points[idx])
                                 .filter(p => !!p);
                             setActiveSellingPoints(restoredPoints);
                         } else {
                             setActiveSellingPoints([]); // Clear if no preference
                         }
                     } catch (e) { setActiveSellingPoints([]); }
                 }
            } else {
                setActiveSellingPoints([]); // Reset active points on product switch if no dice
            }

        };
        loadProductContext();
    }, [selectedProductId, products, selectedDiceId]); // Depend on SelectedDiceId to re-trigger defaults

    // Explicitly set the active product reference image
    const setActiveProductReference = async (url: string) => {
        try {
            const b64 = await urlToBase64(url);
            setReferences(prev => ({
                ...prev,
                'product': { type: 'product', url, base64: b64, label: 'Product Subject' }
            }));
        } catch (e) {
            console.error("Failed to set active product image", e);
        }
    };

    // Handle Manual Reference Upload (Layout/Style)
    const handleReferenceUpload = async (type: 'layout' | 'style', file: File) => {
        try {
            const url = await db.uploadFile(file); // Or create object URL for local preview
            const b64 = await urlToBase64(url); // Re-download to get base64 or read from file directly
            
            setReferences(prev => ({
                ...prev,
                [type]: { type, url, base64: b64, label: type === 'layout' ? 'Layout Ref' : 'Style Ref' }
            }));
        } catch (e) {
            console.error("Ref upload failed", e);
        }
    };

    const removeReference = (type: string) => {
        setReferences(prev => {
            const next = { ...prev };
            delete next[type];
            return next;
        });
    };

    // Toggle Selling Point
    const toggleSellingPoint = (point: string) => {
        if (activeSellingPoints.includes(point)) {
            setActiveSellingPoints(prev => prev.filter(p => p !== point));
        } else {
            setActiveSellingPoints(prev => [...prev, point]);
        }
    };

    const handleAddPoint = () => {
        if (!newPointInput.trim()) return;
        setProductSellingPoints(prev => [...prev, newPointInput.trim()]);
        setActiveSellingPoints(prev => [...prev, newPointInput.trim()]);
        setNewPointInput('');
        setIsAddingPoint(false);
    };

    // Scroll to bottom on message
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [messages, isThinking, isGenerating]);

    const handleSendChat = async () => {
        if (!input.trim() && Object.keys(references).length === 0) return;
        
        const currentInput = input;
        setInput('');
        setIsThinking(true);

        // 1. Add User Message
        const userMsg: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: currentInput,
            type: 'text'
        };
        const newHistory = [...messages, userMsg];
        setMessages(newHistory);

        try {
            const apiKey = await getApiKey();
            const ai = new GoogleGenAI({ apiKey });

            // 2. Construct System Prompt for STRUCTURED OUTPUT
            const sellingPointsContext = activeSellingPoints.length > 0 
                ? `KEY FEATURES TO HIGHLIGHT: \n- ${activeSellingPoints.join('\n- ')}` 
                : "No specific features selected.";

            let preDefinedEnvironment = '';
            let preDefinedLighting = '';
            let preDefinedComposition = '';

            if (selectedDiceId) {
                const activeDice = dice.find(d => d.id === selectedDiceId);
                if (activeDice && activeDice.description) {
                    try {
                        const meta = JSON.parse(activeDice.description) as DiceMetadata;
                        if (meta.structuredPrompt) {
                            preDefinedEnvironment = meta.structuredPrompt.environment || '';
                            preDefinedLighting = meta.structuredPrompt.lighting || '';
                            preDefinedComposition = meta.structuredPrompt.composition || '';
                        }
                    } catch (e) { /* ignore */ }
                }
            }

            const systemPrompt = `You are an expert AI Art Director for E-commerce.
            Your goal is to plan a high-quality product render based on the user's request and the provided references.
            
            CONTEXT:
            - Product Reference: ${references['product'] ? 'PROVIDED (Use this visual as the absolute source of truth for the product)' : 'MISSING'}
            - ${sellingPointsContext}
            - Layout Reference: ${references['layout'] ? 'PROVIDED (Use this for strict composition, framing, and UI layout)' : 'None'}
            - Style/Lighting Reference: ${references['style'] ? 'PROVIDED (Use this for mood/lighting)' : 'None'}
            ${preDefinedEnvironment ? `- Pre-defined Environment: ${preDefinedEnvironment}` : ''}
            ${preDefinedLighting ? `- Pre-defined Lighting: ${preDefinedLighting}` : ''}
            ${preDefinedComposition ? `- Pre-defined Composition: ${preDefinedComposition}` : ''}
            
            TASK:
            Analyze the user's request. Break down the visual description into 4 distinct structural components:
            1. **Subject**: Detailed description of the product based on its features.
            2. **Environment**: The background, setting, or scene. (Use Pre-defined Environment if provided, adapt if user request overrides).
            3. **Lighting**: The type of light, shadows, and mood. (Use Pre-defined Lighting if provided, adapt if user request overrides).
            4. **Composition**: The camera angle, framing, spatial arrangement, and specific layout of structural elements (like text boxes, feature callouts, or frames). (Use Pre-defined Composition if provided, adapt if user request overrides).
            
            IMPORTANT:
            - Incorporate the "Key Features" into the 'Subject' or 'Lighting' description where appropriate (e.g. if 'Waterproof', mention water droplets).
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
            }
            `;

            const chatContent: any[] = [
                { text: `Chat History:\n${newHistory.filter(m=>m.role!=='system').map(m => `${m.role}: ${m.content}`).join('\n')}` },
                { text: "User Input: " + currentInput }
            ];

            // Attach Reference Images with specific labels
            if (references['product']) {
                chatContent.push({ text: "\n[Reference: Product Subject - VISUAL TRUTH]" });
                chatContent.push({ inlineData: { mimeType: 'image/jpeg', data: references['product'].base64 } });
            }
            if (references['layout']) {
                chatContent.push({ text: "\n[Reference: Layout/Composition Guide]" });
                chatContent.push({ inlineData: { mimeType: 'image/jpeg', data: references['layout'].base64 } });
            }
            if (references['style']) {
                chatContent.push({ text: "\n[Reference: Style/Lighting Guide]" });
                chatContent.push({ inlineData: { mimeType: 'image/jpeg', data: references['style'].base64 } });
            }

            const response = await ai.models.generateContent({
                model: planModel, 
                contents: [
                    { role: 'user', parts: [{ text: systemPrompt }] },
                    { role: 'user', parts: chatContent }
                ],
                config: { responseMimeType: 'application/json' }
            });

            const responseText = response.text || '{}';
            const cleanJson = responseText.replace(/```json|```/g, '').trim();
            
            try {
                const proposal = JSON.parse(cleanJson);
                
                setMessages(prev => [...prev, {
                    id: Date.now().toString() + '_prop',
                    role: 'ai',
                    content: '',
                    type: 'proposal',
                    proposalData: proposal,
                    meta: { productId: selectedProductId }
                }]);

            } catch (e) {
                console.error("JSON Parse Error", e);
                setMessages(prev => [...prev, { id: Date.now().toString(), role: 'ai', content: responseText, type: 'text' }]);
            }

        } catch (e) {
            console.error(e);
            alert(t.pg_planning_failed);
        } finally {
            setIsThinking(false);
        }
    };

    const handleConfirmGenerate = async (proposalMsg: Message, editedStructured?: StructuredPrompt, debug: boolean = false) => {
        const structure = editedStructured || proposalMsg.proposalData?.structured;
        if (!structure || !proposalMsg.meta.productId) return;
        
        if (!debug) setIsGenerating(true);

        try {
            const apiKey = await getApiKey();
            const ai = new GoogleGenAI({ apiKey });

            // 1. Construct the Final Prompt from Structured Parts
            // ENHANCED: Use Negative Prompt from Active Dice (if available) or default
            let negativePrompt = !genConfig.allowText ? " Do not render text, typography, or watermarks. Low quality, distorted." : " Low quality, distorted.";
            let styleDirectives = "";

            // Check if there is an active Dice to pull strict overrides from
            if (selectedDiceId) {
                const activeDice = dice.find(d => d.id === selectedDiceId);
                if (activeDice && activeDice.description) {
                    try {
                        const meta = JSON.parse(activeDice.description) as DiceMetadata;
                        if (meta.negativePrompt) {
                            let np = meta.negativePrompt;
                            if (genConfig.allowText) {
                                np = np.replace(/text|writing|letters|words|watermark|signature|typography|label/gi, '').replace(/,\s*,/g, ',').trim();
                            }
                            negativePrompt += " " + np;
                        }
                        
                        if (meta.styleDirectives) {
                            const d = meta.styleDirectives;
                            if (d.textRendering) styleDirectives += `\nText Rendering Rules: ${d.textRendering}`;
                            if (d.featureHighlight) styleDirectives += `\nFeature Highlight Rules: ${d.featureHighlight}`;
                            if (d.compositionRules) styleDirectives += `\nStrict Composition: ${d.compositionRules}`;
                        }
                    } catch(e) {}
                }
            }
            
            // --- CORE LOGIC: Text vs Visual Selling Points ---
            let featuresText = "";
            if (activeSellingPoints.length > 0) {
                const pointsList = activeSellingPoints.map(p => `"${p}"`).join(', ');
                
                if (genConfig.allowText) {
                    // TEXT MODE: Instruct to render the strings
                    // UPDATED: Include Language and Font instructions
                    const targetLang = genConfig.targetLanguage || 'English (US)';
                    const fontStyle = genConfig.fontStyle || 'Modern Sans-Serif';

                    featuresText = `
                    **MANDATORY TEXT RENDER**: 
                    You must visually render the following text strings into the scene: ${pointsList}.
                    
                    CRITICAL LOCALIZATION RULES:
                    1. **Target Language**: Translate any extracted text or selling points into **${targetLang}** before rendering. Ensure correct grammar and spelling for ${targetLang}.
                    2. **Typography**: Use a **${fontStyle}** font style. Text must be high-resolution, legible, and integrated naturally (e.g. floating 3D, etched, or smart overlay).
                    `;
                } else {
                    // VISUAL MODE: Instruct to visualize concepts and FORBID text
                    featuresText = `
                    **FEATURE VISUALIZATION (NO TEXT)**:
                    Do NOT write any text. Instead, visually demonstrate these features concepts: ${pointsList}.
                    Example: If "Waterproof", show water droplets. If "Long Battery", show glowing energy.
                    `;
                    negativePrompt += " text, writing, letters, words, watermark, signature";
                }
            } else if (genConfig.allowText) {
                featuresText = `
                **TEXT RENDER ALLOWED**: 
                You are permitted and encouraged to render text, typography, and labels if requested in the scene description.
                `;
            }

            // CRITICAL INSTRUCTION FOR VISUAL CONSISTENCY
            const productReferenceInstruction = references['product'] 
                ? "CRITICAL RULE 1 (SUBJECT): The 'Product Reference' image is the ONLY source of truth for the subject. You MUST accurately extract and render this exact product. Maintain its exact shape, color, branding, materials, and details. DO NOT use the product from the layout or style references."
                : "";

            const layoutConsistency = genConfig.layoutConsistency ?? 100;
            const frameShapeVariance = genConfig.frameShapeVariance ?? 0;
            const layoutVariance = genConfig.layoutVariance ?? 0;
            const styleVariance = genConfig.styleVariance ?? 0;

            let layoutInstruction = "";
            if (references['layout']) {
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
            if (references['style']) {
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
            ${styleDirectives}
            
            Instructions: Combine these elements into a high-fidelity, photorealistic e-commerce product render. The Product Reference must be rendered with absolute accuracy. ${references['layout'] ? (layoutConsistency > 80 ? 'You must strictly preserve the structural layout, framing, and feature callout placements from the Composition Reference.' : 'Adapt the layout creatively based on the Composition Reference.') : ''} Draw artistic inspiration from the Style Reference to define the mood, lighting, and textures, adapting them to build a harmonious scene. ${negativePrompt}
            `;

            // 2. Prepare Parts with active references
            // ORDER MATTERS: Product First is standard for "Subject" control
            const parts: any[] = [{ text: finalPrompt }];
            
            if (references['product']) {
                parts.push({ text: "Product Reference (Main Subject):" });
                parts.push({ inlineData: { mimeType: 'image/jpeg', data: references['product'].base64 } });
            }
            if (references['layout']) {
                parts.push({ text: "Composition Reference:" });
                parts.push({ inlineData: { mimeType: 'image/jpeg', data: references['layout'].base64 } });
            }
            if (references['style']) {
                parts.push({ text: "Style Reference:" });
                parts.push({ inlineData: { mimeType: 'image/jpeg', data: references['style'].base64 } });
            }

            const modelConfig: any = {};
            if (buildModel.includes('pro-image')) {
                modelConfig.imageConfig = { 
                    aspectRatio: genConfig.aspectRatio, 
                    imageSize: genConfig.resolution 
                };
            } else {
                modelConfig.imageConfig = { aspectRatio: genConfig.aspectRatio }; 
            }

            if (debug) {
                setDebugPayload({
                    model: buildModel,
                    config: modelConfig,
                    parts: parts.map(p => p.inlineData ? { ...p, inlineData: { ...p.inlineData, data: `(Base64 Data: ${p.inlineData.data.substring(0, 20)}...[${p.inlineData.data.length} chars])` } } : p),
                    _rawReferences: Object.keys(references).map(k => ({ key: k, hasBase64: !!references[k].base64, url: references[k].url })),
                    _structure: structure
                });
                return;
            }

            const response = await ai.models.generateContent({
                model: buildModel,
                contents: { parts: parts },
                config: modelConfig
            });

            // Extract Image
            let imageUrl = '';
            for (const part of response.candidates?.[0]?.content?.parts || []) {
                if (part.inlineData) {
                    imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                    break;
                }
            }

            if (imageUrl) {
                const aiMsg: Message = {
                    id: (Date.now() + 1).toString(),
                    role: 'ai',
                    content: imageUrl,
                    type: 'image',
                    meta: { 
                        finalPrompt: finalPrompt,
                        structuredData: structure, // Store for magic extract
                        productId: proposalMsg.meta.productId,
                        sourceProposalId: proposalMsg.id,
                        usedReference: Object.keys(references).length > 0,
                        modelUsed: buildModel,
                        configUsed: genConfig // Store used config
                    }
                };
                setMessages(prev => [...prev, aiMsg]);
            } else {
                alert(t.pg_no_image_generated);
            }

        } catch (e) {
            console.error(e);
            alert(t.pg_generation_failed);
        } finally {
            setIsGenerating(false);
        }
    };

    // --- INTELLIGENT EXTRACTION LOGIC (UPDATED V2.14) ---
    const handleMagicExtract = async (imageMsg: Message) => {
        if (!imageMsg.meta?.structuredData) {
            alert(t.pg_missing_structure);
            return;
        }
        
        setIsExtracting(true);
        try {
            const apiKey = await getApiKey();
            const ai = new GoogleGenAI({ apiKey });
            
            const usedStructure = imageMsg.meta.structuredData as StructuredPrompt;
            // We concatenate to give full context
            const fullDescription = `Environment: ${usedStructure.environment}\nLighting: ${usedStructure.lighting}\nComposition: ${usedStructure.composition}\nSubject Context (to remove): ${usedStructure.subject}`;

            // Analyze to create a reusable template WITH TECH SPECS
            const analysisPrompt = `
            You are a Design System Architect.
            I have a description for a specific product render I just created:
            "${fullDescription}"

            TASK:
            1. Abstract this description into a reusable style template.
            2. CRITICAL: Remove any specific mentions of the original product (e.g. "headphones", "bottle", specific colors of the product).
            3. Replace the product subject location/interaction with "{{subject}}". 
               Example: "A {{subject}} sitting on a rock" instead of "A bottle sitting on a rock".
            4. Generate a short, creative Name for this style (e.g., "Neon Cyberpunk", "Soft Morning").
            5. Generate 3-5 keywords/tags describing the vibe.
            6. Create a Standardized Style Directive (JSON) that defines:
               - textRendering: Rules for how text should appear if present (e.g. "Minimalist sans-serif, integrated into surface").
               - featureHighlight: How selling points should be visualized (e.g. "Use holographic overlays for tech features").
               - compositionRules: Strict layout rules (e.g. "Always center subject, 30% negative space").
            7. Generate Negative Prompts to keep this style clean (e.g. "blurry, distorted, clutter, low res").

            OUTPUT JSON:
            {
                "name": "...",
                "template": "...", 
                "tags": ["..."],
                "negativePrompt": "...",
                "styleDirectives": {
                    "textRendering": "...",
                    "featureHighlight": "...",
                    "compositionRules": "..."
                }
            }
            `;

            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: [{ role: 'user', parts: [{ text: analysisPrompt }] }],
                config: { responseMimeType: 'application/json' }
            });

            const result = JSON.parse(response.text || '{}');
            
            // Snapshot current references to save with Dice
            const snapshotReferences = { ...references };

            const existingDice = selectedDiceId ? dice.find(d => d.id === selectedDiceId) : null;
            setExtractData({
                name: result.name || "Custom Style",
                template: result.template || fullDescription,
                tags: result.tags || [],
                negativePrompt: result.negativePrompt || "low quality, distorted, watermark",
                styleDirectives: result.styleDirectives || { textRendering: '', featureHighlight: '', compositionRules: '' },
                structuredPrompt: {
                    environment: usedStructure.environment,
                    lighting: usedStructure.lighting,
                    composition: usedStructure.composition
                },
                coverImage: imageMsg.content, // The generated image (Base64)
                originalConfig: imageMsg.meta.configUsed || genConfig, // Snapshot of config used
                snapshotReferences: snapshotReferences, // Pass references to modal for saving
                isGlobal: existingDice?.isGlobal || false
            });

        } catch (e) {
            console.error("Extraction failed", e);
            alert(t.pg_analysis_failed);
        } finally {
            setIsExtracting(false);
        }
    };

    // UPDATED: Handle Save Dice with Update Logic
    const handleSaveDice = async (isUpdate: boolean = false) => {
        if (!extractData || !currentUser) return;
        setIsSavingDice(true);
        
        try {
            // 1. Upload Cover Image to Storage (Convert Base64 to Blob)
            let coverUrl = extractData.coverImage;
            if (coverUrl.startsWith('data:')) {
                const res = await fetch(coverUrl);
                const blob = await res.blob();
                const file = new File([blob], `dice_cover_${Date.now()}.png`, { type: 'image/png' });
                coverUrl = await db.uploadFile(file);
            }

            // 2. Prepare Reference URLs (Only need URLs, not Base64, for metadata)
            const referenceUrls = {
                layout: extractData.snapshotReferences['layout']?.url,
                style: extractData.snapshotReferences['style']?.url
            };

            // 3. Calculate selected indices of selling points
            const selectedIndices = activeSellingPoints
                .map(p => productSellingPoints.indexOf(p))
                .filter(idx => idx !== -1);

            // 4. NEW: Calculate selected index of product image
            let imgIndex = -1;
            if (references['product']?.url && availableProductImages.length > 0) {
                imgIndex = availableProductImages.indexOf(references['product'].url);
            }

            // 5. Store Metadata (Updated V2.14)
            const metadata: DiceMetadata = {
                tags: extractData.tags,
                config: extractData.originalConfig,
                referenceUrls: referenceUrls,
                selectedSellingPointIndices: selectedIndices,
                productImageIndex: imgIndex > -1 ? imgIndex : undefined, // Save image index
                // NEW FIELDS
                negativePrompt: extractData.negativePrompt,
                styleDirectives: extractData.styleDirectives,
                structuredPrompt: extractData.structuredPrompt
            };

            // 6. Determine ID (Update existing or Create New)
            const targetId = (isUpdate && selectedDiceId) ? selectedDiceId : `dice-${Date.now()}`;

            await db.saveStyleDice({
                id: targetId,
                userId: currentUser.id,
                name: extractData.name,
                description: JSON.stringify(metadata),
                template: extractData.template,
                coverImage: coverUrl, 
                createdAt: new Date(),
                isGlobal: extractData.isGlobal
            });

            const newDice = await db.getStyleDice();
            setDice(newDice);
            // If we created a new one, select it
            if (!isUpdate) {
                setSelectedDiceId(targetId);
            }
            
            setExtractData(null); // Close modal
            alert(isUpdate ? t.pg_update_success : t.pg_extract_success);
        } catch (e) {
            console.error(e);
            alert(t.pg_save_failed);
        } finally {
            setIsSavingDice(false);
        }
    };

    const applyDice = async (d: StyleDice) => {
        setSelectedDiceId(d.id);
        setRestoringDice(true);
        
        try {
            // 1. Restore Configuration & References if available
            if (d.description) {
                try {
                    const meta = JSON.parse(d.description) as DiceMetadata;
                    
                    // Config
                    if (meta.config) {
                        setGenConfig(meta.config);
                    }

                    // Restore References (Layout & Style)
                    if (meta.referenceUrls) {
                        const newReferences = { ...references }; // Keep product ref
                        
                        // Layout
                        if (meta.referenceUrls.layout) {
                            try {
                                const b64 = await urlToBase64(meta.referenceUrls.layout);
                                if (b64) {
                                    newReferences['layout'] = {
                                        type: 'layout',
                                        url: meta.referenceUrls.layout,
                                        base64: b64,
                                        label: 'Restored Layout'
                                    };
                                }
                            } catch (e) { console.error("Failed to restore layout ref", e); }
                        } else {
                            delete newReferences['layout'];
                        }

                        // Style
                        if (meta.referenceUrls.style) {
                            try {
                                const b64 = await urlToBase64(meta.referenceUrls.style);
                                if (b64) {
                                    newReferences['style'] = {
                                        type: 'style',
                                        url: meta.referenceUrls.style,
                                        base64: b64,
                                        label: 'Restored Style'
                                    };
                                }
                            } catch (e) { console.error("Failed to restore style ref", e); }
                        } else {
                            delete newReferences['style'];
                        }

                        setReferences(newReferences);
                    }

                    // Restore Selling Points Indices if Product is Selected
                    if (meta.selectedSellingPointIndices && Array.isArray(meta.selectedSellingPointIndices) && productSellingPoints.length > 0) {
                        const restoredPoints = meta.selectedSellingPointIndices
                            .map(index => productSellingPoints[index])
                            .filter(p => !!p); 
                        setActiveSellingPoints(restoredPoints);
                    }

                    // NEW: Restore Product Image Index
                    if (meta.productImageIndex !== undefined && availableProductImages.length > 0) {
                        // Check if index is valid
                        if (availableProductImages[meta.productImageIndex]) {
                            const targetUrl = availableProductImages[meta.productImageIndex];
                            // If current is different, update it
                            if (references['product']?.url !== targetUrl) {
                                await setActiveProductReference(targetUrl);
                            }
                        }
                    }

                } catch (e) {
                    console.error("Dice metadata parse error", e);
                }
            }

            // 2. Set Prompt Input (Injecting current product name if possible)
            let templateText = d.template;
            if (selectedProductId) {
                const p = products.find(x => x.id === selectedProductId);
                if (p) {
                    templateText = templateText.replace(/{{subject}}|{{product}}/gi, `the ${p.name}`);
                }
            }
            
            setInput(templateText);
        } finally {
            setRestoringDice(false);
        }
    };

    const deleteDice = async (id: string) => {
        if(!confirm(t.pm_delete_confirm)) return;
        await db.deleteStyleDice(id);
        setDice(prev => prev.filter(d => d.id !== id));
        if (selectedDiceId === id) setSelectedDiceId(null);
    };

    // Component for Editable Proposal
    const ProposalCard = ({ msg }: { msg: Message }) => {
        const [data, setData] = useState<StructuredPrompt>(msg.proposalData?.structured || { subject: '', environment: '', lighting: '', composition: '' });
        
        return (
            <div className="space-y-4">
                <div className="flex items-center gap-2 text-indigo-600 font-bold text-sm border-b border-gray-100 pb-2">
                    <Sparkles size={16}/> {t.pg_execution_plan}
                </div>
                <div className="text-xs text-gray-500 italic">
                    "{msg.proposalData?.thought}"
                </div>
                
                {/* Structured Form */}
                <div className="grid grid-cols-1 gap-3">
                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase flex items-center gap-1"><Box size={10}/> {t.pg_subject}</label>
                        <textarea className="w-full bg-gray-50 border border-gray-200 rounded p-2 text-xs focus:bg-white focus:border-indigo-300 outline-none" rows={2} 
                            value={data.subject} onChange={e => setData({...data, subject: e.target.value})}
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase flex items-center gap-1"><Sun size={10}/> {t.pg_env_lighting}</label>
                        <textarea className="w-full bg-gray-50 border border-gray-200 rounded p-2 text-xs focus:bg-white focus:border-indigo-300 outline-none" rows={3} 
                            value={`${data.environment}. ${data.lighting}`} 
                            onChange={e => {
                                // Simple update for now
                                setData({...data, environment: e.target.value, lighting: ''});
                            }}
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase flex items-center gap-1"><LayoutTemplate size={10}/> {t.pg_composition}</label>
                        <textarea className="w-full bg-gray-50 border border-gray-200 rounded p-2 text-xs focus:bg-white focus:border-indigo-300 outline-none" rows={2} 
                            value={data.composition} onChange={e => setData({...data, composition: e.target.value})}
                        />
                    </div>
                </div>

                <div className="bg-gray-50 p-2 rounded border border-gray-200 text-xs text-gray-500 flex justify-between items-center">
                    <span>Config: {genConfig.aspectRatio}, {genConfig.resolution}, {genConfig.allowText ? t.pg_text_allowed : t.pg_no_text}</span>
                    <Settings size={12}/>
                </div>

                <div className="flex gap-2">
                    <button 
                        onClick={() => handleConfirmGenerate(msg, data, true)}
                        className="p-2.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors border border-gray-200"
                        title="Debug Payload"
                    >
                        <Bug size={16}/>
                    </button>
                    <button 
                        onClick={() => handleConfirmGenerate(msg, data)}
                        className="flex-1 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md transform hover:scale-[1.02]"
                    >
                        <ImageIcon size={16}/> {t.pg_build_with} {buildModel.includes('pro') ? 'Gemini Pro' : 'Imagen'}
                    </button>
                </div>
            </div>
        );
    };

    return (
        <div className="absolute inset-0 flex bg-gray-50 overflow-hidden">
            {/* LEFT SIDEBAR: Reference Controls */}
            <div className="w-80 bg-white border-r border-gray-200 flex flex-col shrink-0 z-10 shadow-lg h-full">
                
                {/* Header */}
                <div className="p-5 border-b border-gray-100 bg-gray-50 shrink-0">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2 mb-4">
                        <Dices size={20} className="text-indigo-600"/> {t.pg_title}
                    </h2>
                    
                    {/* MODE TOGGLE */}
                    <div className="flex p-1 bg-gray-200 rounded-lg mb-4">
                        <button onClick={() => setActiveMode('plan')} className={`flex-1 py-1.5 px-3 rounded-md text-xs font-bold flex items-center justify-center gap-2 transition-all ${activeMode === 'plan' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                            <MessageSquare size={14}/> {t.pg_plan_mode}
                        </button>
                        <button onClick={() => setActiveMode('build')} className={`flex-1 py-1.5 px-3 rounded-md text-xs font-bold flex items-center justify-center gap-2 transition-all ${activeMode === 'build' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                            <Layers size={14}/> {t.pg_build_mode}
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
                    <div className="space-y-6">
                        {/* 1. PRODUCT SELECTION */}
                        <div>
                            <ProductSelector 
                                label={t.pg_select_product}
                                products={products}
                                selectedProductId={selectedProductId}
                                onSelect={setSelectedProductId}
                                placeholder={t.pg_select_product_placeholder}
                            />
                        </div>

                        {/* 1.5 SELLING POINTS (NEW) */}
                        {selectedProductId && (
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-1">
                                    <Tag size={12}/> {t.pg_selling_points}
                                </label>
                                <div className="flex flex-wrap gap-1.5 mb-2">
                                    {productSellingPoints.map((point, idx) => {
                                        const isActive = activeSellingPoints.includes(point);
                                        return (
                                            <button
                                                key={idx}
                                                onClick={() => toggleSellingPoint(point)}
                                                className={`text-[10px] px-2 py-1 rounded-full border transition-all text-left truncate max-w-full ${isActive ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'}`}
                                                title={point}
                                            >
                                                {point}
                                            </button>
                                        );
                                    })}
                                    {isAddingPoint ? (
                                        <div className="flex items-center gap-1 w-full mt-1">
                                            <input 
                                                autoFocus
                                                className="flex-1 border border-indigo-300 rounded px-2 py-1 text-[10px] outline-none"
                                                value={newPointInput}
                                                onChange={(e) => setNewPointInput(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && handleAddPoint()}
                                                onBlur={() => { if(!newPointInput) setIsAddingPoint(false); }}
                                                placeholder={t.pg_add_feature_placeholder}
                                            />
                                            <button onClick={handleAddPoint} className="text-indigo-600"><Check size={12}/></button>
                                        </div>
                                    ) : (
                                        <button onClick={() => setIsAddingPoint(true)} className="text-[10px] px-2 py-1 rounded-full border border-dashed border-gray-300 text-gray-400 hover:text-indigo-600 hover:border-indigo-300 flex items-center gap-1">
                                            <Plus size={8}/> {t.pg_add}
                                        </button>
                                    )}
                                </div>
                                {activeSellingPoints.length > 0 && <div className="text-[9px] text-indigo-500 italic">{t.pg_selling_points_guide}</div>}
                            </div>
                        )}

                        {/* 2. REFERENCE CONFIGURATION */}
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center justify-between">
                                {t.pg_reference_config}
                                <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 rounded">{t.pg_multi_modal}</span>
                            </h4>

                            {/* Product Slot (Enhanced) */}
                            <div className="border border-indigo-100 bg-indigo-50/30 rounded-lg p-2 transition-all">
                                <div className="flex justify-between items-center mb-1">
                                    <label className="text-[10px] font-bold text-indigo-800 flex items-center gap-1"><Box size={10}/> {t.pg_product_subject}</label>
                                    {references['product'] && <CheckCircle size={10} className="text-green-500"/>}
                                </div>
                                
                                {/* Active Reference Display */}
                                {references['product'] ? (
                                    <div className="relative h-24 w-full bg-white rounded border border-indigo-100 overflow-hidden group cursor-zoom-in" onClick={() => setLightboxUrl(references['product'].url)}>
                                        <img src={references['product'].url || undefined} className="w-full h-full object-contain p-1" />
                                    </div>
                                ) : (
                                    <div className="h-10 border border-dashed border-indigo-200 rounded flex items-center justify-center text-[10px] text-indigo-300">
                                        {t.pg_select_product_above}
                                    </div>
                                )}

                                {/* Image Grid Selector */}
                                {availableProductImages.length > 1 && (
                                    <div className="mt-2">
                                        <div className="text-[9px] text-indigo-400 mb-1 font-medium">{t.pg_select_active_shot}</div>
                                        <div className="grid grid-cols-4 gap-1">
                                            {availableProductImages.map((url, idx) => (
                                                <div 
                                                    key={idx}
                                                    onClick={() => setActiveProductReference(url)}
                                                    className={`aspect-square rounded border cursor-pointer overflow-hidden relative ${references['product']?.url === url ? 'ring-2 ring-indigo-500 border-indigo-500' : 'border-indigo-100 hover:border-indigo-300'}`}
                                                >
                                                    <img src={url || undefined} className="w-full h-full object-cover"/>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Layout Slot */}
                            <div className="border border-gray-200 rounded-lg p-2">
                                <div className="flex justify-between items-center mb-1">
                                    <label className="text-[10px] font-bold text-gray-600 flex items-center gap-1"><LayoutTemplate size={10}/> {t.pg_layout_composition}</label>
                                    {references['layout'] && <button onClick={() => removeReference('layout')} className="text-red-400 hover:text-red-600"><X size={10}/></button>}
                                </div>
                                {references['layout'] ? (
                                    <div className="space-y-2">
                                        <div className="relative h-20 w-full bg-gray-100 rounded border border-gray-200 overflow-hidden cursor-zoom-in" onClick={() => setLightboxUrl(references['layout'].url)}>
                                            <img src={references['layout'].url || undefined} className="w-full h-full object-cover" />
                                            {restoringDice && <div className="absolute inset-0 bg-white/50 flex items-center justify-center"><Loader2 size={16} className="animate-spin text-indigo-600"/></div>}
                                        </div>
                                        <div className="space-y-1.5 pt-1 border-t border-gray-100">
                                            <div>
                                                <div className="flex justify-between text-[9px] text-gray-500 mb-0.5">
                                                    <span>{t.pg_layout_consistency}</span>
                                                    <span>{genConfig.layoutConsistency ?? 100}%</span>
                                                </div>
                                                <input type="range" min="0" max="100" value={genConfig.layoutConsistency ?? 100} onChange={(e) => setGenConfig({...genConfig, layoutConsistency: parseInt(e.target.value)})} className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
                                            </div>
                                            <div>
                                                <div className="flex justify-between text-[9px] text-gray-500 mb-0.5">
                                                    <span>{t.pg_frame_shape_variance}</span>
                                                    <span>{genConfig.frameShapeVariance ?? 0}%</span>
                                                </div>
                                                <input type="range" min="0" max="100" value={genConfig.frameShapeVariance ?? 0} onChange={(e) => setGenConfig({...genConfig, frameShapeVariance: parseInt(e.target.value)})} className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
                                            </div>
                                            <div>
                                                <div className="flex justify-between text-[9px] text-gray-500 mb-0.5">
                                                    <span>{t.pg_layout_variance}</span>
                                                    <span>{genConfig.layoutVariance ?? 0}%</span>
                                                </div>
                                                <input type="range" min="0" max="100" value={genConfig.layoutVariance ?? 0} onChange={(e) => setGenConfig({...genConfig, layoutVariance: parseInt(e.target.value)})} className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <label className="h-10 border border-dashed border-gray-300 rounded flex items-center justify-center text-[10px] text-gray-400 cursor-pointer hover:bg-gray-50 hover:border-indigo-300 hover:text-indigo-500 transition-all">
                                        <UploadCloud size={12} className="mr-1"/> {t.pg_upload_ref}
                                        <input type="file" className="hidden" accept="image/*" onChange={(e) => e.target.files && handleReferenceUpload('layout', e.target.files[0])}/>
                                    </label>
                                )}
                            </div>

                            {/* Style Slot */}
                            <div className="border border-gray-200 rounded-lg p-2">
                                <div className="flex justify-between items-center mb-1">
                                    <label className="text-[10px] font-bold text-gray-600 flex items-center gap-1"><Sun size={10}/> {t.pg_style_lighting}</label>
                                    {references['style'] && <button onClick={() => removeReference('style')} className="text-red-400 hover:text-red-600"><X size={10}/></button>}
                                </div>
                                {references['style'] ? (
                                    <div className="space-y-2">
                                        <div className="relative h-20 w-full bg-gray-100 rounded border border-gray-200 overflow-hidden cursor-zoom-in" onClick={() => setLightboxUrl(references['style'].url)}>
                                            <img src={references['style'].url || undefined} className="w-full h-full object-cover" />
                                            {restoringDice && <div className="absolute inset-0 bg-white/50 flex items-center justify-center"><Loader2 size={16} className="animate-spin text-indigo-600"/></div>}
                                        </div>
                                        <div className="space-y-1.5 pt-1 border-t border-gray-100">
                                            <div>
                                                <div className="flex justify-between text-[9px] text-gray-500 mb-0.5">
                                                    <span>{t.pg_style_variance}</span>
                                                    <span>{genConfig.styleVariance ?? 0}%</span>
                                                </div>
                                                <input type="range" min="0" max="100" value={genConfig.styleVariance ?? 0} onChange={(e) => setGenConfig({...genConfig, styleVariance: parseInt(e.target.value)})} className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <label className="h-10 border border-dashed border-gray-300 rounded flex items-center justify-center text-[10px] text-gray-400 cursor-pointer hover:bg-gray-50 hover:border-indigo-300 hover:text-indigo-500 transition-all">
                                        <UploadCloud size={12} className="mr-1"/> {t.pg_upload_ref}
                                        <input type="file" className="hidden" accept="image/*" onChange={(e) => e.target.files && handleReferenceUpload('style', e.target.files[0])}/>
                                    </label>
                                )}
                            </div>
                        </div>

                        {/* 3. GENERATION SETTINGS (NEW) */}
                        <div className="pt-2 border-t border-gray-100">
                            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1">
                                <Sliders size={12}/> {t.pg_gen_settings}
                            </h4>
                            
                            <div className="space-y-3">
                                {/* Aspect Ratio */}
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 mb-1">{t.pg_aspect_ratio}</label>
                                    <div className="flex flex-wrap gap-1">
                                        {[
                                            { label: '1:1', val: '1:1', icon: <Box size={10}/> },
                                            { label: '4:3', val: '4:3', icon: <Monitor size={10}/> },
                                            { label: '3:4', val: '3:4', icon: <Smartphone size={10}/> },
                                            { label: '16:9', val: '16:9', icon: <Monitor size={10}/> },
                                            { label: '9:16', val: '9:16', icon: <Smartphone size={10}/> }
                                        ].map(opt => (
                                            <button
                                                key={opt.val}
                                                onClick={() => setGenConfig({ ...genConfig, aspectRatio: opt.val })}
                                                className={`px-2 py-1.5 text-[10px] rounded border transition-all flex items-center gap-1 ${genConfig.aspectRatio === opt.val ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                                            >
                                                {opt.icon} {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Resolution (Only visible if model supports it) */}
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 mb-1">{t.pg_resolution_quality}</label>
                                    <div className="flex flex-wrap gap-1">
                                        {['1K', '2K'].map(res => (
                                            <button
                                                key={res}
                                                onClick={() => setGenConfig({ ...genConfig, resolution: res as any })}
                                                className={`px-3 py-1.5 text-[10px] rounded border transition-colors flex items-center gap-1 ${genConfig.resolution === res ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                                            >
                                                <Scaling size={10}/> {res}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Allow Text Toggle */}
                                <div className="flex items-center justify-between border border-gray-100 rounded p-2 bg-gray-50">
                                    <label className="text-[10px] font-bold text-gray-500 flex items-center gap-1">
                                        {genConfig.allowText ? <Type size={12}/> : <Ban size={12}/>} {t.pg_render_text}
                                    </label>
                                    <button 
                                        onClick={() => setGenConfig({ ...genConfig, allowText: !genConfig.allowText })}
                                        className={`w-8 h-4 rounded-full relative transition-colors ${genConfig.allowText ? 'bg-green-500' : 'bg-gray-300'}`}
                                        title={genConfig.allowText ? t.pg_text_allowed : t.pg_text_blocked}
                                    >
                                        <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${genConfig.allowText ? 'translate-x-4' : ''}`}></div>
                                    </button>
                                </div>

                                {/* Localization Options (Target Language & Font Style) - VISIBLE ONLY IF RENDER TEXT IS TRUE */}
                                {genConfig.allowText && (
                                    <div className="space-y-3 bg-indigo-50/50 p-2 rounded-lg border border-indigo-100 animate-fade-in-up">
                                        
                                        {/* Target Language */}
                                        <div>
                                            <label className="block text-[10px] font-bold text-indigo-700 mb-1 flex items-center gap-1">
                                                <Globe size={10}/> {t.pg_target_language}
                                            </label>
                                            <select 
                                                className="w-full text-[10px] border border-indigo-200 rounded px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:border-indigo-400"
                                                value={genConfig.targetLanguage || 'English (US)'}
                                                onChange={(e) => setGenConfig({ ...genConfig, targetLanguage: e.target.value })}
                                            >
                                                {SUPPORTED_LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                                            </select>
                                        </div>

                                        {/* Font Style */}
                                        <div>
                                            <label className="block text-[10px] font-bold text-indigo-700 mb-1 flex items-center gap-1">
                                                <PenTool size={10}/> {t.pg_font_style}
                                            </label>
                                            <select 
                                                className="w-full text-[10px] border border-indigo-200 rounded px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:border-indigo-400"
                                                value={genConfig.fontStyle || 'Modern Sans-Serif'}
                                                onChange={(e) => setGenConfig({ ...genConfig, fontStyle: e.target.value })}
                                            >
                                                {FONT_STYLES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Dice Library (Saved Styles) */}
                        <div className="pt-4 border-t border-gray-100">
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-2 flex justify-between items-center">
                                {t.pg_dice_library}
                                <span className="bg-purple-100 text-purple-700 px-1.5 rounded text-[10px]">{dice.length}</span>
                            </label>
                            <div className="space-y-3 pb-8">
                                {dice.filter(d => d.userId === currentUser?.id || d.isGlobal).map(d => (
                                    <div 
                                        key={d.id} 
                                        className={`group relative rounded-lg border overflow-hidden cursor-pointer transition-all ${selectedDiceId === d.id ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-gray-200 hover:border-indigo-300'}`}
                                        onClick={() => applyDice(d)}
                                    >
                                        {d.isGlobal && (
                                            <div className="absolute top-1 right-1 bg-indigo-100/80 text-indigo-700 p-0.5 rounded-full z-10 backdrop-blur-sm" title="Global Style">
                                                <Globe size={12} />
                                            </div>
                                        )}
                                        <div className="aspect-[3/1] bg-gray-100 relative">
                                            {d.coverImage ? (
                                                <img src={d.coverImage || undefined} className="w-full h-full object-cover opacity-80" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center bg-indigo-50 text-indigo-300"><Sparkles size={16}/></div>
                                            )}
                                            <div className="absolute bottom-2 left-2 text-white font-bold text-xs truncate w-[90%] drop-shadow-md">{d.name}</div>
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); deleteDice(d.id); }}
                                                className="absolute top-1 right-1 text-white/50 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                <Trash2 size={12}/>
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* MAIN AREA: Chat Interface */}
            <div className="flex-1 flex flex-col h-full min-w-0 bg-slate-50 relative overflow-hidden">
                
                {/* Chat History */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar scroll-smooth min-h-0">
                    {messages.map((msg) => (
                        <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            {msg.role === 'ai' && (
                                <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 mr-3 shrink-0 mt-2">
                                    <Bot size={18}/>
                                </div>
                            )}

                            <div className={`max-w-[80%] ${
                                msg.role === 'user' 
                                ? 'bg-indigo-600 text-white rounded-2xl rounded-br-none' 
                                : 'bg-white border border-gray-200 rounded-2xl rounded-bl-none shadow-sm'
                            } p-4`}>
                                
                                {msg.type === 'text' && (
                                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                                )}

                                {msg.type === 'proposal' && msg.proposalData && (
                                    <ProposalCard msg={msg} />
                                )}

                                {msg.type === 'image' && (
                                    <div className="space-y-2">
                                        <div className="relative group cursor-zoom-in" onClick={() => setLightboxUrl(msg.content)}>
                                            <img src={msg.content || undefined} className="rounded-lg max-w-full shadow-sm" />
                                            <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                <Maximize2 size={24} className="text-white drop-shadow-md"/>
                                            </div>
                                        </div>
                                        <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                                            <span className="text-[10px] text-gray-400 flex items-center gap-1">
                                                {msg.meta?.usedReference && <Box size={10} className="text-indigo-400"/>}
                                                {msg.meta?.modelUsed || 'AI Generated'}
                                            </span>
                                            <button 
                                                onClick={() => handleMagicExtract(msg)}
                                                disabled={isExtracting}
                                                className="flex items-center gap-1.5 text-xs font-bold text-purple-600 hover:bg-purple-50 px-3 py-1.5 rounded transition-colors border border-purple-100"
                                            >
                                                {isExtracting ? <Loader2 size={14} className="animate-spin"/> : <Wand2 size={14}/>}
                                                {t.pg_magic_extract}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {msg.role === 'user' && currentUser && (
                                <div className="w-8 h-8 rounded-full bg-gray-200 overflow-hidden ml-3 shrink-0 mt-2">
                                    <img src={currentUser.avatar || undefined} className="w-full h-full object-cover"/>
                                </div>
                            )}
                        </div>
                    ))}
                    
                    {isThinking && (
                        <div className="flex justify-start items-center gap-3 ml-11">
                            <div className="flex space-x-1">
                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                            </div>
                            <span className="text-xs text-gray-400">{t.pg_analysing_scene}</span>
                        </div>
                    )}

                    {isGenerating && (
                        <div className="flex justify-start ml-11">
                            <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-none p-4 shadow-sm flex items-center gap-3">
                                <Loader2 size={20} className="animate-spin text-indigo-600"/>
                                <span className="text-sm text-gray-500 font-medium">{t.pg_rendering_image}</span>
                            </div>
                        </div>
                    )}
                    <div ref={chatEndRef} />
                </div>

                {/* Input Area - Sticky Floating Footer */}
                <div className="p-4 bg-white border-t border-gray-200 shrink-0 z-20 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] relative">
                    <div className="max-w-4xl mx-auto relative z-10">
                        <textarea
                            className="w-full border border-gray-300 rounded-xl pl-4 pr-12 py-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none shadow-sm transform-gpu"
                            placeholder={selectedProductId ? t.pg_describe_placeholder : t.pg_select_first}
                            rows={selectedDiceId ? 3 : 1}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                    e.preventDefault();
                                    handleSendChat();
                                }
                            }}
                            disabled={!selectedProductId || isGenerating || isThinking}
                        />
                        <button 
                            onClick={handleSendChat}
                            disabled={!input.trim() || !selectedProductId || isGenerating || isThinking}
                            className="absolute right-2 bottom-2 p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
                        >
                            <Send size={18}/>
                        </button>
                    </div>
                </div>
            </div>

            {/* MAGIC EXTRACT CONFIRMATION MODAL (ENHANCED V2.14) */}
            {extractData && (
                <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in-up">
                    <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-purple-100 max-h-[90vh]">
                        <div className="p-5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white flex justify-between items-center shrink-0">
                            <h3 className="font-bold flex items-center gap-2 text-lg">
                                <Sparkles size={20} className="text-yellow-300"/> {t.pg_save_magic_dice}
                            </h3>
                            <button onClick={() => setExtractData(null)} className="text-white/70 hover:text-white p-1 rounded-full hover:bg-white/10"><X size={20}/></button>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                            {/* Preview & Basic Info */}
                            <div className="flex gap-4">
                                <img src={extractData.coverImage || undefined} className="w-24 h-24 rounded-lg object-cover border border-gray-200 shadow-sm"/>
                                <div className="flex-1 space-y-3">
                                    <div>
                                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{t.pg_style_name}</label>
                                        <input 
                                            className="w-full border-b border-gray-300 py-1 text-sm font-bold text-gray-800 focus:border-purple-500 outline-none bg-transparent"
                                            value={extractData.name}
                                            onChange={(e) => setExtractData({...extractData, name: e.target.value})}
                                            placeholder={t.pg_style_name_placeholder}
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{t.pg_keywords}</label>
                                        <div className="flex flex-wrap gap-1">
                                            {extractData.tags.map((tag, idx) => (
                                                <span key={idx} className="bg-purple-50 text-purple-700 px-2 py-0.5 rounded text-xs flex items-center">
                                                    {tag}
                                                    <button onClick={() => setExtractData({...extractData, tags: extractData.tags.filter((_, i) => i !== idx)})} className="ml-1 hover:text-red-500"><X size={10}/></button>
                                                </span>
                                            ))}
                                            <button 
                                                onClick={() => {
                                                    const newTag = prompt(t.pg_add_tag_prompt);
                                                    if(newTag) setExtractData({...extractData, tags: [...extractData.tags, newTag]});
                                                }}
                                                className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded text-xs hover:bg-gray-200"
                                            >+ {t.pg_add}</button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Core Templates */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-2">
                                    <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 flex items-center justify-between">
                                        <span>{t.pg_prompt_template}</span>
                                        <span className="text-[9px] bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded">{t.pg_subject_removed}</span>
                                    </label>
                                    <textarea 
                                        className="w-full border border-gray-200 rounded-lg p-3 text-xs text-gray-600 bg-gray-50 focus:ring-1 focus:ring-purple-500 outline-none h-24 resize-none leading-relaxed"
                                        value={extractData.template}
                                        onChange={(e) => setExtractData({...extractData, template: e.target.value})}
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 flex items-center gap-1">
                                        <Ban size={10}/> {t.pg_negative_prompt}
                                    </label>
                                    <textarea 
                                        className="w-full border border-gray-200 rounded-lg p-3 text-xs text-red-600 bg-red-50/30 focus:ring-1 focus:ring-red-300 outline-none h-16 resize-none leading-relaxed"
                                        value={extractData.negativePrompt}
                                        onChange={(e) => setExtractData({...extractData, negativePrompt: e.target.value})}
                                        placeholder={t.pg_negative_prompt_placeholder}
                                    />
                                </div>
                            </div>

                            {/* Style Directives (Structured) */}
                            <div className="bg-indigo-50/50 rounded-xl p-4 border border-indigo-100 space-y-4">
                                <div className="flex items-center gap-2 text-indigo-700 font-bold text-xs border-b border-indigo-200 pb-2 mb-2">
                                    <FileJson size={12}/> {t.pg_style_directives}
                                </div>
                                
                                <div>
                                    <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{t.pg_text_rendering_rules}</label>
                                    <input 
                                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs bg-white focus:border-indigo-400 outline-none"
                                        value={extractData.styleDirectives.textRendering}
                                        onChange={(e) => setExtractData({...extractData, styleDirectives: { ...extractData.styleDirectives, textRendering: e.target.value }})}
                                        placeholder={t.pg_text_rendering_placeholder}
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{t.pg_feature_highlighting}</label>
                                    <input 
                                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs bg-white focus:border-indigo-400 outline-none"
                                        value={extractData.styleDirectives.featureHighlight}
                                        onChange={(e) => setExtractData({...extractData, styleDirectives: { ...extractData.styleDirectives, featureHighlight: e.target.value }})}
                                        placeholder={t.pg_feature_highlight_placeholder}
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{t.pg_composition_rules}</label>
                                    <input 
                                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs bg-white focus:border-indigo-400 outline-none"
                                        value={extractData.styleDirectives.compositionRules}
                                        onChange={(e) => setExtractData({...extractData, styleDirectives: { ...extractData.styleDirectives, compositionRules: e.target.value }})}
                                        placeholder={t.pg_composition_rules_placeholder}
                                    />
                                </div>
                            </div>

                            {/* Saved Config Info */}
                            <div className="grid grid-cols-2 gap-4 bg-gray-50 rounded p-3 text-xs text-gray-500 border border-gray-100">
                                <div className="space-y-2">
                                    <div className="text-[10px] font-bold uppercase mb-1">{t.pg_config_parameters}</div>
                                    <div className="flex gap-2">
                                        <select 
                                            className="bg-white border px-2 py-1 rounded text-xs"
                                            value={extractData.originalConfig.aspectRatio}
                                            onChange={(e) => setExtractData({...extractData, originalConfig: {...extractData.originalConfig, aspectRatio: e.target.value}})}
                                        >
                                            <option value="1:1">1:1</option>
                                            <option value="16:9">16:9</option>
                                            <option value="9:16">9:16</option>
                                            <option value="4:3">4:3</option>
                                            <option value="3:4">3:4</option>
                                        </select>
                                        <select 
                                            className="bg-white border px-2 py-1 rounded text-xs"
                                            value={extractData.originalConfig.resolution}
                                            onChange={(e) => setExtractData({...extractData, originalConfig: {...extractData.originalConfig, resolution: e.target.value as any}})}
                                        >
                                            <option value="1K">1K</option>
                                            <option value="2K">2K</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <div className="text-[10px] font-bold uppercase mb-1">{t.pg_references_saved}</div>
                                    <div className="flex gap-2">
                                        {extractData.snapshotReferences['layout'] && <span className="bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded flex items-center gap-1"><Check size={8}/> {t.pg_layout}</span>}
                                        {extractData.snapshotReferences['style'] && <span className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded flex items-center gap-1"><Check size={8}/> {t.pg_style}</span>}
                                        {!extractData.snapshotReferences['layout'] && !extractData.snapshotReferences['style'] && <span className="text-gray-400 italic">{t.pg_none}</span>}
                                    </div>
                                </div>
                            </div>
                            
                            {/* Global Visibility Toggle */}
                            {canManageGlobalDice && (
                                <div className="flex items-center gap-2 mt-4 p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                                    <input 
                                        type="checkbox" 
                                        id="isGlobal" 
                                        checked={extractData.isGlobal}
                                        onChange={(e) => setExtractData({...extractData, isGlobal: e.target.checked})}
                                        className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                                    />
                                    <label htmlFor="isGlobal" className="text-sm font-medium text-indigo-900 flex items-center gap-1">
                                        <Globe size={14} /> {t.pg_make_global}
                                    </label>
                                </div>
                            )}
                        </div>

                        <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-between items-center gap-2 shrink-0">
                            <button onClick={() => setExtractData(null)} className="px-4 py-2 text-gray-600 text-sm font-bold hover:bg-gray-100 rounded-lg">{t.pg_cancel}</button>
                            <div className="flex gap-2">
                                {selectedDiceId && (
                                    <button 
                                        onClick={() => handleSaveDice(true)} // Pass true for update
                                        disabled={isSavingDice} 
                                        className="px-4 py-2 bg-indigo-100 text-indigo-700 text-sm font-bold rounded-lg hover:bg-indigo-200 flex items-center gap-2 disabled:opacity-70 border border-indigo-200"
                                    >
                                        {isSavingDice ? <Loader2 size={14} className="animate-spin"/> : <RefreshCw size={14}/>} {t.pg_update_current}
                                    </button>
                                )}
                                <button 
                                    onClick={() => handleSaveDice(false)} 
                                    disabled={isSavingDice} 
                                    className="px-6 py-2 bg-purple-600 text-white text-sm font-bold rounded-lg hover:bg-purple-700 shadow-md flex items-center gap-2 disabled:opacity-70"
                                >
                                    {isSavingDice ? <Loader2 size={16} className="animate-spin"/> : <Save size={16}/>} 
                                    {selectedDiceId ? t.pg_save_new : t.pg_save_library}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Lightbox */}
            {lightboxUrl && (
                <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-8 animate-fade-in-up" onClick={() => setLightboxUrl(null)}>
                    <button className="absolute top-6 right-6 text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors">
                        <X size={32} />
                    </button>
                    <img src={lightboxUrl || undefined} className="max-w-full max-h-full object-contain rounded shadow-2xl" onClick={(e) => e.stopPropagation()}/>
                </div>
            )}

            {/* DEBUG PAYLOAD MODAL */}
            {debugPayload && (
                <div className="fixed inset-0 z-[130] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in-up">
                    <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 max-h-[80vh]">
                        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                            <h3 className="font-bold flex items-center gap-2 text-gray-800">
                                <Bug size={18} className="text-red-500"/> Debug Payload
                            </h3>
                            <button onClick={() => setDebugPayload(null)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
                        </div>
                        <div className="p-4 overflow-auto custom-scrollbar bg-slate-900">
                            <pre className="text-xs font-mono text-green-400 whitespace-pre-wrap break-all">
                                {JSON.stringify(debugPayload, null, 2)}
                            </pre>
                        </div>
                        <div className="p-3 bg-gray-50 border-t border-gray-200 text-right">
                            <button onClick={() => setDebugPayload(null)} className="px-4 py-2 bg-white border border-gray-300 rounded text-sm font-medium hover:bg-gray-50">Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
