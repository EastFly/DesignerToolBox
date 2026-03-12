
import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Check, ChevronDown } from 'lucide-react';
import { Product } from '../types';
import { translations } from '../i18n';

interface ProductSelectorProps {
    products: Product[];
    selectedProductId: string;
    onSelect: (productId: string) => void;
    placeholder?: string;
    label?: string | React.ReactNode;
    disabled?: boolean;
    className?: string;
    language?: string;
}

export const ProductSelector: React.FC<ProductSelectorProps> = ({ 
    products, selectedProductId, onSelect, placeholder, label, disabled, className, language = 'en'
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const wrapperRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const t = translations[language as keyof typeof translations] || translations.en;

    const selectedProduct = products.find(p => p.id === selectedProductId);
    const displayPlaceholder = placeholder || t.ot_choose_product_placeholder || "Select product...";

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
        if (!isOpen) {
            setSearch('');
        }
    }, [isOpen]);

    const filtered = products.filter(p => 
        (p.name || '').toLowerCase().includes(search.toLowerCase()) || 
        (p.sku || '').toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className={`relative ${className || ''}`} ref={wrapperRef}>
            {label && (
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-2">
                    {label}
                </label>
            )}
            
            <div 
                className={`w-full border rounded-lg bg-white flex items-center transition-all relative ${
                    isOpen ? 'ring-2 ring-indigo-500 border-indigo-500' : 'border-gray-300 hover:border-gray-400'
                } ${disabled ? 'opacity-60 cursor-not-allowed bg-gray-50' : 'cursor-pointer'}`}
                onClick={() => !disabled && setIsOpen(true)}
            >
                <div className="pl-3 text-gray-400 shrink-0">
                    <Search size={16}/>
                </div>
                
                {isOpen ? (
                    <input 
                        ref={inputRef}
                        className="w-full py-2.5 px-3 text-sm outline-none bg-transparent"
                        placeholder={t.ot_search_by_name_sku}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                ) : (
                    <div className="flex-1 py-2.5 px-3 text-sm flex items-center justify-between overflow-hidden">
                        {selectedProduct ? (
                            <span className="text-gray-800 font-medium truncate flex items-center">
                                <span className="font-mono text-gray-500 mr-2 text-xs bg-gray-100 px-1.5 rounded">{selectedProduct.sku}</span>
                                <span className="truncate">{selectedProduct.name}</span>
                            </span>
                        ) : (
                            <span className="text-gray-400">{displayPlaceholder}</span>
                        )}
                        <ChevronDown size={14} className="text-gray-400 shrink-0 ml-2"/>
                    </div>
                )}

                {selectedProductId && !isOpen && !disabled && (
                    <button 
                        onClick={(e) => { e.stopPropagation(); onSelect(''); }}
                        className="absolute right-8 p-1 text-gray-400 hover:text-red-500 rounded-full hover:bg-gray-100 mr-1"
                    >
                        <X size={14}/>
                    </button>
                )}
            </div>

            {isOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl max-h-60 overflow-y-auto z-50 animate-fade-in-up">
                    {filtered.length === 0 ? (
                        <div className="p-4 text-center text-gray-400 text-sm italic">
                            {search ? t.ot_no_matches_found : t.ot_type_to_search}
                        </div>
                    ) : (
                        filtered.map(p => (
                            <div 
                                key={p.id}
                                onClick={() => { onSelect(p.id); setIsOpen(false); }}
                                className={`px-4 py-3 cursor-pointer border-b border-gray-50 last:border-0 hover:bg-indigo-50 transition-colors flex justify-between items-center group ${p.id === selectedProductId ? 'bg-indigo-50/50' : ''}`}
                            >
                                <div className="overflow-hidden">
                                    <div className="flex items-center gap-2 mb-0.5">
                                        <div className="text-xs font-mono text-gray-500 bg-gray-100 px-1.5 rounded">{p.sku}</div>
                                        {p.level && <span className={`text-[9px] px-1.5 rounded border font-bold ${p.level === 'S' ? 'text-purple-600 border-purple-100 bg-purple-50' : 'text-gray-500 border-gray-100 bg-gray-50'}`}>{p.level}</span>}
                                    </div>
                                    <div className="text-sm font-bold text-gray-800 truncate group-hover:text-indigo-700">{p.name}</div>
                                </div>
                                {p.id === selectedProductId && <Check size={16} className="text-indigo-600 shrink-0 ml-2"/>}
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};
