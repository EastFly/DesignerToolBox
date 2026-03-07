import React, { useState } from 'react';
import { FieldDefinition } from '../types';
import { format } from 'date-fns';
import { Minus, Plus, UploadCloud, Loader2, X, ZoomIn, Video, Play, FileText } from 'lucide-react';
import { supabase, BUCKET_NAME } from '../services/supabase';

interface DynamicFieldProps {
    field: FieldDefinition;
    value: any;
    onChange: (value: any) => void;
    readOnly?: boolean;
    language: string;
}

export const DynamicField: React.FC<DynamicFieldProps> = ({ field, value, onChange, readOnly = false, language }) => {
    const [isUploading, setIsUploading] = useState(false);

    const handleFileUpload = async (file: File): Promise<string> => {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Math.random()}.${fileExt}`;
        const filePath = `uploads/${fileName}`;

        const { error } = await supabase.storage.from(BUCKET_NAME).upload(filePath, file);
        if (error) throw error;

        const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(filePath);
        return data.publicUrl;
    };

    // 1. Folder Handling (Recursive)
    if (field.type === 'folder' && field.subFields) {
        return (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
                {field.subFields.map(sub => (
                    <div key={sub.key} className="mb-4 last:mb-0">
                        <label className="text-xs font-bold text-gray-600 mb-1 block">{sub.label}</label>
                        <DynamicField
                            field={sub}
                            value={value?.[sub.key]}
                            onChange={(newVal) => {
                                const updated = { ...(value || {}), [sub.key]: newVal };
                                onChange(updated);
                            }}
                            readOnly={readOnly}
                            language={language}
                        />
                    </div>
                ))}
            </div>
        );
    }

    // 2. Selling Points (Specific UI)
    if (field.key === 'sellingPoints') {
        const points = Array.isArray(value) ? value : [];
        return (
            <div className="space-y-2">
                {points.map((sp: any, idx: number) => (
                    <div key={idx} className="flex gap-2">
                        <input 
                            disabled={readOnly}
                            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm bg-white disabled:bg-gray-100"
                            value={sp.text || ''}
                            onChange={(e) => {
                                const newPoints = [...points];
                                newPoints[idx] = { ...sp, text: e.target.value };
                                onChange(newPoints);
                            }}
                        />
                        {!readOnly && (
                            <button onClick={() => {
                                const newPoints = points.filter((_: any, i: number) => i !== idx);
                                onChange(newPoints);
                            }} className="text-gray-400 hover:text-red-500"><Minus size={16}/></button>
                        )}
                    </div>
                ))}
                {!readOnly && (
                    <button onClick={() => {
                        const newPoints = [...points, { text: '', referenceImage: undefined }];
                        onChange(newPoints);
                    }} className="text-indigo-600 text-xs font-bold flex items-center hover:bg-indigo-50 px-2 py-1 rounded w-fit">
                        <Plus size={14} className="mr-1"/> Add Point
                    </button>
                )}
            </div>
        );
    }

    // 3. Media (Image/Video/File)
    if (['image', 'video', 'file'].includes(field.type)) {
        const files = Array.isArray(value) ? value : (value ? [value] : []);
        return (
            <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                    {files.map((url: string, idx: number) => (
                        <div key={idx} className="relative group w-20 h-20 border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                            {field.type === 'image' ? (
                                <div className="w-full h-full relative cursor-zoom-in group/media">
                                    <img src={url || undefined} className="w-full h-full object-cover transition-transform group-hover/media:scale-105" />
                                </div>
                            ) : field.type === 'video' ? (
                                <div className="w-full h-full flex items-center justify-center text-gray-400 cursor-pointer hover:bg-gray-100 transition-colors relative group/media">
                                    <Video size={24}/>
                                </div>
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-400">
                                    <a href={url} target="_blank" rel="noreferrer" className="flex flex-col items-center justify-center w-full h-full hover:bg-gray-50 transition-colors">
                                        <FileText size={24}/>
                                        <span className="text-[8px] mt-1 uppercase text-gray-500 font-bold">FILE</span>
                                    </a>
                                </div>
                            )}
                            
                            {!readOnly && (
                                <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        const newFiles = files.filter((_: string, i: number) => i !== idx);
                                        onChange(newFiles);
                                    }}
                                    className="absolute top-1 right-1 z-20 bg-white rounded-full p-0.5 text-gray-500 hover:text-red-500 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <X size={12}/>
                                </button>
                            )}
                        </div>
                    ))}
                    {!readOnly && (
                        <label className={`w-20 h-20 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center text-gray-400 hover:border-indigo-400 hover:text-indigo-500 hover:bg-indigo-50 cursor-pointer transition-all ${isUploading ? 'opacity-50 cursor-wait' : ''}`}>
                            {isUploading ? <Loader2 className="animate-spin" size={20}/> : <UploadCloud size={20}/>}
                            <span className="text-[9px] mt-1 font-bold">Upload</span>
                            <input 
                                type="file" 
                                multiple 
                                className="hidden" 
                                disabled={isUploading}
                                onChange={async (e) => {
                                    if (e.target.files) {
                                        setIsUploading(true);
                                        try {
                                            const newUrls = await Promise.all(Array.from(e.target.files).map((f: File) => handleFileUpload(f)));
                                            onChange([...files, ...newUrls]);
                                        } catch (err) {
                                            console.error("Upload failed", err);
                                        } finally {
                                            setIsUploading(false);
                                        }
                                    }
                                }}
                            />
                        </label>
                    )}
                </div>
            </div>
        );
    }

    // 4. Select / Multiselect
    if (field.type === 'select' || field.type === 'multiselect') {
        return (
            <select 
                disabled={readOnly}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-100"
                value={value || ''}
                onChange={(e) => onChange(e.target.value)}
            >
                <option value="">Select...</option>
                {field.options?.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                ))}
            </select>
        );
    }

    // 5. Rich Text / Textarea
    if (field.type === 'richtext' || field.type === 'textarea') {
        return (
            <textarea 
                disabled={readOnly}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-100 min-h-[100px]"
                value={value || ''}
                onChange={(e) => onChange(e.target.value)}
            />
        );
    }

    // 6. Default Text / Number / Date
    const inputType = field.type === 'number' ? 'number' : field.type === 'datetime' ? 'datetime-local' : field.type === 'date' ? 'date' : 'text';
    let displayVal = value || '';
    if (field.type === 'date' && value) displayVal = format(new Date(value), 'yyyy-MM-dd');
    if (field.type === 'datetime' && value) displayVal = format(new Date(value), "yyyy-MM-dd'T'HH:mm");

    return (
        <input 
            type={inputType}
            disabled={readOnly}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-100"
            value={displayVal}
            onChange={(e) => onChange(e.target.value)}
        />
    );
};
