import React, { useState, useEffect, useMemo } from 'react';
import { StyleDice, DiceMetadata, GenConfig, User } from '../types';
import { db } from '../services/db';
import { Dices, Search, Tag, Filter, Edit3, Save, X, Trash2, Plus, Globe, Image as ImageIcon, LayoutTemplate, Sun, Type, Sliders, Ban, Lock, Loader2, LayoutGrid, List, UploadCloud, AlignLeft, ChevronLeft, ChevronRight, Check, ChevronDown } from 'lucide-react';
import { Language, translations } from '../i18n';

interface DiceManagementViewProps {
    currentUser: User | null;
    canManageGlobalDice: boolean;
    language: Language;
}

export const DiceManagementView: React.FC<DiceManagementViewProps> = ({ currentUser, canManageGlobalDice, language }) => {
    const t = translations[language];
    const [diceList, setDiceList] = useState<StyleDice[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [allTags, setAllTags] = useState<string[]>([]);
    const [isTagDropdownOpen, setIsTagDropdownOpen] = useState(false);
    const [tagSearchQuery, setTagSearchQuery] = useState('');
    
    const [editingDice, setEditingDice] = useState<StyleDice | null>(null);
    const [editMetadata, setEditMetadata] = useState<DiceMetadata | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
    const [isUploadingLayout, setIsUploadingLayout] = useState(false);
    const [isUploadingStyle, setIsUploadingStyle] = useState(false);

    const pageSize = viewMode === 'table' ? 10 : 12;

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchQuery(searchQuery);
        }, 500);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    useEffect(() => {
        setCurrentPage(1);
    }, [debouncedSearchQuery, selectedTags, viewMode]);

    const loadTags = async () => {
        try {
            const tags = await db.getAllDiceTags(true);
            setAllTags(tags);
        } catch (e) {
            console.error("Failed to load tags", e);
        }
    };

    const loadDice = async () => {
        setIsLoading(true);
        try {
            const { data, count } = await db.getStyleDicePaginated(true, currentPage, pageSize, debouncedSearchQuery, selectedTags);
            setDiceList(data);
            setTotalCount(count);
        } catch (e) {
            console.error("Failed to load dice", e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadTags();
    }, []);

    useEffect(() => {
        loadDice();
    }, [currentPage, pageSize, debouncedSearchQuery, selectedTags]);

    // Filter tags for dropdown
    const filteredTags = useMemo(() => {
        return allTags.filter(t => t.toLowerCase().includes(tagSearchQuery.toLowerCase()));
    }, [allTags, tagSearchQuery]);

    const handleEditClick = (dice: StyleDice) => {
        setEditingDice({ ...dice });
        let meta: DiceMetadata = { tags: [], config: { aspectRatio: '1:1', resolution: '1K', allowText: false, targetLanguage: 'English (US)' } };
        if (dice.description) {
            try {
                meta = JSON.parse(dice.description);
            } catch (e) {}
        }
        setEditMetadata(meta);
    };

    const handleImageUpload = async (type: 'layout' | 'style', e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        
        if (type === 'layout') setIsUploadingLayout(true);
        else setIsUploadingStyle(true);

        try {
            const url = await db.uploadFile(file);
            setEditMetadata(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    referenceUrls: {
                        ...(prev.referenceUrls || {}),
                        [type]: url
                    }
                };
            });
        } catch (error) {
            console.error("Upload failed", error);
            alert(t.dm_upload_fail);
        } finally {
            if (type === 'layout') setIsUploadingLayout(false);
            else setIsUploadingStyle(false);
        }
    };

    const handleSave = async () => {
        if (!editingDice || !editMetadata) return;
        setIsSaving(true);
        try {
            const updatedDice = {
                ...editingDice,
                description: JSON.stringify(editMetadata)
            };
            await db.saveStyleDice(updatedDice);
            setDiceList(prev => prev.map(d => d.id === updatedDice.id ? updatedDice : d));
            setEditingDice(null);
            setEditMetadata(null);
            loadTags(); // Reload tags in case new ones were added
        } catch (e) {
            console.error("Failed to save dice", e);
            alert(t.dm_save_fail);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm(t.dm_delete_confirm)) return;
        try {
            await db.deleteStyleDice(id);
            setDiceList(prev => prev.filter(d => d.id !== id));
            setTotalCount(prev => prev - 1);
            if (editingDice?.id === id) {
                setEditingDice(null);
                setEditMetadata(null);
            }
        } catch (e) {
            console.error("Failed to delete dice", e);
            alert(t.dm_delete_fail);
        }
    };

    const toggleTagFilter = (tag: string) => {
        setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
    };

    const handleAddTagToEdit = (tag: string) => {
        if (!editMetadata) return;
        if (!editMetadata.tags.includes(tag)) {
            setEditMetadata({ ...editMetadata, tags: [...editMetadata.tags, tag] });
        }
    };

    const handleRemoveTagFromEdit = (tag: string) => {
        if (!editMetadata) return;
        setEditMetadata({ ...editMetadata, tags: editMetadata.tags.filter(t => t !== tag) });
    };

    return (
        <div className="flex h-full bg-slate-50 relative overflow-hidden">
            {/* Main Content Area */}
            <div className={`flex flex-col h-full min-h-0 transition-all duration-300 ease-in-out ${editingDice ? 'w-2/3 border-r border-gray-200' : 'w-full'} bg-white`}>
                <div className="p-6 border-b border-gray-200 shrink-0">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
                            <div className="p-2 bg-indigo-100 text-indigo-700 rounded-lg">
                                <Dices size={24} />
                            </div>
                            {t.dm_title}
                            <span className="text-sm font-normal text-gray-500 bg-gray-100 px-2 py-1 rounded-full">{totalCount} {t.dm_items}</span>
                        </h2>
                        <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-lg">
                            <button 
                                onClick={() => setViewMode('table')}
                                className={`p-1.5 rounded-md transition-colors ${viewMode === 'table' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
                                title={t.dm_table_view}
                            >
                                <List size={18} />
                            </button>
                            <button 
                                onClick={() => setViewMode('grid')}
                                className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
                                title={t.dm_grid_view}
                            >
                                <LayoutGrid size={18} />
                            </button>
                        </div>
                    </div>
                    
                    <div className="flex flex-col sm:flex-row gap-4">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input 
                                type="text"
                                placeholder={t.dm_search_placeholder}
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            />
                        </div>
                        
                        <div className="relative">
                            <button
                                onClick={() => setIsTagDropdownOpen(!isTagDropdownOpen)}
                                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700 h-full"
                            >
                                <Filter size={16} className="text-gray-400" />
                                {selectedTags.length > 0 ? (
                                    <span className="flex items-center gap-1">
                                        {t.dm_tags} <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-md text-xs">{selectedTags.length}</span>
                                    </span>
                                ) : (
                                    t.dm_filter_tags
                                )}
                                <ChevronDown size={14} className="text-gray-400 ml-1" />
                            </button>

                            {isTagDropdownOpen && (
                                <>
                                    <div className="fixed inset-0 z-10" onClick={() => setIsTagDropdownOpen(false)} />
                                    <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-gray-200 z-20 overflow-hidden flex flex-col max-h-96">
                                        <div className="p-2 border-b border-gray-100">
                                            <div className="relative">
                                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                                                <input 
                                                    type="text"
                                                    placeholder={t.dm_search_tags}
                                                    value={tagSearchQuery}
                                                    onChange={e => setTagSearchQuery(e.target.value)}
                                                    className="w-full pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                                />
                                            </div>
                                        </div>
                                        <div className="overflow-y-auto p-2 flex-1">
                                            {filteredTags.length === 0 ? (
                                                <div className="text-center py-4 text-sm text-gray-500">{t.dm_no_tags}</div>
                                            ) : (
                                                filteredTags.map(tag => {
                                                    const isSelected = selectedTags.includes(tag);
                                                    return (
                                                        <button
                                                            key={tag}
                                                            onClick={() => toggleTagFilter(tag)}
                                                            className="w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between hover:bg-gray-50 transition-colors"
                                                        >
                                                            <span className="truncate pr-2">{tag}</span>
                                                            {isSelected && <Check size={14} className="text-indigo-600 shrink-0" />}
                                                        </button>
                                                    );
                                                })
                                            )}
                                        </div>
                                        {selectedTags.length > 0 && (
                                            <div className="p-2 border-t border-gray-100 bg-gray-50">
                                                <button 
                                                    onClick={() => { setSelectedTags([]); setIsTagDropdownOpen(false); }}
                                                    className="w-full py-1.5 text-sm text-gray-600 hover:text-gray-900 font-medium"
                                                >
                                                    {t.dm_clear_filters}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 flex flex-col min-h-0">
                    {isLoading ? (
                        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-indigo-600" size={40} /></div>
                    ) : diceList.length === 0 ? (
                        <div className="text-center py-20 text-gray-500 bg-white rounded-xl border border-gray-200 border-dashed">
                            <Dices size={48} className="mx-auto text-gray-300 mb-4" />
                            <p className="text-lg font-medium">{t.dm_no_dice_found}</p>
                            <p className="text-sm mt-1">{t.dm_adjust_filters}</p>
                        </div>
                    ) : (
                        <>
                            {viewMode === 'table' ? (
                                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto mb-6">
                                    <table className="w-full text-left border-collapse min-w-[800px]">
                                        <thead>
                                            <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500 font-bold">
                                                <th className="p-4 w-16">{t.dm_col_cover}</th>
                                                <th className="p-4">{t.dm_col_name}</th>
                                                <th className="p-4 w-48">{t.dm_col_tags}</th>
                                                <th className="p-4 w-32">{t.dm_col_config}</th>
                                                <th className="p-4 w-24 text-right">{t.dm_col_actions}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {diceList.map(dice => {
                                                let meta: DiceMetadata | null = null;
                                                if (dice.description) {
                                                    try { meta = JSON.parse(dice.description); } catch (e) {}
                                                }
                                                const isSelected = editingDice?.id === dice.id;
                                                const isOwner = dice.userId === currentUser?.id;
                                                const canEdit = isOwner || (dice.isGlobal && canManageGlobalDice);

                                                return (
                                                    <tr 
                                                        key={dice.id}
                                                        onClick={() => canEdit && handleEditClick(dice)}
                                                        className={`transition-colors group ${
                                                            canEdit ? 'cursor-pointer hover:bg-indigo-50/50' : 'cursor-not-allowed opacity-80'
                                                        } ${isSelected ? 'bg-indigo-50/80' : 'bg-white'}`}
                                                    >
                                                        <td className="p-4">
                                                            <div className="w-12 h-12 bg-gray-100 rounded-lg overflow-hidden border border-gray-200 flex items-center justify-center">
                                                                {dice.coverImage ? (
                                                                    <img src={dice.coverImage || undefined} alt={dice.name} className="w-full h-full object-cover" />
                                                                ) : (
                                                                    <ImageIcon size={16} className="text-gray-400" />
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="p-4">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <span className="font-bold text-gray-800">{dice.name}</span>
                                                                {dice.isGlobal && <Globe size={14} className="text-blue-500" title={t.dm_global_dice} />}
                                                                {!canEdit && <Lock size={14} className="text-gray-400" title={t.dm_read_only} />}
                                                            </div>
                                                            <div className="text-xs text-gray-500 line-clamp-1 font-mono bg-gray-50 px-2 py-1 rounded border border-gray-100 inline-block max-w-full" title={dice.template}>
                                                                {dice.template}
                                                            </div>
                                                        </td>
                                                        <td className="p-4">
                                                            <div className="flex flex-wrap gap-1">
                                                                {meta?.tags?.slice(0, 3).map(t => (
                                                                    <span key={t} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] font-medium border border-gray-200">
                                                                        {t}
                                                                    </span>
                                                                ))}
                                                                {meta?.tags && meta.tags.length > 3 && (
                                                                    <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px] font-medium border border-gray-200">
                                                                        +{meta.tags.length - 3}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="p-4">
                                                            <div className="flex flex-col gap-1 text-[10px] text-gray-500">
                                                                <span className="flex items-center gap-1"><LayoutTemplate size={10}/> {meta?.config?.aspectRatio || '1:1'}</span>
                                                                <span className="flex items-center gap-1"><ImageIcon size={10}/> {meta?.config?.resolution || '1K'}</span>
                                                            </div>
                                                        </td>
                                                        <td className="p-4 text-right">
                                                            {canEdit && (
                                                                <button 
                                                                    onClick={(e) => { e.stopPropagation(); handleDelete(dice.id); }}
                                                                    className="text-gray-400 hover:text-red-500 p-2 rounded-lg hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                                                                    title={t.dm_delete_dice}
                                                                >
                                                                    <Trash2 size={16} />
                                                                </button>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-6">
                                    {diceList.map(dice => {
                                        let meta: DiceMetadata | null = null;
                                        if (dice.description) {
                                            try { meta = JSON.parse(dice.description); } catch (e) {}
                                        }
                                        const isSelected = editingDice?.id === dice.id;
                                        const isOwner = dice.userId === currentUser?.id;
                                        const canEdit = isOwner || (dice.isGlobal && canManageGlobalDice);

                                        return (
                                            <div 
                                                key={dice.id}
                                                onClick={() => canEdit && handleEditClick(dice)}
                                                className={`p-4 rounded-xl border transition-all flex flex-col gap-3 ${
                                                    canEdit ? 'cursor-pointer hover:border-indigo-300 hover:shadow-md hover:-translate-y-0.5' : 'cursor-not-allowed opacity-80'
                                                } ${
                                                    isSelected 
                                                    ? 'border-indigo-500 bg-indigo-50 shadow-md ring-1 ring-indigo-500' 
                                                    : 'border-gray-200 bg-white shadow-sm'
                                                }`}
                                            >
                                                <div className="flex gap-3">
                                                    <div className="w-16 h-16 shrink-0 bg-gray-100 rounded-lg overflow-hidden border border-gray-200 flex items-center justify-center">
                                                        {dice.coverImage ? (
                                                            <img src={dice.coverImage || undefined} alt={dice.name} className="w-full h-full object-cover" />
                                                        ) : (
                                                            <ImageIcon size={20} className="text-gray-400" />
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex justify-between items-start mb-1">
                                                            <h3 className="font-bold text-gray-800 truncate flex items-center gap-1.5 text-sm">
                                                                {dice.name}
                                                                {dice.isGlobal && <Globe size={12} className="text-blue-500 shrink-0" title={t.dm_global_dice} />}
                                                                {!canEdit && <Lock size={12} className="text-gray-400 shrink-0" title={t.dm_read_only} />}
                                                            </h3>
                                                            {canEdit && (
                                                                <button 
                                                                    onClick={(e) => { e.stopPropagation(); handleDelete(dice.id); }}
                                                                    className="text-gray-400 hover:text-red-500 p-1 -mr-1 -mt-1"
                                                                >
                                                                    <Trash2 size={14} />
                                                                </button>
                                                            )}
                                                        </div>
                                                        <div className="flex gap-2 text-[10px] text-gray-500 mb-1.5">
                                                            <span className="flex items-center gap-0.5"><LayoutTemplate size={10}/> {meta?.config?.aspectRatio || '1:1'}</span>
                                                            <span className="flex items-center gap-0.5"><ImageIcon size={10}/> {meta?.config?.resolution || '1K'}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <p className="text-xs text-gray-500 line-clamp-2 font-mono bg-gray-50 p-1.5 rounded border border-gray-100" title={dice.template}>
                                                    {dice.template}
                                                </p>
                                                <div className="flex flex-wrap gap-1 mt-auto pt-2">
                                                    {meta?.tags?.slice(0, 4).map(t => (
                                                        <span key={t} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] font-medium border border-gray-200">
                                                            {t}
                                                        </span>
                                                    ))}
                                                    {meta?.tags && meta.tags.length > 4 && (
                                                        <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px] font-medium border border-gray-200">
                                                            +{meta.tags.length - 4}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Pagination Controls */}
                            {totalCount > pageSize && (
                                <div className="mt-auto flex items-center justify-between bg-white px-4 py-3 border border-gray-200 rounded-xl shadow-sm">
                                    <div className="text-sm text-gray-700">
                                        {t.dm_showing} <span className="font-medium">{(currentPage - 1) * pageSize + 1}</span> {t.dm_to} <span className="font-medium">{Math.min(currentPage * pageSize, totalCount)}</span> {t.dm_of} <span className="font-medium">{totalCount}</span> {t.dm_results}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                            disabled={currentPage === 1}
                                            className="p-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                        >
                                            <ChevronLeft size={18} />
                                        </button>
                                        <span className="text-sm font-medium text-gray-700 px-2">
                                            {t.dm_page} {currentPage} {t.dm_of} {Math.ceil(totalCount / pageSize)}
                                        </span>
                                        <button
                                            onClick={() => setCurrentPage(prev => Math.min(Math.ceil(totalCount / pageSize), prev + 1))}
                                            disabled={currentPage >= Math.ceil(totalCount / pageSize)}
                                            className="p-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                        >
                                            <ChevronRight size={18} />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Right Panel: Slide-over Editor */}
            <div 
                className={`absolute top-0 right-0 h-full w-1/3 min-w-[400px] bg-white shadow-2xl border-l border-gray-200 transform transition-transform duration-300 ease-in-out z-10 flex flex-col ${
                    editingDice ? 'translate-x-0' : 'translate-x-full'
                }`}
            >
                {editingDice && editMetadata && (
                    <>
                        <div className="p-5 border-b border-gray-200 bg-white flex justify-between items-center shrink-0">
                            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2 truncate pr-4">
                                <Edit3 size={18} className="text-indigo-600 shrink-0" />
                                <span className="truncate">{editingDice.name}</span>
                            </h3>
                            <button 
                                onClick={() => setEditingDice(null)}
                                className="p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 rounded-lg transition-colors shrink-0"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50">
                            {/* Basic Info */}
                            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-4">
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">{t.dm_dice_name}</label>
                                    <input 
                                        type="text" 
                                        value={editingDice.name}
                                        onChange={e => setEditingDice({...editingDice, name: e.target.value})}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">{t.dm_base_prompt_template}</label>
                                    <p className="text-xs text-gray-500 mb-2">{t.dm_base_prompt_desc}</p>
                                    <textarea 
                                        value={editingDice.template}
                                        onChange={e => setEditingDice({...editingDice, template: e.target.value})}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent h-32 resize-none text-sm font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
                                        <Ban size={16} className="text-red-500" /> {t.dm_negative_prompt}
                                    </label>
                                    <textarea 
                                        value={editMetadata.negativePrompt || ''}
                                        onChange={e => setEditMetadata({...editMetadata, negativePrompt: e.target.value})}
                                        placeholder={t.dm_negative_prompt_placeholder}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent h-20 resize-none text-sm"
                                    />
                                </div>
                            </div>

                            {/* Tags */}
                            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                <label className="block text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                                    <Tag size={16} className="text-indigo-600" /> {t.dm_tags}
                                </label>
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {editMetadata.tags.map(tag => (
                                        <span key={tag} className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded-md text-sm font-medium border border-indigo-100 flex items-center gap-1">
                                            {tag}
                                            <button onClick={() => handleRemoveTagFromEdit(tag)} className="hover:text-red-500"><X size={14} /></button>
                                        </span>
                                    ))}
                                </div>
                                <div className="flex gap-2">
                                    <input 
                                        type="text" 
                                        id="newTagInput"
                                        placeholder={t.dm_add_new_tag}
                                        className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                const val = e.currentTarget.value.trim();
                                                if (val) {
                                                    handleAddTagToEdit(val);
                                                    e.currentTarget.value = '';
                                                }
                                            }
                                        }}
                                    />
                                    <button 
                                        onClick={() => {
                                            const input = document.getElementById('newTagInput') as HTMLInputElement;
                                            if (input.value.trim()) {
                                                handleAddTagToEdit(input.value.trim());
                                                input.value = '';
                                            }
                                        }}
                                        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
                                    >
                                        {t.dm_add}
                                    </button>
                                </div>
                            </div>

                            {/* Configuration */}
                            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                <label className="block text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
                                    <Sliders size={16} className="text-indigo-600" /> {t.dm_generation_config}
                                </label>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 mb-1">{t.dm_aspect_ratio}</label>
                                        <select 
                                            value={editMetadata.config.aspectRatio || '1:1'}
                                            onChange={e => setEditMetadata({...editMetadata, config: {...editMetadata.config, aspectRatio: e.target.value as any}})}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                        >
                                            <option value="1:1">1:1 Square</option>
                                            <option value="3:4">3:4 Portrait</option>
                                            <option value="4:3">4:3 Landscape</option>
                                            <option value="9:16">9:16 Story</option>
                                            <option value="16:9">16:9 Widescreen</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 mb-1">{t.dm_image_size}</label>
                                        <select 
                                            value={editMetadata.config.resolution || '1K'}
                                            onChange={e => setEditMetadata({...editMetadata, config: {...editMetadata.config, resolution: e.target.value as any}})}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                        >
                                            <option value="1K">1K (Fast)</option>
                                            <option value="2K">2K (High Quality)</option>
                                            <option value="4K">4K (Ultra HD)</option>
                                        </select>
                                    </div>
                                    <div className="col-span-2 flex items-center gap-2 mt-2">
                                        <input 
                                            type="checkbox" 
                                            id="allowText"
                                            checked={editMetadata.config.allowText || false}
                                            onChange={e => setEditMetadata({...editMetadata, config: {...editMetadata.config, allowText: e.target.checked}})}
                                            className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                                        />
                                        <label htmlFor="allowText" className="text-sm font-medium text-gray-700 flex items-center gap-1">
                                            <Type size={14} /> {t.dm_allow_text}
                                        </label>
                                    </div>
                                    
                                    {/* Layout & Style Variance Controls */}
                                    <div className="col-span-2 grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-gray-100">
                                        <div>
                                            <div className="flex justify-between text-xs font-semibold text-gray-500 mb-1">
                                                <span>{t.pg_layout_consistency}</span>
                                                <span>{editMetadata.config.layoutConsistency ?? 100}%</span>
                                            </div>
                                            <input type="range" min="0" max="100" value={editMetadata.config.layoutConsistency ?? 100} onChange={(e) => setEditMetadata({...editMetadata, config: {...editMetadata.config, layoutConsistency: parseInt(e.target.value)}})} className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-xs font-semibold text-gray-500 mb-1">
                                                <span>{t.pg_frame_shape_variance}</span>
                                                <span>{editMetadata.config.frameShapeVariance ?? 0}%</span>
                                            </div>
                                            <input type="range" min="0" max="100" value={editMetadata.config.frameShapeVariance ?? 0} onChange={(e) => setEditMetadata({...editMetadata, config: {...editMetadata.config, frameShapeVariance: parseInt(e.target.value)}})} className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-xs font-semibold text-gray-500 mb-1">
                                                <span>{t.pg_layout_variance}</span>
                                                <span>{editMetadata.config.layoutVariance ?? 0}%</span>
                                            </div>
                                            <input type="range" min="0" max="100" value={editMetadata.config.layoutVariance ?? 0} onChange={(e) => setEditMetadata({...editMetadata, config: {...editMetadata.config, layoutVariance: parseInt(e.target.value)}})} className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-xs font-semibold text-gray-500 mb-1">
                                                <span>{t.pg_style_variance}</span>
                                                <span>{editMetadata.config.styleVariance ?? 0}%</span>
                                            </div>
                                            <input type="range" min="0" max="100" value={editMetadata.config.styleVariance ?? 0} onChange={(e) => setEditMetadata({...editMetadata, config: {...editMetadata.config, styleVariance: parseInt(e.target.value)}})} className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Reference Images */}
                            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-4">
                                <label className="block text-sm font-bold text-gray-700 flex items-center gap-2">
                                    <ImageIcon size={16} className="text-indigo-600" /> {t.dm_reference_images}
                                </label>
                                
                                <div className="grid grid-cols-2 gap-4">
                                    {/* Layout Reference */}
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">
                                            <LayoutTemplate size={12}/> {t.dm_layout_reference}
                                        </label>
                                        <div className="relative group rounded-lg border-2 border-dashed border-gray-300 hover:border-indigo-400 transition-colors bg-gray-50 flex flex-col items-center justify-center overflow-hidden h-32">
                                            {isUploadingLayout ? (
                                                <Loader2 className="animate-spin text-indigo-500" size={24} />
                                            ) : editMetadata.referenceUrls?.layout ? (
                                                <>
                                                    <img src={editMetadata.referenceUrls.layout || undefined} className="w-full h-full object-cover" alt={t.dm_layout_reference} />
                                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                        <label className="cursor-pointer bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-lg text-xs font-medium backdrop-blur-sm flex items-center gap-1">
                                                            <UploadCloud size={14} /> {t.dm_replace}
                                                            <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload('layout', e)} />
                                                        </label>
                                                    </div>
                                                </>
                                            ) : (
                                                <label className="cursor-pointer w-full h-full flex flex-col items-center justify-center text-gray-400 hover:text-indigo-500 transition-colors">
                                                    <UploadCloud size={24} className="mb-1" />
                                                    <span className="text-xs font-medium">{t.dm_upload_layout}</span>
                                                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload('layout', e)} />
                                                </label>
                                            )}
                                        </div>
                                    </div>

                                    {/* Style Reference */}
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">
                                            <Sun size={12}/> {t.dm_style_reference}
                                        </label>
                                        <div className="relative group rounded-lg border-2 border-dashed border-gray-300 hover:border-indigo-400 transition-colors bg-gray-50 flex flex-col items-center justify-center overflow-hidden h-32">
                                            {isUploadingStyle ? (
                                                <Loader2 className="animate-spin text-indigo-500" size={24} />
                                            ) : editMetadata.referenceUrls?.style ? (
                                                <>
                                                    <img src={editMetadata.referenceUrls.style || undefined} className="w-full h-full object-cover" alt={t.dm_style_reference} />
                                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                        <label className="cursor-pointer bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-lg text-xs font-medium backdrop-blur-sm flex items-center gap-1">
                                                            <UploadCloud size={14} /> {t.dm_replace}
                                                            <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload('style', e)} />
                                                        </label>
                                                    </div>
                                                </>
                                            ) : (
                                                <label className="cursor-pointer w-full h-full flex flex-col items-center justify-center text-gray-400 hover:text-indigo-500 transition-colors">
                                                    <UploadCloud size={24} className="mb-1" />
                                                    <span className="text-xs font-medium">{t.dm_upload_style}</span>
                                                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload('style', e)} />
                                                </label>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Structured Prompt Details */}
                            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-4">
                                <label className="block text-sm font-bold text-gray-700 flex items-center gap-2">
                                    <AlignLeft size={16} className="text-indigo-600" /> {t.dm_structured_details}
                                </label>
                                <p className="text-xs text-gray-500 mb-2">{t.dm_structured_details_desc}</p>
                                
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 mb-1">{t.dm_environment}</label>
                                    <textarea 
                                        value={editMetadata.structuredPrompt?.environment || ''}
                                        onChange={e => setEditMetadata({...editMetadata, structuredPrompt: {...editMetadata.structuredPrompt, environment: e.target.value}})}
                                        placeholder={t.dm_environment_placeholder}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent h-16 resize-none text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 mb-1">{t.dm_lighting}</label>
                                    <textarea 
                                        value={editMetadata.structuredPrompt?.lighting || ''}
                                        onChange={e => setEditMetadata({...editMetadata, structuredPrompt: {...editMetadata.structuredPrompt, lighting: e.target.value}})}
                                        placeholder={t.dm_lighting_placeholder}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent h-16 resize-none text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 mb-1">{t.dm_composition}</label>
                                    <textarea 
                                        value={editMetadata.structuredPrompt?.composition || ''}
                                        onChange={e => setEditMetadata({...editMetadata, structuredPrompt: {...editMetadata.structuredPrompt, composition: e.target.value}})}
                                        placeholder={t.dm_composition_placeholder}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent h-16 resize-none text-sm"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="p-5 border-t border-gray-200 bg-white shrink-0 flex justify-end gap-3">
                            <button 
                                onClick={() => setEditingDice(null)}
                                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors"
                            >
                                {t.dm_cancel}
                            </button>
                            <button 
                                onClick={handleSave}
                                disabled={isSaving}
                                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold flex items-center gap-2 transition-colors disabled:opacity-50 shadow-sm"
                            >
                                {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                {t.dm_save_changes}
                            </button>
                        </div>
                    </>
                )}
            </div>
            
            {/* Overlay for mobile/smaller screens when drawer is open */}
            {editingDice && (
                <div 
                    className="absolute inset-0 bg-black/20 z-0 transition-opacity lg:hidden"
                    onClick={() => setEditingDice(null)}
                />
            )}
        </div>
    );
};
