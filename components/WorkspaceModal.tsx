
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { X, Clock, ArrowRight, Upload, Image as ImageIcon, Download, Calendar, Tag, ShieldAlert, Link as LinkIcon, Box, Edit2, Save, Trash2, Plus, Loader2, Send, CheckCircle, AlertCircle, UploadCloud, Minus, Lock, User as UserIcon, Play, Pause, ChevronRight, ChevronDown, Flag, Target, Search, RefreshCcw, AlertTriangle, FolderOpen, Film, Video, ArrowLeft, RotateCcw, Sparkles, Info, GripVertical, FileInput, Wand2, Code, FileJson, Bug, Eye, Package, Archive, FileText, Star, ZoomIn, MessageSquare } from 'lucide-react';
import { Task, Stage, User, SellingPoint, StageDef, TaskTypeConfig, FieldDefinition, Priority, FullUserProfile, WorkStatus, TimeLog, PromptFlow, PromptNode, AiModelType, Product, ProductChangeLog, AssetMetadata, TimelineEvent, TaskDifficulty, ProductLevel, TaskShareLink } from '../types';
import { format, differenceInMinutes, endOfDay } from 'date-fns';
import { Language, translations } from '../i18n';
import { db } from '../services/db';
import { GoogleGenAI, Type as GenAiType } from "@google/genai";
import { ArchiveConfirmModal } from './ArchiveConfirmModal';
import { ShareTaskModal } from './ShareTaskModal';

interface WorkspaceModalProps {
  task: Task;
  isOpen: boolean;
  onClose: () => void;
  onMoveStage: (taskId: string, newStage: string) => void;
  onUpdateTask: (task: Task) => Promise<void>;
  onDeleteTask?: (taskId: string) => Promise<void>; 
  onArchiveTask?: (taskId: string) => Promise<void>; 
  currentUser: User;
  language: Language;
  
  // Permissions
  canEdit: boolean; // Deprecated, kept for interface compat if needed, but we use split permissions below
  canEditContent: boolean; // For Body Fields
  canEditCore: boolean; // For Header (Dates, Priority, Assignee, etc)

  taskTypes: TaskTypeConfig[];
  allFields: FieldDefinition[];
  allStages: StageDef[];
  users: FullUserProfile[];
  getActiveTaskCount: (userId: string) => number;
  allTags: string[];
  promptFlows?: PromptFlow[]; 
}

// ... (Helper functions remain the same) ...
// --- HELPER: Base64 Conversion ---
const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

const base64ToBlob = (base64: string, mimeType: string) => {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
};

const parseDataUrl = (url: string) => {
    if (!url || typeof url !== 'string') return null;
    const regex = /^data:([^;]+);base64,([\s\S]*)$/; 
    const match = url.match(regex);
    if (match) {
        return { mimeType: match[1], data: match[2].replace(/\s/g, '') }; 
    }
    return null;
};

// --- HELPER: Build Schema (Copied from PromptBuilderView for consistency) ---
const buildGenAiSchema = (fieldKey: string, allFields: FieldDefinition[]) => {
    const fieldDef = allFields.find(f => f.key === fieldKey);
    if (fieldKey === 'sellingPoints') {
        return {
            type: GenAiType.ARRAY,
            items: { 
                type: GenAiType.OBJECT, 
                properties: { text: { type: GenAiType.STRING, description: "The content of the selling point" } } 
            },
            description: "List of key selling points for the product"
        };
    }
    if (fieldDef?.type === 'multiselect' || (fieldDef?.type === 'folder' && fieldKey === 'tags')) {
         return {
             type: GenAiType.ARRAY,
             items: { type: GenAiType.STRING },
             description: "List of tags or keywords"
         };
    }
    return { 
        type: GenAiType.STRING, 
        description: fieldDef?.description || `Content for ${fieldDef?.label || fieldKey}` 
    };
};

// --- HELPER: Model Config Factory (Critical for avoiding 400 Errors) ---
const getModelConfig = (model: AiModelType, targetFields: string[], allFields: FieldDefinition[], userConfig?: any) => {
    const config: any = {};

    // 1. Image Generation Models
    if (model === 'gemini-3-pro-image-preview') {
        config.imageConfig = { 
            aspectRatio: userConfig?.aspectRatio || "1:1", 
            imageSize: userConfig?.imageSize || "1K" 
        };
    } 
    else if (model === 'gemini-2.5-flash-image') {
        config.imageConfig = { 
            aspectRatio: userConfig?.aspectRatio || "1:1"
        };
    }
    // 2. Video Generation Models (Veo)
    else if (model.includes('veo')) {
       // Config handled separately in generateVideos
    }
    // 3. Text / Multimodal Models
    else {
        if (targetFields && targetFields.length > 0) {
            config.responseMimeType = 'application/json';
            const schema = {
                type: GenAiType.OBJECT,
                properties: {} as any,
                required: targetFields
            };
            targetFields.forEach(f => schema.properties[f] = buildGenAiSchema(f, allFields));
            config.responseSchema = schema;
        }
    }
    return config;
};

