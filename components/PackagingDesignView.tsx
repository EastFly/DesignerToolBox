import React, { useState, useEffect, useRef } from 'react';
import { UploadCloud, Loader2, Sparkles, X, Camera, Wand2, Plus, Minus } from 'lucide-react';
import { Language, translations } from '../i18n';
import { GoogleGenAI, Type } from '@google/genai';
import { db } from '../services/db';
import { Rnd } from 'react-rnd';

interface FaceText {
    style: string;
    copy: string;
    layout: string;
}

interface FaceImages {
    product?: string;
    layout?: string;
    style?: string;
}

interface PackagingDesignViewProps {
    lang: Language;
}

export const PackagingDesignView: React.FC<PackagingDesignViewProps> = ({ lang }) => {
    const t = translations[lang];

    // Packaging Design State
    const [products, setProducts] = useState<any[]>([]);
    const [selectedProductId, setSelectedProductId] = useState<string>('');
    const [pkgType, setPkgType] = useState<'box' | 'pouch' | 'tube'>('box');
    const [pkgDims, setPkgDims] = useState({ length: 100, width: 50, height: 150 });
    
    const [pkgFaceImages, setPkgFaceImages] = useState<Record<string, FaceImages>>({});
    const [pkgFaceText, setPkgFaceText] = useState<Record<string, FaceText>>({});
    const [pkgTextFile, setPkgTextFile] = useState<File | null>(null);
    const [pkgParsedText, setPkgParsedText] = useState<any>(null);
    const [isParsingText, setIsParsingText] = useState(false);
    const [pkgGlobalPrompt, setPkgGlobalPrompt] = useState('');
    
    const [pkgStyleRef, setPkgStyleRef] = useState<string | null>(null);
    const [isExtractingStyle, setIsExtractingStyle] = useState(false);
    const [pkgGeneratedFaces, setPkgGeneratedFaces] = useState<Record<string, string>>({});
    const [pkgOriginalFaces, setPkgOriginalFaces] = useState<Record<string, string>>({});
    const [isGeneratingPkg, setIsGeneratingPkg] = useState(false);
    const [generatingFace, setGeneratingFace] = useState<string | null>(null);
    const [model, setModel] = useState<'gemini-3.1-flash-image-preview' | 'gemini-3-pro-image-preview'>('gemini-3.1-flash-image-preview');
    
    const [pkgViewMode, setPkgViewMode] = useState<'2d' | '3d'>('2d');
    const [rotX, setRotX] = useState(-20);
    const [rotY, setRotY] = useState(-30);
    const [zoom, setZoom] = useState(1);
    const [isDragging3D, setIsDragging3D] = useState(false);
    const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });

    // Crop Modal State
    const [cropModalFace, setCropModalFace] = useState<string | null>(null);
    const [cropBox, setCropBox] = useState({ x: 0, y: 0, width: 100, height: 100 });
    const [cropImgAspect, setCropImgAspect] = useState(1);
    const [pkgFaceBgColor, setPkgFaceBgColor] = useState<Record<string, string>>({});
    const cropImgRef = useRef<HTMLImageElement>(null);
    const cropContainerRef = useRef<HTMLDivElement>(null);

    // Image Selection Modal State
    const [isImageModalOpen, setIsImageModalOpen] = useState(false);
    const [currentSelectingFace, setCurrentSelectingFace] = useState<string | null>(null);

    useEffect(() => {
        db.getProducts().then(setProducts).catch(console.error);
    }, []);

    const selectedProduct = products.find(p => p.id === selectedProductId);
    
    // Extract unique images from product
    const productImages: string[] = [];
    if (selectedProduct) {
        const syncedImg = selectedProduct.data['productImage'];
        if (Array.isArray(syncedImg)) productImages.push(...syncedImg);
        else if (typeof syncedImg === 'string' && syncedImg) productImages.push(syncedImg);

        const gallery = selectedProduct.data['galleryImages'];
        if (Array.isArray(gallery)) productImages.push(...gallery);
    }
    const uniqueProductImages = Array.from(new Set(productImages.filter(url => typeof url === 'string' && url.trim() !== '')));

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
        // @ts-ignore
        if (!apiKey && typeof window !== 'undefined' && window.aistudio) {
            // @ts-ignore
            if (await window.aistudio.hasSelectedApiKey()) {
                apiKey = process.env.API_KEY || '';
            } else {
                // @ts-ignore
                await window.aistudio.openSelectKey();
                apiKey = process.env.API_KEY || '';
            }
        }
        return apiKey;
    };

    const handleTextFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setPkgTextFile(file);
        setIsParsingText(true);
        
        try {
            const apiKey = await getApiKey();
            if (!apiKey) throw new Error("API Key required");
            const ai = new GoogleGenAI({ apiKey });
            
            const mimeType = file.type || 'application/pdf';
            const reader = new FileReader();
            const base64Promise = new Promise<string>((resolve) => {
                reader.onload = (ev) => resolve((ev.target?.result as string).split(',')[1]);
                reader.readAsDataURL(file);
            });
            const base64Data = await base64Promise;

            const response = await ai.models.generateContent({
                model: 'gemini-3.1-pro-preview',
                contents: [
                    {
                        inlineData: {
                            data: base64Data,
                            mimeType: mimeType
                        }
                    },
                    "Extract the packaging design requirements from this document. Return a JSON object with 'overall' (string) and 'faces' (object mapping 'front', 'back', 'left', 'right', 'top', 'bottom' to objects with 'content' and 'copy' strings)."
                ],
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            overall: { type: Type.STRING },
                            faces: {
                                type: Type.OBJECT,
                                properties: {
                                    front: { type: Type.OBJECT, properties: { content: { type: Type.STRING }, copy: { type: Type.STRING } } },
                                    back: { type: Type.OBJECT, properties: { content: { type: Type.STRING }, copy: { type: Type.STRING } } },
                                    left: { type: Type.OBJECT, properties: { content: { type: Type.STRING }, copy: { type: Type.STRING } } },
                                    right: { type: Type.OBJECT, properties: { content: { type: Type.STRING }, copy: { type: Type.STRING } } },
                                    top: { type: Type.OBJECT, properties: { content: { type: Type.STRING }, copy: { type: Type.STRING } } },
                                    bottom: { type: Type.OBJECT, properties: { content: { type: Type.STRING }, copy: { type: Type.STRING } } }
                                }
                            }
                        }
                    }
                }
            });
            
            if (response.text) {
                const parsed = JSON.parse(response.text);
                setPkgParsedText(parsed);
                
                if (parsed.overall) {
                    setPkgGlobalPrompt(prev => prev ? prev + "\n" + parsed.overall : parsed.overall);
                }
                
                if (parsed.faces) {
                    const newFaceText = { ...pkgFaceText };
                    Object.keys(parsed.faces).forEach(face => {
                        const data = parsed.faces[face];
                        newFaceText[face] = {
                            style: newFaceText[face]?.style || '',
                            layout: data.content || newFaceText[face]?.layout || '',
                            copy: data.copy || newFaceText[face]?.copy || ''
                        };
                    });
                    setPkgFaceText(newFaceText);
                }
            }
        } catch (err) {
            console.error("Failed to parse document", err);
            alert("Failed to parse document");
            setPkgTextFile(null);
        } finally {
            setIsParsingText(false);
        }
    };

    const handleLocalImageUpload = (face: string, type: 'product' | 'layout' | 'style', e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            if (ev.target?.result) {
                setPkgFaceImages(prev => ({
                    ...prev,
                    [face]: { ...(prev[face] || {}), [type]: ev.target!.result as string }
                }));
            }
        };
        reader.readAsDataURL(file);
    };

    const handleSelectProductImage = (face: string, imgUrl: string) => {
        setPkgFaceImages(prev => ({ ...prev, [face]: { ...(prev[face] || {}), product: imgUrl } }));
        setIsImageModalOpen(false);
    };

    const openImageSelection = (face: string) => {
        setCurrentSelectingFace(face);
        setIsImageModalOpen(true);
    };

    const updateFaceText = (face: string, field: 'style' | 'layout' | 'copy', value: string) => {
        setPkgFaceText(prev => ({
            ...prev,
            [face]: { ...(prev[face] || { style: '', layout: '', copy: '' }), [field]: value }
        }));
    };

    const removeFaceImage = (face: string, type: 'product' | 'layout' | 'style') => {
        setPkgFaceImages(prev => {
            const next = { ...prev };
            if (next[face]) {
                const updatedFace = { ...next[face] };
                delete updatedFace[type];
                next[face] = updatedFace;
            }
            return next;
        });
    };

    const handleExtractStyle = async () => {
        if (!pkgStyleRef) return;
        setIsExtractingStyle(true);
        try {
            const apiKey = await getApiKey();
            if (!apiKey) throw new Error("API Key required");
            const ai = new GoogleGenAI({ apiKey });
            const { data, mimeType } = await urlToBase64(pkgStyleRef);
            
            const prompt = `Analyze this packaging style reference image. Extract the overall style and suggest layout descriptions for a 6-sided box (front, back, left, right, top, bottom).
            Return ONLY a valid JSON object with this structure:
            {
                "globalStyle": "...",
                "faces": {
                    "front": { "style": "...", "layout": "..." },
                    "back": { "style": "...", "layout": "..." },
                    "left": { "style": "...", "layout": "..." },
                    "right": { "style": "...", "layout": "..." },
                    "top": { "style": "...", "layout": "..." },
                    "bottom": { "style": "...", "layout": "..." }
                }
            }`;
            
            const response = await ai.models.generateContent({
                model: 'gemini-3.1-pro-preview',
                contents: [
                    { inlineData: { data, mimeType } },
                    { text: prompt }
                ],
                config: { responseMimeType: "application/json" }
            });
            
            if (response.text) {
                const parsed = JSON.parse(response.text);
                if (parsed.globalStyle) setPkgGlobalPrompt(parsed.globalStyle);
                if (parsed.faces) {
                    setPkgFaceText(prev => {
                        const next = { ...prev };
                        Object.keys(parsed.faces).forEach(f => {
                            next[f] = {
                                ...next[f],
                                style: parsed.faces[f].style || '',
                                layout: parsed.faces[f].layout || ''
                            };
                        });
                        return next;
                    });
                }
            }
        } catch (e) {
            console.error(e);
            alert("Failed to extract style");
        } finally {
            setIsExtractingStyle(false);
        }
    };

    const urlToBase64 = async (url: string): Promise<{ data: string, mimeType: string }> => {
        if (url.startsWith('data:')) {
            const [header, data] = url.split(',');
            const mimeType = header.split(':')[1].split(';')[0];
            return { data, mimeType };
        }
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64data = reader.result as string;
                const [header, data] = base64data.split(',');
                const mimeType = header.split(':')[1].split(';')[0] || blob.type || 'image/jpeg';
                resolve({ data, mimeType });
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    };

    const getClosestAspectRatio = (w: number, h: number, model: string) => {
        const ratio = w / h;
        let supported = [
            { str: "1:1", val: 1 },
            { str: "4:3", val: 4/3 },
            { str: "3:4", val: 3/4 },
            { str: "16:9", val: 16/9 },
            { str: "9:16", val: 9/16 }
        ];
        if (model === 'gemini-3.1-flash-image-preview') {
            supported.push(
                { str: "4:1", val: 4 },
                { str: "1:4", val: 1/4 },
                { str: "8:1", val: 8 },
                { str: "1:8", val: 1/8 }
            );
        }
        
        let closest = supported[0];
        let minDiff = Math.abs(ratio - closest.val);
        for (const r of supported) {
            const diff = Math.abs(ratio - r.val);
            if (diff < minDiff) {
                minDiff = diff;
                closest = r;
            }
        }
        return closest.str;
    };

    const generateFaceLogic = async (face: string, currentFaces: Record<string, string>): Promise<string | null> => {
        const apiKey = await getApiKey();
        if (!apiKey) throw new Error("API Key required");
        const ai = new GoogleGenAI({ apiKey });
        
        // Determine dimensions for this face
        let faceW = pkgDims.length;
        let faceH = pkgDims.height;
        if (face === 'left' || face === 'right') {
            faceW = pkgDims.width;
            faceH = pkgDims.height;
        } else if (face === 'top' || face === 'bottom') {
            faceW = pkgDims.length;
            faceH = pkgDims.width;
        }
        
        const aspectRatio = getClosestAspectRatio(faceW, faceH, model);
        
        let facePrompt = `Design the ${face} face of a product packaging. `;
        facePrompt += `Ensure the design has a safe margin or bleed area around the edges so that important text or graphics are not cut off when folded or mapped to a 3D model. `;
        if (pkgGlobalPrompt) facePrompt += `Global style/requirements: ${pkgGlobalPrompt}. `;
        
        if (pkgFaceText[face]) {
            const fText = pkgFaceText[face];
            if (fText.style) facePrompt += `\nStyle for this face: ${fText.style}. `;
            if (fText.layout) facePrompt += `\nLayout for this face: ${fText.layout}. `;
            if (fText.copy) facePrompt += `\nCRITICAL TEXT INSTRUCTION: You must render EXACTLY the following text on this face and NO OTHER TEXT. Do not hallucinate or add any extra words, labels, or gibberish. Exact text to render: "${fText.copy}". `;
        }
        
        const parts: any[] = [{ text: facePrompt }];
        
        if (pkgFaceImages[face]) {
            const fImgs = pkgFaceImages[face];
            if (fImgs.product) {
                try {
                    const { data, mimeType } = await urlToBase64(fImgs.product);
                    parts.push({ text: "Include this product image on this face:" });
                    parts.push({ inlineData: { data, mimeType } });
                } catch (e) {
                    console.error("Failed to process product image:", e);
                }
            }
            if (fImgs.layout) {
                try {
                    const { data, mimeType } = await urlToBase64(fImgs.layout);
                    parts.push({ text: "Use this image strictly as a layout/composition reference for this face:" });
                    parts.push({ inlineData: { data, mimeType } });
                } catch (e) {
                    console.error("Failed to process layout image:", e);
                }
            }
            if (fImgs.style) {
                try {
                    const { data, mimeType } = await urlToBase64(fImgs.style);
                    parts.push({ text: "Use this image strictly as a style/color/texture reference for this face:" });
                    parts.push({ inlineData: { data, mimeType } });
                } catch (e) {
                    console.error("Failed to process style image:", e);
                }
            }
        }
        
        // Use the front face as a reference for subsequent faces to ensure style consistency
        if (face !== 'front' && currentFaces['front']) {
            parts.push({ text: "CRITICAL: Match the exact visual style, color palette, and background of this primary front face to ensure packaging consistency:" });
            try {
                const { data, mimeType } = await urlToBase64(currentFaces['front']);
                parts.push({ inlineData: { data, mimeType } });
            } catch (e) {
                console.error("Failed to process front face ref:", e);
            }
        }
        
        const response = await ai.models.generateContent({
            model: model,
            contents: { parts },
            config: { imageConfig: { aspectRatio: aspectRatio as any } }
        });
        
        db.logModelUsage('XLab', model, { type: 'packaging_design', prompt: facePrompt }).catch(console.error);
        
        if (response.candidates && response.candidates[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData) {
                    return `data:image/jpeg;base64,${part.inlineData.data}`;
                }
            }
        }
        return null;
    };

    const handleGenerateSingleFace = async (face: string) => {
        if (!selectedProductId) return;
        setIsGeneratingPkg(true);
        setGeneratingFace(face);
        try {
            const imgUrl = await generateFaceLogic(face, pkgGeneratedFaces);
            if (imgUrl) {
                setPkgOriginalFaces(prev => ({ ...prev, [face]: imgUrl }));
                setPkgGeneratedFaces(prev => ({ ...prev, [face]: imgUrl }));
            }
        } catch (e) {
            console.error(e);
            alert(`Failed to generate ${face} face`);
        } finally {
            setIsGeneratingPkg(false);
            setGeneratingFace(null);
        }
    };

    const handleGenerateAll = async () => {
        if (!selectedProductId) return;
        setIsGeneratingPkg(true);
        
        try {
            const faces = ['front', 'back', 'left', 'right', 'top', 'bottom'];
            let currentFaces = { ...pkgGeneratedFaces };
            let currentOriginals = { ...pkgOriginalFaces };
            
            for (const face of faces) {
                setGeneratingFace(face);
                const imgUrl = await generateFaceLogic(face, currentFaces);
                if (imgUrl) {
                    currentFaces[face] = imgUrl;
                    currentOriginals[face] = imgUrl;
                    setPkgGeneratedFaces({ ...currentFaces });
                    setPkgOriginalFaces({ ...currentOriginals });
                }
            }
        } catch (e) {
            console.error(e);
            alert("Failed to generate packaging");
        } finally {
            setIsGeneratingPkg(false);
            setGeneratingFace(null);
        }
    };

    const extractAverageColor = (imgUrl: string, face: string) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            
            // Sample points from the edges
            const samplePoints = [
                { x: 10, y: 10 },
                { x: img.width - 10, y: 10 },
                { x: 10, y: img.height - 10 },
                { x: img.width - 10, y: img.height - 10 },
                { x: img.width / 2, y: 10 },
                { x: img.width / 2, y: img.height - 10 },
                { x: 10, y: img.height / 2 },
                { x: img.width - 10, y: img.height / 2 },
            ];
            
            let r = 0, g = 0, b = 0;
            let validPoints = 0;
            
            samplePoints.forEach(p => {
                if (p.x >= 0 && p.x < img.width && p.y >= 0 && p.y < img.height) {
                    const data = ctx.getImageData(p.x, p.y, 1, 1).data;
                    r += data[0];
                    g += data[1];
                    b += data[2];
                    validPoints++;
                }
            });
            
            if (validPoints > 0) {
                r = Math.round(r / validPoints);
                g = Math.round(g / validPoints);
                b = Math.round(b / validPoints);
                
                const hex = "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
                setPkgFaceBgColor(prev => ({ ...prev, [face]: hex }));
            }
        };
        img.src = imgUrl;
    };

    const openCropModal = (face: string) => {
        if (!pkgOriginalFaces[face]) {
            alert(`Please generate the ${face} face first before cropping.`);
            return;
        }
        setCropModalFace(face);
        // Calculate aspect ratio based on face dimensions
        let aspect = 1;
        if (face === 'front' || face === 'back') {
            aspect = pkgDims.length / pkgDims.height;
        } else if (face === 'left' || face === 'right') {
            aspect = pkgDims.width / pkgDims.height;
        } else if (face === 'top' || face === 'bottom') {
            aspect = pkgDims.length / pkgDims.width;
        }
        setCropImgAspect(aspect);
        
        // Reset crop state (will be updated on image load)
        setCropBox({ x: 0, y: 0, width: 100, height: 100 });
        
        // Extract background color if not already set
        if (!pkgFaceBgColor[face]) {
            extractAverageColor(pkgOriginalFaces[face], face);
        }
    };

    const handleSaveCrop = () => {
        if (!cropModalFace || !pkgOriginalFaces[cropModalFace] || !cropImgRef.current) return;
        
        const displayImg = cropImgRef.current;
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            
            const scaleX = img.width / displayImg.width;
            const scaleY = img.height / displayImg.height;
            
            const sourceX = cropBox.x * scaleX;
            const sourceY = cropBox.y * scaleY;
            const sourceWidth = cropBox.width * scaleX;
            const sourceHeight = cropBox.height * scaleY;
            
            // Calculate canvas size based on face aspect ratio
            let canvasWidth, canvasHeight;
            if (sourceWidth / sourceHeight > cropImgAspect) {
                // Crop is wider than face aspect, so width dictates canvas size
                canvasWidth = sourceWidth;
                canvasHeight = sourceWidth / cropImgAspect;
            } else {
                // Crop is taller than face aspect, so height dictates canvas size
                canvasHeight = sourceHeight;
                canvasWidth = sourceHeight * cropImgAspect;
            }
            
            canvas.width = canvasWidth;
            canvas.height = canvasHeight;
            
            // Fill background
            const bgColor = pkgFaceBgColor[cropModalFace] || '#ffffff';
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);
            
            // Draw cropped image centered
            const drawX = (canvasWidth - sourceWidth) / 2;
            const drawY = (canvasHeight - sourceHeight) / 2;
            
            ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, drawX, drawY, sourceWidth, sourceHeight);
            
            const croppedDataUrl = canvas.toDataURL('image/jpeg', 0.9);
            setPkgGeneratedFaces(prev => ({ ...prev, [cropModalFace]: croppedDataUrl }));
            setCropModalFace(null);
        };
        img.src = pkgOriginalFaces[cropModalFace];
    };

    return (
        <div className="flex-1 flex flex-col md:flex-row h-full">
            {/* Left: Unfolded Template Area */}
            <div className="flex-1 bg-gray-100 p-6 flex flex-col relative overflow-hidden">
                {!selectedProductId ? (
                    <div className="flex-1 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center bg-white">
                        <div className="w-16 h-16 bg-indigo-50 text-indigo-500 rounded-full flex items-center justify-center mb-4">
                            <UploadCloud size={32} />
                        </div>
                        <h3 className="text-lg font-bold text-gray-800 mb-2">{t.xlab_pkg_no_product || 'Select a product to continue'}</h3>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col h-full bg-white rounded-xl border border-gray-200 shadow-sm p-4 overflow-auto">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-gray-700">{pkgViewMode === '2d' ? (t.xlab_pkg_unfolded || 'Unfolded Template') : '3D Preview'}</h3>
                            <div className="flex bg-gray-200 p-1 rounded-lg">
                                <button 
                                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${pkgViewMode === '2d' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                    onClick={() => setPkgViewMode('2d')}
                                >
                                    2D
                                </button>
                                <button 
                                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${pkgViewMode === '3d' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                    onClick={() => setPkgViewMode('3d')}
                                >
                                    3D
                                </button>
                            </div>
                        </div>
                        <div 
                            className="flex-1 flex items-center justify-center min-h-[500px] overflow-hidden relative"
                            onWheel={(e) => {
                                if (e.deltaY !== 0) {
                                    setZoom(prev => Math.max(0.2, Math.min(prev + (e.deltaY > 0 ? -0.1 : 0.1), 5)));
                                }
                            }}
                        >
                            {/* Zoom Controls */}
                            <div className="absolute bottom-4 right-4 flex bg-white shadow-md rounded-lg overflow-hidden border border-gray-200 z-10">
                                <button onClick={() => setZoom(p => Math.max(0.2, p - 0.1))} className="p-2 hover:bg-gray-100 border-r border-gray-200 text-gray-600">
                                    <Minus size={16} />
                                </button>
                                <button onClick={() => setZoom(1)} className="px-3 py-2 hover:bg-gray-100 border-r border-gray-200 text-xs font-medium text-gray-600">
                                    {Math.round(zoom * 100)}%
                                </button>
                                <button onClick={() => setZoom(p => Math.min(5, p + 0.1))} className="p-2 hover:bg-gray-100 text-gray-600">
                                    <Plus size={16} />
                                </button>
                            </div>

                            {pkgViewMode === '2d' ? (
                                /* Simple Box Unfolded Visualization */
                                pkgType === 'box' && (
                                    <div className="relative transition-transform" style={{ width: pkgDims.length * 2 + pkgDims.width * 2, height: pkgDims.height + pkgDims.width * 2, transform: `scale(${Math.min(1, 400 / (pkgDims.length * 2 + pkgDims.width * 2)) * zoom})` }}>
                                        {/* Top */}
                                        <div className="absolute border border-gray-400 bg-indigo-50 flex items-center justify-center text-xs text-indigo-800 font-medium cursor-pointer hover:ring-2 hover:ring-indigo-500 hover:z-10 transition-all"
                                             style={{ top: 0, left: pkgDims.width, width: pkgDims.length, height: pkgDims.width }}
                                             onClick={() => openCropModal('top')}>
                                            {pkgGeneratedFaces['top'] ? <img src={pkgGeneratedFaces['top']} className="w-full h-full object-cover" /> : t.xlab_pkg_top || 'Top'}
                                        </div>
                                        {/* Left */}
                                        <div className="absolute border border-gray-400 bg-indigo-50 flex items-center justify-center text-xs text-indigo-800 font-medium cursor-pointer hover:ring-2 hover:ring-indigo-500 hover:z-10 transition-all"
                                             style={{ top: pkgDims.width, left: 0, width: pkgDims.width, height: pkgDims.height }}
                                             onClick={() => openCropModal('left')}>
                                            {pkgGeneratedFaces['left'] ? <img src={pkgGeneratedFaces['left']} className="w-full h-full object-cover" /> : t.xlab_pkg_left || 'Left'}
                                        </div>
                                        {/* Front */}
                                        <div className="absolute border border-gray-400 bg-indigo-100 flex items-center justify-center text-xs text-indigo-900 font-bold cursor-pointer hover:ring-2 hover:ring-indigo-500 hover:z-10 transition-all"
                                             style={{ top: pkgDims.width, left: pkgDims.width, width: pkgDims.length, height: pkgDims.height }}
                                             onClick={() => openCropModal('front')}>
                                            {pkgGeneratedFaces['front'] ? <img src={pkgGeneratedFaces['front']} className="w-full h-full object-cover" /> : t.xlab_pkg_front || 'Front'}
                                        </div>
                                        {/* Right */}
                                        <div className="absolute border border-gray-400 bg-indigo-50 flex items-center justify-center text-xs text-indigo-800 font-medium cursor-pointer hover:ring-2 hover:ring-indigo-500 hover:z-10 transition-all"
                                             style={{ top: pkgDims.width, left: pkgDims.width + pkgDims.length, width: pkgDims.width, height: pkgDims.height }}
                                             onClick={() => openCropModal('right')}>
                                            {pkgGeneratedFaces['right'] ? <img src={pkgGeneratedFaces['right']} className="w-full h-full object-cover" /> : t.xlab_pkg_right || 'Right'}
                                        </div>
                                        {/* Back */}
                                        <div className="absolute border border-gray-400 bg-indigo-50 flex items-center justify-center text-xs text-indigo-800 font-medium cursor-pointer hover:ring-2 hover:ring-indigo-500 hover:z-10 transition-all"
                                             style={{ top: pkgDims.width, left: pkgDims.width * 2 + pkgDims.length, width: pkgDims.length, height: pkgDims.height }}
                                             onClick={() => openCropModal('back')}>
                                            {pkgGeneratedFaces['back'] ? <img src={pkgGeneratedFaces['back']} className="w-full h-full object-cover" /> : t.xlab_pkg_back || 'Back'}
                                        </div>
                                        {/* Bottom */}
                                        <div className="absolute border border-gray-400 bg-indigo-50 flex items-center justify-center text-xs text-indigo-800 font-medium cursor-pointer hover:ring-2 hover:ring-indigo-500 hover:z-10 transition-all"
                                             style={{ top: pkgDims.width + pkgDims.height, left: pkgDims.width, width: pkgDims.length, height: pkgDims.width }}
                                             onClick={() => openCropModal('bottom')}>
                                            {pkgGeneratedFaces['bottom'] ? <img src={pkgGeneratedFaces['bottom']} className="w-full h-full object-cover" /> : t.xlab_pkg_bottom || 'Bottom'}
                                        </div>
                                    </div>
                                )
                            ) : (
                                /* 3D Box Visualization */
                                pkgType === 'box' && (
                                    <div 
                                        className="w-full h-full flex items-center justify-center cursor-move"
                                        onMouseDown={(e) => { setIsDragging3D(true); setLastMousePos({ x: e.clientX, y: e.clientY }); }}
                                        onMouseMove={(e) => {
                                            if (isDragging3D) {
                                                const dx = e.clientX - lastMousePos.x;
                                                const dy = e.clientY - lastMousePos.y;
                                                setRotY(prev => prev + dx * 0.5);
                                                setRotX(prev => prev - dy * 0.5);
                                                setLastMousePos({ x: e.clientX, y: e.clientY });
                                            }
                                        }}
                                        onMouseUp={() => setIsDragging3D(false)}
                                        onMouseLeave={() => setIsDragging3D(false)}
                                        style={{ perspective: '1000px' }}
                                    >
                                        <div 
                                            style={{ 
                                                transformStyle: 'preserve-3d', 
                                                transform: `scale(${zoom}) rotateX(${rotX}deg) rotateY(${rotY}deg)`,
                                                width: pkgDims.length,
                                                height: pkgDims.height,
                                                position: 'relative',
                                                transition: isDragging3D ? 'none' : 'transform 0.1s'
                                            }}
                                        >
                                            {/* Front */}
                                            <div className="absolute border border-gray-400 bg-white flex items-center justify-center text-gray-300" style={{ width: pkgDims.length, height: pkgDims.height, transform: `translateZ(${pkgDims.width / 2}px)` }}>
                                                {pkgGeneratedFaces['front'] ? <img src={pkgGeneratedFaces['front']} className="w-full h-full object-cover" /> : 'Front'}
                                            </div>
                                            {/* Back */}
                                            <div className="absolute border border-gray-400 bg-white flex items-center justify-center text-gray-300" style={{ width: pkgDims.length, height: pkgDims.height, transform: `rotateY(180deg) translateZ(${pkgDims.width / 2}px)` }}>
                                                {pkgGeneratedFaces['back'] ? <img src={pkgGeneratedFaces['back']} className="w-full h-full object-cover" /> : 'Back'}
                                            </div>
                                            {/* Left */}
                                            <div className="absolute border border-gray-400 bg-white flex items-center justify-center text-gray-300" style={{ width: pkgDims.width, height: pkgDims.height, transform: `rotateY(-90deg) translateZ(${pkgDims.length / 2}px)`, left: (pkgDims.length - pkgDims.width) / 2 }}>
                                                {pkgGeneratedFaces['left'] ? <img src={pkgGeneratedFaces['left']} className="w-full h-full object-cover" /> : 'Left'}
                                            </div>
                                            {/* Right */}
                                            <div className="absolute border border-gray-400 bg-white flex items-center justify-center text-gray-300" style={{ width: pkgDims.width, height: pkgDims.height, transform: `rotateY(90deg) translateZ(${pkgDims.length / 2}px)`, left: (pkgDims.length - pkgDims.width) / 2 }}>
                                                {pkgGeneratedFaces['right'] ? <img src={pkgGeneratedFaces['right']} className="w-full h-full object-cover" /> : 'Right'}
                                            </div>
                                            {/* Top */}
                                            <div className="absolute border border-gray-400 bg-white flex items-center justify-center text-gray-300" style={{ width: pkgDims.length, height: pkgDims.width, transform: `rotateX(90deg) translateZ(${pkgDims.height / 2}px)`, top: (pkgDims.height - pkgDims.width) / 2 }}>
                                                {pkgGeneratedFaces['top'] ? <img src={pkgGeneratedFaces['top']} className="w-full h-full object-cover" /> : 'Top'}
                                            </div>
                                            {/* Bottom */}
                                            <div className="absolute border border-gray-400 bg-white flex items-center justify-center text-gray-300" style={{ width: pkgDims.length, height: pkgDims.width, transform: `rotateX(-90deg) translateZ(${pkgDims.height / 2}px)`, top: (pkgDims.height - pkgDims.width) / 2 }}>
                                                {pkgGeneratedFaces['bottom'] ? <img src={pkgGeneratedFaces['bottom']} className="w-full h-full object-cover" /> : 'Bottom'}
                                            </div>
                                        </div>
                                    </div>
                                )
                            )}
                            {pkgType !== 'box' && (
                                <div className="text-gray-500 italic">Template visualization for {pkgType} coming soon.</div>
                            )}
                        </div>
                        {isGeneratingPkg && (
                            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center z-30">
                                <Loader2 size={48} className="text-indigo-600 animate-spin mb-4" />
                                <div className="text-lg font-bold text-gray-800">{t.xlab_pkg_generating || 'Generating Packaging...'}</div>
                            </div>
                        )}
                    </div>
                )}
            </div>
            
            {/* Right: Controls Area */}
            <div className="w-full md:w-80 bg-white border-l border-gray-200 p-6 flex flex-col overflow-y-auto">
                <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2">
                    <Wand2 size={20} className="text-indigo-600" /> {t.xlab_packaging_mode || 'Packaging Design'}
                </h3>
                
                <div className="space-y-6">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">{t.xlab_pkg_select_product || 'Select Product'}</label>
                        <select 
                            value={selectedProductId}
                            onChange={(e) => setSelectedProductId(e.target.value)}
                            className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            disabled={isGeneratingPkg}
                        >
                            <option value="">-- Select --</option>
                            {products.map(p => (
                                <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                            ))}
                        </select>
                    </div>

                    {selectedProductId && (
                        <>
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">{t.xlab_pkg_type || 'Packaging Type'}</label>
                                <select 
                                    value={pkgType}
                                    onChange={(e) => setPkgType(e.target.value as any)}
                                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                    disabled={isGeneratingPkg}
                                >
                                    <option value="box">{t.xlab_pkg_type_box || 'Standard Box'}</option>
                                    <option value="pouch">{t.xlab_pkg_type_pouch || 'Stand-up Pouch'}</option>
                                    <option value="tube">{t.xlab_pkg_type_tube || 'Cylinder / Tube'}</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">{t.xlab_pkg_dimensions || 'Dimensions (L x W x H)'}</label>
                                <div className="flex gap-2">
                                    <input type="number" value={pkgDims.length} onChange={e => setPkgDims(p => ({...p, length: Number(e.target.value)}))} className="w-full px-2 py-1.5 bg-gray-50 border border-gray-300 rounded-lg text-sm" placeholder="L" />
                                    <input type="number" value={pkgDims.width} onChange={e => setPkgDims(p => ({...p, width: Number(e.target.value)}))} className="w-full px-2 py-1.5 bg-gray-50 border border-gray-300 rounded-lg text-sm" placeholder="W" />
                                    <input type="number" value={pkgDims.height} onChange={e => setPkgDims(p => ({...p, height: Number(e.target.value)}))} className="w-full px-2 py-1.5 bg-gray-50 border border-gray-300 rounded-lg text-sm" placeholder="H" />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">Global Style Reference</label>
                                <div className="flex gap-2 items-start">
                                    <label className="flex-1 flex items-center justify-center gap-2 px-3 py-3 bg-gray-50 border border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-100 cursor-pointer transition-colors">
                                        <Camera size={16} />
                                        <span>Upload Style Ref</span>
                                        <input type="file" className="hidden" accept="image/*" onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) {
                                                const reader = new FileReader();
                                                reader.onload = (ev) => {
                                                    if (ev.target?.result) setPkgStyleRef(ev.target.result as string);
                                                };
                                                reader.readAsDataURL(file);
                                            }
                                        }} disabled={isGeneratingPkg || isExtractingStyle} />
                                    </label>
                                    {pkgStyleRef && (
                                        <button 
                                            onClick={handleExtractStyle}
                                            disabled={isExtractingStyle || isGeneratingPkg}
                                            className="px-3 py-3 bg-indigo-100 text-indigo-700 rounded-lg text-sm font-semibold hover:bg-indigo-200 disabled:opacity-50 flex items-center gap-2 transition-colors"
                                        >
                                            {isExtractingStyle ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                                            Extract
                                        </button>
                                    )}
                                </div>
                                {pkgStyleRef && (
                                    <div className="relative mt-2 inline-block">
                                        <img src={pkgStyleRef} className="h-20 w-20 object-cover rounded-md border border-gray-200" />
                                        <button onClick={() => setPkgStyleRef(null)} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5"><X size={10}/></button>
                                    </div>
                                )}
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">Global Style & Prompt</label>
                                <textarea 
                                    value={pkgGlobalPrompt}
                                    onChange={(e) => setPkgGlobalPrompt(e.target.value)}
                                    placeholder="e.g., Minimalist, eco-friendly, green and white color palette..."
                                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none h-20"
                                    disabled={isGeneratingPkg}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">Face Details (Images & Text)</label>
                                <div className="space-y-3">
                                    {['front', 'back', 'left', 'right', 'top', 'bottom'].map(face => (
                                        <div key={face} className="flex flex-col gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                                            <span className="text-sm font-bold text-gray-700 capitalize">{face} Face</span>
                                            
                                            {/* Images Row */}
                                            <div className="grid grid-cols-3 gap-2">
                                                {/* Product Image */}
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-[10px] text-gray-500 font-semibold uppercase">Product</span>
                                                    <div 
                                                        className="flex items-center justify-center h-16 bg-white border border-dashed border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-100 cursor-pointer overflow-hidden relative"
                                                        onClick={() => !isGeneratingPkg && openImageSelection(face)}
                                                    >
                                                        {pkgFaceImages[face]?.product ? (
                                                            <>
                                                                <img src={pkgFaceImages[face].product} className="w-full h-full object-cover" />
                                                                <button onClick={(e) => { e.stopPropagation(); removeFaceImage(face, 'product'); }} className="absolute top-0 right-0 bg-red-500 text-white rounded-bl-md p-0.5"><X size={10}/></button>
                                                            </>
                                                        ) : (
                                                            <div className="flex flex-col items-center justify-center text-gray-400"><Camera size={14} className="mb-0.5" /><span className="text-[10px]">Add</span></div>
                                                        )}
                                                    </div>
                                                </div>
                                                
                                                {/* Layout Ref */}
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-[10px] text-gray-500 font-semibold uppercase">Layout Ref</span>
                                                    <label className="flex items-center justify-center h-16 bg-white border border-dashed border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-100 cursor-pointer overflow-hidden relative">
                                                        {pkgFaceImages[face]?.layout ? (
                                                            <>
                                                                <img src={pkgFaceImages[face].layout} className="w-full h-full object-cover" />
                                                                <button onClick={(e) => { e.preventDefault(); removeFaceImage(face, 'layout'); }} className="absolute top-0 right-0 bg-red-500 text-white rounded-bl-md p-0.5"><X size={10}/></button>
                                                            </>
                                                        ) : (
                                                            <div className="flex flex-col items-center justify-center text-gray-400"><UploadCloud size={14} className="mb-0.5" /><span className="text-[10px]">Upload</span></div>
                                                        )}
                                                        <input type="file" className="hidden" accept="image/*" onChange={(e) => handleLocalImageUpload(face, 'layout', e)} disabled={isGeneratingPkg} />
                                                    </label>
                                                </div>

                                                {/* Style Ref */}
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-[10px] text-gray-500 font-semibold uppercase">Style Ref</span>
                                                    <label className="flex items-center justify-center h-16 bg-white border border-dashed border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-100 cursor-pointer overflow-hidden relative">
                                                        {pkgFaceImages[face]?.style ? (
                                                            <>
                                                                <img src={pkgFaceImages[face].style} className="w-full h-full object-cover" />
                                                                <button onClick={(e) => { e.preventDefault(); removeFaceImage(face, 'style'); }} className="absolute top-0 right-0 bg-red-500 text-white rounded-bl-md p-0.5"><X size={10}/></button>
                                                            </>
                                                        ) : (
                                                            <div className="flex flex-col items-center justify-center text-gray-400"><UploadCloud size={14} className="mb-0.5" /><span className="text-[10px]">Upload</span></div>
                                                        )}
                                                        <input type="file" className="hidden" accept="image/*" onChange={(e) => handleLocalImageUpload(face, 'style', e)} disabled={isGeneratingPkg} />
                                                    </label>
                                                </div>
                                            </div>

                                            {/* Text Areas */}
                                            <div className="flex flex-col gap-2 mt-1">
                                                <textarea
                                                    value={pkgFaceText[face]?.style || ''}
                                                    onChange={(e) => updateFaceText(face, 'style', e.target.value)}
                                                    placeholder="Style description for this face..."
                                                    className="w-full px-2 py-1.5 bg-white border border-gray-300 rounded-md text-xs focus:ring-1 focus:ring-indigo-500 outline-none resize-none h-12"
                                                    disabled={isGeneratingPkg}
                                                />
                                                <textarea
                                                    value={pkgFaceText[face]?.layout || ''}
                                                    onChange={(e) => updateFaceText(face, 'layout', e.target.value)}
                                                    placeholder="Layout description for this face..."
                                                    className="w-full px-2 py-1.5 bg-white border border-gray-300 rounded-md text-xs focus:ring-1 focus:ring-indigo-500 outline-none resize-none h-12"
                                                    disabled={isGeneratingPkg}
                                                />
                                                <textarea
                                                    value={pkgFaceText[face]?.copy || ''}
                                                    onChange={(e) => updateFaceText(face, 'copy', e.target.value)}
                                                    placeholder="Exact text to render (Strict)..."
                                                    className="w-full px-2 py-1.5 bg-white border border-gray-300 rounded-md text-xs focus:ring-1 focus:ring-indigo-500 outline-none resize-none h-12 font-mono"
                                                    disabled={isGeneratingPkg}
                                                />
                                            </div>
                                            
                                            {/* Generate Single Face Button */}
                                            <div className="flex justify-end mt-1">
                                                <button 
                                                    onClick={() => handleGenerateSingleFace(face)}
                                                    disabled={isGeneratingPkg || !selectedProductId}
                                                    className="px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-md text-xs font-bold hover:bg-indigo-200 disabled:opacity-50 flex items-center gap-1 transition-colors"
                                                >
                                                    {generatingFace === face ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                                    Generate {face}
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">{t.xlab_pkg_text_details || 'Text Details & Specs (PDF/Doc)'}</label>
                                <label className="flex items-center justify-center gap-2 w-full px-3 py-3 bg-gray-50 border border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-100 cursor-pointer transition-colors">
                                    {isParsingText ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
                                    <span>{isParsingText ? 'Parsing Document...' : (pkgTextFile ? pkgTextFile.name : 'Upload Document')}</span>
                                    <input type="file" className="hidden" accept=".pdf,.txt,.md" onChange={handleTextFileUpload} disabled={isGeneratingPkg || isParsingText} />
                                </label>
                                {pkgParsedText && (
                                    <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-800">
                                        <span className="font-bold">Parsed successfully:</span> Found requirements for {Object.keys(pkgParsedText.faces || {}).length} faces.
                                    </div>
                                )}
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">Image Model</label>
                                <select 
                                    value={model}
                                    onChange={(e) => setModel(e.target.value as any)}
                                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                    disabled={isGeneratingPkg}
                                >
                                    <option value="gemini-3.1-flash-image-preview">Gemini 3.1 Flash Image (Fast)</option>
                                    <option value="gemini-3-pro-image-preview">Gemini 3 Pro Image (High Quality)</option>
                                </select>
                            </div>
                        </>
                    )}
                </div>
                
                <div className="mt-auto pt-6">
                    <button 
                        onClick={handleGenerateAll}
                        disabled={!selectedProductId || isGeneratingPkg}
                        className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors shadow-sm"
                    >
                        {isGeneratingPkg ? (
                            <><Loader2 size={18} className="animate-spin" /> {generatingFace ? `Generating ${generatingFace}...` : 'Generating...'}</>
                        ) : (
                            <><Sparkles size={18} /> {t.xlab_pkg_generate || 'Generate Packaging'}</>
                        )}
                    </button>
                </div>
            </div>

            {/* Image Selection Modal */}
            {isImageModalOpen && currentSelectingFace && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[80vh]">
                        <div className="p-4 border-b flex justify-between items-center">
                            <h3 className="font-bold text-lg">Select Image for {currentSelectingFace}</h3>
                            <button onClick={() => setIsImageModalOpen(false)} className="text-gray-500 hover:text-gray-700">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-4 overflow-y-auto">
                            <h4 className="text-sm font-semibold text-gray-700 mb-2">Product Images</h4>
                            {uniqueProductImages.length > 0 ? (
                                <div className="grid grid-cols-3 gap-3 mb-6">
                                    {uniqueProductImages.map((img: string, idx: number) => (
                                        <div 
                                            key={idx} 
                                            className="aspect-square border rounded-lg overflow-hidden cursor-pointer hover:border-indigo-500 hover:shadow-md transition-all"
                                            onClick={() => handleSelectProductImage(currentSelectingFace, img)}
                                        >
                                            <img src={img} className="w-full h-full object-cover" />
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-gray-500 mb-6 italic">No images found for this product.</p>
                            )}
                            
                            <h4 className="text-sm font-semibold text-gray-700 mb-2">Upload Custom Image</h4>
                            <label className="flex items-center justify-center gap-2 w-full px-4 py-8 bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:bg-gray-100 cursor-pointer transition-colors">
                                <UploadCloud size={24} />
                                <span>Click to upload a new image</span>
                                <input type="file" className="hidden" accept="image/*" onChange={(e) => {
                                    handleLocalImageUpload(currentSelectingFace, 'product', e);
                                    setIsImageModalOpen(false);
                                }} />
                            </label>
                        </div>
                    </div>
                </div>
            )}

            {/* Crop Modal */}
            {cropModalFace && (
                <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="p-4 border-b flex justify-between items-center">
                            <h3 className="font-bold text-lg">Adjust Margin for {cropModalFace}</h3>
                            <button onClick={() => setCropModalFace(null)} className="text-gray-500 hover:text-gray-700">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 flex-1 overflow-y-auto flex flex-col md:flex-row gap-6">
                            <div className="flex-1 flex flex-col items-center justify-center bg-gray-100 rounded-lg overflow-hidden relative min-h-[300px]">
                                <div className="relative inline-block" ref={cropContainerRef}>
                                    <img 
                                        ref={cropImgRef}
                                        src={pkgOriginalFaces[cropModalFace]} 
                                        className="max-w-full max-h-[60vh] object-contain pointer-events-none" 
                                        style={{ opacity: 0.5 }}
                                        onLoad={(e) => {
                                            const img = e.currentTarget;
                                            setCropBox({
                                                x: img.width * 0.1,
                                                y: img.height * 0.1,
                                                width: img.width * 0.8,
                                                height: img.height * 0.8
                                            });
                                        }}
                                    />
                                    {/* Crop Overlay */}
                                    <Rnd
                                        bounds="parent"
                                        position={{ x: cropBox.x, y: cropBox.y }}
                                        size={{ width: cropBox.width, height: cropBox.height }}
                                        onDragStop={(e, d) => setCropBox(prev => ({ ...prev, x: d.x, y: d.y }))}
                                        onResizeStop={(e, direction, ref, delta, position) => {
                                            setCropBox({
                                                width: parseInt(ref.style.width, 10),
                                                height: parseInt(ref.style.height, 10),
                                                ...position,
                                            });
                                        }}
                                        className="absolute border-2 border-indigo-500 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] z-10"
                                    >
                                        <div className="w-full h-full border border-white/50 grid grid-cols-3 grid-rows-3">
                                            <div className="border-r border-b border-white/30"></div>
                                            <div className="border-r border-b border-white/30"></div>
                                            <div className="border-b border-white/30"></div>
                                            <div className="border-r border-b border-white/30"></div>
                                            <div className="border-r border-b border-white/30"></div>
                                            <div className="border-b border-white/30"></div>
                                            <div className="border-r border-white/30"></div>
                                            <div className="border-r border-white/30"></div>
                                            <div></div>
                                        </div>
                                    </Rnd>
                                </div>
                            </div>
                            <div className="w-full md:w-64 flex flex-col gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Background Color</label>
                                    <div className="flex items-center gap-2">
                                        <input 
                                            type="color" 
                                            value={pkgFaceBgColor[cropModalFace] || '#ffffff'} 
                                            onChange={(e) => setPkgFaceBgColor(prev => ({ ...prev, [cropModalFace]: e.target.value }))}
                                            className="w-10 h-10 rounded cursor-pointer border-0 p-0"
                                        />
                                        <span className="text-sm text-gray-600 font-mono">{pkgFaceBgColor[cropModalFace] || '#ffffff'}</span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-2">
                                        This color will fill any empty space if your crop doesn't match the face's exact aspect ratio.
                                    </p>
                                </div>
                                <div className="mt-auto pt-4">
                                    <button 
                                        onClick={handleSaveCrop}
                                        className="w-full py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition-colors"
                                    >
                                        Apply Crop
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
