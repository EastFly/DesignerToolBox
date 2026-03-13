
import React, { useState, useEffect, useMemo } from 'react';
import { X, UploadCloud, ChevronDown, Plus, Minus, Info, Image as ImageIcon, CheckCircle, AlertCircle, Loader2, Video as VideoIcon, FolderOpen, Sparkles, GripVertical, Search, Package, Star, Clock } from 'lucide-react';
import { Priority, User, TaskTypeConfig, FieldDefinition, StageDef, Product, ProductChangeLog, TaskDifficulty, ProductLevel } from '../types';
import { db } from '../services/db';
import { Language, translations } from '../i18n';
import { ProductSelector } from './ProductSelector';

interface NewTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: any) => void;
  currentUser: User;
  language: Language;
  taskTypes: TaskTypeConfig[];
  allFields: FieldDefinition[];
  allStages: StageDef[];
}

export const NewTaskModal: React.FC<NewTaskModalProps> = ({ 
  isOpen, onClose, onSubmit, currentUser, language, taskTypes, allFields, allStages 
}) => {
  const t = translations[language];
  
  // State
  const [selectedTypeId, setSelectedTypeId] = useState(taskTypes[0]?.id || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Products State
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);

  // Form State
  const [formState, setFormState] = useState<Record<string, any>>({
      priority: Priority.P1,
      difficulty: 'Medium',
      estimatedHours: 4,
      productLevel: 'B', // Read-only visual mainly, synced from product
      sellingPoints: [{ text: '', referenceImage: undefined }],
      styleTags: [],
  });

  const [filesMap, setFilesMap] = useState<Record<string, File[]>>({});

  useEffect(() => {
     if(isOpen) {
         setFormState({
             priority: Priority.P1,
             difficulty: 'Medium',
             estimatedHours: 4,
             productLevel: 'B',
             sellingPoints: [{ text: '', referenceImage: undefined }],
             styleTags: [],
         });
         setFilesMap({});
         setSelectedProductId('');
         if (taskTypes.length > 0) setSelectedTypeId(taskTypes[0].id);
         
         // Load Products for selection
         setIsLoadingProducts(true);
         db.getProducts().then(data => {
             setProducts(data);
             setIsLoadingProducts(false);
         });
     }
  }, [isOpen, taskTypes]);

  const currentTypeConfig = taskTypes.find(type => type.id === selectedTypeId);
  
  // --- PRODUCT HYDRATION LOGIC ---
  const handleProductSelect = (productId: string) => {
      setSelectedProductId(productId);
      if (!productId) return;

      const product = products.find(p => p.id === productId);
      if (!product) return;

      // Hydrate formState with product data where fields match and have isProductField=true
      const newFormState = { ...formState };
      
      // Auto-fill SKU/Name/Brand/Level if they exist in product root/data
      newFormState['sku'] = product.sku;
      newFormState['productName'] = product.name;
      newFormState['productLevel'] = product.level || 'B'; // Sync Level

      // Fill dynamic fields
      allFields.forEach(field => {
          if (field.isProductField) {
              let val = product.data[field.key];

              // --- IMAGE PRIORITY LOGIC ---
              // If field is 'productImage' (Synced Attribute), use it.
              // If it's empty, fallback to 'galleryImages' (Core Asset) first image.
              if (field.key === 'productImage') {
                  const hasSyncedImage = val && (Array.isArray(val) ? val.length > 0 : typeof val === 'string' && val.trim() !== '');
                  
                  if (!hasSyncedImage) {
                      const gallery = product.data['galleryImages'];
                      if (Array.isArray(gallery) && gallery.length > 0) {
                          // Use the first image from gallery as the product image
                          val = [gallery[0]]; 
                      }
                  }
              }
              // ----------------------------

              if (val !== undefined && val !== null) {
                  // Special logic for Textarea/SellingPoints to match renderFieldInput expectations
                  if (field.key === 'sellingPoints') {
                      newFormState[field.key] = Array.isArray(val) ? val : [{text: ''}];
                  } else if (field.type === 'textarea') {
                      // Textarea renderer expects an Array if editing, OR a string that gets split.
                      newFormState[field.key] = val;
                  } else {
                      newFormState[field.key] = val;
                  }
              }
          }
      });

      setFormState(newFormState);
  };

  // --- VALIDATION LOGIC ---

  const getFieldConfig = (key: string) => {
      if (!currentTypeConfig) return { visible: true, required: false };
      
      const creationConfig = currentTypeConfig.fieldMatrix['creation']?.[key];
      if (creationConfig && (creationConfig.visible || creationConfig.required)) {
          return creationConfig;
      }
      return currentTypeConfig.fieldMatrix['backlog']?.[key] || { visible: false, required: false };
  };

  const isFieldValid = (key: string, value: any, required: boolean) => {
      if (!required) return true;
      if (value === undefined || value === null || value === '') return false;
      if (Array.isArray(value) && value.length === 0) return false;
      if (key === 'sellingPoints') {
          return Array.isArray(value) && value.length > 0 && value.every((sp: any) => sp.text && sp.text.trim() !== '');
      }
      return true;
  };

  // Get fields visible in the CREATION STAGE
  const unsortedVisibleFields = allFields.filter(f => {
      const config = getFieldConfig(f.key);
      return config.visible;
  });

  // Apply layout sorting
  let creationLayout = currentTypeConfig?.stageLayouts?.['creation'] || [];
  
  // Inheritance: If no layout exists for creation, it's the first stage, so no inheritance to apply here.
  // Wait, creation is the first stage, so it doesn't inherit from anything.
  const layoutItems = creationLayout.length > 0 ? creationLayout : unsortedVisibleFields.map(f => ({ key: f.key, width: 'full' }));
  
  const visibleFields = [...unsortedVisibleFields].sort((a, b) => {
      const indexA = layoutItems.findIndex(item => item.key === a.key);
      const indexB = layoutItems.findIndex(item => item.key === b.key);
      if (indexA === -1 && indexB === -1) return 0;
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
  });

  const isFormValid = useMemo(() => {
      let valid = true;
      visibleFields.forEach(field => {
          const config = getFieldConfig(field.key);
          
          // Only validate if Required
          if (config.required) {
               // 1. Special Handling for FOLDERS
               // Logic: If a folder is required, at least ONE sub-field (Text OR File) must be present.
               if (field.type === 'folder' && field.subFields) {
                   const hasAnySubValue = field.subFields.some(sub => {
                       // Reconstruct the composite key used in renderFieldInput
                       const compositeKey = `${field.key}_${sub.key}`;
                       
                       // Check Text Input
                       const textVal = formState[compositeKey];
                       const hasText = textVal !== undefined && textVal !== null && textVal !== '';
                       
                       // Check File Input
                       const fileList = filesMap[compositeKey];
                       const hasFile = fileList && fileList.length > 0;

                       return hasText || hasFile;
                   });

                   if (!hasAnySubValue) {
                       valid = false;
                   }
               } 
               // 2. Standard Fields
               else {
                   const hasValue = isFieldValid(field.key, formState[field.key], true) || (filesMap[field.key] && filesMap[field.key].length > 0);
                   if (!hasValue) valid = false;
               }
          }
      });
      return valid;
  }, [formState, filesMap, visibleFields, getFieldConfig]);

  const handleFileChange = (key: string, files: File[]) => {
      setFilesMap(prev => ({ ...prev, [key]: files }));
  };

  // --- SYNC BACK TO PRODUCT (First Sync) ---
  const syncBackToProduct = async (linkedProductId: string, taskData: any) => {
      const product = products.find(p => p.id === linkedProductId);
      if (!product) return;

      const updatedProduct = { ...product, data: { ...product.data } };
      let hasChanges = false;
      const changesLog: any[] = [];

      // Check Root Fields
      if (taskData.identity?.sku && taskData.identity.sku !== product.sku) {
          changesLog.push({ field: 'SKU', old: product.sku, new: taskData.identity.sku });
          updatedProduct.sku = taskData.identity.sku;
          hasChanges = true;
      }
      if (taskData.identity?.productName && taskData.identity.productName !== product.name) {
          changesLog.push({ field: 'Name', old: product.name, new: taskData.identity.productName });
          updatedProduct.name = taskData.identity.productName;
          hasChanges = true;
      }

      // Check Dynamic Fields
      allFields.forEach(field => {
          if (field.isProductField) {
              const sectionMap: any = { 'identity': 'identity', 'assets': 'assets', 'requirements': 'requirements', 'directives': 'directives', 'custom': 'custom' };
              const target = sectionMap[field.section] || 'custom';
              const newVal = taskData[target]?.[field.key];
              const oldVal = product.data[field.key];

              // Simple equality check (JSON stringify handles arrays/objects reasonably well for dirty check)
              if (JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
                  if (!newVal && !oldVal) return; // ignore null vs undefined
                  
                  updatedProduct.data[field.key] = newVal;
                  changesLog.push({ field: field.label, old: oldVal, new: newVal });
                  hasChanges = true;
              }
          }
      });

      if (hasChanges) {
          updatedProduct.history = [{
              date: new Date(),
              actor: currentUser,
              taskName: 'Task Initialization (Sync)',
              changes: changesLog
          }, ...updatedProduct.history];
          updatedProduct.updatedAt = new Date();
          
          await db.saveProduct(updatedProduct);
      }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;
    setIsSubmitting(true);

    try {
        // 1. Upload files (Including nested keys)
        const uploadedUrls: Record<string, string[]> = {};
        for (const key of Object.keys(filesMap)) {
            if (filesMap[key].length > 0) {
                const urls = await Promise.all(filesMap[key].map(f => db.uploadFile(f)));
                uploadedUrls[key] = urls;
            }
        }

        // 2. Process Selling Points
        const sellingPoints = [...(formState.sellingPoints || [])];
        const processedSellingPoints = await Promise.all(sellingPoints.map(async (sp: any) => {
            if (sp.file) {
                const url = await db.uploadFile(sp.file);
                return { text: sp.text, referenceImage: url };
            }
            return { text: sp.text, referenceImage: sp.referenceImage };
        }));

        // 3. Construct Payload
        const result: any = {
            type: selectedTypeId,
            priority: formState.priority,
            difficulty: formState.difficulty,
            estimatedHours: parseInt(formState.estimatedHours || '4'),
            productLevel: formState.productLevel, // Save cached level
            productId: selectedProductId || undefined, // Attach Product ID
            identity: {},
            assets: {},
            requirements: {},
            directives: {},
            custom: {}
        };

        // Recursive Payload Builder
        const buildFieldData = (field: FieldDefinition, parentKeyPrefix = ''): any => {
            const compositeKey = parentKeyPrefix ? `${parentKeyPrefix}_${field.key}` : field.key;
            
            // Handle Files (Images/Videos)
            if (['image', 'file', 'video'].includes(field.type)) {
                // Check if we have uploaded URLs for this specific key
                return uploadedUrls[compositeKey] || (formState[compositeKey] || []); // Use uploaded or existing (from product sync)
            }
            
            // Handle Selling Points (Top Level Only usually)
            if (field.key === 'sellingPoints') {
                return processedSellingPoints.filter(sp => sp.text.trim() !== '');
            }

            // Handle Folders
            if (field.type === 'folder' && field.subFields) {
                const folderObj: Record<string, any> = {};
                field.subFields.forEach(sub => {
                    folderObj[sub.key] = buildFieldData(sub, compositeKey); // Recursion
                });
                // Merge with any direct formState if exists (unlikely for folder root)
                return { ...formState[field.key], ...folderObj };
            }

            // Default: Get from formState. 
            return formState[compositeKey];
        };

        allFields.forEach(field => {
            const value = buildFieldData(field);
            
            if (value !== undefined) {
                const sectionMap: any = {
                    'identity': 'identity', 'assets': 'assets', 'requirements': 'requirements', 'directives': 'directives', 'custom': 'custom'
                };
                const target = sectionMap[field.section] || 'custom';
                result[target][field.key] = value;
            }
        });

        // 4. FIRST SYNC: Update Product if linked
        if (selectedProductId) {
            await syncBackToProduct(selectedProductId, result);
        }
        
        onSubmit(result);
        onClose();
    } catch (e) {
        console.error(e);
        alert("Error creating task");
    } finally {
        setIsSubmitting(false);
    }
  };

  // ... (RenderFieldInput remains the same) ...
  const renderFieldInput = (field: FieldDefinition, required: boolean, parentKeyPrefix = '') => {
      const compositeKey = parentKeyPrefix ? `${parentKeyPrefix}_${field.key}` : field.key;
      const val = formState[compositeKey];

      // Folder Type
      if (field.type === 'folder') {
          return (
              <div className="border border-gray-200 rounded-lg p-4 bg-gray-50/50">
                  <div className="flex items-center mb-3 text-gray-500 font-medium text-xs uppercase tracking-wide">
                      <FolderOpen size={14} className="mr-1.5"/> {field.label}
                  </div>
                  <div className="space-y-4 pl-2 border-l-2 border-gray-200">
                      {field.subFields?.map(sub => (
                          <div key={sub.key}>
                              <label className="block text-xs font-bold text-gray-700 mb-1 flex items-center">
                                  {sub.label}
                                  {/* Helper for Media Dimensions */}
                                  {(sub.type === 'image' || sub.type === 'video') && sub.mediaConfig && (
                                      <span className="ml-2 text-[10px] text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-100 flex items-center" title="Target dimension for AI Generation">
                                          <Sparkles size={8} className="mr-1"/> {sub.mediaConfig.width}x{sub.mediaConfig.height}
                                      </span>
                                  )}
                                  {/* Context Tooltip */}
                                  {sub.description && (
                                      <div className="group relative ml-1.5 inline-block">
                                          <Info size={10} className="text-gray-400 cursor-help hover:text-indigo-500" />
                                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-gray-800 text-white text-[10px] rounded shadow-lg hidden group-hover:block z-50 pointer-events-none">
                                              {sub.description}
                                          </div>
                                      </div>
                                  )}
                              </label>
                              {renderFieldInput(sub, false, compositeKey)}
                          </div>
                      ))}
                  </div>
              </div>
          );
      }

      // Rich Text Type
      if (field.type === 'richtext') {
          return (
              <textarea 
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm min-h-[150px] font-mono text-gray-700 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="<div>Enter HTML or Rich Content...</div>"
                  value={val || ''}
                  onChange={e => setFormState({...formState, [compositeKey]: e.target.value})}
              />
          );
      }

      // Selling Points OR Textarea (List UI)
      if (field.key === 'sellingPoints' || field.type === 'textarea') {
          const isSP = field.key === 'sellingPoints';
          // Normalize Data
          let listData: any[] = [];
          if (isSP) {
              listData = Array.isArray(val) ? val : [{text: '', referenceImage: undefined}];
          } else {
              // Convert text blob to array for editing
              // If val is a string (common), split by newline. 
              // If val is undefined, default to [''] to show one empty input
              listData = Array.isArray(val) ? val : (typeof val === 'string' && val ? val.split('\n') : ['']);
          }

          return (
              <div className="space-y-3">
                  {listData.map((item: any, idx: number) => (
                      <div key={idx} className="flex gap-2 items-start bg-gray-50 p-3 rounded-lg border border-gray-200 group">
                          <div className="mt-2.5 cursor-grab text-gray-300 opacity-0 group-hover:opacity-50"><GripVertical size={14}/></div>
                          <span className="text-gray-400 py-2 font-mono text-sm">{idx + 1}.</span>
                          <div className="flex-1 flex flex-col gap-2">
                              <input 
                                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-indigo-500 outline-none"
                                  placeholder={isSP ? `${t.pointPlaceholder}${idx + 1}` : "Enter text line..."}
                                  value={isSP ? item.text : item}
                                  onChange={e => {
                                      const newVal = [...listData];
                                      if (isSP) newVal[idx] = { ...newVal[idx], text: e.target.value };
                                      else newVal[idx] = e.target.value;
                                      
                                      if (isSP) {
                                          setFormState({...formState, [compositeKey]: newVal});
                                      } else {
                                          // Update array locally, then join
                                          setFormState({...formState, [compositeKey]: newVal.join('\n')});
                                      }
                                  }}
                              />
                          </div>
                          <button type="button" onClick={() => {
                              const newVal = [...listData]; 
                              newVal.splice(idx, 1); 
                              if (isSP) setFormState({...formState, [compositeKey]: newVal});
                              else setFormState({...formState, [compositeKey]: newVal.join('\n')});
                          }} className="text-gray-400 hover:text-red-500 mt-2"><Minus size={16}/></button>
                      </div>
                  ))}
                  <button type="button" onClick={() => {
                      const newVal = [...listData, isSP ? {text: '', referenceImage: undefined} : ''];
                      if (isSP) setFormState({...formState, [compositeKey]: newVal});
                      else setFormState({...formState, [compositeKey]: newVal.join('\n')});
                  }} className="text-xs text-indigo-600 font-medium flex items-center hover:underline bg-indigo-50 px-3 py-1.5 rounded w-fit">
                      <Plus size={14} className="mr-1"/> {isSP ? t.addSellingPoint : "Add Line"}
                  </button>
              </div>
          );
      }

      switch (field.type) {
          case 'select':
          case 'multiselect':
              return (
                  <select className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" value={val || ''} onChange={e => setFormState({...formState, [compositeKey]: e.target.value})}>
                      <option value="">Select...</option>
                      {field.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
              );
          case 'date':
          case 'datetime':
              return <input type={field.type === 'datetime' ? 'datetime-local' : 'date'} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" value={val || ''} onChange={e => setFormState({...formState, [compositeKey]: e.target.value})} />;
          case 'image':
          case 'video':
          case 'file':
              return (
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 flex flex-col items-center justify-center text-gray-500 hover:bg-gray-50 relative bg-white transition-colors">
                      <input type="file" multiple className="absolute inset-0 opacity-0 cursor-pointer" onChange={e => e.target.files && handleFileChange(compositeKey, Array.from(e.target.files))} />
                      {field.type === 'video' ? <VideoIcon className="mb-2 text-gray-400" /> : <UploadCloud className="mb-2 text-gray-400" />}
                      <span className="text-xs font-medium">{filesMap[compositeKey]?.length > 0 ? `${filesMap[compositeKey].length} files selected` : t.dragDrop}</span>
                      
                      {/* Show existing URLs if hydrated from Product */}
                      {Array.isArray(val) && val.length > 0 && (
                          <div className="flex gap-2 mt-2 flex-wrap justify-center">
                              {val.map((url: string, i: number) => (
                                  <img key={i} src={url || undefined} className="w-8 h-8 rounded object-cover border border-gray-200" alt="Preview"/>
                              ))}
                          </div>
                      )}

                      {field.mediaConfig && (
                          <div className="text-[9px] text-gray-400 mt-1 flex items-center">
                              <Sparkles size={8} className="mr-1 text-purple-500"/>
                              AI Gen: {field.mediaConfig.width || '?'}x{field.mediaConfig.height || '?'}
                          </div>
                      )}
                  </div>
              );
          default:
              return <input type={field.type === 'number' ? 'number' : 'text'} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" value={val || ''} onChange={e => setFormState({...formState, [compositeKey]: e.target.value})} placeholder={field.key === 'styleTags' ? t.styleTagsPlaceholder : ''} />;
      }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white w-full max-w-4xl h-[90vh] rounded-xl shadow-2xl overflow-hidden flex flex-col animate-fade-in-up">
        
        <div className="bg-indigo-600 p-6 flex justify-between items-center shrink-0">
          <div>
             <h2 className="text-xl font-bold text-white">{t.newTask}</h2>
             <p className="text-indigo-200 text-sm mt-1">{t.configureTypes}</p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Create Task Form Body */}
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
            <form onSubmit={handleSubmit}>
                <div className="grid grid-cols-2 gap-6 mb-8 pb-6 border-b border-gray-100">
                     <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t.typeName}</label>
                        <select className="w-full border border-gray-300 rounded-md px-3 py-2" value={selectedTypeId} onChange={e => setSelectedTypeId(e.target.value)}>
                            {taskTypes.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t.priority}</label>
                        <select className="w-full border border-gray-300 rounded-md px-3 py-2" value={formState.priority} onChange={e => setFormState({...formState, priority: e.target.value as any})}>
                            <option value={Priority.P0}>{t.priorityUrgent}</option>
                            <option value={Priority.P1}>{t.priorityNormal}</option>
                            <option value={Priority.P2}>{t.priorityLow}</option>
                        </select>
                    </div>
                </div>

                {/* PRODUCT SELECTION (NEW) */}
                <div className="mb-8 p-4 bg-cyan-50/50 border border-cyan-100 rounded-xl">
                    <ProductSelector 
                        label={<span className="flex items-center gap-1 text-cyan-800"><Package size={14}/> ASSOCIATED PRODUCT (OPTIONAL)</span>}
                        products={products}
                        selectedProductId={selectedProductId}
                        onSelect={handleProductSelect}
                        disabled={isLoadingProducts}
                        placeholder="Search product to auto-fill data..."
                    />
                    
                    {selectedProductId && (
                        <div className="mt-2 text-xs text-cyan-600 flex items-center gap-1">
                            <CheckCircle size={12}/> 
                            Fields initialized from product. 
                            <span className="font-bold ml-1">Changes made here will update the Product (First Sync).</span>
                        </div>
                    )}
                </div>

                {/* --- VALUE ATTRIBUTES SECTION (NEW) --- */}
                <div className="mb-8 bg-gray-50 p-4 rounded-xl border border-gray-100">
                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-4">{t.taskValueAttributes || 'Task Value Attributes'}</h4>
                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-700 mb-1 flex items-center gap-1">
                                <Star size={12}/> {t.productLevelCached || 'Product Level (Cached)'}
                            </label>
                            <input 
                                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-gray-100 text-gray-600 cursor-not-allowed"
                                value={formState.productLevel || 'B'}
                                disabled
                                title={t.inheritedFromProductMaster || 'Inherited from Product Master'}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-700 mb-1 flex items-center gap-1">
                                <AlertCircle size={12}/> {t.taskDifficulty || 'Difficulty'}
                            </label>
                            <select 
                                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                                value={formState.difficulty}
                                onChange={e => setFormState({...formState, difficulty: e.target.value})}
                            >
                                <option value="High">{t.highDifficulty || 'High (x1.2)'}</option>
                                <option value="Medium">{t.mediumDifficulty || 'Medium (x1.0)'}</option>
                                <option value="Low">{t.lowDifficulty || 'Low (x0.8)'}</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-700 mb-1 flex items-center gap-1">
                                <Clock size={12}/> {t.taskEstHours || 'Est. Hours'}
                            </label>
                            <input 
                                type="number"
                                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                                value={formState.estimatedHours}
                                onChange={e => setFormState({...formState, estimatedHours: e.target.value})}
                                min="1"
                            />
                        </div>
                    </div>
                </div>

                <div className="space-y-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="col-span-2 text-sm font-bold text-gray-500 uppercase tracking-wider mb-2 border-b pb-2 flex justify-between items-center">
                        <span>{t.creationFields || 'Creation Fields'}</span>
                        <span className="text-xs text-indigo-500 font-normal normal-case bg-indigo-50 px-2 py-0.5 rounded">
                            {t.configuredInSettings || 'Configured in Settings > Task Types > Creation Form'}
                        </span>
                    </div>
                    {visibleFields.map(field => {
                        const config = getFieldConfig(field.key);
                        const layoutItem = layoutItems.find(item => item.key === field.key);
                        // Folders should span full width
                        const isFullWidth = layoutItem ? layoutItem.width === 'full' : (field.type === 'folder' || field.type === 'textarea' || field.type === 'richtext' || field.key === 'sellingPoints');
                        const isSynced = field.isProductField && selectedProductId;

                        return (
                            <div key={field.key} className={isFullWidth ? 'col-span-2' : ''}>
                                <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                                    {field.label} 
                                    {config.required && <span className="text-red-500 ml-0.5">*</span>}
                                    {isSynced && (
                                        <span className="ml-2 text-[10px] text-cyan-600 bg-cyan-50 px-1.5 py-0.5 rounded border border-cyan-100 flex items-center" title="Data synced from Product">
                                            <Package size={10} className="mr-1"/> Product Synced
                                        </span>
                                    )}
                                    {/* Root Level Media Config Hint */}
                                    {field.mediaConfig && (field.type === 'image' || field.type === 'video') && (
                                        <span className="ml-2 text-[10px] text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-100 flex items-center" title="Target dimension for AI Generation">
                                            <Sparkles size={8} className="mr-1"/> {field.mediaConfig.width}x{field.mediaConfig.height}
                                        </span>
                                    )}
                                    {/* Context Tooltip */}
                                    {field.description && (
                                      <div className="group relative ml-1.5 inline-block">
                                          <Info size={12} className="text-gray-400 cursor-help hover:text-indigo-500" />
                                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-gray-800 text-white text-xs rounded shadow-lg hidden group-hover:block z-50 pointer-events-none">
                                              <div className="font-bold border-b border-gray-600 pb-1 mb-1 text-[10px] uppercase text-gray-400">Context</div>
                                              {field.description}
                                              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800"></div>
                                          </div>
                                      </div>
                                    )}
                                </label>
                                {renderFieldInput(field, config.required)}
                            </div>
                        );
                    })}
                </div>
            </form>
        </div>

        <div className="p-6 border-t border-gray-200 bg-gray-50 flex justify-between items-center shrink-0">
            <div className="text-sm">
                {!isFormValid && <span className="text-red-500 flex items-center"><AlertCircle size={14} className="mr-1"/> {t.fillAllFields}</span>}
            </div>
            <div className="flex gap-3">
                <button onClick={onClose} className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-100 rounded-lg">{t.cancel}</button>
                <button 
                    onClick={handleSubmit}
                    disabled={!isFormValid || isSubmitting}
                    className={`px-6 py-2 rounded-lg font-medium shadow-md flex items-center transition-all ${
                        isFormValid ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    }`}
                >
                    {isSubmitting ? <Loader2 className="animate-spin mr-2" /> : t.launchWorkflow}
                    {!isSubmitting && <ChevronDown className="ml-2 w-4 h-4" />}
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};
