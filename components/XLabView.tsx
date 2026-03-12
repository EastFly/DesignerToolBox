import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, Image as ImageIcon, Loader2, Sparkles, Download, RefreshCw, Wand2, Maximize2, MousePointer2, Hand, ZoomIn, ZoomOut, Camera, X } from 'lucide-react';
import { Language, translations } from '../i18n';
import { GoogleGenAI } from '@google/genai';

interface XLabViewProps {
    language: Language;
}

export const XLabView: React.FC<XLabViewProps> = ({ language }) => {
    const t = translations[language];
    
    // State
    const [activeTab, setActiveTab] = useState<'focus_mode'>('focus_mode');
    
    // Focus Mode State
    const [image, setImage] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [prompt, setPrompt] = useState('');
    const [model, setModel] = useState<'gemini-3.1-flash-image-preview' | 'gemini-3-pro-image-preview'>('gemini-3.1-flash-image-preview');
    const [referenceImage, setReferenceImage] = useState<string | null>(null);
    
    // Viewport State
    const [imageDims, setImageDims] = useState({ width: 0, height: 0 });
    const [scale, setScale] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [tool, setTool] = useState<'select' | 'pan'>('select');
    const [isDragging, setIsDragging] = useState(false);
    
    // Selection State
    const [selection, setSelection] = useState<{ x: number, y: number, width: number, height: number } | null>(null);
    const [isSelecting, setIsSelecting] = useState(false);
    const [startPos, setStartPos] = useState<{ x: number, y: number } | null>(null);
    
    // Reference Crop State
    const [tempReferenceImage, setTempReferenceImage] = useState<string | null>(null);
    const [isCroppingReference, setIsCroppingReference] = useState(false);
    const [refSelection, setRefSelection] = useState<{ x: number, y: number, width: number, height: number } | null>(null);
    const [isRefSelecting, setIsRefSelecting] = useState(false);
    const [refStartPos, setRefStartPos] = useState<{ x: number, y: number } | null>(null);
    const refImageRef = useRef<HTMLImageElement>(null);

    const containerRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);

    // Handle Image Upload
    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                setImage(event.target?.result as string);
                setSelection(null);
                setScale(1);
                setPan({ x: 0, y: 0 });
                setReferenceImage(null);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleReferenceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                setTempReferenceImage(event.target?.result as string);
                setIsCroppingReference(true);
                setRefSelection(null);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const img = e.currentTarget;
        const naturalWidth = img.naturalWidth;
        const naturalHeight = img.naturalHeight;
        setImageDims({ width: naturalWidth, height: naturalHeight });
        
        if (containerRef.current) {
            const container = containerRef.current.getBoundingClientRect();
            // Add some padding (e.g., 40px total)
            const fitScale = Math.min(
                (container.width - 40) / naturalWidth,
                (container.height - 40) / naturalHeight
            );
            const initialScale = Math.min(fitScale, 1); // Don't scale up beyond 1x initially if small
            
            setScale(initialScale);
            setPan({
                x: (container.width - naturalWidth * initialScale) / 2,
                y: (container.height - naturalHeight * initialScale) / 2
            });
        }
    };

    // Mouse Events for Selection and Panning
    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!containerRef.current) return;
        
        if (tool === 'pan') {
            setIsDragging(true);
            setStartPos({ x: e.clientX - pan.x, y: e.clientY - pan.y });
            return;
        }
        
        if (tool === 'select') {
            const rect = containerRef.current.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            const imgX = (mouseX - pan.x) / scale;
            const imgY = (mouseY - pan.y) / scale;
            
            // Ensure click is inside image bounds
            if (imgX >= 0 && imgY >= 0 && imgX <= imageDims.width && imgY <= imageDims.height) {
                setIsSelecting(true);
                setStartPos({ x: imgX, y: imgY });
                setSelection({ x: imgX, y: imgY, width: 0, height: 0 });
            }
        }
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (tool === 'pan' && isDragging && startPos) {
            setPan({
                x: e.clientX - startPos.x,
                y: e.clientY - startPos.y
            });
            return;
        }
        
        if (tool === 'select' && isSelecting && startPos && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            let imgX = (mouseX - pan.x) / scale;
            let imgY = (mouseY - pan.y) / scale;
            
            // Clamp to image bounds
            imgX = Math.max(0, Math.min(imgX, imageDims.width));
            imgY = Math.max(0, Math.min(imgY, imageDims.height));
            
            const x = Math.min(startPos.x, imgX);
            const y = Math.min(startPos.y, imgY);
            const width = Math.abs(imgX - startPos.x);
            const height = Math.abs(imgY - startPos.y);
            
            setSelection({ x, y, width, height });
        }
    };

    const handleMouseUp = () => {
        if (tool === 'pan') {
            setIsDragging(false);
        } else if (tool === 'select') {
            setIsSelecting(false);
            // If selection is too small, clear it
            if (selection && (selection.width < 10 || selection.height < 10)) {
                setSelection(null);
            }
        }
    };

    const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
        if (!containerRef.current) return;
        
        const zoomSensitivity = 0.001;
        const delta = -e.deltaY * zoomSensitivity;
        const newScale = Math.max(0.05, Math.min(scale * (1 + delta), 20)); // Limit scale between 0.05x and 20x
        
        // Zoom towards mouse cursor
        const rect = containerRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        // Calculate new pan to keep the point under the mouse fixed
        const newPanX = mouseX - (mouseX - pan.x) * (newScale / scale);
        const newPanY = mouseY - (mouseY - pan.y) * (newScale / scale);
        
        setScale(newScale);
        setPan({ x: newPanX, y: newPanY });
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

    // Process Image
    const handleGenerate = async () => {
        if (!image || !prompt || !imageRef.current) return;
        
        setIsProcessing(true);
        
        try {
            const actualCrop = selection ? {
                x: selection.x,
                y: selection.y,
                width: selection.width,
                height: selection.height
            } : {
                x: 0,
                y: 0,
                width: imageDims.width,
                height: imageDims.height
            };
            
            // 2. Crop the image using a hidden canvas
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = actualCrop.width;
            cropCanvas.height = actualCrop.height;
            const ctx = cropCanvas.getContext('2d');
            
            if (!ctx) throw new Error("Could not get canvas context");
            
            ctx.drawImage(
                imageRef.current,
                actualCrop.x, actualCrop.y, actualCrop.width, actualCrop.height,
                0, 0, actualCrop.width, actualCrop.height
            );
            
            const croppedBase64 = cropCanvas.toDataURL('image/jpeg').split(',')[1];
            
            // 3. Send to Gemini
            const apiKey = await getApiKey();
            if (!apiKey) {
                alert("API Key is required");
                setIsProcessing(false);
                return;
            }
            
            const ai = new GoogleGenAI({ apiKey });
            
            const parts: any[] = [
                {
                    inlineData: {
                        data: croppedBase64,
                        mimeType: 'image/jpeg'
                    }
                }
            ];

            // Add reference image if provided
            if (referenceImage) {
                const refBase64 = referenceImage.split(',')[1];
                const mimeType = referenceImage.split(';')[0].split(':')[1] || 'image/jpeg';
                parts.push({ text: "Please use the following image as a reference for the details to be added or replaced:" });
                parts.push({
                    inlineData: {
                        data: refBase64,
                        mimeType: mimeType
                    }
                });
            }

            parts.push({ text: prompt });
            
            const response = await ai.models.generateContent({
                model: model,
                contents: {
                    parts: parts
                }
            });
            
            // 4. Extract result image
            let resultBase64 = null;
            if (response.candidates && response.candidates[0]?.content?.parts) {
                for (const part of response.candidates[0].content.parts) {
                    if (part.inlineData) {
                        resultBase64 = part.inlineData.data;
                        break;
                    }
                }
            }
            
            if (!resultBase64) {
                throw new Error("No image returned from model");
            }
            
            // 5. Stitch back
            const resultImg = new Image();
            resultImg.onload = () => {
                const finalCanvas = document.createElement('canvas');
                finalCanvas.width = imageDims.width;
                finalCanvas.height = imageDims.height;
                const finalCtx = finalCanvas.getContext('2d');
                
                if (!finalCtx) return;
                
                // Draw original
                finalCtx.drawImage(imageRef.current!, 0, 0);
                
                // Draw edited crop over it
                finalCtx.drawImage(resultImg, actualCrop.x, actualCrop.y, actualCrop.width, actualCrop.height);
                
                setImage(finalCanvas.toDataURL('image/jpeg'));
                setIsProcessing(false);
            };
            resultImg.src = `data:image/jpeg;base64,${resultBase64}`;
            
        } catch (error) {
            console.error("Error processing image:", error);
            alert("Failed to process image. See console for details.");
            setIsProcessing(false);
        }
    };

    const handleDownload = () => {
        if (!image) return;
        const a = document.createElement('a');
        a.href = image;
        a.download = 'focus-edit-result.jpg';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    return (
        <div className="flex flex-col h-full bg-white">
            {/* Header */}
            <div className="p-5 border-b border-gray-100 bg-gray-50 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-100 text-amber-600 rounded-lg">
                        <Sparkles size={20} />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-800">{t.xlab_title}</h2>
                        <p className="text-xs text-gray-500">{t.xlab_subtitle}</p>
                    </div>
                </div>
                
                {/* Nav Bar */}
                <div className="flex bg-gray-200 p-1 rounded-lg">
                    <button 
                        className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'focus_mode' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        onClick={() => setActiveTab('focus_mode')}
                    >
                        {t.xlab_focus_mode}
                    </button>
                    {/* Future experimental features can go here */}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden flex">
                {activeTab === 'focus_mode' && (
                    <div className="flex-1 flex flex-col md:flex-row h-full">
                        {/* Left: Image Area */}
                        <div className="flex-1 bg-gray-100 p-6 flex flex-col relative overflow-hidden">
                            {!image ? (
                                <div className="flex-1 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center bg-white">
                                    <div className="w-16 h-16 bg-indigo-50 text-indigo-500 rounded-full flex items-center justify-center mb-4">
                                        <UploadCloud size={32} />
                                    </div>
                                    <h3 className="text-lg font-bold text-gray-800 mb-2">{t.xlab_upload_image}</h3>
                                    <p className="text-sm text-gray-500 mb-6 text-center max-w-sm">
                                        {t.xlab_upload_desc}
                                    </p>
                                    <label className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 cursor-pointer transition-colors shadow-sm">
                                        {t.xlab_select_image}
                                        <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                                    </label>
                                </div>
                            ) : (
                                <div className="flex-1 flex flex-col h-full">
                                    <div className="flex justify-between items-center mb-4 shrink-0">
                                        <h3 className="font-bold text-gray-700 flex items-center gap-2">
                                            <Maximize2 size={16} /> {t.xlab_draw_box}
                                        </h3>
                                        <div className="flex gap-2">
                                            <button 
                                                onClick={handleDownload}
                                                disabled={!image || isProcessing}
                                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                                            >
                                                <Download size={16} /> {t.xlab_download}
                                            </button>
                                            <button 
                                                onClick={() => setSelection(null)}
                                                disabled={!selection || isProcessing}
                                                className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                                            >
                                                {t.xlab_clear_selection}
                                            </button>
                                            <label className="px-3 py-1.5 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 cursor-pointer transition-colors">
                                                {t.xlab_new_image}
                                                <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                                            </label>
                                        </div>
                                    </div>
                                    
                                    <div 
                                        className={`flex-1 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden relative select-none ${tool === 'pan' ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-crosshair'}`}
                                        ref={containerRef}
                                        onMouseDown={handleMouseDown}
                                        onMouseMove={handleMouseMove}
                                        onMouseUp={handleMouseUp}
                                        onMouseLeave={handleMouseUp}
                                        onWheel={handleWheel}
                                    >
                                        {/* Toolbar */}
                                        <div className="absolute top-4 left-4 bg-white rounded-lg shadow-md border border-gray-200 flex flex-col gap-1 p-1 z-20">
                                            <button onClick={() => setTool('select')} className={`p-2 rounded-md ${tool === 'select' ? 'bg-indigo-100 text-indigo-600' : 'text-gray-600 hover:bg-gray-100'}`} title="Select Area">
                                                <MousePointer2 size={20} />
                                            </button>
                                            <button onClick={() => setTool('pan')} className={`p-2 rounded-md ${tool === 'pan' ? 'bg-indigo-100 text-indigo-600' : 'text-gray-600 hover:bg-gray-100'}`} title="Pan Image">
                                                <Hand size={20} />
                                            </button>
                                            <div className="w-full h-px bg-gray-200 my-1"></div>
                                            <button onClick={() => {
                                                if (!containerRef.current) return;
                                                const rect = containerRef.current.getBoundingClientRect();
                                                const newScale = Math.min(scale * 1.2, 20);
                                                const mouseX = rect.width / 2;
                                                const mouseY = rect.height / 2;
                                                setPan({
                                                    x: mouseX - (mouseX - pan.x) * (newScale / scale),
                                                    y: mouseY - (mouseY - pan.y) * (newScale / scale)
                                                });
                                                setScale(newScale);
                                            }} className="p-2 rounded-md text-gray-600 hover:bg-gray-100" title="Zoom In">
                                                <ZoomIn size={20} />
                                            </button>
                                            <button onClick={() => {
                                                if (!containerRef.current) return;
                                                const rect = containerRef.current.getBoundingClientRect();
                                                const newScale = Math.max(scale / 1.2, 0.05);
                                                const mouseX = rect.width / 2;
                                                const mouseY = rect.height / 2;
                                                setPan({
                                                    x: mouseX - (mouseX - pan.x) * (newScale / scale),
                                                    y: mouseY - (mouseY - pan.y) * (newScale / scale)
                                                });
                                                setScale(newScale);
                                            }} className="p-2 rounded-md text-gray-600 hover:bg-gray-100" title="Zoom Out">
                                                <ZoomOut size={20} />
                                            </button>
                                        </div>

                                        <div 
                                            style={{
                                                transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                                                transformOrigin: '0 0',
                                                width: imageDims.width || 'auto',
                                                height: imageDims.height || 'auto',
                                                position: 'absolute',
                                                top: 0,
                                                left: 0
                                            }}
                                        >
                                            <img 
                                                ref={imageRef}
                                                src={image} 
                                                alt="Workspace" 
                                                className="w-full h-full pointer-events-none"
                                                draggable={false}
                                                onLoad={handleImageLoad}
                                            />
                                            
                                            {/* Selection Box Overlay */}
                                            {selection && (
                                                <div 
                                                    className="absolute border-2 border-indigo-500 bg-indigo-500/20 pointer-events-none"
                                                    style={{
                                                        left: selection.x,
                                                        top: selection.y,
                                                        width: selection.width,
                                                        height: selection.height
                                                    }}
                                                >
                                                    {/* Corner handles for visual feedback */}
                                                    <div className="absolute -top-1 -left-1 w-2 h-2 bg-indigo-600"></div>
                                                    <div className="absolute -top-1 -right-1 w-2 h-2 bg-indigo-600"></div>
                                                    <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-indigo-600"></div>
                                                    <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-indigo-600"></div>
                                                </div>
                                            )}
                                        </div>
                                        
                                        {isProcessing && (
                                            <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex flex-col items-center justify-center z-30">
                                                <Loader2 size={48} className="text-indigo-600 animate-spin mb-4" />
                                                <div className="text-lg font-bold text-gray-800">{t.xlab_processing}</div>
                                                <div className="text-sm text-gray-600">{t.xlab_processing_desc}</div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                        
                        {/* Right: Controls Area */}
                        <div className="w-full md:w-80 bg-white border-l border-gray-200 p-6 flex flex-col overflow-y-auto">
                            <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2">
                                <Wand2 size={20} className="text-indigo-600" /> {t.xlab_focus_edit}
                            </h3>
                            
                            <div className="space-y-6">
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">{t.xlab_model}</label>
                                    <select 
                                        value={model}
                                        onChange={(e) => setModel(e.target.value as any)}
                                        className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                        disabled={isProcessing}
                                    >
                                        <option value="gemini-3.1-flash-image-preview">Gemini 3.1 Flash Image</option>
                                        <option value="gemini-3-pro-image-preview">Gemini 3 Pro Image</option>
                                    </select>
                                    <p className="text-xs text-gray-500 mt-1">{t.xlab_pro_warning}</p>
                                </div>
                                
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">{t.xlab_ref_image}</label>
                                    {!referenceImage ? (
                                        <label className="flex items-center justify-center gap-2 w-full px-3 py-3 bg-gray-50 border border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-100 cursor-pointer transition-colors">
                                            <Camera size={16} />
                                            <span>{t.xlab_upload_detail}</span>
                                            <input type="file" className="hidden" accept="image/*" onChange={handleReferenceUpload} disabled={isProcessing} />
                                        </label>
                                    ) : (
                                        <div className="relative inline-block">
                                            <img src={referenceImage} alt="Reference" className="h-24 w-auto rounded-lg border border-gray-200 object-cover" />
                                            <button 
                                                onClick={() => setReferenceImage(null)}
                                                disabled={isProcessing}
                                                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-sm hover:bg-red-600 disabled:opacity-50"
                                            >
                                                <X size={12} />
                                            </button>
                                        </div>
                                    )}
                                    <p className="text-xs text-gray-500 mt-2">{t.xlab_ref_desc}</p>
                                </div>

                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">{t.xlab_edit_prompt}</label>
                                    <textarea 
                                        value={prompt}
                                        onChange={(e) => setPrompt(e.target.value)}
                                        placeholder={t.xlab_prompt_placeholder}
                                        className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none h-32"
                                        disabled={isProcessing}
                                    />
                                </div>
                                
                                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                                    <h4 className="text-sm font-bold text-amber-800 mb-1">{t.xlab_how_it_works}</h4>
                                    <p className="text-xs text-amber-700 leading-relaxed">
                                        {t.xlab_how_1}<br/>
                                        {t.xlab_how_2}<br/>
                                        {t.xlab_how_3}<br/>
                                        {t.xlab_how_4}
                                    </p>
                                </div>
                            </div>
                            
                            <div className="mt-auto pt-6">
                                <button 
                                    onClick={handleGenerate}
                                    disabled={!image || !prompt || isProcessing}
                                    className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors shadow-sm"
                                >
                                    {isProcessing ? (
                                        <><Loader2 size={18} className="animate-spin" /> {t.xlab_processing_btn}</>
                                    ) : (
                                        <><Sparkles size={18} /> {t.xlab_apply_edit}</>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
            {/* Reference Crop Modal */}
            {isCroppingReference && tempReferenceImage && (
                <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-6">
                    <div className="bg-white rounded-xl shadow-2xl flex flex-col w-full max-w-4xl max-h-full overflow-hidden">
                        <div className="p-4 border-b flex justify-between items-center shrink-0">
                            <h3 className="font-bold text-lg text-gray-800">Crop Reference Image</h3>
                            <button onClick={() => setIsCroppingReference(false)} className="p-1 text-gray-500 hover:bg-gray-100 rounded-md transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        
                        <div className="flex-1 overflow-auto bg-gray-100 p-4 relative flex items-center justify-center min-h-[50vh]"
                             onMouseDown={(e) => {
                                 if (!refImageRef.current) return;
                                 const rect = refImageRef.current.getBoundingClientRect();
                                 const x = e.clientX - rect.left;
                                 const y = e.clientY - rect.top;
                                 if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
                                     setIsRefSelecting(true);
                                     setRefStartPos({ x, y });
                                     setRefSelection({ x, y, width: 0, height: 0 });
                                 }
                             }}
                             onMouseMove={(e) => {
                                 if (isRefSelecting && refStartPos && refImageRef.current) {
                                     const rect = refImageRef.current.getBoundingClientRect();
                                     let x = e.clientX - rect.left;
                                     let y = e.clientY - rect.top;
                                     x = Math.max(0, Math.min(x, rect.width));
                                     y = Math.max(0, Math.min(y, rect.height));
                                     
                                     setRefSelection({
                                         x: Math.min(refStartPos.x, x),
                                         y: Math.min(refStartPos.y, y),
                                         width: Math.abs(x - refStartPos.x),
                                         height: Math.abs(y - refStartPos.y)
                                     });
                                 }
                             }}
                             onMouseUp={() => setIsRefSelecting(false)}
                             onMouseLeave={() => setIsRefSelecting(false)}
                        >
                            <div className="relative inline-block select-none shadow-md">
                                <img 
                                    ref={refImageRef} 
                                    src={tempReferenceImage} 
                                    alt="Crop Reference" 
                                    className="max-w-full max-h-[65vh] object-contain pointer-events-none block" 
                                    draggable={false}
                                />
                                {refSelection && (
                                    <div 
                                        className="absolute border-2 border-indigo-500 bg-indigo-500/20 pointer-events-none"
                                        style={{
                                            left: refSelection.x,
                                            top: refSelection.y,
                                            width: refSelection.width,
                                            height: refSelection.height
                                        }}
                                    >
                                        <div className="absolute -top-1 -left-1 w-2 h-2 bg-indigo-600"></div>
                                        <div className="absolute -top-1 -right-1 w-2 h-2 bg-indigo-600"></div>
                                        <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-indigo-600"></div>
                                        <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-indigo-600"></div>
                                    </div>
                                )}
                            </div>
                        </div>
                        
                        <div className="p-4 border-t flex justify-end gap-3 bg-gray-50 shrink-0">
                            <button 
                                onClick={() => {
                                    setReferenceImage(tempReferenceImage);
                                    setIsCroppingReference(false);
                                }}
                                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg font-medium transition-colors"
                            >
                                Use Full Image
                            </button>
                            <button 
                                onClick={() => {
                                    if (!refSelection || refSelection.width < 10 || refSelection.height < 10) {
                                        setReferenceImage(tempReferenceImage);
                                        setIsCroppingReference(false);
                                        return;
                                    }
                                    const img = refImageRef.current;
                                    if (!img) return;
                                    
                                    const scaleX = img.naturalWidth / img.width;
                                    const scaleY = img.naturalHeight / img.height;
                                    
                                    const canvas = document.createElement('canvas');
                                    canvas.width = refSelection.width * scaleX;
                                    canvas.height = refSelection.height * scaleY;
                                    const ctx = canvas.getContext('2d');
                                    if (ctx) {
                                        ctx.drawImage(
                                            img,
                                            refSelection.x * scaleX, refSelection.y * scaleY, refSelection.width * scaleX, refSelection.height * scaleY,
                                            0, 0, canvas.width, canvas.height
                                        );
                                        setReferenceImage(canvas.toDataURL('image/jpeg'));
                                    }
                                    setIsCroppingReference(false);
                                }}
                                className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg font-medium transition-colors"
                            >
                                Crop & Save
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
