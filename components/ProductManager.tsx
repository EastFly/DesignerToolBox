
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Package, Search, Plus, Loader2, Edit, Trash2, Save, X, History, ArrowRight, Eye, Calendar, User, Link as LinkIcon, ExternalLink, Clock, PlayCircle, CheckCircle2, LayoutGrid, List, FolderOpen, UploadCloud, File as FileIcon, Film, Sparkles, Image as ImageIcon, FileText, Download, ZoomIn, Star, Tag, Layers, Settings, Target, Table, Bot, Filter, AlignJustify, Grid, Wand2, Check, RefreshCw, FileSpreadsheet, FileType, GripHorizontal, FileJson, ArrowRightLeft } from 'lucide-react';
import { Product, FieldDefinition, Task, User as UserType, ProductChangeLog, ProductLevel, ProductSpec, CompetitorAnalysis } from '../types';
import { db } from '../services/db';
import { format } from 'date-fns';
import { translations, Language } from '../i18n';
import { ProductCopilot } from './ProductCopilot';
import { GoogleGenAI } from "@google/genai";

interface ProductManagerProps {
    language: Language;
    allFields: FieldDefinition[];
    tasks: Task[]; // Injected for correlation view
    currentUser: UserType | null; // Injected for history logging
}

// --- ASSET TYPES ---
type AssetType = 'image' | 'video' | 'file';
type AssetSource = 'product_master' | 'manual_upload' | 'task_human' | 'task_ai';

interface AggregatedAsset {
    url: string;
    type: AssetType;
    fieldKey: string;
    fieldLabel: string;
    source: AssetSource;
    originId: string; // Task ID or 'Manual'
    originName: string; // Task Name or 'Product Folder'
    date: Date;
}

// Helper to convert URL to Base64 for AI analysis
const urlToBase64 = async (url: string): Promise<{ data: string, mimeType: string } | null> => {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const res = reader.result as string;
                const base64 = res.split(',')[1];
                resolve({ data: base64, mimeType: blob.type });
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.error("Failed to convert image", e);
        return null;
    }
};

const getAssetType = (url: string, knownType?: string): AssetType => {
    if (knownType === 'image' || knownType === 'video' || knownType === 'file') return knownType as AssetType;
    
    // Check Data URIs
    if (url.startsWith('data:image/')) return 'image';
    if (url.startsWith('data:video/')) return 'video';

    // Extension Check
    try {
        // Handle full URLs with query params
        const path = url.split('?')[0]; 
        const ext = path.split('.').pop()?.toLowerCase();
        
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'heic'].includes(ext || '')) return 'image';
        if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'].includes(ext || '')) return 'video';
    } catch(e) {
        // ignore
    }

    return 'file';
};