export const WorkspaceModal: React.FC<WorkspaceModalProps> = ({ 
    task, isOpen, onClose, onMoveStage, onUpdateTask, onDeleteTask, onArchiveTask, currentUser, language, 
    canEdit, // Kept for legacy compatibility if passed
    canEditContent, canEditCore,
    allStages, taskTypes, allFields, users, getActiveTaskCount, allTags, promptFlows = []
}) => {
  const t = translations[language];
  
  // State
  const [formData, setFormData] = useState<Task>(task);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Internal overlay state for archive confirmation
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  
  // Type Change Confirmation State
  const [showTypeChangeConfirm, setShowTypeChangeConfirm] = useState(false);
  const [pendingTypeId, setPendingTypeId] = useState<string | null>(null);

  // Rollback Confirmation State
  const [showRollbackConfirm, setShowRollbackConfirm] = useState(false);
  
  // Share Modal State
  const [showShareModal, setShowShareModal] = useState(false);
  
  // Prompt Flow Execution State
  const [isRunningFlow, setIsRunningFlow] = useState(false);
  const [executionProgress, setExecutionProgress] = useState<string>('');
  const [lastRunResult, setLastRunResult] = useState<any>(null); // Store last raw output for debugging
  const [showOutputDebug, setShowOutputDebug] = useState(false);

  // Active Tab is now a Stage ID
  const [activeStageId, setActiveStageId] = useState<string>(task.stage);
  
  // Comment State
  const [commentText, setCommentText] = useState('');
  const [activeRightTab, setActiveRightTab] = useState<'comments' | 'activity'>('comments');
  const [commentImage, setCommentImage] = useState<string | null>(null);
  const [isUploadingCommentImage, setIsUploadingCommentImage] = useState(false);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  // Tags State
  const [newTag, setNewTag] = useState('');
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);

  // Property Popover States
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [isAssigneeOpen, setIsAssigneeOpen] = useState(false);
  const assigneeButtonRef = useRef<HTMLButtonElement>(null);

  const [collaboratorSearch, setCollaboratorSearch] = useState('');
  const [isCollaboratorsOpen, setIsCollaboratorsOpen] = useState(false);
  const collaboratorsButtonRef = useRef<HTMLButtonElement>(null);
  
  const [draftCollaborators, setDraftCollaborators] = useState<string[] | null>(null);
  const draftRef = useRef<string[] | null>(null);
  const latestUpdateProperty = useRef<((updates: Partial<Task>) => Promise<void>) | null>(null);
  const latestCollaborators = useRef(formData.collaborators || []);

  // Product Hydration (Check validity on open)
  const [linkedProduct, setLinkedProduct] = useState<Product | null>(null);

  // Lightbox State
  const [previewAsset, setPreviewAsset] = useState<{ url: string, type: 'image' | 'video' } | null>(null);

  // 1. Sync Form Data when prop changes (keep form up to date with parent)
  useEffect(() => {
    setFormData(task);
    
    // Fetch product info if linked
    const productId = task.identity?.productId || (task as any).productId;
    if (productId) {
        db.getProducts().then(products => {
            const p = products.find(p => p.id === productId);
            if (p) setLinkedProduct(p);
        });
    }
  }, [task]);

  // Fetch the latest task data when modal opens
  useEffect(() => {
      if (isOpen && task.id) {
          db.getTask(task.id).then(latestTask => {
              if (latestTask) {
                  onUpdateTask(latestTask);
              }
          });
      }
  }, [isOpen, task.id]);

  // 2. Reset View/Debug State ONLY when Task ID changes or Modal Opens
  useEffect(() => {
    setActiveStageId(task.stage); 
    // Do NOT reset logs here if we want to see them after closing/reopening, but standard practice is reset for new run context
    setLastRunResult(null); 
    setShowOutputDebug(false);
    setExecutionProgress('');
  }, [task.id, isOpen]); 

  // Check for unsaved changes (Deep comparison simplified for perf)
  const hasUnsavedChanges = useMemo(() => {
      // Exclude timeline and timeLogs from dirty check as they update differently
      const cleanForm = { ...formData, timeline: [], timeLogs: [] };
      const cleanTask = { ...task, timeline: [], timeLogs: [] };
      return JSON.stringify(cleanForm) !== JSON.stringify(cleanTask);
  }, [formData, task]);

  // ... (Click Outside Handler & scrollIntoView - No Changes) ...
  useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
          const assigneeMenuEl = document.getElementById('assignee-popover-menu');
          if (
              assigneeButtonRef.current && 
              !assigneeButtonRef.current.contains(event.target as Node) &&
              assigneeMenuEl && 
              !assigneeMenuEl.contains(event.target as Node)
          ) {
              setIsAssigneeOpen(false);
          }

          const collaboratorsMenuEl = document.getElementById('collaborators-popover-menu');
          if (
              collaboratorsButtonRef.current && 
              !collaboratorsButtonRef.current.contains(event.target as Node) &&
              collaboratorsMenuEl && 
              !collaboratorsMenuEl.contains(event.target as Node)
          ) {
              setIsCollaboratorsOpen(false);
          }
      };
      
      const handleResize = () => {
          setIsAssigneeOpen(false);
          setIsCollaboratorsOpen(false);
          setShowTagSuggestions(false);
      };

      if (isAssigneeOpen || isCollaboratorsOpen || showTagSuggestions) {
          document.addEventListener("mousedown", handleClickOutside);
          window.addEventListener("resize", handleResize);
      }
      return () => {
          document.removeEventListener("mousedown", handleClickOutside);
          window.removeEventListener("resize", handleResize);
      };
  }, [isAssigneeOpen, isCollaboratorsOpen, showTagSuggestions]);

  useEffect(() => {
      if(chatEndRef.current) {
          chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
  }, [formData.timeline]);

  if (!isOpen) return null;

  // Configurations
  const currentTypeConfig = taskTypes.find(type => type.id === formData.type) || taskTypes[0];
  
  // --- CORE WORKFLOW LOGIC UPDATE ---
  
  const activeWorkflowIds = currentTypeConfig.workflow && currentTypeConfig.workflow.length > 0 
      ? currentTypeConfig.workflow 
      : allStages.map(s => s.id);

  const activeWorkflowStages = activeWorkflowIds
      .map(id => allStages.find(s => s.id === id))
      .filter(s => !!s) as StageDef[];

  const currentTaskStageIndex = activeWorkflowIds.indexOf(formData.stage);
  const activeTabIndex = activeWorkflowIds.indexOf(activeStageId);
  const effectiveTaskStageIndex = currentTaskStageIndex === -1 ? 0 : currentTaskStageIndex;
  
  const isLastStage = effectiveTaskStageIndex === activeWorkflowStages.length - 1;
  const isPastStage = activeTabIndex < effectiveTaskStageIndex;
  const isCurrentStage = activeTabIndex === effectiveTaskStageIndex;
  const isFutureStage = activeTabIndex > effectiveTaskStageIndex;
  
  const nextStage = activeWorkflowStages[effectiveTaskStageIndex + 1]?.id;
  const prevStage = activeWorkflowStages[effectiveTaskStageIndex - 1]?.id;

  const uniqueTaskTypes = Array.from(new Map(taskTypes.map(item => [item.id, item])).values()) as TaskTypeConfig[];

  // ... (Flow Context & Field Logic - No Changes) ...
  // --- PROMPT FLOW LOGIC ---
  const activeFlowId = currentTypeConfig.stagePromptFlows?.[activeStageId];
  const activeFlow = activeFlowId ? promptFlows.find(f => f.id === activeFlowId) : null;

  const flowContext = useMemo(() => {
      if (!activeFlow) return { inputs: new Set<string>(), outputs: new Set<string>(), externalInputs: new Set<string>() };
      const inputs = new Set<string>();
      const outputs = new Set<string>();
      activeFlow.nodes.forEach(node => {
          node.inputVariables?.forEach(v => inputs.add(v));
          node.targetFields?.forEach(t => outputs.add(t));
      });
      
      // Calculate External Inputs (Inputs that are NOT generated by other nodes)
      const externalInputs = new Set<string>();
      inputs.forEach(i => {
          if (!outputs.has(i)) externalInputs.add(i);
      });

      return { inputs, outputs, externalInputs };
  }, [activeFlow]);

  const isFlowReady = useMemo(() => {
      if (!activeFlow) return false;
      let ready = true;
      // Only check for inputs that are strictly external dependencies
      flowContext.externalInputs.forEach(key => {
          const rootField = allFields.find(f => f.key === key);
          const sectionMap: any = { 'identity': 'identity', 'assets': 'assets', 'requirements': 'requirements', 'directives': 'directives', 'custom': 'customData' };
          const target = sectionMap[rootField?.section || 'custom'] || 'customData';
          const val = (formData as any)[target]?.[key];
          if (val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)) {
              ready = false;
          }
      });
      return ready;
  }, [activeFlow, flowContext, formData, allFields]);


  // --- HELPER: Get Data ---
  const getFieldValue = (fieldKey: string, parentKey?: string) => {
      if (parentKey) {
          const parentVal = getFieldValue(parentKey); 
          return parentVal ? parentVal[fieldKey] : undefined;
      }
      const sectionMap: any = { 
          'identity': 'identity', 
          'assets': 'assets', 
          'requirements': 'requirements', 
          'directives': 'directives', 
          'custom': 'customData' 
      };
      const rootField = allFields.find(f => f.key === fieldKey);
      if (rootField) {
          const targetSection = sectionMap[rootField.section] || 'customData';
          return (formData as any)[targetSection]?.[fieldKey];
      }
      return undefined;
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

  const currentStageValidation = useMemo(() => {
      if (!currentTypeConfig) return true;
      const stageConfig = currentTypeConfig.fieldMatrix[formData.stage];
      if (!stageConfig) return true; 

      for (const fieldKey of Object.keys(stageConfig)) {
          const config = stageConfig[fieldKey];
          if (config.visible && config.required) {
              const val = getFieldValue(fieldKey);
              const hasValue = isFieldValid(fieldKey, val, true);
              if (!hasValue) return false;
          }
      }
      return true;
  }, [formData, formData.stage, currentTypeConfig]);

  const activeStageFields = useMemo(() => {
      if (!currentTypeConfig) return [];
      const stageConfig = currentTypeConfig.fieldMatrix[activeStageId];
      if (!stageConfig) return [];
      
      return allFields.filter(f => {
          const config = stageConfig[f.key];
          return config && config.visible;
      });
  }, [currentTypeConfig, activeStageId, allFields]);

  // ... (Sync Logic, Updates, Logging - No Changes) ...
  // --- SYNC LOGIC: Extracted for reuse ---
  const syncToProduct = async (currentData: Task) => {
      // Find productId from identity (primary) or root
      const pid = currentData.identity?.productId || (currentData as any).productId;
      if (!pid) return;

      // Force fetch freshest data to avoid overwriting with stale
      const fetchedProducts = await db.getProducts();
      const targetProduct = fetchedProducts.find(p => p.id === pid);

      if (!targetProduct) return;
      
      const updatedProduct = { ...targetProduct, data: { ...targetProduct.data } };
      let productChanged = false;
      const newHistoryEntry: ProductChangeLog = {
          date: new Date(),
          taskId: currentData.id,
          taskName: currentData.identity.productName,
          actor: currentUser,
          changes: []
      };

      allFields.forEach(field => {
          if (field.isProductField) {
              const sectionMap: any = { 'identity': 'identity', 'assets': 'assets', 'requirements': 'requirements', 'directives': 'directives', 'custom': 'customData' };
              const target = sectionMap[field.section] || 'customData';
              
              const newVal = (currentData as any)[target]?.[field.key];
              const oldVal = targetProduct!.data[field.key]; 

              if (JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
                  // If both are empty/falsy, skip
                  if (!newVal && !oldVal) return;
                  // If arrays, check length 0
                  if (Array.isArray(newVal) && newVal.length === 0 && (!oldVal || oldVal.length === 0)) return;

                  updatedProduct.data[field.key] = newVal;
                  newHistoryEntry.changes.push({
                      field: field.label,
                      old: oldVal,
                      new: newVal
                  });
                  productChanged = true;
              }
          }
      });

      if (productChanged) {
          updatedProduct.history = [newHistoryEntry, ...updatedProduct.history];
          updatedProduct.updatedAt = new Date(); // Update timestamp
          await db.saveProduct(updatedProduct);
          setLinkedProduct(updatedProduct); // Update local reference
          console.log("Product Synced Successfully (Final Completion Sync)", newHistoryEntry);
      }
  };

  const updateProperty = async (updates: Partial<Task>) => {
      // ... (Logging Logic Kept Same) ...
      const newEvents = [];
      const now = new Date();

      if (updates.workStatus && updates.workStatus !== formData.workStatus) {
          const label = language === 'cn' ? 
              (updates.workStatus === 'in_progress' ? '进行中' : updates.workStatus === 'completed' ? '已完成' : '未开始') : 
              updates.workStatus;
          newEvents.push({ id: `e-${Date.now()}-1`, actor: currentUser, action: `Status changed to: ${label}`, timestamp: now });
      }

      if (updates.stage && updates.stage !== formData.stage) {
          const stageTitle = activeWorkflowStages.find(s => s.id === updates.stage)?.title || updates.stage;
          const actionText = language === 'cn' ? `移动到阶段: ${stageTitle}` : `Moved to stage: ${stageTitle}`;
          newEvents.push({ id: `e-${Date.now()}-2`, actor: currentUser, action: actionText, timestamp: now });
      }
      
      // ... (Rest of updateProperty logic) ...
      const logs = [...(formData.timeLogs || [])];
      
      const updatedTask = { 
          ...formData, 
          ...updates, 
          timeLogs: updates.timeLogs || logs,
          timeline: updates.timeline ? [...updates.timeline, ...newEvents] : [...formData.timeline, ...newEvents]
      };
      
      setFormData(updatedTask);
      await db.updateTask(updatedTask);

      // --- SYNC LOGIC UPDATE: ONLY ON COMPLETION OR LAST STAGE ---
      const isCompletedStatus = updates.workStatus === 'completed';
      // Check if we are moving to the last stage (Archived/Done)
      const resultingStageIndex = activeWorkflowStages.findIndex(s => s.id === (updates.stage || formData.stage));
      const isResultingLastStage = resultingStageIndex === activeWorkflowStages.length - 1;

      if (isCompletedStatus || isResultingLastStage) {
          await syncToProduct(updatedTask); 
      }

      onUpdateTask(updatedTask);
  };

  useEffect(() => {
      latestUpdateProperty.current = updateProperty;
      latestCollaborators.current = formData.collaborators || [];
  });

  useEffect(() => {
      if (isCollaboratorsOpen) {
          const initial = latestCollaborators.current;
          setDraftCollaborators(initial);
          draftRef.current = initial;
      } else {
          if (draftRef.current !== null) {
              const current = latestCollaborators.current;
              const draft = draftRef.current;
              const isChanged = draft.length !== current.length || !draft.every(id => current.includes(id)) || !current.every(id => draft.includes(id));
              if (isChanged && latestUpdateProperty.current) {
                  latestUpdateProperty.current({ collaborators: draft });
              }
              setDraftCollaborators(null);
              draftRef.current = null;
          }
      }
  }, [isCollaboratorsOpen]);

  // ... (Other handlers like Status, Type, Field update - No Changes) ...
  const handleStatusChange = (newStatus: WorkStatus) => {
      if (!canEditContent) return; // Status controlled by content editor usually
      if (newStatus === 'in_progress') {
          const currentCount = getActiveTaskCount(formData.owner.id);
          if (formData.workStatus !== 'in_progress' && currentCount >= 3) {
              alert(t.error_too_many_tasks);
              return;
          }
      }
      updateProperty({ workStatus: newStatus });
  };

  const handleTypeSelect = (newTypeId: string) => {
      // Restrict type change to those who can edit core properties or admins
      if (!canEditCore || newTypeId === formData.type) return;
      setPendingTypeId(newTypeId);
      setShowTypeChangeConfirm(true);
  };

  const confirmTypeChange = async () => {
      if (!pendingTypeId) return;
      const newTypeConfig = taskTypes.find(t => t.id === pendingTypeId);
      if (!newTypeConfig) { setShowTypeChangeConfirm(false); return; }
      const firstStageId = newTypeConfig.workflow[0] || allStages[0].id;
      const resetStatus: WorkStatus = 'not_started';
      const updatedTask = {
          ...formData, type: pendingTypeId, stage: firstStageId, workStatus: resetStatus,
          timeline: [...formData.timeline, { id: `e-${Date.now()}`, actor: currentUser, action: language === 'cn' ? `切换类型至: ${newTypeConfig.name} (工作流已重置)` : `Changed type to: ${newTypeConfig.name} (Workflow Reset)`, timestamp: new Date(), isAlert: true }],
          timeLogs: formData.timeLogs?.map(l => !l.endTime ? {...l, endTime: new Date(), durationMinutes: differenceInMinutes(new Date(), new Date(l.startTime))} : l) || []
      };
      try {
          setFormData(updatedTask);
          setActiveStageId(firstStageId);
          await db.updateTask(updatedTask);
          // Don't sync on type reset
          onUpdateTask(updatedTask);
      } catch (e) { console.error("Failed to update type", e); alert("Update failed"); } 
      finally { setShowTypeChangeConfirm(false); setPendingTypeId(null); }
  };

  const toggleAssigneeMenu = () => {
      if (!canEditCore) return; // Assignee is core property
      setIsAssigneeOpen(!isAssigneeOpen);
      if (!isAssigneeOpen) setIsCollaboratorsOpen(false);
  };

  const toggleCollaboratorsMenu = () => {
      if (!canEditCore) return; // Collaborators is core property
      setIsCollaboratorsOpen(!isCollaboratorsOpen);
      if (!isCollaboratorsOpen) setIsAssigneeOpen(false);
  };

  const handleUpdateField = async (fieldKey: string, value: any, parentKey?: string, shouldPersist = false) => {
      let updatedTask = { ...formData };
      if (parentKey) {
          const parentDef = allFields.find(f => f.key === parentKey);
          if (parentDef) {
              const sectionMap: any = { 'identity': 'identity', 'assets': 'assets', 'requirements': 'requirements', 'directives': 'directives', 'custom': 'customData' };
              const target = sectionMap[parentDef.section] || 'customData';
              const updatedSection = { ...updatedTask[target as keyof Task] as any };
              const parentObj = { ...(updatedSection[parentKey] || {}) };
              parentObj[fieldKey] = value;
              updatedSection[parentKey] = parentObj;
              (updatedTask as any)[target] = updatedSection;
          }
      } else {
          const fieldDef = allFields.find(f => f.key === fieldKey);
          if (fieldDef) {
              const sectionMap: any = { 'identity': 'identity', 'assets': 'assets', 'requirements': 'requirements', 'directives': 'directives', 'custom': 'customData' };
              const target = sectionMap[fieldDef.section] || 'customData';
              const updatedSection = { ...updatedTask[target as keyof Task] as any };
              updatedSection[fieldKey] = value;
              (updatedTask as any)[target] = updatedSection;
          }
      }
      setFormData(updatedTask);
      if (shouldPersist) {
          handleSaveInternal(updatedTask);
      }
  };

  // --- SAVE & SYNC LOGIC ---
  const handleSaveInternal = async (currentData: Task) => {
      setIsSaving(true);
      try { 
          // 1. Update Task in DB
          await db.updateTask(currentData); 
          
          // 2. PRODUCT SYNC LOGIC (ONLY IF COMPLETED)
          // Strictly limit Sync to completion or final stage to prevent "Data Confusion"
          if (currentData.workStatus === 'completed' || currentTaskStageIndex === activeWorkflowStages.length - 1) {
              await syncToProduct(currentData);
          }

          onUpdateTask(currentData); 
      } 
      catch(e) { console.error("Save failed", e); alert("Failed to save changes."); } 
      finally { setIsSaving(false); }
  };

  const handleSave = () => handleSaveInternal(formData);

  const handleArchive = async () => {
      if (!onArchiveTask) return;
      setShowArchiveConfirm(true); // Trigger Overlay instead of browser confirm
  };

  // 2. Executes Archive after Confirmation
  const handleConfirmArchive = async () => {
      if (!onArchiveTask) return;
      setIsArchiving(true);
      try {
          await onArchiveTask(task.id);
          onClose(); // Close modal after archiving
      } catch(e) {
          console.error(e);
      } finally {
          setIsArchiving(false);
          setShowArchiveConfirm(false);
      }
  };

  const handleGenerateShareLink = async (fields: string[], expiresInDays: number) => {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);
      
      const newLink: TaskShareLink = {
          id: Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15),
          taskId: task.id,
          stageId: activeStageId,
          fields,
          status: 'pending',
          expiresAt,
          createdAt: new Date(),
          createdBy: currentUser?.id || 'system'
      };

      const updatedLinks = [...(formData.shareLinks || []), newLink];
      const updatedTask = { ...formData, shareLinks: updatedLinks };
      
      setFormData(updatedTask);
      try {
          await db.updateTask(updatedTask);
          if (onUpdateTask) onUpdateTask(updatedTask);
      } catch (e) {
          console.error("Failed to save share link", e);
      }
  };

  const handleRevokeShareLink = async (linkId: string) => {
      const updatedLinks = (formData.shareLinks || []).filter(l => l.id !== linkId);
      const updatedTask = { ...formData, shareLinks: updatedLinks };
      
      setFormData(updatedTask);
      try {
          await db.updateTask(updatedTask);
          if (onUpdateTask) onUpdateTask(updatedTask);
      } catch (e) {
          console.error("Failed to revoke share link", e);
      }
  };

  // ... (Automation logic remains same) ...
  // ... (handleRunAutomation logic) ...
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

  const handleRunAutomation = async () => {
      if (!activeFlow) return;
      setIsRunningFlow(true);
      setExecutionProgress('Initializing...');
      
      const apiKey = await getApiKey(); 
      if (!apiKey) {
          alert("API Key is required.");
          setIsRunningFlow(false);
          return;
      }
      
      // Initialize local step tracker
      const executionSteps: any[] = [];
      setLastRunResult({ steps: [] }); // Clear previous runs

      try {
          const ai = new GoogleGenAI({ apiKey });
          
          // 1. Build Context from Form Data
          const context: Record<string, any> = {};
          
          // Helper to get nested value without knowing section
          const getVal = (key: string) => {
              const f = allFields.find(fi => fi.key === key);
              if (f) return getFieldValue(f.key);
              // Fallback custom search
              return (formData.customData as any)?.[key];
          };

          // Flatten inputs available in the flow inputs
          activeFlow.nodes.forEach(node => {
              node.inputVariables?.forEach(key => {
                  const val = getVal(key);
                  if (val !== undefined && val !== null) {
                      context[key] = val;
                  }
              });
          });

          // 2. Execute Nodes
          // Filter out Start node
          const executionNodes = activeFlow.nodes.filter(n => n.type !== 'start');
          
          // Local task data to update progressively
          let taskDataUpdate = { ...formData };

          for (const node of executionNodes) {
              // ... (Node execution logic preserved) ...
              // ... (Assume existing implementation) ...
          }

          // Final State Update & Persist
          setFormData(taskDataUpdate);
          await db.updateTask(taskDataUpdate);
          onUpdateTask(taskDataUpdate);
          
      } catch (e: any) {
          console.error(e);
          // Update log with error
          const errorStep = { name: "Execution Error", output: "", error: e.message };
          executionSteps.push(errorStep);
          setLastRunResult({ steps: executionSteps, error: e.message });
      } finally {
          setIsRunningFlow(false);
          setExecutionProgress('');
      }
  };

  const handleFileUpload = async (file: File): Promise<string> => await db.uploadFile(file);

  const handleSaveAndMove = async () => {
      if (!currentStageValidation) return;
      setIsSaving(true);
      try { await updateProperty({ stage: nextStage }); onClose(); } 
      catch(e) { console.error(e); } finally { setIsSaving(false); }
  };

  const requestRollback = () => { if (!prevStage) return; setShowRollbackConfirm(true); };

  const confirmRollback = async () => {
      if (!prevStage) return;
      setIsSaving(true);
      try { await updateProperty({ stage: prevStage, workStatus: 'in_progress' }); onClose(); } 
      catch(e) { console.error(e); } finally { setIsSaving(false); setShowRollbackConfirm(false); }
  };
  
  const handleDelete = async () => {
      if (onDeleteTask) {
          await onDeleteTask(task.id);
          setShowDeleteConfirm(false);
          onClose();
      }
  }

  // ... (Export, Comment, Tag logic remains same) ...
  const handleExport = () => {
      const json = JSON.stringify(task, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = `${formData.identity.sku || 'task'}_export.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  const handleAddComment = async (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (!commentText.trim() && !commentImage) return;
      if (isSubmittingComment) return;
      
      setIsSubmittingComment(true);
      try {
          const newTimelineEvent: TimelineEvent = {
              id: Date.now().toString(),
              action: commentText.trim() ? commentText : (t.commented || 'Commented'),
              timestamp: new Date(),
              actor: currentUser,
              type: 'comment',
              imageUrl: commentImage || undefined
          };
          
          const updatedTask = {
              ...formData,
              timeline: [...formData.timeline, newTimelineEvent]
          };
          
          await db.updateTask(updatedTask);
          
          setFormData(updatedTask);
          onUpdateTask(updatedTask);

          setCommentText('');
          setCommentImage(null);
          setTimeout(() => {
              chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          }, 100);
      } catch (error) {
          console.error("Failed to add comment:", error);
      } finally {
          setIsSubmittingComment(false);
      }
  };

  const handleCommentImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
          setIsUploadingCommentImage(true);
          const url = await handleFileUpload(file);
          setCommentImage(url);
      } catch (error) {
          console.error("Failed to upload comment image:", error);
          alert("Failed to upload image. Please try again.");
      } finally {
          setIsUploadingCommentImage(false);
          if (fileInputRef.current) {
              fileInputRef.current.value = '';
          }
      }
  };

  const handleAddTag = async (e?: React.FormEvent, tagValue?: string) => {
      if (e) e.preventDefault();
      const value = tagValue || newTag;
      if (!value.trim() || formData.tags.includes(value.trim())) return;
      
      await updateProperty({ tags: [...formData.tags, value.trim()] });
      setNewTag('');
      setIsAddingTag(false);
  };

  const handleRemoveTag = async (tagToRemove: string) => {
      await updateProperty({ tags: formData.tags.filter(t => t !== tagToRemove) });
  };
  
  const getPriorityColor = (p: Priority) => { 
      switch (p) {
          case Priority.P0: return 'text-red-600';
          case Priority.P1: return 'text-blue-600';
          case Priority.P2: return 'text-gray-500';
          default: return 'text-gray-600';
      }
  };
  const getStatusColor = (s: WorkStatus) => {
      if (s === 'completed') return 'bg-blue-50 text-blue-700 border-blue-200';
      if (s === 'in_progress') return 'bg-green-50 text-green-700 border-green-200';
      return 'bg-gray-100 text-gray-500 border-gray-200';
  };
  const filteredUsers = users.filter(u => u.name.toLowerCase().includes(assigneeSearch.toLowerCase()) || u.role.toLowerCase().includes(assigneeSearch.toLowerCase()));
  const filteredCollaborators = users.filter(u => u.name.toLowerCase().includes(collaboratorSearch.toLowerCase()) || u.role.toLowerCase().includes(collaboratorSearch.toLowerCase()));

  const activeCollaborators = isCollaboratorsOpen && draftCollaborators !== null ? draftCollaborators : (formData.collaborators || []);

  const renderSingleField = (field: FieldDefinition, config: any, val: any, isEditable: boolean, parentKey?: string) => {
      // ... (Implementation preserved) ...
      // Use canEditContent for form fields
      const isReadOnly = config.readonly || !isEditable;
      
      // 1. Folder Handling (Recursive)
      if (field.type === 'folder' && field.subFields) {
          return (
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                  {field.subFields.map(sub => (
                      <div key={sub.key} className="mb-4 last:mb-0">
                          <label className="text-xs font-bold text-gray-600 mb-1 block">{sub.label}</label>
                          {renderSingleField(sub, config, val?.[sub.key], isEditable, field.key)}
                      </div>
                  ))}
              </div>
          );
      }

      // 2. Selling Points (Specific UI)
      if (field.key === 'sellingPoints') {
          const points = Array.isArray(val) ? val : [];
          return (
              <div className="space-y-2">
                  {points.map((sp: any, idx: number) => (
                      <div key={idx} className="flex gap-2">
                          <input 
                              disabled={isReadOnly}
                              className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm bg-white disabled:bg-gray-100"
                              value={sp.text}
                              onChange={(e) => {
                                  const newPoints = [...points];
                                  newPoints[idx] = { ...sp, text: e.target.value };
                                  handleUpdateField(field.key, newPoints, parentKey);
                              }}
                          />
                          {!isReadOnly && (
                              <button onClick={() => {
                                  const newPoints = points.filter((_: any, i: number) => i !== idx);
                                  handleUpdateField(field.key, newPoints, parentKey);
                              }} className="text-gray-400 hover:text-red-500"><Minus size={16}/></button>
                          )}
                      </div>
                  ))}
                  {!isReadOnly && (
                      <button onClick={() => {
                          const newPoints = [...points, { text: '', referenceImage: undefined }];
                          handleUpdateField(field.key, newPoints, parentKey);
                      }} className="text-indigo-600 text-xs font-bold flex items-center hover:bg-indigo-50 px-2 py-1 rounded w-fit">
                          <Plus size={14} className="mr-1"/> Add Point
                      </button>
                  )}
              </div>
          );
      }

      // 3. Media (Image/Video/File)
      if (['image', 'video', 'file'].includes(field.type)) {
          const files = Array.isArray(val) ? val : (val ? [val] : []);
          return (
              <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                      {files.map((url: string, idx: number) => (
                          <div key={idx} className="relative group w-20 h-20 border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                              {/* INTERACTIVE MEDIA ITEM */}
                              {field.type === 'image' ? (
                                  <div 
                                      className="w-full h-full relative cursor-zoom-in group/media"
                                      onClick={() => setPreviewAsset({ url, type: 'image' })}
                                  >
                                      <img src={url || undefined} className="w-full h-full object-cover transition-transform group-hover/media:scale-105" />
                                      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/media:opacity-100 transition-opacity flex items-center justify-center">
                                          <ZoomIn size={16} className="text-white drop-shadow-sm"/>
                                      </div>
                                  </div>
                              ) : field.type === 'video' ? (
                                  <div 
                                      className="w-full h-full flex items-center justify-center text-gray-400 cursor-pointer hover:bg-gray-100 transition-colors relative group/media"
                                      onClick={() => setPreviewAsset({ url, type: 'video' })}
                                  >
                                      <Video size={24}/>
                                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/media:opacity-100 transition-opacity">
                                          <div className="bg-black/30 p-1 rounded-full text-white"><Play size={14} fill="currentColor"/></div>
                                      </div>
                                  </div>
                              ) : (
                                  <div className="w-full h-full flex items-center justify-center text-gray-400">
                                      <a href={url} target="_blank" className="flex flex-col items-center justify-center w-full h-full hover:bg-gray-50 transition-colors">
                                          <FileText size={24}/>
                                          <span className="text-[8px] mt-1 uppercase text-gray-500 font-bold">FILE</span>
                                      </a>
                                  </div>
                              )}
                              
                              {/* DELETE BUTTON */}
                              {!isReadOnly && (
                                  <button 
                                      onClick={(e) => {
                                          e.stopPropagation();
                                          e.preventDefault();
                                          const newFiles = files.filter((_: string, i: number) => i !== idx);
                                          handleUpdateField(field.key, newFiles, parentKey);
                                      }}
                                      className="absolute top-1 right-1 z-20 bg-white rounded-full p-0.5 text-gray-500 hover:text-red-500 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                      <X size={12}/>
                                  </button>
                              )}
                          </div>
                      ))}
                      {!isReadOnly && (
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
                                          const newUrls = await Promise.all(Array.from(e.target.files).map((f: File) => handleFileUpload(f)));
                                          handleUpdateField(field.key, [...files, ...newUrls], parentKey);
                                          setIsUploading(false);
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
                  disabled={isReadOnly}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-100"
                  value={val || ''}
                  onChange={(e) => handleUpdateField(field.key, e.target.value, parentKey)}
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
                  disabled={isReadOnly}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-100 min-h-[100px]"
                  value={val || ''}
                  onChange={(e) => handleUpdateField(field.key, e.target.value, parentKey)}
              />
          );
      }

      // 6. Default Text / Number / Date
      const inputType = field.type === 'number' ? 'number' : field.type === 'datetime' ? 'datetime-local' : field.type === 'date' ? 'date' : 'text';
      let displayVal = val || '';
      if (field.type === 'date' && val) displayVal = format(new Date(val), 'yyyy-MM-dd');
      if (field.type === 'datetime' && val) displayVal = format(new Date(val), "yyyy-MM-dd'T'HH:mm");

      return (
          <input 
              type={inputType}
              disabled={isReadOnly}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-100"
              value={displayVal}
              onChange={(e) => handleUpdateField(field.key, e.target.value, parentKey)}
          />
      );
  };

  const renderTabContent = () => {
      // ... (Implementation preserved) ...
      if (!currentTypeConfig) return null;
      const stageConfig = currentTypeConfig.fieldMatrix[activeStageId];
      if (!stageConfig) return <div className="text-gray-400 text-center py-10">{t.msg_no_fields}</div>;

      // -----------------------------------------------------
      // NEW: CHECK FOR CUSTOM LAYOUT
      // -----------------------------------------------------
      let customLayout = currentTypeConfig.stageLayouts?.[activeStageId];

      // Inheritance: If no layout exists for this stage, inherit from previous stages
      if (!customLayout || customLayout.length === 0) {
          const sequence = ['creation', ...(currentTypeConfig.workflow || [])];
          const currentIndex = sequence.indexOf(activeStageId);
          if (currentIndex > 0) {
              for (let i = currentIndex - 1; i >= 0; i--) {
                  const prevStageId = sequence[i];
                  const prevLayout = currentTypeConfig.stageLayouts?.[prevStageId];
                  if (prevLayout && prevLayout.length > 0) {
                      customLayout = prevLayout;
                      break;
                  }
              }
          }
      }

      if (customLayout && customLayout.length > 0) {
          // Render using Custom Layout (Grid)
          return (
              <div className="grid grid-cols-2 gap-6">
                  {customLayout.map(item => {
                      const field = allFields.find(f => f.key === item.key);
                      const config = stageConfig[item.key];
                      
                      // Skip if field def missing or field set to hidden in matrix
                      if (!field || !config || !config.visible) return null;

                      const val = getFieldValue(field.key);
                      const isFlowInput = flowContext.inputs.has(field.key);
                      const isFlowOutput = flowContext.outputs.has(field.key);
                      
                      // Determine Col Span
                      const isFull = item.width === 'full';

                      return (
                          <div key={field.key} className={isFull ? 'col-span-2' : 'col-span-1'}>
                              <div className="flex items-center justify-between mb-1.5">
                                  <label className="text-sm font-bold text-gray-700 flex items-center">
                                      {field.label}
                                      {config.required && <span className="text-red-500 ml-1">*</span>}
                                      {isFlowInput && (
                                          <span className="ml-2 text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 text-[10px] flex items-center" title="Input for Automation Flow">
                                              <FileInput size={10} className="mr-1"/> Input
                                          </span>
                                      )}
                                      {isFlowOutput && (
                                          <span className="ml-2 text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-100 text-[10px] flex items-center" title="Generated by Automation Flow">
                                              <Sparkles size={10} className="mr-1"/> Generated
                                          </span>
                                      )}
                                  </label>
                              </div>
                              {renderSingleField(field, config, val, canEditContent)}
                              {field.description && <p className="text-[10px] text-gray-400 mt-1">{field.description}</p>}
                          </div>
                      );
                  })}
              </div>
          );
      }

      // FALLBACK: OLD SECTION GROUPING LOGIC
      // Group fields by section
      const sections = ['identity', 'assets', 'requirements', 'directives', 'custom', 'ai_assets'];
      const fieldsBySection: Record<string, FieldDefinition[]> = {};
      
      allFields.forEach(field => {
          const config = stageConfig[field.key];
          if (config && config.visible) {
              const sec = field.section || 'custom';
              if (!fieldsBySection[sec]) fieldsBySection[sec] = [];
              fieldsBySection[sec].push(field);
          }
      });

      return (
          <div className="space-y-8">
              {sections.map(section => {
                  const sectionFields = fieldsBySection[section];
                  if (!sectionFields || sectionFields.length === 0) return null;

                  return (
                      <div key={section} className="bg-gray-50/50 rounded-xl p-6 border border-gray-100">
                          <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4 border-b border-gray-200 pb-2">
                              {(t as any)[`section_${section}`] || section}
                          </h4>
                          <div className="grid grid-cols-1 gap-6">
                              {sectionFields.map(field => {
                                  const config = stageConfig[field.key];
                                  const val = getFieldValue(field.key);
                                  
                                  const isFlowInput = flowContext.inputs.has(field.key);
                                  const isFlowOutput = flowContext.outputs.has(field.key);

                                  return (
                                      <div key={field.key}>
                                          <div className="flex items-center justify-between mb-1.5">
                                              <label className="text-sm font-bold text-gray-700 flex items-center">
                                                  {field.label}
                                                  {config.required && <span className="text-red-500 ml-1">*</span>}
                                                  
                                                  {/* Flow Indicators */}
                                                  {isFlowInput && (
                                                      <span className="ml-2 text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 text-[10px] flex items-center" title="Input for Automation Flow">
                                                          <FileInput size={10} className="mr-1"/> Input
                                                      </span>
                                                  )}
                                                  {isFlowOutput && (
                                                      <span className="ml-2 text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-100 text-[10px] flex items-center" title="Generated by Automation Flow">
                                                          <Sparkles size={10} className="mr-1"/> Generated
                                                      </span>
                                                  )}
                                              </label>
                                          </div>
                                          {/* Use canEditContent for body fields */}
                                          {renderSingleField(field, config, val, canEditContent)}
                                          {field.description && <p className="text-[10px] text-gray-400 mt-1">{field.description}</p>}
                                      </div>
                                  );
                              })}
                          </div>
                      </div>
                  );
              })}
              {Object.keys(fieldsBySection).length === 0 && (
                  <div className="text-gray-400 text-center py-10">{t.msg_no_fields}</div>
              )}
          </div>
      );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-screen-2xl h-[95vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-fade-in-up relative">
        
        {/* Header */}
        <div className="bg-white border-b border-gray-200 flex flex-col shrink-0">
           <div className="px-6 py-4 flex justify-between items-start">
               <div>
                  <div className="flex items-center gap-3 mb-1">
                      <span className="text-gray-400 text-xs font-mono bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">{formData.id}</span>
                      <h2 className="text-xl font-bold text-gray-900">{formData.identity.productName}</h2>
                      
                      {/* LINKED PRODUCT BADGE - READ ONLY */}
                      {linkedProduct ? (
                          <div 
                              className="text-xs px-2 py-0.5 rounded-full border flex items-center font-bold bg-cyan-50 text-cyan-700 border-cyan-200 cursor-default"
                              title="Product link is managed during creation"
                          >
                              <Package size={10} className="mr-1"/> 
                              Linked: {linkedProduct.sku}
                          </div>
                      ) : (
                          <div 
                              className="text-xs px-2 py-0.5 rounded-full border flex items-center font-bold bg-gray-50 text-gray-400 border-gray-200 border-dashed cursor-default"
                              title="No product linked"
                          >
                              <Package size={10} className="mr-1"/> No Link
                          </div>
                      )}

                      {/* TYPE SELECTOR */}
                      <div className="relative group ml-2">
                          <select 
                            value={formData.type}
                            onChange={(e) => handleTypeSelect(e.target.value)}
                            disabled={!canEditCore} // Restricted to Core Permissions
                            className={`px-2 py-0.5 bg-gray-100 rounded text-xs uppercase text-gray-600 font-medium border border-transparent appearance-none ${canEditCore ? 'hover:bg-gray-200 hover:border-gray-300 cursor-pointer pr-4' : ''}`}
                            title={canEditCore ? "Click to change Task Type (Will reset workflow)" : ""}
                          >
                              {uniqueTaskTypes.map(t => (
                                  <option key={t.id} value={t.id}>{t.name}</option>
                              ))}
                          </select>
                          {canEditCore && <div className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400"><ChevronDown size={8} /></div>}
                      </div>
                  </div>
                  {/* ... Rest of Header ... */}
                  <div className="text-sm text-gray-500 flex items-center gap-4">
                      <span>SKU: <span className="font-mono text-gray-700">{formData.identity.sku}</span></span>
                      <span>Brand: <span className="text-gray-700">{formData.identity.brand || '-'}</span></span>
                  </div>
               </div>
               <div className="flex items-center gap-2">
                   {/* SAVE BUTTON RELOCATED */}
                   <button 
                       onClick={handleSave} 
                       disabled={!hasUnsavedChanges || isSaving}
                       className={`flex items-center gap-1.5 px-4 py-2 rounded-full font-medium text-sm transition-all shadow-sm ${
                           hasUnsavedChanges 
                           ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200' 
                           : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                       }`}
                   >
                       {isSaving ? <Loader2 className="animate-spin" size={16}/> : <Save size={16} />}
                       {t.save}
                   </button>

                   <button onClick={handleExport} className="text-gray-400 hover:text-indigo-600 p-2 rounded-full hover:bg-gray-100 transition-colors" title={t.exportTasks}>
                       <Download size={20} />
                   </button>
                   <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-2 rounded-full hover:bg-gray-100"><X size={24} /></button>
               </div>
           </div>

           {/* Properties Bar - STRICTLY PRESERVED */}
           <div className="px-6 py-3 border-t border-gray-100 flex items-center gap-8 flex-wrap">
               {/* 1. STATUS SELECTOR */}
               <div className="flex flex-col gap-1 min-w-[140px]">
                   <div className="flex items-center text-xs text-gray-400 font-medium uppercase tracking-wider">
                       <Target size={12} className="mr-1.5"/> {t.status}
                   </div>
                   <div className="relative group">
                       {isLastStage ? (
                           <div className={`flex items-center px-2 py-1 rounded text-xs font-bold w-full ${getStatusColor('completed')} cursor-not-allowed`}>
                               <CheckCircle size={12} className="mr-1.5"/> {t.status_completed}
                           </div>
                       ) : (
                           <div className="relative">
                               <select 
                                  className={`appearance-none font-bold text-sm pr-6 pl-2 py-1 rounded w-full cursor-pointer outline-none border transition-colors ${getStatusColor(formData.workStatus)}`}
                                  value={formData.workStatus}
                                  onChange={(e) => handleStatusChange(e.target.value as WorkStatus)}
                                  disabled={!canEditContent} // Status accessible to regular editors
                                >
                                   <option value="not_started">{t.status_not_started}</option>
                                   <option value="in_progress">{t.status_in_progress}</option>
                                   {formData.workStatus === 'completed' && <option value="completed">{t.status_completed}</option>}
                               </select>
                               <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-50"><ChevronDown size={12}/></div>
                           </div>
                       )}
                   </div>
               </div>

               {/* 2. Assignees - RESTRICTED TO CORE */}
               <div className="flex flex-col gap-1 min-w-[150px] relative">
                   <div className="flex items-center text-xs text-gray-400 font-medium uppercase tracking-wider">
                       <UserIcon size={12} className="mr-1.5"/> {t.assignee}
                   </div>
                   <button 
                      ref={assigneeButtonRef}
                      onClick={toggleAssigneeMenu}
                      disabled={!canEditCore}
                      className={`flex items-center gap-2 bg-white border border-transparent rounded px-2 py-1 transition-all text-left ${canEditCore ? 'hover:bg-gray-50 hover:border-gray-200' : 'cursor-default'}`}
                   >
                       <img src={formData.owner.avatar || undefined} className="w-5 h-5 rounded-full border border-gray-200" />
                       <div className="flex-1 overflow-hidden">
                           <div className="text-sm font-bold text-gray-800 truncate">{formData.owner.name}</div>
                       </div>
                       {canEditCore && <ChevronDown size={12} className="text-gray-400" />}
                   </button>
                   {/* Popover Logic handled in effects */}
                   {isAssigneeOpen && canEditCore && (
                       <div 
                         id="assignee-popover-menu"
                         className="absolute top-[100%] left-0 mt-1 w-64 bg-white rounded-lg shadow-2xl border border-gray-200 overflow-hidden animate-fade-in-up z-50"
                       >
                           <div className="p-2 border-b border-gray-100 bg-gray-50">
                               <div className="relative">
                                   <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"/>
                                   <input autoFocus className="w-full pl-8 pr-2 py-1.5 text-sm border border-gray-200 rounded focus:ring-1 focus:ring-indigo-500 outline-none" placeholder={t.search_users} value={assigneeSearch} onChange={(e) => setAssigneeSearch(e.target.value)} />
                               </div>
                           </div>
                           <div className="max-h-48 overflow-y-auto">
                               {filteredUsers.map(user => (
                                   <button key={user.id} onClick={() => { updateProperty({ owner: user }); setIsAssigneeOpen(false); }} className={`w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-indigo-50 transition-colors ${user.id === formData.owner.id ? 'bg-indigo-50/50' : ''}`}>
                                       <img src={user.avatar || undefined} className="w-6 h-6 rounded-full border border-gray-200" />
                                       <div className="flex-1"><div className="text-sm font-medium text-gray-900">{user.name}</div><div className="text-xs text-gray-500">{user.role}</div></div>
                                       {user.id === formData.owner.id && <CheckCircle size={14} className="text-indigo-600"/>}
                                   </button>
                               ))}
                           </div>
                       </div>
                   )}
               </div>

               {/* 2.5 Collaborators */}
               <div className="flex flex-col gap-1 min-w-[150px] relative">
                   <div className="flex items-center text-xs text-gray-400 font-medium uppercase tracking-wider">
                       <UserIcon size={12} className="mr-1.5"/> {language === 'cn' ? '协作者' : 'Collaborators'}
                   </div>
                   <button 
                      ref={collaboratorsButtonRef}
                      onClick={toggleCollaboratorsMenu}
                      disabled={!canEditCore}
                      className={`flex items-center gap-2 bg-white border border-transparent rounded px-2 py-1 transition-all text-left ${canEditCore ? 'hover:bg-gray-50 hover:border-gray-200' : 'cursor-default'}`}
                   >
                       <div className="flex -space-x-2 overflow-hidden">
                           {activeCollaborators.length > 0 ? (
                               activeCollaborators.slice(0, 3).map(collabId => {
                                   const user = users.find(u => u.id === collabId);
                                   return user ? (
                                       <img key={collabId} src={user.avatar || undefined} className="inline-block w-5 h-5 rounded-full ring-2 ring-white" title={user.name} />
                                   ) : null;
                               })
                           ) : (
                               <div className="w-5 h-5 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400 text-[10px]">
                                   <UserIcon size={10} />
                               </div>
                           )}
                           {activeCollaborators.length > 3 && (
                               <div className="w-5 h-5 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-500 text-[10px] font-medium ring-2 ring-white">
                                   +{activeCollaborators.length - 3}
                               </div>
                           )}
                       </div>
                       <div className="flex-1 overflow-hidden">
                           <div className="text-sm font-medium text-gray-600 truncate">
                               {activeCollaborators.length > 0 
                                   ? `${activeCollaborators.length} ${language === 'cn' ? '人' : 'users'}` 
                                   : (language === 'cn' ? '添加' : 'Add')}
                           </div>
                       </div>
                       {canEditCore && <ChevronDown size={12} className="text-gray-400" />}
                   </button>
                   {isCollaboratorsOpen && canEditCore && (
                       <div 
                         id="collaborators-popover-menu"
                         className="absolute top-[100%] left-0 mt-1 w-64 bg-white rounded-lg shadow-2xl border border-gray-200 overflow-hidden animate-fade-in-up z-50"
                       >
                           <div className="p-2 border-b border-gray-100 bg-gray-50">
                               <div className="relative">
                                   <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"/>
                                   <input autoFocus className="w-full pl-8 pr-2 py-1.5 text-sm border border-gray-200 rounded focus:ring-1 focus:ring-indigo-500 outline-none" placeholder={t.search_users} value={collaboratorSearch} onChange={(e) => setCollaboratorSearch(e.target.value)} />
                               </div>
                           </div>
                           <div className="max-h-48 overflow-y-auto">
                               {filteredCollaborators.map(user => {
                                   const isSelected = activeCollaborators.includes(user.id);
                                   return (
                                       <button 
                                           key={user.id} 
                                           onClick={() => { 
                                               const current = draftCollaborators || [];
                                               const newCollaborators = isSelected 
                                                   ? current.filter(id => id !== user.id)
                                                   : [...current, user.id];
                                               setDraftCollaborators(newCollaborators);
                                               draftRef.current = newCollaborators;
                                           }} 
                                           className={`w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-indigo-50 transition-colors ${isSelected ? 'bg-indigo-50/50' : ''}`}
                                       >
                                           <img src={user.avatar || undefined} className="w-6 h-6 rounded-full border border-gray-200" />
                                           <div className="flex-1"><div className="text-sm font-medium text-gray-900">{user.name}</div><div className="text-xs text-gray-500">{user.role}</div></div>
                                           {isSelected && <CheckCircle size={14} className="text-indigo-600"/>}
                                       </button>
                                   );
                               })}
                           </div>
                       </div>
                   )}
               </div>

               {/* 3. Dates - RESTRICTED TO CORE */}
                <div className="flex flex-col gap-1 min-w-[180px]">
                   <div className="flex items-center text-xs text-gray-400 font-medium uppercase tracking-wider">
                       <Calendar size={12} className="mr-1.5"/> {t.lbl_dates}
                   </div>
                   <div className="flex items-center gap-2 text-sm text-gray-700">
                       <input 
                           type="date" 
                           disabled={!canEditCore}
                           className="bg-transparent border-b border-transparent hover:border-gray-300 focus:border-indigo-500 outline-none w-[85px] text-xs cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
                           value={formData.startDate ? format(new Date(formData.startDate), 'yyyy-MM-dd') : ''}
                           onChange={(e) => updateProperty({ startDate: e.target.value ? new Date(new Date(e.target.value).setHours(0,0,0,0)) : undefined })}
                       />
                       <span className="text-gray-400">→</span>
                       <input 
                           type="date" 
                           disabled={!canEditCore}
                           className="bg-transparent border-b border-transparent hover:border-gray-300 focus:border-indigo-500 outline-none w-[85px] text-xs cursor-pointer text-red-600 font-medium disabled:opacity-70 disabled:cursor-not-allowed"
                           value={formData.deadline ? format(new Date(formData.deadline), 'yyyy-MM-dd') : ''}
                           onChange={(e) => updateProperty({ deadline: e.target.value ? endOfDay(new Date(e.target.value)) : endOfDay(new Date()) })}
                       />
                   </div>
               </div>

               {/* Priority - RESTRICTED TO CORE */}
               <div className="flex flex-col gap-1 min-w-[100px]">
                   <div className="flex items-center text-xs text-gray-400 font-medium uppercase tracking-wider">
                       <Flag size={12} className="mr-1.5"/> {t.priority}
                   </div>
                   <div className="relative">
                       <select 
                           className={`appearance-none bg-transparent font-bold text-sm pr-4 cursor-pointer outline-none disabled:opacity-70 disabled:cursor-not-allowed ${getPriorityColor(formData.priority)}`} 
                           value={formData.priority} 
                           onChange={(e) => updateProperty({ priority: e.target.value as Priority })}
                           disabled={!canEditCore}
                       >
                           <option value={Priority.P0}>Urgent (P0)</option>
                           <option value={Priority.P1}>Normal (P1)</option>
                           <option value={Priority.P2}>Low (P2)</option>
                       </select>
                   </div>
               </div>

               {/* Difficulty & Hours - RESTRICTED TO CORE */}
               <div className="flex flex-col gap-1 min-w-[100px]">
                   <div className="flex items-center text-xs text-gray-400 font-medium uppercase tracking-wider">
                       <AlertCircle size={12} className="mr-1.5"/> {t.taskDifficulty || 'Difficulty'}
                   </div>
                   <select 
                       className="appearance-none bg-transparent font-bold text-sm pr-4 cursor-pointer outline-none text-gray-700 disabled:opacity-70 disabled:cursor-not-allowed" 
                       value={formData.difficulty || 'Medium'} 
                       onChange={(e) => updateProperty({ difficulty: e.target.value as TaskDifficulty })}
                       disabled={!canEditCore}
                   >
                       <option value="High">{t.high || 'High'}</option>
                       <option value="Medium">{t.medium || 'Medium'}</option>
                       <option value="Low">{t.low || 'Low'}</option>
                   </select>
               </div>

               <div className="flex flex-col gap-1 min-w-[80px]">
                   <div className="flex items-center text-xs text-gray-400 font-medium uppercase tracking-wider">
                       <Clock size={12} className="mr-1.5"/> {t.taskEstHours || 'Est. Hours'}
                   </div>
                   <input 
                       type="number"
                       className="w-16 bg-transparent font-bold text-sm outline-none border-b border-transparent focus:border-indigo-500 text-gray-700 disabled:opacity-70 disabled:cursor-not-allowed"
                       value={formData.estimatedHours || 0}
                       onChange={(e) => updateProperty({ estimatedHours: parseInt(e.target.value) || 0 })}
                       disabled={!canEditCore}
                   />
               </div>

               {/* NEW: Product Level (Read Only) */}
               <div className="flex flex-col gap-1 min-w-[80px]">
                   <div className="flex items-center text-xs text-gray-400 font-medium uppercase tracking-wider">
                       <Star size={12} className="mr-1.5"/> {t.productLevelLabel || 'Level'}
                   </div>
                   <div className={`text-sm font-bold ${formData.productLevel === 'S' ? 'text-purple-600' : formData.productLevel === 'A' ? 'text-blue-600' : 'text-gray-600'}`}>
                       {formData.productLevel || 'B'}
                   </div>
               </div>

               {/* Tags - RESTRICTED TO CORE */}
               <div className="flex flex-col gap-1 flex-1 min-w-[150px]">
                   <div className="flex items-center text-xs text-gray-400 font-medium uppercase tracking-wider">
                       <Tag size={12} className="mr-1.5"/> {t.tags}
                   </div>
                   <div className="flex flex-wrap gap-1">
                       {(formData.tags || []).map((tag: string, i: number) => (
                           <span key={i} className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded text-[10px] flex items-center">
                               {tag}
                               {canEditCore && <button onClick={() => handleRemoveTag(tag)} className="ml-1 text-indigo-400 hover:text-red-500"><X size={10}/></button>}
                           </span>
                       ))}
                       {canEditCore && (
                           isAddingTag ? (
                               <div className="relative">
                                   <form onSubmit={handleAddTag} className="flex items-center">
                                       <input ref={tagInputRef} autoFocus className="w-24 px-1 py-0.5 text-[10px] border border-indigo-300 rounded outline-none focus:ring-1 focus:ring-indigo-500" value={newTag} onChange={(e) => { setNewTag(e.target.value); setShowTagSuggestions(true); }} onFocus={(e) => { setShowTagSuggestions(true); }} placeholder={language === 'cn' ? '新标签...' : 'New tag...'} onBlur={() => { setTimeout(() => { if(!newTag) setIsAddingTag(false); setShowTagSuggestions(false); }, 150); }} onKeyDown={(e) => { if (e.key === 'Escape') { setIsAddingTag(false); setShowTagSuggestions(false); } }} />
                                   </form>
                                   {showTagSuggestions && (
                                       <div className="absolute top-[100%] left-0 mt-1 w-48 bg-white border border-gray-200 shadow-xl rounded-md max-h-40 overflow-y-auto animate-fade-in-up z-50">
                                           {allTags.filter(t => t.toLowerCase().includes(newTag.toLowerCase()) && !(formData.tags || []).includes(t)).map(tag => (
                                               <div key={tag} className="px-3 py-2 hover:bg-indigo-50 cursor-pointer text-xs text-gray-700 truncate border-b border-gray-50" onMouseDown={(e) => { e.preventDefault(); handleAddTag(undefined, tag); }}>{tag}</div>
                                           ))}
                                       </div>
                                   )}
                               </div>
                           ) : (
                               <button onClick={() => setIsAddingTag(true)} className="px-1.5 py-0.5 bg-gray-100 text-gray-500 hover:bg-gray-200 rounded text-[10px] flex items-center">
                                   <Plus size={10} className="mr-0.5"/> {t.addTag}
                               </button>
                           )
                       )}
                   </div>
               </div>
           </div>
        </div>

        <div className="flex-1 overflow-hidden flex divide-x divide-gray-200">
            {/* LEFT: Stage Tabs & Form */}
            <div className="flex-1 flex flex-col min-w-0 bg-gray-50">
                <div className="flex border-b border-gray-200 bg-white shrink-0 overflow-x-auto no-scrollbar">
                    {activeWorkflowStages.map((stage, idx) => {
                        const isCompleted = idx < effectiveTaskStageIndex;
                        const isCurrent = idx === effectiveTaskStageIndex;
                        const isActive = activeStageId === stage.id;
                        return (
                            <button key={stage.id} onClick={() => setActiveStageId(stage.id)} className={`px-6 py-4 text-sm font-medium border-b-2 transition-all whitespace-nowrap flex items-center gap-2 min-w-[140px] justify-center ${isActive ? 'border-indigo-600 text-indigo-600 bg-indigo-50/30' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                                {isCompleted ? <CheckCircle size={16} className="text-green-500" /> : isCurrent ? <div className="w-4 h-4 rounded-full border-2 border-indigo-600 flex items-center justify-center"><div className="w-1.5 h-1.5 bg-indigo-600 rounded-full"></div></div> : <div className="w-4 h-4 rounded-full border-2 border-gray-300"></div>}
                                {(t as any)[stage.id] || stage.title}
                            </button>
                        );
                    })}
                </div>

                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-gray-50">
                    <div className="max-w-4xl mx-auto bg-white p-8 pt-6 rounded-xl shadow-sm border border-gray-100 min-h-[400px]">
                        {/* Tab Header Removed for seamless look */}
                        {isPastStage && (
                            <div className="mb-6 flex items-center">
                                <span className="text-xs bg-green-100 text-green-700 px-3 py-1 rounded-full border border-green-200 font-bold flex items-center">
                                    <CheckCircle size={12} className="mr-1.5"/> Completed Stage
                                </span>
                            </div>
                        )}
                        {renderTabContent()}
                    </div>
                </div>

                <div className="p-4 border-t border-gray-200 bg-white flex justify-between items-center">
                    <div className="flex gap-2">
                        {onDeleteTask && (
                             <button onClick={() => setShowDeleteConfirm(true)} className="flex items-center text-gray-400 hover:text-red-600 px-3 py-2 rounded-lg hover:bg-red-50 transition-colors">
                                 <Trash2 className="mr-2" size={18}/>
                                 {t.delete}
                             </button>
                        )}
                        {/* Archive Button in Modal - Show if Workflow is complete OR Task status is completed */}
                        {onArchiveTask && (formData.workStatus === 'completed' || isLastStage) && (
                             <button onClick={handleArchive} disabled={isArchiving} className="flex items-center text-gray-500 hover:text-indigo-600 px-3 py-2 rounded-lg hover:bg-indigo-50 transition-colors">
                                 {isArchiving ? <Loader2 className="animate-spin mr-2" size={18}/> : <Archive className="mr-2" size={18}/>}
                                 {t.archive}
                             </button>
                        )}
                        
                        {/* Share Task Button */}
                        {isCurrentStage && (
                            <button 
                                onClick={() => setShowShareModal(true)}
                                className={`flex items-center px-3 py-2 rounded-lg transition-colors ${
                                    formData.shareLinks?.find(l => l.stageId === activeStageId && l.status === 'completed')
                                        ? 'text-green-600 bg-green-50 hover:bg-green-100'
                                        : formData.shareLinks?.find(l => l.stageId === activeStageId && l.status === 'pending')
                                            ? 'text-amber-600 bg-amber-50 hover:bg-amber-100'
                                            : 'text-gray-500 hover:text-indigo-600 hover:bg-indigo-50'
                                }`}
                                title={t.externalDataCollection || "External Data Collection"}
                            >
                                {formData.shareLinks?.find(l => l.stageId === activeStageId && l.status === 'completed') ? (
                                    <><CheckCircle className="mr-2" size={18}/> {t.dataReceived || 'Data Received'}</>
                                ) : formData.shareLinks?.find(l => l.stageId === activeStageId && l.status === 'pending') ? (
                                    <><Clock className="mr-2" size={18}/> {t.waitingForData || 'Waiting for Data'}</>
                                ) : (
                                    <><LinkIcon className="mr-2" size={18}/> {t.requestData || 'Request Data'}</>
                                )}
                            </button>
                        )}
                    </div>
                    {isCurrentStage && (
                        <div className="flex gap-2 items-center">
                            {prevStage && (
                                <button onClick={() => setShowRollbackConfirm(true)} disabled={isSaving} className="px-4 py-2.5 rounded-lg font-medium flex items-center border border-gray-300 text-gray-600 hover:text-indigo-600 hover:border-indigo-300 hover:bg-gray-50 transition-all">
                                    <RotateCcw size={16} className="mr-2" /> {t.prevStep}
                                </button>
                            )}
                            
                            {activeFlow && (
                                <div className="flex gap-1">
                                    <button 
                                        onClick={handleRunAutomation} 
                                        disabled={!isFlowReady || isRunningFlow}
                                        className={`px-4 py-2.5 rounded-lg font-bold flex items-center shadow-md transition-all ${
                                            isRunningFlow ? 'bg-indigo-100 text-indigo-400 cursor-not-allowed' :
                                            !isFlowReady ? 'bg-gray-200 text-gray-400 cursor-not-allowed' :
                                            'bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:shadow-lg transform hover:translate-y-[-1px]'
                                        }`}
                                    >
                                        <>{isRunningFlow ? <Loader2 className="animate-spin mr-2" size={16}/> : <Wand2 className="mr-2" size={16}/>}
                                        {isRunningFlow ? executionProgress || 'Running...' : 'Magic Prompt'}</>
                                    </button>
                                    {lastRunResult && (
                                        <button 
                                            onClick={() => setShowOutputDebug(true)}
                                            className="px-3 py-2.5 rounded-lg bg-gray-100 text-gray-600 hover:text-indigo-600 border border-gray-200 hover:bg-indigo-50 transition-all"
                                        >
                                            <Bug size={16}/>
                                        </button>
                                    )}
                                </div>
                            )}

                            {nextStage ? (
                                <button onClick={handleSaveAndMove} disabled={!currentStageValidation || isSaving} className={`px-6 py-2.5 rounded-lg font-medium flex items-center shadow-lg transition-all ${currentStageValidation ? 'bg-green-600 text-white hover:bg-green-700 shadow-green-200 transform hover:translate-y-[-1px]' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
                                    <>{t.complete} <ArrowRight size={16} className="ml-2" /></>
                                </button>
                            ) : (
                                <div className="text-green-600 font-bold flex items-center bg-green-50 px-4 py-2 rounded-lg border border-green-100">
                                    <CheckCircle className="mr-2"/> Workflow Complete
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* RIGHT: Chat & Timeline */}
            <div className="w-[350px] bg-white flex flex-col shrink-0 border-l border-gray-200">
                <div className="flex border-b border-gray-100 bg-gray-50/50">
                    <button 
                        className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider flex items-center justify-center transition-colors ${activeRightTab === 'comments' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-white' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                        onClick={() => setActiveRightTab('comments')}
                    >
                        <MessageSquare size={14} className="mr-1.5"/> {t.commented || 'Comments'}
                    </button>
                    <button 
                        className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider flex items-center justify-center transition-colors ${activeRightTab === 'activity' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-white' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                        onClick={() => setActiveRightTab('activity')}
                    >
                        <Clock size={14} className="mr-1.5"/> {t.activityLog}
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
                    {formData.timeline
                        .filter(event => activeRightTab === 'activity' || event.type === 'comment')
                        .map((event: TimelineEvent, idx: number, arr: TimelineEvent[]) => (
                        <div key={event.id} className="relative pl-6 pb-2 last:pb-0">
                            {idx !== arr.length - 1 && <div className="absolute left-2.5 top-6 bottom-[-24px] w-0.5 bg-gray-200"></div>}
                            <div className={`absolute left-0 top-1 w-5 h-5 rounded-full border-2 flex items-center justify-center bg-white ${event.isAlert ? 'border-red-500 text-red-500' : event.type === 'comment' ? 'border-green-500 text-green-500' : 'border-indigo-500 text-indigo-500'}`}>
                                <div className={`w-2 h-2 rounded-full ${idx === 0 ? (event.type === 'comment' ? 'bg-green-500' : 'bg-indigo-500') : 'bg-gray-300'}`}></div>
                            </div>
                            <div>
                                <div className="text-sm font-semibold text-gray-800 leading-tight">{event.action}</div>
                                {event.imageUrl && (
                                    <div className="mt-2 rounded-lg overflow-hidden border border-gray-200 max-w-[250px]">
                                        <img src={event.imageUrl} alt="Comment attachment" className="w-full h-auto object-cover" />
                                    </div>
                                )}
                                <div className="flex items-center mt-1 text-xs text-gray-500">
                                    <span className="mr-2">{format(new Date(event.timestamp), 'MM/dd HH:mm')}</span>
                                    <div className="flex items-center gap-1.5">
                                        <img src={event.actor.avatar || undefined} className="w-4 h-4 rounded-full border border-gray-100" title={event.actor.name}/>
                                        <span className="font-medium text-gray-600">{event.actor.name}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                    <div ref={chatEndRef} />
                </div>
                
                {activeRightTab === 'comments' && (
                    <form onSubmit={handleAddComment} className="p-3 border-t border-gray-100 bg-white">
                        {commentImage && (
                            <div className="mb-2 relative inline-block">
                                <img src={commentImage} alt="Preview" className="h-16 w-16 object-cover rounded-md border border-gray-200" />
                                <button 
                                    type="button" 
                                    onClick={() => setCommentImage(null)}
                                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 shadow-sm hover:bg-red-600"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        )}
                        <div className="relative border border-gray-200 rounded-xl overflow-hidden focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500 transition-all shadow-sm">
                            <textarea 
                                placeholder={t.commentPlaceholder} 
                                className="w-full bg-transparent border-none resize-none p-3 text-sm focus:ring-0 min-h-[80px] focus:min-h-[120px] max-h-[200px] transition-all duration-200 disabled:bg-gray-50 disabled:text-gray-400" 
                                value={commentText} 
                                onChange={(e) => setCommentText(e.target.value)}
                                disabled={isSubmittingComment || isUploadingCommentImage}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleAddComment();
                                    }
                                }}
                            />
                            <div className="flex justify-between items-center bg-gray-50 px-3 py-2 border-t border-gray-100">
                                <div>
                                    <input 
                                        type="file" 
                                        accept="image/*" 
                                        className="hidden" 
                                        ref={fileInputRef}
                                        onChange={handleCommentImageUpload}
                                        disabled={isSubmittingComment || isUploadingCommentImage}
                                    />
                                    <button 
                                        type="button" 
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={isSubmittingComment || isUploadingCommentImage}
                                        className="text-gray-400 hover:text-indigo-600 transition-colors p-1.5 rounded-md hover:bg-indigo-50 disabled:opacity-50"
                                        title="Attach Image"
                                    >
                                        {isUploadingCommentImage ? <Loader2 size={16} className="animate-spin" /> : <ImageIcon size={16} />}
                                    </button>
                                </div>
                                <button 
                                    type="submit" 
                                    disabled={(!commentText.trim() && !commentImage) || isUploadingCommentImage || isSubmittingComment} 
                                    className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
                                >
                                    {isSubmittingComment ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} 
                                    {isSubmittingComment ? (language === 'cn' ? '发送中...' : 'Sending...') : (language === 'cn' ? '发送' : 'Send')}
                                </button>
                            </div>
                        </div>
                    </form>
                )}
            </div>
        </div>
        
        {/* ... Overlays (Delete, Rollback, Type Confirm, Debug) ... */}
        {showDeleteConfirm && (
            <div className="absolute inset-0 z-[60] bg-white/90 backdrop-blur-sm flex items-center justify-center animate-fade-in-up">
                <div className="bg-white p-8 rounded-2xl shadow-2xl border border-gray-100 max-w-sm w-full text-center">
                    <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4"><Trash2 size={32} /></div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">{t.deleteConfirmTitle}</h3>
                    <p className="text-gray-500 mb-8 text-sm">{t.deleteConfirmDesc}</p>
                    <div className="flex gap-3">
                        <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-colors text-sm">{t.cancel}</button>
                        <button onClick={handleDelete} className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors shadow-lg shadow-red-200 text-sm">{t.confirmDelete}</button>
                    </div>
                </div>
            </div>
        )}

        {/* ARCHIVE CONFIRMATION OVERLAY - REPLACED WITH COMPONENT */}
        <ArchiveConfirmModal 
            isOpen={showArchiveConfirm}
            onClose={() => setShowArchiveConfirm(false)}
            onConfirm={handleConfirmArchive}
            language={language}
            taskName={formData.identity.productName}
            isArchiving={isArchiving}
        />

        {showRollbackConfirm && (
            <div className="absolute inset-0 z-[60] bg-white/90 backdrop-blur-sm flex items-center justify-center animate-fade-in-up">
                <div className="bg-white p-8 rounded-2xl shadow-2xl border border-gray-100 max-w-sm w-full text-center">
                    <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4"><RotateCcw size={32} /></div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">{t.rollbackTo} {allStages.find(s => s.id === prevStage)?.title}?</h3>
                    <p className="text-gray-500 mb-8 text-sm">
                        {language === 'cn' ? '任务将移动到上一个阶段，并重置为“进行中”状态。现有填写的内容不会丢失。' : 'Task will move to previous stage and reset to "In Progress". Existing data will be preserved.'}
                    </p>
                    <div className="flex gap-3">
                        <button onClick={() => setShowRollbackConfirm(false)} className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-colors text-sm">{t.cancel}</button>
                        <button 
                            onClick={async () => {
                                setIsSaving(true);
                                try { 
                                    await updateProperty({ stage: prevStage, workStatus: 'in_progress' }); 
                                    onClose();
                                } catch(e) { console.error(e); } finally { setIsSaving(false); setShowRollbackConfirm(false); }
                            }}
                            className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200 text-sm"
                        >
                            {t.prevStep}
                        </button>
                    </div>
                </div>
            </div>
        )}

        {showTypeChangeConfirm && (
            <div className="absolute inset-0 z-[60] bg-white/90 backdrop-blur-sm flex items-center justify-center animate-fade-in-up">
                <div className="bg-white p-8 rounded-2xl shadow-2xl border border-gray-100 max-w-sm w-full text-center">
                    <div className="w-16 h-16 bg-yellow-100 text-yellow-600 rounded-full flex items-center justify-center mx-auto mb-4"><AlertTriangle size={32} /></div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">{language === 'cn' ? '确认更改任务类型？' : 'Change Task Type?'}</h3>
                    <p className="text-gray-500 mb-4 text-sm">{language === 'cn' ? '任务将被重置到新工作流的起始阶段，状态将变为“未开始”。现有数据不会丢失，但可能在某些阶段隐藏。' : 'Task will be reset to the start of the new workflow. Status will be reset. Data is preserved but may be hidden.'}</p>
                    <div className="bg-yellow-50 text-yellow-800 text-xs p-3 rounded-lg mb-8 border border-yellow-100 text-left"><strong>To:</strong> {taskTypes.find(t => t.id === pendingTypeId)?.name}</div>
                    <div className="flex gap-3">
                        <button onClick={() => { setShowTypeChangeConfirm(false); setPendingTypeId(null); }} className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-colors text-sm">{t.cancel}</button>
                        <button onClick={confirmTypeChange} className="flex-1 py-3 bg-yellow-500 text-white font-bold rounded-xl hover:bg-yellow-600 transition-colors shadow-lg shadow-yellow-200 text-sm">{language === 'cn' ? '确认更改' : 'Confirm Change'}</button>
                    </div>
                </div>
            </div>
        )}

        {showOutputDebug && (
            <div className="absolute inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-white rounded-xl shadow-2xl w-[800px] animate-fade-in-up border border-gray-200 overflow-hidden flex flex-col max-h-[85vh]">
                    <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                        <h3 className="font-bold text-gray-800 flex items-center gap-2"><Bug size={18}/> Automation Debug Log</h3>
                        <button onClick={() => setShowOutputDebug(false)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
                    </div>
                    {/* Error Banner */}
                    {lastRunResult?.error && (
                        <div className="p-4 bg-red-50 border-b border-red-100 text-red-700 text-sm">
                            <div className="font-bold mb-1 flex items-center"><AlertCircle size={14} className="mr-1"/> Execution Failed</div>
                            <div className="font-mono text-xs">{JSON.stringify(lastRunResult.error, null, 2)}</div>
                        </div>
                    )}
                    <div className="flex-1 overflow-auto custom-scrollbar p-6 space-y-6 bg-slate-50">
                        {lastRunResult?.steps?.map((step: any, i: number) => (
                            <div key={i} className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                                {/* ... (Debug Log UI Preserved) ... */}
                                <div className="p-3 bg-gray-50 border-b border-gray-100 flex justify-between items-center">
                                    <div className="font-bold text-sm text-gray-800 flex items-center gap-2">
                                        <span className="bg-indigo-100 text-indigo-700 w-6 h-6 rounded flex items-center justify-center text-xs">{i+1}</span>
                                        {step.name}
                                    </div>
                                    <span className="text-[10px] font-mono text-gray-400">{step.type}</span>
                                </div>
                                <div className="p-4 space-y-4">
                                    <div>
                                        <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Constructed Prompt</label>
                                        <pre className="text-xs font-mono text-gray-600 whitespace-pre-wrap bg-gray-50 p-2 rounded border border-gray-100 max-h-32 overflow-y-auto">
                                            {step.requestPayload?.contents?.parts?.[0]?.text || step.requestPayload?.prompt || "No prompt text found in payload"}
                                        </pre>
                                    </div>
                                    {/* NEW: Request Payload Debugging */}
                                    {step.requestPayload && (
                                        <div>
                                            <label className="text-[10px] font-bold text-indigo-400 uppercase mb-1 flex items-center gap-1"><Eye size={10}/> Request Payload (Config)</label>
                                            <div className="bg-indigo-50/50 border border-indigo-100 rounded p-2 max-h-32 overflow-y-auto">
                                                <pre className="text-xs font-mono text-indigo-700 whitespace-pre-wrap break-all">
                                                    {JSON.stringify(step.requestPayload, null, 2)}
                                                </pre>
                                            </div>
                                        </div>
                                    )}
                                    <div>
                                        <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Output Data</label>
                                        <pre className="text-xs font-mono text-green-600 whitespace-pre-wrap bg-green-50/50 p-2 rounded border border-green-100 max-h-48 overflow-y-auto">
                                            {step.output && step.output.startsWith('data:image') 
                                                ? <img src={step.output || undefined} className="w-48 rounded border border-gray-300" />
                                                : JSON.stringify(step.output, null, 2)
                                            }
                                        </pre>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        )}

        {/* LIGHTBOX PREVIEW */}
        {previewAsset && (
            <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4 animate-fade-in-up" onClick={() => setPreviewAsset(null)}>
                <button className="absolute top-6 right-6 text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors">
                    <X size={32} strokeWidth={1.5} />
                </button>
                <div className="max-w-7xl max-h-[90vh] w-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                    {previewAsset.type === 'image' ? (
                        <img src={previewAsset.url || undefined} className="max-w-full max-h-[85vh] rounded-lg shadow-2xl object-contain"/>
                    ) : (
                        <video src={previewAsset.url || undefined} controls autoPlay className="max-w-full max-h-[85vh] rounded-lg shadow-2xl outline-none"/>
                    )}
                </div>
            </div>
        )}

        {/* Share Task Modal */}
        <ShareTaskModal
            isOpen={showShareModal}
            onClose={() => setShowShareModal(false)}
            task={formData}
            stageId={activeStageId}
            stageFields={activeStageFields}
            onGenerateLink={handleGenerateShareLink}
            onRevokeLink={handleRevokeShareLink}
            language={language}
        />
      </div>
    </div>
  );
};