export const ProductManager: React.FC<ProductManagerProps> = ({ language, allFields, tasks, currentUser }) => {
    const t = translations[language];
    const [products, setProducts] = useState<Product[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    
    // Filtering & View State
    const [searchQuery, setSearchQuery] = useState('');
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('list'); // Default to List
    const [filterBrand, setFilterBrand] = useState<string>('all');
    const [filterChannel, setFilterChannel] = useState<string>('all');
    
    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<'view' | 'edit' | 'create'>('view');
    const [currentProduct, setCurrentProduct] = useState<Partial<Product>>({});
    const [originalProduct, setOriginalProduct] = useState<Product | null>(null); // For diffing history
    const [isSaving, setIsSaving] = useState(false);
    const [productToDelete, setProductToDelete] = useState<Product | null>(null);
    
    // Asset Tab State
    const [isUploadingAsset, setIsUploadingAsset] = useState(false); 
    const [activeTab, setActiveTab] = useState<'details' | 'tasks' | 'history' | 'assets'>('details');
    const [assetFilter, setAssetFilter] = useState<AssetType>('image'); // 'image' | 'video' | 'file'

    // Drag & Drop State
    const [draggedImgIndex, setDraggedImgIndex] = useState<number | null>(null);

    // AI Extraction State
    const [isExtracting, setIsExtracting] = useState(false);
    const [extractionPreview, setExtractionPreview] = useState<any | null>(null); // New: Preview Data

    // Lightbox State
    const [previewImage, setPreviewImage] = useState<string | null>(null);

    // Copilot State
    const [showCopilot, setShowCopilot] = useState(false);

    // Tag Inputs State
    const [brandInput, setBrandInput] = useState('');
    const [channelInput, setChannelInput] = useState('');

    useEffect(() => {
        loadProducts();
    }, []);

    const loadProducts = async () => {
        setIsLoading(true);
        const data = await db.getProducts();
        setProducts(data);
        setIsLoading(false);
    };

    // --- Derived Data for Filters ---
    const allBrands = useMemo(() => {
        const brands = new Set<string>();
        products.forEach(p => p.brands?.forEach(b => brands.add(b)));
        return Array.from(brands).sort();
    }, [products]);

    const allChannels = useMemo(() => {
        const channels = new Set<string>();
        products.forEach(p => p.channels?.forEach(c => channels.add(c)));
        return Array.from(channels).sort();
    }, [products]);

    const filteredProducts = useMemo(() => {
        return products.filter(p => {
            const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                                  p.sku.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesBrand = filterBrand === 'all' || (p.brands || []).includes(filterBrand);
            const matchesChannel = filterChannel === 'all' || (p.channels || []).includes(filterChannel);
            return matchesSearch && matchesBrand && matchesChannel;
        });
    }, [products, searchQuery, filterBrand, filterChannel]);

    // --- ACTIONS IMPLEMENTATION ---

    const handleDelete = (product: Product) => {
        setProductToDelete(product);
    };

    const confirmDelete = async () => {
        if (!productToDelete) return;
        try {
            const updatedProduct = { ...productToDelete, isDeleted: true, updatedAt: new Date() };
            await db.saveProduct(updatedProduct);
            setProducts(prev => prev.filter(p => p.id !== productToDelete.id));
            setProductToDelete(null);
        } catch (e) {
            console.error(e);
            alert(t.pm_delete_failed);
        }
    };

    const handleSave = async () => {
        if (!currentProduct.sku || !currentProduct.name) {
            alert(t.pm_sku_name_required);
            return;
        }
        setIsSaving(true);
        try {
            let historyToAdd: ProductChangeLog | null = null;
            if (modalMode === 'edit' && originalProduct && currentUser) {
                const changes: any[] = [];
                if(originalProduct.name !== currentProduct.name) changes.push({ field: 'Name', old: originalProduct.name, new: currentProduct.name });
                if (changes.length > 0) {
                    historyToAdd = {
                        date: new Date(),
                        actor: currentUser,
                        changes,
                        taskName: t.pm_manual_update
                    };
                }
            } else if (modalMode === 'create' && currentUser) {
                 historyToAdd = {
                    date: new Date(),
                    actor: currentUser,
                    changes: [],
                    taskName: t.pm_product_created
                };
            }

            const productToSave: Product = {
                id: currentProduct.id || `PROD-${Date.now()}`,
                sku: currentProduct.sku!,
                name: currentProduct.name!,
                level: currentProduct.level,
                brands: currentProduct.brands || [],
                channels: currentProduct.channels || [],
                data: currentProduct.data || {},
                specs: currentProduct.specs || [],
                competitors: currentProduct.competitors || [],
                history: historyToAdd ? [historyToAdd, ...(currentProduct.history || [])] : (currentProduct.history || []),
                createdAt: currentProduct.createdAt || new Date(),
                updatedAt: new Date()
            };

            await db.saveProduct(productToSave);
            
            if (modalMode === 'create') {
                setProducts([productToSave, ...products]);
            } else {
                setProducts(products.map(p => p.id === productToSave.id ? productToSave : p));
            }
            
            setIsModalOpen(false);
        } catch (e) {
            console.error(e);
            alert(t.pm_save_failed);
        } finally {
            setIsSaving(false);
        }
    };

    const uploadFieldFiles = async (files: FileList, fieldKey: string) => {
        setIsUploadingAsset(true);
        try {
            const urls = await Promise.all(Array.from(files).map(f => db.uploadFile(f)));
            const currentFiles = (currentProduct.data?.[fieldKey] as string[]) || [];
            const newFiles = [...currentFiles, ...urls];
            
            setCurrentProduct({
                ...currentProduct,
                data: { ...currentProduct.data, [fieldKey]: newFiles }
            });

            if (modalMode === 'view' && currentProduct.id) {
                const prodToUpdate = products.find(p => p.id === currentProduct.id);
                if (prodToUpdate) {
                    const updated = {
                        ...prodToUpdate,
                        data: { ...prodToUpdate.data, [fieldKey]: newFiles },
                        updatedAt: new Date()
                    };
                    await db.saveProduct(updated);
                    setProducts(prev => prev.map(p => p.id === updated.id ? updated : p));
                }
            }
        } catch (e) {
            console.error(e);
            alert(t.pm_upload_failed);
        } finally {
            setIsUploadingAsset(false);
        }
    };

    const removeFieldFile = async (url: string, fieldKey: string) => {
        // Direct delete without confirmation for better UX responsiveness
        
        const currentFiles = (currentProduct.data?.[fieldKey] as string[]) || [];
        const newFiles = currentFiles.filter(u => u !== url);

        setCurrentProduct({
            ...currentProduct,
            data: { ...currentProduct.data, [fieldKey]: newFiles }
        });

        if (modalMode === 'view' && currentProduct.id) {
            const prodToUpdate = products.find(p => p.id === currentProduct.id);
            if (prodToUpdate) {
                const updated = {
                    ...prodToUpdate,
                    data: { ...prodToUpdate.data, [fieldKey]: newFiles },
                    updatedAt: new Date()
                };
                await db.saveProduct(updated);
                setProducts(prev => prev.map(p => p.id === updated.id ? updated : p));
            }
        }
    };

    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggedImgIndex(index);
        e.dataTransfer.effectAllowed = "move";
    };

    const handleDragOver = (e: React.DragEvent, index: number, fieldKey: string) => {
        e.preventDefault();
        if (draggedImgIndex === null || draggedImgIndex === index) return;
        
        const currentList = (currentProduct.data?.[fieldKey] as string[]) || [];
        const newList = [...currentList];
        const draggedItem = newList[draggedImgIndex];
        newList.splice(draggedImgIndex, 1);
        newList.splice(index, 0, draggedItem);
        
        setDraggedImgIndex(index);
        setCurrentProduct({
            ...currentProduct,
            data: { ...currentProduct.data, [fieldKey]: newList }
        });
    };

    const handleApplyImages = (urls: string[]) => {
        const currentGallery = (currentProduct.data?.galleryImages as string[]) || [];
        setCurrentProduct({
            ...currentProduct,
            data: { ...currentProduct.data, galleryImages: [...currentGallery, ...urls] }
        });
    };

    const handleCreate = () => {
        setCurrentProduct({
            data: {},
            history: [],
            level: 'B', // Default Level
            brands: [],
            channels: [],
            specs: [],
            competitors: []
        });
        setOriginalProduct(null);
        setModalMode('create');
        setActiveTab('details');
        setIsModalOpen(true);
        setShowCopilot(false);
    };

    const handleEdit = (product: Product) => {
        setCurrentProduct(JSON.parse(JSON.stringify(product))); // Deep copy for editing
        setOriginalProduct(product); // Keep original for history diff
        setModalMode('edit');
        setActiveTab('details');
        setIsModalOpen(true);
        setShowCopilot(false);
    };

    const handleView = (product: Product) => {
        setCurrentProduct(product);
        setModalMode('view');
        setActiveTab('details');
        setIsModalOpen(true);
        setShowCopilot(false);
    };

    // --- COPILOT CALLBACKS ---
    const handleApplySpecs = (specs: ProductSpec[]) => {
        // Direct apply for specific small actions is fine, or route through preview if preferred.
        // For specs, let's route through preview to ensure deduplication.
        handleOpenSmartImportPreview({ specs });
    };

    const handleApplyCompetitor = (comp: CompetitorAnalysis) => {
        handleOpenSmartImportPreview({ competitors: [comp] });
    };

    // NEW: Open Preview instead of direct apply
    const handleOpenSmartImportPreview = (data: any) => {
        // Run cleanup logic here too in case data came from Copilot
        const cleanedData = cleanExtractedData(data);
        setExtractionPreview(cleanedData);
    };

    // Helper: Move items from specs array to root fields if they match global fields
    const cleanExtractedData = (data: any) => {
        const newData = { ...data };
        const specs = [...(newData.specs || [])];
        const newSpecs: any[] = [];

        specs.forEach((spec: any) => {
            // Check if spec label matches any global product field label
            const matchedField = allFields.find(f => 
                f.isProductField && 
                f.label.toLowerCase() === spec.label.toLowerCase()
            );

            if (matchedField) {
                // Move to root data
                newData[matchedField.key] = spec.value;
            } else {
                newSpecs.push(spec);
            }
        });

        newData.specs = newSpecs;
        return newData;
    };

    // Actual Merge Logic (Triggered from Modal)
    const handleMergeSmartImport = (data: any) => {
        const newProduct = { ...currentProduct };
        
        if (data.sku) newProduct.sku = data.sku;
        
        // FIX: Handle both 'name' and 'productName' keys for the root name property.
        // The extraction preview often uses 'productName' based on the prompt instructions.
        if (data.name) newProduct.name = data.name;
        else if (data.productName) newProduct.name = data.productName;

        if (data.brand) newProduct.brands = Array.from(new Set([...(newProduct.brands || []), data.brand]));
        
        // Specs: Intelligent Merge (Overwrite if label matches, else append)
        if (data.specs && Array.isArray(data.specs)) {
            const existingSpecs = [...(newProduct.specs || [])];
            data.specs.forEach((newSpec: any) => {
                const idx = existingSpecs.findIndex(s => s.label.toLowerCase() === newSpec.label.toLowerCase());
                if (idx >= 0) existingSpecs[idx] = newSpec;
                else existingSpecs.push(newSpec);
            });
            newProduct.specs = existingSpecs;
        }

        // Selling Points
        if (data.sellingPoints) {
            // Normalize selling points: if it's string array, map to objects. If object array, use as is.
            let spArray = Array.isArray(data.sellingPoints) ? data.sellingPoints : [];
            if (spArray.length > 0 && typeof spArray[0] === 'string') {
                spArray = spArray.map((s: string) => ({ text: s }));
            }
            newProduct.data = { 
                ...newProduct.data, 
                sellingPoints: spArray 
            };
        }

        // Competitors
        if (data.competitors && Array.isArray(data.competitors)) {
            const existingComps = [...(newProduct.competitors || [])];
            data.competitors.forEach((newComp: any) => {
                const idx = existingComps.findIndex(c => c.name.toLowerCase() === newComp.name.toLowerCase());
                if (idx >= 0) existingComps[idx] = newComp;
                else existingComps.push(newComp);
            });
            newProduct.competitors = existingComps;
        }

        // Synced Dynamic Fields (if returned by AI)
        allFields.forEach(f => {
            if (f.isProductField && data[f.key] !== undefined) {
                // Handle text array (tags) conversion if needed
                let val = data[f.key];
                if (typeof val === 'string' && (f.type === 'multiselect' || f.key === 'styleTags')) {
                    val = val.split(',').map((s: string) => s.trim());
                }
                newProduct.data = { ...newProduct.data, [f.key]: val };
            }
        });

        setCurrentProduct(newProduct);
        setExtractionPreview(null); // Close preview
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

    // --- AI MAGIC EXTRACTION ---
    const handleAutoFillFromAssets = async () => {
        const data = currentProduct.data || {};
        const assetsToAnalyze = [
            ...(data.galleryImages || []),
            ...(data.manualFiles || []),
            ...(data.specFiles || []),
            ...(data.competitorFiles || [])
        ];

        if (assetsToAnalyze.length === 0) {
            alert("No assets found to analyze. Please upload images or documents first.");
            return;
        }

        setIsExtracting(true);
        try {
            const apiKey = await getApiKey();
            if (!apiKey) {
                alert("API Key is required.");
                setIsExtracting(false);
                return;
            }
            const ai = new GoogleGenAI({ apiKey });

            // Prepare Dynamic Field List (Strictly Text-Based Only)
            const textBasedTypes = ['text', 'textarea', 'richtext', 'number', 'date', 'datetime', 'select', 'multiselect', 'link'];
            
            const syncedFields = allFields.filter(f => 
                f.isProductField && 
                textBasedTypes.includes(f.type)
            );
            
            const syncedFieldKeys = syncedFields.map(f => `"${f.key}" (${f.label})`).join(', ');

            // 1. Prepare Parts (Fetch and convert to base64)
            const parts: any[] = [
                { text: `Analyze the provided product images and documents. Extract information into strictly valid JSON format.
                
                GLOBAL TEXT FIELDS TO POPULATE (Map to these keys if found):
                [${syncedFieldKeys}]
                * NOTE: Only extract TEXT or NUMERIC values. Do NOT extract images or file paths for these fields.

                STANDARD FIELDS:
                - "sku": SKU or model number (String).
                - "productName": Full product name (String).
                - "brand": Brand name (String).
                - "specs": Array of { "label": string, "value": string }. 
                   IMPORTANT: 
                   1. Translate all spec labels to ENGLISH. 
                   2. Normalize keys (e.g. "Battery", "Batt." -> "Battery Capacity").
                   3. Merge duplicate concepts.
                   4. DO NOT put fields listed in "GLOBAL TEXT FIELDS TO POPULATE" here. Put them in the root JSON object.
                - "sellingPoints": Array of { "text": string }. Extract key features.
                - "competitors": Array of { 
                     "name": string, 
                     "summary": string, 
                     "pros": string[], 
                     "cons": string[],
                     "price_range": string,
                     "target_audience": string,
                     "key_differentiators": string[]
                  }.
                
                If a field is not found in the documents/images, omit it from the JSON. Do not return null.
                ` }
            ];

            // Limit analysis to first 5 assets to avoid payload limits
            for (const url of assetsToAnalyze.slice(0, 5)) {
                const fileData = await urlToBase64(url);
                if (fileData) {
                    parts.push({
                        inlineData: { mimeType: fileData.mimeType, data: fileData.data }
                    });
                }
            }

            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: { parts },
                config: { responseMimeType: 'application/json' }
            });

            db.logModelUsage('ProductManager', 'gemini-3-flash-preview', { type: 'data_extraction', config: { responseMimeType: 'application/json' } }).catch(console.error);

            const rawExtracted = JSON.parse(response.text || '{}');
            
            // CLEANUP: Move any accidental specs to root keys
            const cleanedData = cleanExtractedData(rawExtracted);
            
            // INSTEAD OF APPLYING, SET PREVIEW
            setExtractionPreview(cleanedData);

        } catch (e) {
            console.error("AI Extraction failed", e);
            alert("Failed to analyze documents. Please try again.");
        } finally {
            setIsExtracting(false);
        }
    };

    // --- RENDER EXTRACTION PREVIEW MODAL (DIFF VIEW) ---
    const renderExtractionPreviewModal = () => {
        if (!extractionPreview) return null;

        // Helper to check if field is modified
        const hasChange = (key: string, newVal: any) => {
            // Get current value from root or data bucket
            const oldVal = (currentProduct as any)[key] || currentProduct.data?.[key];
            
            // Skip if new value is empty
            if (!newVal) return false;
            if (Array.isArray(newVal) && newVal.length === 0) return false;
            
            // Compare
            return JSON.stringify(oldVal) !== JSON.stringify(newVal);
        };

        return (
            <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in-up">
                <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
                    <div className="p-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white flex justify-between items-center shrink-0">
                        <div className="flex items-center gap-2">
                            <Sparkles size={20} className="text-yellow-300"/>
                            <div>
                                <h3 className="font-bold text-lg">Smart Extract Review</h3>
                                <p className="text-xs text-indigo-100 opacity-90">Only showing new or changed information.</p>
                            </div>
                        </div>
                        <button onClick={() => setExtractionPreview(null)} className="text-white/70 hover:text-white bg-white/10 rounded-full p-1"><X size={20}/></button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-slate-50">
                        
                        {/* 1. Basic Fields Diff */}
                        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                            <h4 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2"><Package size={16}/> Basic Information</h4>
                            <div className="space-y-4">
                                {['sku', 'brand', 'productName'].map(key => {
                                    const oldVal = (currentProduct as any)[key === 'productName' ? 'name' : key];
                                    const newVal = extractionPreview[key] || extractionPreview[key === 'productName' ? 'name' : key];
                                    
                                    // Logic: Only show if there is a NEW value that is DIFFERENT
                                    if (!newVal || newVal === oldVal) return null;

                                    return (
                                        <div key={key} className="grid grid-cols-2 gap-4 p-2 rounded bg-indigo-50 border border-indigo-100">
                                            <div>
                                                <label className="text-[10px] font-bold text-gray-400 uppercase">{key} (Current)</label>
                                                <div className="text-sm text-gray-600 truncate">{oldVal || '-'}</div>
                                            </div>
                                            <div className="relative">
                                                <label className="text-[10px] font-bold text-indigo-400 uppercase">{key} (New)</label>
                                                <input 
                                                    className="w-full text-sm font-medium bg-transparent border-b outline-none border-indigo-300 text-indigo-700"
                                                    value={newVal || ''}
                                                    onChange={e => setExtractionPreview({...extractionPreview, [key]: e.target.value})}
                                                />
                                                <ArrowRightLeft size={12} className="absolute top-0 right-0 text-indigo-400"/>
                                            </div>
                                        </div>
                                    );
                                })}
                                {/* Fallback if no basic info changed */}
                                {['sku', 'brand', 'productName'].every(k => !hasChange(k === 'productName' ? 'name' : k, extractionPreview[k === 'productName' ? 'name' : k])) && (
                                    <div className="text-xs text-gray-400 italic">No basic information changes detected.</div>
                                )}
                            </div>
                        </div>

                        {/* 2. Synced Attributes Diff (With Type-Specific UI) */}
                        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                            <h4 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2"><LinkIcon size={16}/> Synced Attributes</h4>
                            <div className="space-y-4">
                                {allFields.filter(f => f.isProductField && !['sku', 'productName'].includes(f.key)).map(field => {
                                    const oldVal = currentProduct.data?.[field.key];
                                    const newVal = extractionPreview[field.key];

                                    // Logic: Only show if there is a NEW value that is DIFFERENT
                                    if (!newVal || JSON.stringify(newVal) === JSON.stringify(oldVal)) return null;

                                    // Determine Input Type
                                    const isTextArea = field.type === 'textarea' || field.type === 'richtext' || field.key === 'sellingPoints';
                                    const isArray = Array.isArray(newVal);
                                    
                                    // Prepare Value for Textarea (Join arrays)
                                    let displayValue = newVal;
                                    if (isArray) {
                                        // If array of objects (like sellingPoints), map to text
                                        if (newVal.length > 0 && typeof newVal[0] === 'object' && newVal[0].text) {
                                            displayValue = newVal.map((i: any) => i.text).join('\n');
                                        } else {
                                            displayValue = newVal.join(', ');
                                        }
                                    } else if (typeof newVal === 'object') {
                                        displayValue = JSON.stringify(newVal);
                                    }

                                    return (
                                        <div key={field.key} className="grid grid-cols-2 gap-4 p-2 rounded bg-cyan-50 border border-cyan-100">
                                            <div>
                                                <label className="text-[10px] font-bold text-gray-400 uppercase">{field.label} (Current)</label>
                                                <div className="text-sm text-gray-600 truncate max-h-20 overflow-hidden line-clamp-3">
                                                    {typeof oldVal === 'object' ? JSON.stringify(oldVal) : oldVal || '-'}
                                                </div>
                                            </div>
                                            <div className="relative">
                                                <label className="text-[10px] font-bold text-cyan-600 uppercase">{field.label} (New)</label>
                                                {isTextArea ? (
                                                    <textarea 
                                                        className="w-full text-sm font-medium bg-transparent border rounded border-cyan-300 text-cyan-800 p-2 min-h-[80px] outline-none"
                                                        value={displayValue}
                                                        onChange={e => {
                                                            let valToSave: any = e.target.value;
                                                            // For selling points, convert back to object array structure
                                                            if (field.key === 'sellingPoints') {
                                                                valToSave = valToSave.split('\n').map((t: string) => ({ text: t }));
                                                            }
                                                            setExtractionPreview({...extractionPreview, [field.key]: valToSave})
                                                        }}
                                                    />
                                                ) : (
                                                    <input 
                                                        className="w-full text-sm font-medium bg-transparent border-b outline-none border-cyan-300 text-cyan-800"
                                                        value={displayValue}
                                                        onChange={e => setExtractionPreview({...extractionPreview, [field.key]: e.target.value})}
                                                    />
                                                )}
                                                <ArrowRightLeft size={12} className="absolute top-0 right-0 text-cyan-600"/>
                                            </div>
                                        </div>
                                    );
                                })}
                                {/* Fallback */}
                                {allFields.filter(f => f.isProductField).every(f => !hasChange(f.key, extractionPreview[f.key])) && (
                                    <div className="text-xs text-gray-400 italic">No synced attribute changes detected.</div>
                                )}
                            </div>
                        </div>

                        {/* 3. Specs List Diff */}
                        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                            <div className="flex justify-between items-center mb-4">
                                <h4 className="text-sm font-bold text-gray-700 flex items-center gap-2"><Table size={16}/> Specifications</h4>
                                <button onClick={() => setExtractionPreview({...extractionPreview, specs: [...(extractionPreview.specs || []), {label:'', value:''}]})} className="text-indigo-600 text-[10px] font-bold">+ Add</button>
                            </div>
                            <div className="space-y-2">
                                {(extractionPreview.specs || []).map((spec: any, idx: number) => (
                                    <div key={idx} className="flex gap-2 items-center">
                                        <input className="w-1/3 text-xs border border-gray-300 rounded px-2 py-1.5" value={spec.label} onChange={e => {
                                            const newSpecs = [...extractionPreview.specs]; newSpecs[idx].label = e.target.value; setExtractionPreview({...extractionPreview, specs: newSpecs});
                                        }} placeholder="Label"/>
                                        <input className="flex-1 text-xs border border-gray-300 rounded px-2 py-1.5" value={spec.value} onChange={e => {
                                            const newSpecs = [...extractionPreview.specs]; newSpecs[idx].value = e.target.value; setExtractionPreview({...extractionPreview, specs: newSpecs});
                                        }} placeholder="Value"/>
                                        <button onClick={() => {
                                            const newSpecs = extractionPreview.specs.filter((_:any, i:number) => i !== idx);
                                            setExtractionPreview({...extractionPreview, specs: newSpecs});
                                        }} className="text-gray-400 hover:text-red-500"><X size={14}/></button>
                                    </div>
                                ))}
                                {(!extractionPreview.specs || extractionPreview.specs.length === 0) && <div className="text-center text-xs text-gray-400 italic">No specs extracted.</div>}
                            </div>
                        </div>

                        {/* 4. Competitors Diff */}
                        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                            <h4 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2"><Target size={16}/> Competitor Analysis</h4>
                            <div className="space-y-4">
                                {(extractionPreview.competitors || []).map((comp: any, idx: number) => (
                                    <div key={idx} className="border border-slate-200 rounded-lg p-3 bg-slate-50 relative">
                                        <div className="grid grid-cols-2 gap-3 mb-2">
                                            <input className="font-bold text-sm bg-transparent border-b border-slate-300 pb-1" value={comp.name} onChange={e => {
                                                const newComps = [...extractionPreview.competitors]; newComps[idx].name = e.target.value; setExtractionPreview({...extractionPreview, competitors: newComps});
                                            }} placeholder="Competitor Name"/>
                                            <input className="text-xs bg-transparent border-b border-slate-300 pb-1" value={comp.price_range || ''} onChange={e => {
                                                const newComps = [...extractionPreview.competitors]; newComps[idx].price_range = e.target.value; setExtractionPreview({...extractionPreview, competitors: newComps});
                                            }} placeholder="Price Range"/>
                                        </div>
                                        <textarea className="w-full text-xs border border-slate-200 rounded p-2 mb-2 bg-white" rows={2} value={comp.summary} onChange={e => {
                                            const newComps = [...extractionPreview.competitors]; newComps[idx].summary = e.target.value; setExtractionPreview({...extractionPreview, competitors: newComps});
                                        }} placeholder="Summary"/>
                                        
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="text-[10px] font-bold text-green-600 uppercase">Pros</label>
                                                <div className="text-[10px] text-slate-600">{(comp.pros || []).join(', ')}</div>
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-red-500 uppercase">Cons</label>
                                                <div className="text-[10px] text-slate-600">{(comp.cons || []).join(', ')}</div>
                                            </div>
                                        </div>

                                        <button onClick={() => {
                                            const newComps = extractionPreview.competitors.filter((_:any, i:number) => i !== idx);
                                            setExtractionPreview({...extractionPreview, competitors: newComps});
                                        }} className="absolute top-2 right-2 text-slate-400 hover:text-red-500"><X size={14}/></button>
                                    </div>
                                ))}
                            </div>
                        </div>

                    </div>

                    <div className="p-4 border-t border-gray-200 bg-white flex justify-end gap-3 shrink-0">
                        <button onClick={() => setExtractionPreview(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-bold">{t.cancel}</button>
                        <button onClick={() => handleMergeSmartImport(extractionPreview)} className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 shadow-md flex items-center gap-2">
                            <Check size={16}/> Confirm & Apply
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // --- ASSETS LOGIC ---
    const handleAssetUpload = async (files: FileList) => {
        setIsUploadingAsset(true);
        try {
            const urls = await Promise.all(Array.from(files).map(f => db.uploadFile(f)));
            // Store in data.assets (Array of strings) - Defines "General Manual Assets"
            const currentAssets = currentProduct.data?.assets || [];
            const newAssets = [...currentAssets, ...urls];
            
            // Optimistic update
            setCurrentProduct({
                ...currentProduct,
                data: { ...currentProduct.data, assets: newAssets }
            });

            // If we are in 'view' mode, auto-save the assets immediately
            if (modalMode === 'view' && currentProduct.id) {
                // Background save
                const prodToUpdate = products.find(p => p.id === currentProduct.id);
                if (prodToUpdate) {
                    const updated = {
                        ...prodToUpdate,
                        data: { ...prodToUpdate.data, assets: newAssets },
                        updatedAt: new Date()
                    };
                    await db.saveProduct(updated);
                    // Refresh Main List
                    setProducts(prev => prev.map(p => p.id === updated.id ? updated : p));
                }
            }
        } catch (e) {
            console.error("Upload failed", e);
            alert(t.pm_upload_failed);
        } finally {
            setIsUploadingAsset(false);
        }
    };

    const handleRemoveAsset = async (url: string) => {
        // Removed confirm dialog for better UX responsiveness
        // if (!window.confirm(t.pm_delete_asset_confirm)) return;

        // 1. Remove from currentProduct state (Optimistic)
        const currentAssets = currentProduct.data?.assets || [];
        const newAssets = currentAssets.filter((a: string) => a !== url);
        
        setCurrentProduct({
            ...currentProduct,
            data: { ...currentProduct.data, assets: newAssets }
        });

        // 2. If in 'view' mode, save to DB immediately
        if (modalMode === 'view' && currentProduct.id) {
            const prodToUpdate = products.find(p => p.id === currentProduct.id);
            if (prodToUpdate) {
                const updated = {
                    ...prodToUpdate,
                    data: { ...prodToUpdate.data, assets: newAssets },
                    updatedAt: new Date()
                };
                await db.saveProduct(updated);
                // Refresh Main List
                setProducts(prev => prev.map(p => p.id === updated.id ? updated : p));
            }
        }
    };

    // Filter fields to show in form 
    // EXCLUDE "Basic Info" fields from the dynamic synced list to prevent duplication
    const productFields = allFields.filter(f => f.isProductField && !['sku', 'productName'].includes(f.key));

    // Get tasks linked to current product
    const linkedTasks = useMemo(() => {
        if (!currentProduct.id) return [];
        return tasks.filter(t => 
            (t as any).productId === currentProduct.id || 
            t.identity?.productId === currentProduct.id ||
            t.customData?.productId === currentProduct.id
        );
    }, [currentProduct.id, tasks]);

    // --- AGGREGATE ASSETS ---
    const aggregatedAssets = useMemo(() => {
        const assets: AggregatedAsset[] = [];

        // 1. Manual Uploads (Generic Bucket stored in product.data.assets)
        const manualAssets = currentProduct.data?.assets || [];
        manualAssets.forEach((url: string) => {
            assets.push({
                url,
                type: getAssetType(url),
                fieldKey: 'manual_upload',
                fieldLabel: t.pm_manual_assets,
                source: 'manual_upload',
                originId: 'product',
                originName: t.pm_product_folder,
                date: currentProduct.updatedAt || new Date()
            });
        });

        // 2. Product's Structured Fields (Current Master State)
        allFields.forEach(field => {
            // Only consider media fields
            if (!['image', 'video', 'file'].includes(field.type)) return;
            
            const rawVal = currentProduct.data?.[field.key];
            if (!rawVal) return;

            // Normalize: Ensure we work with an array
            const values = Array.isArray(rawVal) ? rawVal : [rawVal];
            
            values.forEach((url: string) => {
                if (typeof url === 'string' && (url.startsWith('http') || url.startsWith('data:'))) {
                    assets.push({
                        url,
                        type: getAssetType(url, field.type),
                        fieldKey: field.key,
                        fieldLabel: field.label,
                        source: 'product_master',
                        originId: 'product',
                        originName: t.pm_product_master,
                        date: currentProduct.updatedAt || new Date()
                    });
                }
            });
        });

        // 3. Aggregated from Linked Tasks (History)
        linkedTasks.forEach(task => {
            allFields.forEach(field => {
                // Only care about media fields
                if (!['image', 'video', 'file'].includes(field.type)) return;

                // Extract value from task based on section mapping
                const sectionMap: any = { 'identity': 'identity', 'assets': 'assets', 'requirements': 'requirements', 'directives': 'directives', 'custom': 'customData', 'ai_assets': 'customData' };
                const target = sectionMap[field.section] || 'customData';
                
                // Try target section first, fallback to customData if not found (robustness)
                let rawValue = (task as any)[target]?.[field.key];
                if (!rawValue && target !== 'customData') {
                    rawValue = (task as any).customData?.[field.key];
                }

                // Normalize to array (CRITICAL FIX for missing assets)
                const values = Array.isArray(rawValue) ? rawValue : (typeof rawValue === 'string' && rawValue ? [rawValue] : []);

                if (values.length > 0) {
                    values.forEach((url: string) => {
                        if (typeof url === 'string' && (url.startsWith('http') || url.startsWith('data:'))) {
                            // DETERMINE SOURCE: Check Metadata First, Fallback to Heuristic
                            let source: AssetSource = 'task_human';
                            
                            // Check explicit metadata
                            const metadata = task.assetMetadata?.[url];
                            
                            // Check if it exists in the explicitly generated AI bucket
                            const isExplicitlyGenerated = task.aiGeneratedImages?.includes(url);

                            if (metadata) {
                                source = metadata.source === 'ai' ? 'task_ai' : 'task_human';
                            } else if (isExplicitlyGenerated) {
                                source = 'task_ai';
                            } else {
                                // Fallback Heuristic
                                const isAI = field.section === 'ai_assets' || field.key.toLowerCase().includes('ai') || field.key.includes('generated') || field.key.includes('prompt');
                                source = isAI ? 'task_ai' : 'task_human';
                            }
                            
                            assets.push({
                                url,
                                type: getAssetType(url, field.type),
                                fieldKey: field.key,
                                fieldLabel: field.label,
                                source,
                                originId: task.id,
                                originName: task.identity.productName + (task.stage ? ` (${task.stage})` : ''),
                                date: task.createdAt
                            });
                        }
                    });
                }
            });
        });

        // Sort by date descending to show newest first
        const uniqueAssets = assets.filter((asset, index, self) => 
            index === self.findIndex((t) => (
                t.url === asset.url && t.originId === asset.originId // Allow same image from different sources (Task vs Product)
            ))
        );

        return uniqueAssets.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [currentProduct, linkedTasks, allFields, t]);

    // Filtered and Grouped Assets for View
    const groupedAssets = useMemo(() => {
        const filtered = aggregatedAssets.filter(a => a.type === assetFilter);
        
        // Group by Field Label
        const groups: Record<string, AggregatedAsset[]> = {};
        filtered.forEach(a => {
            if (!groups[a.fieldLabel]) groups[a.fieldLabel] = [];
            groups[a.fieldLabel].push(a);
        });
        
        return groups;
    }, [aggregatedAssets, assetFilter]);

    // Helper function for Source Badge
    const getSourceBadge = (source: AssetSource) => {
        switch(source) {
            case 'product_master': return <span className="bg-purple-100 text-purple-700 text-[9px] px-1.5 py-0.5 rounded border border-purple-200 font-bold flex items-center shadow-sm bg-white/90 backdrop-blur-sm"><Package size={10} className="mr-1"/> Master</span>;
            case 'manual_upload': return <span className="bg-gray-100 text-gray-600 text-[9px] px-1.5 py-0.5 rounded border border-gray-200 font-bold flex items-center shadow-sm bg-white/90 backdrop-blur-sm"><UploadCloud size={10} className="mr-1"/> Manual</span>;
            case 'task_ai': return <span className="bg-indigo-100 text-indigo-700 text-[9px] px-1.5 py-0.5 rounded border border-indigo-200 font-bold flex items-center shadow-sm bg-white/90 backdrop-blur-sm"><Sparkles size={10} className="mr-1"/> AI Gen</span>;
            case 'task_human': return <span className="bg-blue-100 text-blue-700 text-[9px] px-1.5 py-0.5 rounded border border-blue-200 font-bold flex items-center shadow-sm bg-white/90 backdrop-blur-sm"><User size={10} className="mr-1"/> Task</span>;
        }
    };

    // RENDER HELPER FOR ASSET UPLOADER
    const renderAssetUploader = (label: string, fieldKey: string, type: 'image' | 'file', icon: any, draggable = false) => {
        const files = (currentProduct.data?.[fieldKey] as string[]) || [];
        const isImage = type === 'image';

        return (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 relative">
                <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-bold text-gray-700 uppercase flex items-center gap-1">
                        {icon} {label}
                    </label>
                    {modalMode !== 'view' && (
                        <label className="cursor-pointer text-indigo-600 hover:text-indigo-800 text-[10px] font-bold flex items-center bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                            <Plus size={10} className="mr-1"/> Add
                            <input 
                                type="file" 
                                multiple 
                                accept={isImage ? "image/*" : ".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"} 
                                className="hidden" 
                                onChange={(e) => e.target.files && uploadFieldFiles(e.target.files, fieldKey)}
                            />
                        </label>
                    )}
                </div>
                <div className="flex flex-wrap gap-2">
                    {files.length === 0 && <span className="text-xs text-gray-400 italic py-2">No {label.toLowerCase()} added.</span>}
                    {files.map((url, idx) => (
                        <div 
                            key={idx} 
                            draggable={draggable}
                            onDragStart={(e) => draggable && handleDragStart(e, idx)}
                            onDragOver={(e) => draggable && handleDragOver(e, idx, fieldKey)}
                            className={`relative group border border-gray-200 rounded overflow-hidden bg-white ${isImage ? 'w-16 h-16' : 'w-full flex items-center p-2'} ${draggedImgIndex === idx && draggable ? 'opacity-50 border-dashed border-indigo-400' : ''}`}
                        >
                            {isImage ? (
                                <>
                                    <img src={url || undefined} className="w-full h-full object-cover cursor-zoom-in" onClick={() => setPreviewImage(url)} />
                                    {/* Default Badge for Index 0 */}
                                    {idx === 0 && draggable && (
                                        <div className="absolute bottom-0 left-0 right-0 bg-indigo-600/80 text-white text-[8px] text-center font-bold py-0.5">MAIN</div>
                                    )}
                                </>
                            ) : (
                                <a href={url} target="_blank" className="flex items-center gap-2 text-xs text-blue-600 hover:underline truncate flex-1">
                                    <FileIcon size={12}/> 
                                    <span className="truncate">Document {idx + 1}</span>
                                </a>
                            )}
                            
                            {modalMode !== 'view' && (
                                <button 
                                    type="button"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        removeFieldFile(url, fieldKey);
                                    }}
                                    onMouseDown={(e) => e.stopPropagation()} // Prevent drag start
                                    onPointerDown={(e) => e.stopPropagation()} // Prevent touch drag start
                                    className={`absolute ${isImage ? 'top-0.5 right-0.5' : 'right-2'} z-50 bg-white text-gray-400 hover:text-red-500 rounded-full p-0.5 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer`}
                                >
                                    <X size={12}/>
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="flex h-full flex-col bg-gray-50">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-8 py-6 flex justify-between items-center shrink-0">
                <div>
                    <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
                        <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg"><Package size={24} /></div>
                        {t.product_management}
                    </h2>
                    <p className="text-gray-500 text-sm mt-1 ml-14">{t.pm_subtitle}</p>
                </div>
                <button onClick={handleCreate} className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold flex items-center hover:bg-indigo-700 transition-colors shadow-sm">
                    <Plus size={18} className="mr-2"/> {t.pm_new_product}
                </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden flex flex-col p-8 max-w-7xl mx-auto w-full">
                
                {/* TOOLBAR: Filter & Search */}
                <div className="mb-6 flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="flex items-center gap-4 flex-1 w-full md:w-auto">
                        {/* Search */}
                        <div className="relative flex-1 max-w-xs">
                            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                            <input 
                                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all" 
                                placeholder={t.pm_search_placeholder}
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                            />
                        </div>

                        {/* Brand Filter */}
                        <div className="relative">
                            <select 
                                className="appearance-none bg-white border border-gray-200 text-gray-700 text-sm py-2 pl-3 pr-8 rounded-lg cursor-pointer hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                                value={filterBrand}
                                onChange={(e) => setFilterBrand(e.target.value)}
                            >
                                <option value="all">{t.pm_all_brands}</option>
                                {allBrands.map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                            <Filter size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
                        </div>

                        {/* Channel Filter */}
                        <div className="relative">
                            <select 
                                className="appearance-none bg-white border border-gray-200 text-gray-700 text-sm py-2 pl-3 pr-8 rounded-lg cursor-pointer hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                                value={filterChannel}
                                onChange={(e) => setFilterChannel(e.target.value)}
                            >
                                <option value="all">{t.pm_all_channels}</option>
                                {allChannels.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <Filter size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="text-sm text-gray-500 font-medium mr-2">
                            {filteredProducts.length} {t.pm_products_suffix}
                        </div>
                        {/* VIEW TOGGLE */}
                        <div className="flex bg-white rounded-lg p-1 border border-gray-200 shadow-sm">
                            <button 
                                onClick={() => setViewMode('grid')}
                                className={`p-2 rounded-md transition-all ${viewMode === 'grid' ? 'bg-indigo-50 text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                                title="Grid View"
                            >
                                <Grid size={16}/>
                            </button>
                            <button 
                                onClick={() => setViewMode('list')}
                                className={`p-2 rounded-md transition-all ${viewMode === 'list' ? 'bg-indigo-50 text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                                title="List View"
                            >
                                <AlignJustify size={16}/>
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar pb-20">
                    {isLoading ? (
                        <div className="flex justify-center p-20"><Loader2 className="animate-spin text-indigo-600 w-8 h-8"/></div>
                    ) : filteredProducts.length === 0 ? (
                        <div className="text-center py-20 bg-white rounded-xl border border-gray-200 border-dashed">
                            <Package size={48} className="mx-auto text-gray-300 mb-4"/>
                            <p className="text-gray-500 italic">{t.pm_no_products}</p>
                        </div>
                    ) : viewMode === 'grid' ? (
                        /* GRID VIEW */
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {filteredProducts.map(p => (
                                <div key={p.id} className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all hover:border-indigo-200 group flex flex-col overflow-hidden relative">
                                    <div className="h-32 bg-gray-50 border-b border-gray-100 flex items-center justify-center relative overflow-hidden">
                                        {/* Try to find first image in data */}
                                        {(() => {
                                            // Image Logic: Prioritize 'productImage' then 'galleryImages'
                                            let imgUrl = null;
                                            
                                            // 1. PRIORITIZE SYNCED ATTRIBUTE 'productImage'
                                            const mainImg = p.data['productImage'];
                                            if (mainImg) {
                                                if(Array.isArray(mainImg) && mainImg.length > 0) imgUrl = mainImg[0];
                                                else if(typeof mainImg === 'string' && mainImg.trim() !== '') imgUrl = mainImg;
                                            }

                                            // 2. FALLBACK TO GALLERY IMAGES (Core Assets)
                                            if (!imgUrl) {
                                                const gallery = p.data['galleryImages'];
                                                if (Array.isArray(gallery) && gallery.length > 0) {
                                                    imgUrl = gallery[0];
                                                }
                                            }

                                            // 3. Fallback to any other image field (last resort)
                                            if (!imgUrl) {
                                                const firstImgKey = Object.keys(p.data).find(k => {
                                                    if (k === 'productImage' || k === 'galleryImages') return false; // Already checked
                                                    const field = allFields.find(f => f.key === k);
                                                    return field?.type === 'image';
                                                });
                                                if (firstImgKey) {
                                                    const val = p.data[firstImgKey];
                                                    if (Array.isArray(val) && val.length > 0) imgUrl = val[0];
                                                    else if (typeof val === 'string' && val) imgUrl = val;
                                                }
                                            }

                                            return imgUrl ? (
                                                <img src={imgUrl || undefined} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                                            ) : (
                                                <Package size={32} className="text-gray-300"/>
                                            );
                                        })()}
                                        
                                        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => handleEdit(p)} className="p-1.5 bg-white text-gray-600 rounded shadow hover:text-indigo-600"><Edit size={14}/></button>
                                            <button onClick={() => handleDelete(p)} className="p-1.5 bg-white text-gray-600 rounded shadow hover:text-red-600"><Trash2 size={14}/></button>
                                        </div>
                                        {/* Level Badge */}
                                        <div className="absolute top-2 left-2">
                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm border ${p.level === 'S' ? 'bg-purple-100 text-purple-700 border-purple-200' : p.level === 'A' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                                                {p.level || 'B'}
                                            </span>
                                        </div>
                                    </div>
                                    
                                    <div className="p-4 flex-1 flex flex-col">
                                        <div className="flex justify-between items-start mb-1">
                                            <span className="text-[10px] font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200 truncate max-w-[120px]">{p.sku}</span>
                                            <span className="text-[10px] text-gray-400">{format(p.updatedAt, 'MM/dd')}</span>
                                        </div>
                                        <h3 className="font-bold text-gray-800 text-sm mb-1 line-clamp-2 min-h-[40px]">{p.name}</h3>
                                        
                                        {/* Brands & Channels Chips */}
                                        <div className="flex flex-wrap gap-1 mb-3">
                                            {(p.brands || []).slice(0, 2).map((b, i) => (
                                                <span key={i} className="text-[9px] bg-slate-50 text-slate-600 px-1.5 py-0.5 rounded border border-slate-100 truncate max-w-[60px]">{b}</span>
                                            ))}
                                            {(p.channels || []).slice(0, 2).map((c, i) => (
                                                <span key={i} className="text-[9px] bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded border border-orange-100 truncate max-w-[60px]">{c}</span>
                                            ))}
                                        </div>

                                        <button 
                                            onClick={() => handleView(p)}
                                            className="mt-auto w-full py-2 bg-gray-50 text-gray-600 text-xs font-bold rounded-lg border border-transparent hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-100 transition-all flex items-center justify-center gap-2"
                                        >
                                            <Eye size={12}/> {t.pm_view_details}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        /* LIST VIEW */
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500 font-bold">
                                        <th className="p-4 w-20">{t.pm_col_image}</th>
                                        <th className="p-4 w-32">{t.pm_col_sku}</th>
                                        <th className="p-4">{t.pm_col_product_name}</th>
                                        <th className="p-4">{t.pm_col_brands}</th>
                                        <th className="p-4">{t.pm_col_channels}</th>
                                        <th className="p-4 w-24">{t.pm_col_level}</th>
                                        <th className="p-4 w-32">{t.pm_col_updated}</th>
                                        <th className="p-4 text-right">{t.pm_col_actions}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {filteredProducts.map(p => {
                                        // Image Logic (Prioritize productImage -> galleryImages)
                                        let imgUrl = null;
                                        
                                        // 1. Synced Attribute 'productImage'
                                        const mainImg = p.data['productImage'];
                                        if (mainImg) {
                                            if(Array.isArray(mainImg) && mainImg.length > 0) imgUrl = mainImg[0];
                                            else if(typeof mainImg === 'string' && mainImg.trim() !== '') imgUrl = mainImg;
                                        } 
                                        
                                        // 2. Core Asset 'galleryImages'
                                        if (!imgUrl) {
                                            const gallery = p.data['galleryImages'];
                                            if (Array.isArray(gallery) && gallery.length > 0) {
                                                imgUrl = gallery[0];
                                            }
                                        }

                                        // 3. Fallback
                                        if (!imgUrl) {
                                            const firstImgKey = Object.keys(p.data).find(k => {
                                                if (k === 'productImage' || k === 'galleryImages') return false;
                                                const field = allFields.find(f => f.key === k);
                                                return field?.type === 'image';
                                            });
                                            if (firstImgKey) {
                                                const val = p.data[firstImgKey];
                                                if (Array.isArray(val) && val.length > 0) imgUrl = val[0];
                                                else if (typeof val === 'string' && val) imgUrl = val;
                                            }
                                        }

                                        return (
                                            <tr key={p.id} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => handleView(p)}>
                                                <td className="p-4">
                                                    <div className="w-10 h-10 rounded bg-gray-100 border border-gray-200 overflow-hidden flex items-center justify-center">
                                                        {imgUrl ? <img src={imgUrl || undefined} className="w-full h-full object-cover"/> : <Package size={16} className="text-gray-400"/>}
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <span className="text-xs font-mono font-bold text-gray-700 bg-gray-100 px-2 py-1 rounded">{p.sku}</span>
                                                </td>
                                                <td className="p-4">
                                                    <div className="text-sm font-bold text-gray-800 line-clamp-1">{p.name}</div>
                                                </td>
                                                <td className="p-4">
                                                    <div className="flex flex-wrap gap-1">
                                                        {(p.brands || []).map(b => (
                                                            <span key={b} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">{b}</span>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <div className="flex flex-wrap gap-1">
                                                        {(p.channels || []).map(c => (
                                                            <span key={c} className="text-[10px] bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded border border-orange-100">{c}</span>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${p.level === 'S' ? 'bg-purple-100 text-purple-700 border-purple-200' : p.level === 'A' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                                                        {p.level || 'B'}
                                                    </span>
                                                </td>
                                                <td className="p-4 text-xs text-gray-500">
                                                    {format(p.updatedAt, 'MM/dd HH:mm')}
                                                </td>
                                                <td className="p-4 text-right" onClick={e => e.stopPropagation()}>
                                                    <div className="flex justify-end gap-2">
                                                        <button onClick={() => handleEdit(p)} className="p-1.5 hover:bg-indigo-50 text-gray-400 hover:text-indigo-600 rounded"><Edit size={16}/></button>
                                                        <button onClick={() => handleDelete(p)} className="p-1.5 hover:bg-red-50 text-gray-400 hover:text-red-600 rounded"><Trash2 size={16}/></button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {/* PRODUCT MODAL (View/Edit/Create) */}
            {isModalOpen && (
                <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-5xl h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-fade-in-up relative">
                        
                        {/* Header */}
                        <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-gray-50 shrink-0">
                            <div className="flex items-center gap-4">
                                <div className={`p-3 rounded-xl shadow-sm ${modalMode === 'view' ? 'bg-white border border-gray-200 text-gray-600' : 'bg-indigo-600 text-white'}`}>
                                    {modalMode === 'create' ? <Plus size={24}/> : modalMode === 'edit' ? <Edit size={24}/> : <Package size={24}/>}
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-gray-900">
                                        {modalMode === 'create' ? t.pm_create_title : modalMode === 'edit' ? t.pm_edit_title : currentProduct.name}
                                    </h3>
                                    {modalMode === 'view' && <div className="flex items-center gap-2 mt-1">
                                        <span className="text-xs font-mono bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded">{currentProduct.sku}</span>
                                        <span className="text-xs text-gray-400">{t.pm_last_updated} {format(currentProduct.updatedAt || new Date(), 'yyyy-MM-dd HH:mm')}</span>
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${currentProduct.level === 'S' ? 'bg-purple-100 text-purple-700 border-purple-200' : 'bg-gray-100 text-gray-600 border-gray-200'}`}>Level {currentProduct.level}</span>
                                    </div>}
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                {/* COPILOT TOGGLE */}
                                {modalMode !== 'view' && (
                                    <button 
                                        onClick={() => setShowCopilot(!showCopilot)}
                                        className={`px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${showCopilot ? 'bg-indigo-100 text-indigo-700 border border-indigo-200' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                                    >
                                        <Bot size={16}/> Copilot
                                    </button>
                                )}

                                {modalMode === 'view' && (
                                    <button onClick={() => setModalMode('edit')} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 transition-colors flex items-center shadow-md shadow-indigo-200">
                                        <Edit size={16} className="mr-2"/> {t.edit}
                                    </button>
                                )}
                                <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 p-2 rounded-full hover:bg-gray-200 transition-colors"><X size={24}/></button>
                            </div>
                        </div>

                        {/* Tabs (Only visible if not creating) */}
                        {modalMode !== 'create' && (
                            <div className="flex border-b border-gray-200 px-8 bg-white shrink-0 overflow-x-auto">
                                <button 
                                    onClick={() => setActiveTab('details')}
                                    className={`py-4 px-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${activeTab === 'details' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                                >
                                    <LayoutGrid size={16}/> {t.pm_tab_details}
                                </button>
                                <button 
                                    onClick={() => setActiveTab('assets')}
                                    className={`py-4 px-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${activeTab === 'assets' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                                >
                                    <FolderOpen size={16}/> {t.pm_tab_assets}
                                    <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full text-[10px]">{aggregatedAssets.length}</span>
                                </button>
                                <button 
                                    onClick={() => setActiveTab('tasks')}
                                    className={`py-4 px-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${activeTab === 'tasks' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                                >
                                    <List size={16}/> {t.pm_tab_tasks}
                                    <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full text-[10px]">{linkedTasks.length}</span>
                                </button>
                                <button 
                                    onClick={() => setActiveTab('history')}
                                    className={`py-4 px-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${activeTab === 'history' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                                >
                                    <History size={16}/> {t.pm_tab_history}
                                    <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full text-[10px]">{currentProduct.history?.length || 0}</span>
                                </button>
                            </div>
                        )}

                        <div className="flex-1 flex overflow-hidden">
                            {/* LEFT: MAIN FORM */}
                            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-gray-50">
                                {/* ... (ASSETS Tab content same as before) ... */}
                                {activeTab === 'assets' && (
                                    <div className="max-w-6xl mx-auto space-y-6">
                                        <div className="flex justify-between items-center">
                                            <div className="flex bg-white rounded-lg p-1 border border-gray-200 shadow-sm">
                                                {(['image', 'video', 'file'] as AssetType[]).map(type => (
                                                    <button
                                                        key={type}
                                                        onClick={() => setAssetFilter(type)}
                                                        className={`px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-all ${assetFilter === type ? 'bg-indigo-600 text-white shadow' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'}`}
                                                    >
                                                        {type === 'image' && <ImageIcon size={16}/>}
                                                        {type === 'video' && <Film size={16}/>}
                                                        {type === 'file' && <FileText size={16}/>}
                                                        <span className="capitalize">{type}s</span>
                                                    </button>
                                                ))}
                                            </div>
                                            <label className="cursor-pointer bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-bold shadow-sm hover:bg-gray-50 transition-colors flex items-center">
                                                <UploadCloud size={16} className="mr-2"/>
                                                {t.pm_upload_general}
                                                <input type="file" multiple className="hidden" onChange={(e) => e.target.files && handleAssetUpload(e.target.files)} disabled={isUploadingAsset} />
                                            </label>
                                        </div>
                                        {/* Asset Grid Logic (Same as existing) */}
                                        <div className="space-y-8">
                                            {/* ... reusing existing grid code ... */}
                                            {Object.keys(groupedAssets).length === 0 && <div className="text-center py-20 text-gray-400 italic">No {assetFilter}s found.</div>}
                                            {Object.entries(groupedAssets).map(([fieldLabel, assets]: [string, any[]]) => (
                                                <div key={fieldLabel} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                                                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                                                        <h4 className="font-bold text-gray-700 text-sm flex items-center gap-2"><FolderOpen size={16} className="text-indigo-400"/> {fieldLabel}</h4>
                                                        <span className="text-xs bg-white px-2 py-0.5 rounded border border-gray-200 text-gray-500">{assets.length} items</span>
                                                    </div>
                                                    <div className="p-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                                        {assets.map((asset: any, idx: number) => (
                                                            <div key={idx} className="group relative bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col">
                                                                <div className="aspect-square bg-gray-100 flex items-center justify-center relative overflow-hidden">
                                                                    <img src={asset.url || undefined} className="w-full h-full object-cover transition-transform group-hover:scale-105 cursor-zoom-in" onClick={() => setPreviewImage(asset.url)}/>
                                                                    <div className="absolute top-2 right-2 z-10 pointer-events-none">{getSourceBadge(asset.source)}</div>
                                                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 z-20 pointer-events-none">
                                                                        <a href={asset.url} target="_blank" className="p-2 bg-white/20 text-white hover:bg-white/40 rounded-full backdrop-blur-sm pointer-events-auto"><Download size={16}/></a>
                                                                        {(asset.source === 'manual_upload' || asset.source === 'product_master') && (
                                                                            <button onClick={() => handleRemoveAsset(asset.url)} className="p-2 bg-white/20 text-white hover:bg-red-500/80 rounded-full backdrop-blur-sm pointer-events-auto"><Trash2 size={16}/></button>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <div className="p-2 bg-white border-t border-gray-100 flex flex-col gap-0.5">
                                                                    <div className="flex items-center justify-between"><span className="text-[10px] font-bold text-gray-700 truncate max-w-[80px]">{asset.originId === 'product' ? 'Product Folder' : asset.originId}</span><span className="text-[9px] text-gray-400">{format(new Date(asset.date), 'MM/dd')}</span></div>
                                                                    <div className="text-[9px] text-gray-400 truncate">{asset.originName}</div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'details' && (
                                    <div className="max-w-4xl mx-auto space-y-8">
                                        
                                        {/* CORE ASSETS & DOCUMENTATION (MOVED TOP) */}
                                        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm relative">
                                            <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-6 flex items-center">
                                                <FolderOpen className="mr-2" size={16}/> {t.pm_core_assets}
                                            </h4>
                                            
                                            <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                                                
                                                {/* 1. Multi-angle Product Images */}
                                                <div className="col-span-2">
                                                    {/* DRAGGABLE GALLERY */}
                                                    {renderAssetUploader(t.pm_product_gallery, 'galleryImages', 'image', <ImageIcon size={14}/>, true)}
                                                    <div className="text-[10px] text-gray-400 mt-1 italic flex items-center gap-1"><GripHorizontal size={10}/> {t.pm_drag_to_reorder}</div>
                                                </div>

                                                {/* 2. Brand Logo */}
                                                <div>
                                                    {renderAssetUploader(t.pm_brand_logo, 'brandLogo', 'image', <Star size={14}/>)}
                                                </div>

                                                {/* 3. Manuals */}
                                                <div>
                                                    {renderAssetUploader(t.pm_user_manuals, 'manualFiles', 'file', <FileText size={14}/>)}
                                                </div>

                                                {/* 3.1 Specs */}
                                                <div>
                                                    {renderAssetUploader(t.pm_spec_files, 'specFiles', 'file', <FileSpreadsheet size={14}/>)}
                                                </div>

                                                {/* 3.2 Competitors */}
                                                <div>
                                                    {renderAssetUploader(t.pm_competitor_files, 'competitorFiles', 'file', <Target size={14}/>)}
                                                </div>

                                                {/* 4. SOPs */}
                                                <div>
                                                    {renderAssetUploader(t.pm_design_sops, 'sopFiles', 'file', <List size={14}/>)}
                                                </div>

                                                {/* 5. Internal Network Path */}
                                                <div className="col-span-2">
                                                    <label className="text-xs font-bold text-gray-700 uppercase flex items-center gap-1 mb-2">
                                                        <LinkIcon size={14}/> {t.pm_internal_network_path}
                                                    </label>
                                                    <div className="flex gap-2">
                                                        {modalMode !== 'view' ? (
                                                            <input 
                                                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                                                placeholder="e.g. \\192.168.1.100\Products\SKU123"
                                                                value={currentProduct.data?.internalAssetUrl || ''}
                                                                onChange={e => setCurrentProduct({...currentProduct, data: { ...currentProduct.data, internalAssetUrl: e.target.value }})}
                                                            />
                                                        ) : (
                                                            <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono text-gray-600 truncate">
                                                                {currentProduct.data?.internalAssetUrl || 'Not set'}
                                                            </div>
                                                        )}
                                                        {currentProduct.data?.internalAssetUrl && (
                                                            <button 
                                                                onClick={() => {navigator.clipboard.writeText(currentProduct.data?.internalAssetUrl); alert("Path copied!");}}
                                                                className="bg-gray-100 hover:bg-gray-200 text-gray-600 p-2 rounded-lg border border-gray-300"
                                                                title="Copy Path"
                                                            >
                                                                <FileIcon size={16}/>
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* MAGIC BUTTON */}
                                            {modalMode !== 'view' && (
                                                <div className="absolute bottom-4 right-4">
                                                    <button 
                                                        onClick={handleAutoFillFromAssets}
                                                        disabled={isExtracting}
                                                        className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-4 py-2 rounded-full font-bold shadow-lg hover:shadow-xl hover:scale-105 transition-all text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {isExtracting ? <Loader2 className="animate-spin" size={14}/> : <Wand2 size={14}/>}
                                                        {t.pm_smart_extract}
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        {/* BASIC INFO CARD (MOVED DOWN) */}
                                        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                                            <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-6 flex items-center">
                                                <Package className="mr-2" size={16}/> {t.pm_basic_info}
                                            </h4>
                                            <div className="grid grid-cols-2 gap-8">
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-1.5">{t.pm_sku} <span className="text-red-500">*</span></label>
                                                    {modalMode === 'view' ? (
                                                        <div className="text-lg font-mono font-bold text-gray-800">{currentProduct.sku}</div>
                                                    ) : (
                                                        <input 
                                                            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm"
                                                            value={currentProduct.sku || ''}
                                                            onChange={e => setCurrentProduct({...currentProduct, sku: e.target.value})}
                                                            placeholder="e.g. PROD-001"
                                                        />
                                                    )}
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-1.5">{t.pm_product_name} <span className="text-red-500">*</span></label>
                                                    {modalMode === 'view' ? (
                                                        <div className="text-lg font-bold text-gray-800">{currentProduct.name}</div>
                                                    ) : (
                                                        <input 
                                                            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-bold"
                                                            value={currentProduct.name || ''}
                                                            onChange={e => setCurrentProduct({...currentProduct, name: e.target.value})}
                                                            placeholder="e.g. Wireless Headphones"
                                                        />
                                                    )}
                                                </div>
                                                
                                                {/* NEW: Product Level Input */}
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-1">
                                                        <Star size={14}/> {t.pm_product_level}
                                                    </label>
                                                    {modalMode === 'view' ? (
                                                        <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-bold border ${currentProduct.level === 'S' ? 'bg-purple-100 text-purple-700 border-purple-200' : currentProduct.level === 'A' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                                                            {currentProduct.level || 'B'}
                                                        </div>
                                                    ) : (
                                                        <select 
                                                            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-white"
                                                            value={currentProduct.level || 'B'}
                                                            onChange={e => setCurrentProduct({...currentProduct, level: e.target.value as ProductLevel})}
                                                        >
                                                            <option value="S">S - Strategic</option>
                                                            <option value="A">A - Priority</option>
                                                            <option value="B">B - Standard</option>
                                                            <option value="C">C - Low</option>
                                                        </select>
                                                    )}
                                                </div>

                                                {/* NEW: Brands & Channels Tags */}
                                                <div className="col-span-2 grid grid-cols-2 gap-8">
                                                    <div>
                                                        <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-1"><Tag size={14}/> {t.pm_brands}</label>
                                                        <div className="flex flex-wrap gap-2 mb-2">
                                                            {(currentProduct.brands || []).map(b => (
                                                                <span key={b} className="bg-slate-100 text-slate-700 px-2 py-1 rounded text-xs border border-slate-200 flex items-center">
                                                                    {b}
                                                                    {modalMode !== 'view' && <button onClick={() => setCurrentProduct({...currentProduct, brands: currentProduct.brands?.filter(x => x !== b)})} className="ml-1 hover:text-red-500"><X size={10}/></button>}
                                                                </span>
                                                            ))}
                                                        </div>
                                                        {modalMode !== 'view' && (
                                                            <input 
                                                                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 outline-none"
                                                                placeholder="Add brand + Enter"
                                                                value={brandInput}
                                                                onChange={e => setBrandInput(e.target.value)}
                                                                onKeyDown={e => {
                                                                    if(e.key === 'Enter' && brandInput.trim()) {
                                                                        setCurrentProduct(prev => ({...prev, brands: [...(prev.brands || []), brandInput.trim()]}));
                                                                        setBrandInput('');
                                                                    }
                                                                }}
                                                            />
                                                        )}
                                                    </div>
                                                    <div>
                                                        <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-1"><Tag size={14}/> {t.pm_channels}</label>
                                                        <div className="flex flex-wrap gap-2 mb-2">
                                                            {(currentProduct.channels || []).map(c => (
                                                                <span key={c} className="bg-orange-50 text-orange-700 px-2 py-1 rounded text-xs border border-orange-100 flex items-center">
                                                                    {c}
                                                                    {modalMode !== 'view' && <button onClick={() => setCurrentProduct({...currentProduct, channels: currentProduct.channels?.filter(x => x !== c)})} className="ml-1 hover:text-red-500"><X size={10}/></button>}
                                                                </span>
                                                            ))}
                                                        </div>
                                                        {modalMode !== 'view' && (
                                                            <input 
                                                                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 outline-none"
                                                                placeholder="Add channel + Enter"
                                                                value={channelInput}
                                                                onChange={e => setChannelInput(e.target.value)}
                                                                onKeyDown={e => {
                                                                    if(e.key === 'Enter' && channelInput.trim()) {
                                                                        setCurrentProduct(prev => ({...prev, channels: [...(prev.channels || []), channelInput.trim()]}));
                                                                        setChannelInput('');
                                                                    }
                                                                }}
                                                            />
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* SPECS & COMPETITORS (ENHANCED) */}
                                        <div className="grid grid-cols-2 gap-6">
                                            {/* SPECS TABLE */}
                                            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                                                <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center justify-between">
                                                    <span className="flex items-center"><Table className="mr-2" size={16}/> {t.pm_specifications}</span>
                                                    {modalMode !== 'view' && <span className="text-[10px] text-indigo-500 font-normal normal-case">{t.pm_use_copilot_autofill}</span>}
                                                </h4>
                                                <div className="space-y-2">
                                                    {(currentProduct.specs || []).length === 0 && <div className="text-xs text-gray-400 italic text-center py-4">{t.pm_no_specs_added}</div>}
                                                    {(currentProduct.specs || []).map((spec, i) => (
                                                        <div key={i} className="flex justify-between border-b border-gray-100 pb-1 text-sm group">
                                                            <span className="font-medium text-gray-600">{spec.label}</span>
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-gray-900">{spec.value}</span>
                                                                {modalMode !== 'view' && <button onClick={() => setCurrentProduct({...currentProduct, specs: currentProduct.specs?.filter((_, idx) => idx !== i)})} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><X size={12}/></button>}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* COMPETITORS */}
                                            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                                                <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center justify-between">
                                                    <span className="flex items-center"><Target className="mr-2" size={16}/> {t.pm_competitors}</span>
                                                    {modalMode !== 'view' && <span className="text-[10px] text-indigo-500 font-normal normal-case">{t.pm_use_copilot_analyze}</span>}
                                                </h4>
                                                <div className="space-y-3">
                                                    {(currentProduct.competitors || []).length === 0 && <div className="text-xs text-gray-400 italic text-center py-4">{t.pm_no_competitors_analyzed}</div>}
                                                    {(currentProduct.competitors || []).map((comp, i) => (
                                                        <div key={i} className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-sm relative group">
                                                            <div className="font-bold text-slate-800 mb-1">{comp.name}</div>
                                                            <div className="text-xs text-slate-500 line-clamp-2">{comp.summary}</div>
                                                            {modalMode !== 'view' && (
                                                                <button 
                                                                    onClick={() => setCurrentProduct({...currentProduct, competitors: currentProduct.competitors?.filter((_, idx) => idx !== i)})}
                                                                    className="absolute top-2 right-2 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100"
                                                                >
                                                                    <Trash2 size={14}/>
                                                                </button>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>

                                        {/* SYNCED FIELDS CARD */}
                                        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                                            <div className="flex justify-between items-center mb-6">
                                                <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center">
                                                    <LinkIcon className="mr-2" size={16}/> {t.pm_synced_attributes}
                                                </h4>
                                                <span className="text-xs bg-cyan-50 text-cyan-600 px-2 py-1 rounded border border-cyan-100 flex items-center">
                                                    <Clock size={10} className="mr-1"/> {t.pm_synced_desc}
                                                </span>
                                            </div>
                                            
                                            <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                                                {productFields.length === 0 && <div className="col-span-2 text-gray-400 italic text-sm text-center py-4">{t.pm_no_sync_fields}</div>}
                                                
                                                {productFields.map(field => {
                                                    const rawVal = currentProduct.data?.[field.key];
                                                    // Normalize data for display
                                                    let displayVal = rawVal;
                                                    let images: string[] = [];
                                                    
                                                    if (field.type === 'image') {
                                                        if (Array.isArray(rawVal)) {
                                                            images = rawVal.filter(item => typeof item === 'string');
                                                        } else if (typeof rawVal === 'string' && rawVal.trim() !== '') {
                                                            images = [rawVal];
                                                        }
                                                    } else {
                                                        displayVal = rawVal || '';
                                                    }

                                                    return (
                                                        <div key={field.key} className={field.type === 'textarea' || field.type === 'richtext' ? 'col-span-2' : ''}>
                                                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5">{field.label}</label>
                                                            
                                                            {modalMode === 'view' ? (
                                                                <div className={`p-3 bg-gray-50 rounded-lg border border-gray-200 text-sm text-gray-800 ${field.type === 'image' ? 'min-h-[80px]' : 'min-h-[42px]'}`}>
                                                                    {field.type === 'image' ? (
                                                                        <div className="flex gap-2 flex-wrap">
                                                                            {images.length > 0 ? images.map((url, i) => (
                                                                                <div key={i} className="relative group cursor-zoom-in" onClick={() => setPreviewImage(url)}>
                                                                                    <img src={url || undefined} className="w-16 h-16 rounded border border-gray-200 object-cover hover:opacity-80 transition-opacity" />
                                                                                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/20 rounded pointer-events-none">
                                                                                        <ZoomIn size={12} className="text-white"/>
                                                                                    </div>
                                                                                </div>
                                                                            )) : <span className="text-gray-400 italic text-xs">{t.pm_no_images}</span>}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="whitespace-pre-wrap">{typeof displayVal === 'object' ? JSON.stringify(displayVal) : displayVal || <span className="text-gray-400 italic text-xs">Empty</span>}</div>
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                // EDIT MODE
                                                                <>
                                                                    {field.type === 'textarea' || field.type === 'richtext' ? (
                                                                        <textarea 
                                                                            className="w-full border border-gray-300 rounded-lg p-3 text-sm min-h-[100px] outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                                                                            value={typeof displayVal === 'string' ? displayVal : JSON.stringify(displayVal)}
                                                                            onChange={e => setCurrentProduct({
                                                                                ...currentProduct, 
                                                                                data: { ...currentProduct.data, [field.key]: e.target.value }
                                                                            })}
                                                                        />
                                                                    ) : field.type === 'image' ? (
                                                                        <div className="space-y-2">
                                                                            <div className="flex gap-2 overflow-x-auto pb-2 bg-gray-50 p-2 rounded-lg border border-gray-200 min-h-[60px]">
                                                                                {images.map((url, i) => (
                                                                                    <div key={i} className="relative cursor-zoom-in" onClick={() => setPreviewImage(url)}>
                                                                                        <img src={url || undefined} className="w-16 h-16 rounded border border-gray-200 object-cover"/>
                                                                                    </div>
                                                                                ))}
                                                                                {images.length === 0 && <span className="text-gray-400 text-xs italic self-center">{t.pm_manage_via_tasks}</span>}
                                                                            </div>
                                                                        </div>
                                                                    ) : (
                                                                        <input 
                                                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                                                                            value={displayVal as string}
                                                                            onChange={e => setCurrentProduct({
                                                                                ...currentProduct, 
                                                                                data: { ...currentProduct.data, [field.key]: e.target.value }
                                                                            })}
                                                                        />
                                                                    )}
                                                                </>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'tasks' && (
                                    <div className="max-w-4xl mx-auto">
                                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                                            <div className="p-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                                                <h4 className="font-bold text-gray-700 text-sm">{t.pm_linked_workflows}</h4>
                                                <span className="text-xs text-gray-500">{t.pm_total}: {linkedTasks.length}</span>
                                            </div>
                                            {linkedTasks.length === 0 ? (
                                                <div className="p-10 text-center text-gray-400 italic">{t.pm_no_linked_tasks}</div>
                                            ) : (
                                                <div className="divide-y divide-gray-100">
                                                    {linkedTasks.map(task => (
                                                        <div key={task.id} className="p-4 flex items-center hover:bg-gray-50 transition-colors gap-4">
                                                            <div className="w-10 h-10 rounded bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-xs border border-indigo-100">
                                                                {task.type.substring(0,2).toUpperCase()}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-2 mb-1">
                                                                    <span className="text-xs font-mono bg-gray-100 px-1.5 rounded text-gray-500">{task.id}</span>
                                                                    <span className="font-bold text-gray-800 text-sm truncate">{task.identity.productName}</span>
                                                                </div>
                                                                <div className="flex items-center gap-3 text-xs text-gray-500">
                                                                    <span className="flex items-center gap-1"><User size={10}/> {task.owner.name}</span>
                                                                    <span>•</span>
                                                                    <span className="bg-gray-100 px-2 rounded-full">{task.stage}</span>
                                                                </div>
                                                            </div>
                                                            <div>
                                                                {task.workStatus === 'completed' ? (
                                                                    <span className="flex items-center text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded border border-green-100">
                                                                        <CheckCircle2 size={12} className="mr-1"/> {t.pm_done}
                                                                    </span>
                                                                ) : (
                                                                    <span className="flex items-center text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded border border-indigo-100">
                                                                        <PlayCircle size={12} className="mr-1"/> {t.pm_active}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'history' && (
                                    <div className="max-w-3xl mx-auto space-y-6">
                                        {(!currentProduct.history || currentProduct.history.length === 0) && (
                                            <div className="text-center py-10 text-gray-400 italic">{t.pm_no_history}</div>
                                        )}
                                        {currentProduct.history?.map((log: ProductChangeLog, idx: number) => (
                                            <div key={idx} className="flex gap-4 relative">
                                                {/* Timeline Line */}
                                                {idx !== currentProduct.history!.length - 1 && <div className="absolute left-[19px] top-8 bottom-[-24px] w-0.5 bg-gray-200"></div>}
                                                
                                                <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shrink-0 border-2 border-indigo-100 z-10 shadow-sm">
                                                    <History size={18} className="text-indigo-500"/>
                                                </div>
                                                
                                                <div className="flex-1 bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                                                    <div className="flex justify-between items-start mb-3 border-b border-gray-100 pb-3">
                                                        <div>
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <span className="font-bold text-gray-800 text-sm">{format(new Date(log.date), 'yyyy-MM-dd HH:mm')}</span>
                                                                <span className={`text-xs px-2 py-0.5 rounded border font-bold ${
                                                                    log.taskName === t.pm_manual_update ? 'bg-amber-50 text-amber-700 border-amber-100' : 
                                                                    log.taskName === t.pm_product_created ? 'bg-green-50 text-green-700 border-green-100' :
                                                                    'bg-indigo-50 text-indigo-600 border-indigo-100'
                                                                }`}>
                                                                    {log.taskName || log.taskId}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-1.5 text-xs text-gray-500">
                                                                <User size={12}/> {log.actor.name}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    
                                                    <div className="space-y-2">
                                                        {log.changes.length === 0 && <div className="text-xs text-gray-400 italic">{t.pm_no_changes}</div>}
                                                        {log.changes.map((change, i) => (
                                                            <div key={i} className="text-xs bg-gray-50 p-2.5 rounded-lg border border-gray-100 grid grid-cols-12 gap-2 items-center">
                                                                <div className="col-span-3 font-bold text-gray-700 truncate" title={change.field}>{change.field}</div>
                                                                <div className="col-span-4 text-red-500 line-through truncate px-1 opacity-70" title={JSON.stringify(change.old)}>{String(change.old || 'empty')}</div>
                                                                <div className="col-span-1 flex justify-center"><ArrowRight size={12} className="text-gray-400"/></div>
                                                                <div className="col-span-4 text-green-600 font-bold truncate px-1" title={JSON.stringify(change.new)}>{String(change.new)}</div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* RIGHT: COPILOT (Conditional) */}
                            {showCopilot && modalMode !== 'view' && (
                                <ProductCopilot 
                                    productName={currentProduct.name || "Current Product"}
                                    productData={currentProduct} // Pass full context
                                    onApplySpecs={handleApplySpecs}
                                    onApplyCompetitor={handleApplyCompetitor}
                                    onApplyImages={handleApplyImages}
                                    onApplySmartImport={handleOpenSmartImportPreview}
                                    onClose={() => setShowCopilot(false)}
                                    language={language}
                                />
                            )}
                        </div>

                        {/* Footer (Only for Create/Edit) */}
                        {modalMode !== 'view' && (
                            <div className="p-6 border-t border-gray-200 bg-gray-50 flex justify-end gap-3 shrink-0">
                                <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-bold transition-colors">{t.pm_close}</button>
                                <button onClick={handleSave} disabled={isSaving} className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition-colors shadow-md flex items-center">
                                    {isSaving ? <Loader2 className="animate-spin mr-2"/> : null}
                                    {t.pm_save_product}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* PREVIEW MODAL */}
            {renderExtractionPreviewModal()}

            {/* Lightbox for Image Preview */}
            {previewImage && (
                <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4" onClick={() => setPreviewImage(null)}>
                    <button className="absolute top-4 right-4 text-white/80 hover:text-white"><X size={32}/></button>
                    <img src={previewImage || undefined} className="max-w-full max-h-full rounded shadow-2xl object-contain"/>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {productToDelete && (
                <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in-up">
                    <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col">
                        <div className="p-6">
                            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4 mx-auto">
                                <Trash2 className="text-red-600" size={24} />
                            </div>
                            <h3 className="text-xl font-bold text-center text-gray-900 mb-2">{t.pm_delete_title || 'Delete Product'}</h3>
                            <p className="text-center text-gray-600 mb-6">
                                {(t.pm_delete_desc || 'Are you sure you want to delete {name}? This will remove the product from the active list.').replace('{name}', productToDelete.name)}
                            </p>
                            <div className="flex gap-3 justify-center">
                                <button 
                                    onClick={() => setProductToDelete(null)}
                                    className="px-6 py-2.5 rounded-xl font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors flex-1"
                                >
                                    {t.cancel}
                                </button>
                                <button 
                                    onClick={confirmDelete}
                                    className="px-6 py-2.5 rounded-xl font-bold text-white bg-red-600 hover:bg-red-700 transition-colors shadow-md flex-1"
                                >
                                    {t.delete}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
