
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Workflow, Plus, Trash2, Save, Settings, ChevronRight, ArrowRight, Database, Bot, Zap, Variable, Play, CheckCircle, Loader2, X, AlertCircle, FileText, Image as ImageIcon, Maximize2, Edit3, GripHorizontal, MousePointerClick, Link as LinkIcon, UploadCloud, AlertTriangle, Video, Type, FileType, GripVertical, FileJson, Code, Eye, Layers, Bug, MessageSquare, Send, Sparkles, Wand2, PlusCircle, Check } from 'lucide-react';
import { FieldDefinition, PromptFlow, PromptNode, PromptEdge, InputType, AiModelType } from '../types';
import { Language, translations } from '../i18n';
import { db } from '../services/db';
import { GoogleGenAI, Type as GenAiType } from "@google/genai";

interface PromptBuilderViewProps {
  language: Language;
  allFields: FieldDefinition[];
}

// --- TYPES FOR COPILOT ---
interface ChatMessage {
    id: string;
    role: 'user' | 'ai' | 'system';
    content: string;
    actions?: CopilotAction[]; // Actions suggested by AI
}

interface CopilotAction {
    type: 'ADD_NODE' | 'UPDATE_NODE' | 'CONNECT_NODES' | 'UPDATE_PROMPT';
    payload: any;
    description: string;
    applied?: boolean;
}

// --- HELPER: Field Categorization ---
type OutputCategory = 'text' | 'image' | 'video';

const getFieldCategory = (field?: FieldDefinition): OutputCategory => {
    if (!field) return 'text';
    if (field.type === 'video') return 'video';
    if (field.type === 'image') return 'image';
    return 'text'; 
};

// Check if model supports visual inputs (All Gemini models do now)
const supportsMultimodalInput = (model: string) => {
    if (!model || typeof model !== 'string') return false;
    return model.includes('gemini') || model.includes('veo');
};

// --- HELPER: Model Options ---
const getModelsForCategory = (category: OutputCategory): { value: AiModelType, label: string }[] => {
    switch (category) {
        case 'video':
            return [
                { value: 'veo-3.1-generate-preview', label: 'Veo 3.1 (High Quality, Multi-Ref)' },
                { value: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast' }
            ];
        case 'image':
            return [
                { value: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image (Best)' },
                { value: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' }
            ];
        case 'text':
        default:
            return [
                { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro (Complex Text & Vision)' },
                { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Fast Text & Vision)' }
            ];
    }
};

const getCategoryIcon = (category: OutputCategory, size = 12) => {
    switch (category) {
        case 'video': return <Video size={size} className="text-pink-500" />;
        case 'image': return <ImageIcon size={size} className="text-purple-500" />;
        case 'text': return <Type size={size} className="text-blue-500" />;
    }
};

// Helper: Calculate Bezier Path for Edges
const getEdgePath = (source: {x:number, y:number}, target: {x:number, y:number}) => {
    const deltaX = Math.abs(target.x - source.x);
    const c1 = { x: source.x + deltaX * 0.5, y: source.y };
    const c2 = { x: target.x - deltaX * 0.5, y: target.y };
    return `M ${source.x} ${source.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${target.x} ${target.y}`;
};

// Helper: Parse Data URL with more robust regex
const parseDataUrl = (url: string) => {
    if (!url || typeof url !== 'string') return null;
    // Allow whitespace after comma, and handle potential newlines in base64 data
    const regex = /^data:([^;]+);base64,([\s\S]*)$/; 
    const match = url.match(regex);
    if (match) {
        return { mimeType: match[1], data: match[2].replace(/\s/g, '') }; // Remove all whitespace from base64 data
    }
    return null;
};

// Helper: Convert Blob to Base64 Data URI
const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

// Helper: Resolve Media Input (URL -> Base64) for Execution
const resolveMediaInput = async (input: string): Promise<string | null> => {
    if (!input || typeof input !== 'string') return null;
    
    // If it's already a Data URI, return as is
    if (input.startsWith('data:')) return input;

    // If it's a URL, fetch and convert just-in-time
    if (input.startsWith('http')) {
        try {
            const response = await fetch(input);
            const blob = await response.blob();
            return await blobToBase64(blob);
        } catch (e) {
            console.error("Failed to fetch media from URL during execution", input, e);
            return null;
        }
    }
    
    return input; // Fallback (maybe text or raw ID)
};

// Helper: Sanitize AI Inputs
const ensureArray = (val: any): string[] => {
    if (!val) return [];
    if (Array.isArray(val)) return val.map(String); // Ensure strings
    return [String(val)];
};

// Helper: Auto-detect Media Variables from Input List
const detectMediaVars = (inputs: string[], allFields: FieldDefinition[]) => {
    return inputs.filter(key => {
        const field = allFields.find(f => f.key === key);
        return field?.type === 'image' || field?.type === 'video';
    }).map(key => ({ 
        key, 
        label: allFields.find(f => f.key === key)?.label || key 
    }));
};

// --- DYNAMIC SCHEMA GENERATOR ---
const buildGenAiSchema = (fieldKey: string, allFields: FieldDefinition[]) => {
    const fieldDef = allFields.find(f => f.key === fieldKey);
    // 1. Explicit Schema for Known Fields
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
    if (fieldDef?.type === 'multiselect' || fieldDef?.type === 'folder' && fieldKey === 'tags') {
         return {
             type: GenAiType.ARRAY,
             items: { type: GenAiType.STRING },
             description: "List of tags or keywords"
         };
    }
    // 2. Default for Custom/Temp Fields (Assume String)
    return { 
        type: GenAiType.STRING, 
        description: fieldDef?.description || `Content for ${fieldDef?.label || fieldKey}` 
    };
};

// --- MODEL CONFIGURATION FACTORY ---
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
    // 2. Video Generation Models
    else if (model.includes('veo')) {
       // Config handled in generateVideos call, but this function can return common configs if needed.
    }
    // 3. Text / Multimodal Models
    else {
        // CRITICAL FIX: Only enforce JSON schema if targetFields exists.
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

export const PromptBuilderView: React.FC<PromptBuilderViewProps> = ({ language, allFields }) => {
  const t = translations[language];
  
  // State
  const [flows, setFlows] = useState<PromptFlow[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  // Graph State
  const [nodes, setNodes] = useState<PromptNode[]>([]);
  const [edges, setEdges] = useState<PromptEdge[]>([]);
  
  // Interaction State
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [connectingSourceId, setConnectingSourceId] = useState<string | null>(null); 
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 }); 
  const [canvasMousePos, setCanvasMousePos] = useState({ x: 0, y: 0 }); 
  const [pan, setPan] = useState({ x: 0, y: 0 }); 
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanMouse, setLastPanMouse] = useState({ x: 0, y: 0 });

  // Editor State
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [customOutputKey, setCustomOutputKey] = useState(''); // New: Temp Output Input
  const [showJsonPreview, setShowJsonPreview] = useState(false); // Schema JSON
  const [showRequestPreview, setShowRequestPreview] = useState(false); // Payload JSON
  const [uploadingKeys, setUploadingKeys] = useState<Set<string>>(new Set()); // Track uploads in Start Node

  // Copilot State
  const [showCopilot, setShowCopilot] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isCopilotThinking, setIsCopilotThinking] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Delete Confirmation State
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'flow' | 'node', id: string, name?: string } | null>(null);

  // Execution Logs & Debug Info
  const [executionLogs, setExecutionLogs] = useState<Record<string, { status: 'idle'|'running'|'success'|'error', output?: string, error?: string, requestPayload?: any }>>({});

  const canvasRef = useRef<HTMLDivElement>(null);

  // Load flows on mount
  useEffect(() => {
      const loadFlows = async () => {
          setIsLoading(true);
          const data = await db.getPromptFlows();
          setFlows(data);
          if (data.length > 0) setSelectedFlowId(data[0].id);
          setIsLoading(false);
      };
      loadFlows();
  }, []);

  // Sync Local State when Selection Changes
  useEffect(() => {
      if (selectedFlowId) {
          const flow = flows.find(f => f.id === selectedFlowId);
          if (flow) {
              let migratedNodes = flow.nodes || [];
              const migratedEdges = flow.edges || [];
              
              if (migratedNodes.length > 0 && (!migratedNodes[0].position)) {
                  migratedNodes = migratedNodes.map((n, i) => ({
                      ...n,
                      position: { x: 100 + (i * 300), y: 200 }
                  }));
              }
              migratedNodes = migratedNodes.map(n => ({
                  ...n,
                  targetFields: ensureArray(n.targetFields || (n as any).targetField),
                  inputVariables: ensureArray(n.inputVariables)
              }));

              setNodes(migratedNodes);
              setEdges(migratedEdges);
              setExecutionLogs({});
              // Reset Chat when flow changes
              setChatMessages([{
                  id: 'welcome',
                  role: 'ai',
                  content: t.pb_welcome_message
              }]);
          }
      }
  }, [selectedFlowId, flows, language]);

  // Scroll Chat to bottom
  useEffect(() => {
      if (chatScrollRef.current) {
          chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
      }
  }, [chatMessages, showCopilot]);

  // --- AUTOMATION LOGIC ---
  const requiredStartInputs = useMemo(() => {
      if (!nodes.length) return new Set<string>();
      const producedOutputs = new Set<string>();
      const allRequirements = new Set<string>();
      
      nodes.forEach(node => {
          if (node.type === 'start') return;
          (node.targetFields || []).forEach(f => producedOutputs.add(f));
          (node.inputVariables || []).forEach(v => allRequirements.add(v));
      });

      const missing = new Set<string>();
      allRequirements.forEach(req => {
          if (!producedOutputs.has(req)) missing.add(req);
      });
      return missing;
  }, [nodes, edges]);

  useEffect(() => {
      const startNode = nodes.find(n => n.type === 'start');
      if (!startNode) return;

      const currentTestInputs = startNode.data?.testInputs || {};
      const newTestInputs: Record<string, string> = {};
      let hasChanges = false;

      requiredStartInputs.forEach(key => {
          if (currentTestInputs[key] !== undefined) {
              newTestInputs[key] = currentTestInputs[key];
          } else {
              newTestInputs[key] = ''; 
              hasChanges = true;
          }
      });
  }, [requiredStartInputs, nodes]);


  // --- COPILOT LOGIC ---

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

  const handleSendMessage = async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!chatInput.trim()) return;

      const newUserMsg: ChatMessage = {
          id: Date.now().toString(),
          role: 'user',
          content: chatInput
      };

      setChatMessages(prev => [...prev, newUserMsg]);
      setChatInput('');
      setIsCopilotThinking(true);

      try {
          const apiKey = await getApiKey();
          if (!apiKey) {
              alert("API Key is required.");
              setIsCopilotThinking(false);
              return;
          }
          const ai = new GoogleGenAI({ apiKey });
          
          // Construct Context about current graph
          const graphContext = JSON.stringify({
              nodes: nodes.map(n => ({ id: n.id, name: n.name, type: n.type, model: n.model, inputs: n.inputVariables, outputs: n.targetFields })),
              edges: edges
          });

          // Construct available fields context
          const fieldsContext = allFields.map(f => `${f.key} (${f.type})`).join(', ');

          const systemInstruction = `You are an AI Architect Copilot for a node-based workflow builder called DesignFlow.
          Your goal is to help the user build a prompt chain by generating actions to modify the graph.
          
          Current Graph Structure:
          ${graphContext}

          Available Data Fields (can be used as inputs/outputs):
          ${fieldsContext}
          
          Available Models: 
          - 'gemini-3-pro-preview' (Best for reasoning, code, complex text)
          - 'gemini-3-flash-preview' (Fast text generation)
          - 'gemini-3-pro-image-preview' (Image generation)
          - 'veo-3.1-generate-preview' (Video generation)
          
          Instructions:
          1. Analyze the user's request and the current graph.
          2. Return a JSON object with:
             - "message": A short conversational response explaining what you did or asking for clarification.
             - "actions": An array of actions to modify the graph.
          
          Supported Action Types:
          - ADD_NODE: payload includes { id (generate unique if new), name, model, template, inputVariables (array of strings), targetFields (array of strings), position: {x, y} }
          - CONNECT_NODES: payload includes { source (nodeId), target (nodeId) }
          - UPDATE_NODE: payload includes { id, ...any node property to update }
          
          Important:
          - When adding a node, try to position it intelligently relative to existing nodes (e.g., to the right of the last node).
          - If the user asks to "generate an image", use an image model.
          - If the user asks to "describe this image", use a text model and include the image field in inputVariables.
          `;

          const response = await ai.models.generateContent({
              model: 'gemini-3-flash-preview',
              contents: newUserMsg.content,
              config: {
                  systemInstruction: systemInstruction,
                  responseMimeType: 'application/json'
              }
          });

          db.logModelUsage('PromptBuilder', 'gemini-3-flash-preview', { type: 'chat', config: { systemInstruction: '...' } }).catch(console.error);

          const responseText = response.text || '{}';
          const parsed = JSON.parse(responseText);

          const newAiMsg: ChatMessage = {
              id: (Date.now() + 1).toString(),
              role: 'ai',
              content: parsed.message || "I've analyzed your request.",
              actions: parsed.actions?.map((a: any) => ({ ...a, applied: false }))
          };

          setChatMessages(prev => [...prev, newAiMsg]);

      } catch (error) {
          console.error("Copilot Error:", error);
          setChatMessages(prev => [...prev, {
              id: Date.now().toString(),
              role: 'system',
              content: "Sorry, I encountered an error processing your request. Please check your API Key configuration."
          }]);
      } finally {
          setIsCopilotThinking(false);
      }
  };

  const executeAction = (action: CopilotAction, messageId: string) => {
      if (action.type === 'ADD_NODE') {
          const newNode: PromptNode = {
              id: action.payload.id || `node-${Date.now()}`,
              type: 'generation',
              name: action.payload.name || `Node ${nodes.length + 1}`,
              model: action.payload.model || 'gemini-3-flash-preview',
              template: action.payload.template || '',
              inputVariables: action.payload.inputVariables || [],
              targetFields: action.payload.targetFields || [],
              position: action.payload.position || { x: 200, y: 200 },
              data: { mediaVariables: [] }
          };
          // Adjust position if it overlaps or is default
          if (!action.payload.position && nodes.length > 0) {
              const lastNode = nodes[nodes.length - 1];
              newNode.position = { x: lastNode.position.x + 350, y: lastNode.position.y };
          }
          setNodes(prev => [...prev, newNode]);
      } 
      else if (action.type === 'CONNECT_NODES') {
          const newEdge: PromptEdge = {
              id: `edge-${Date.now()}-${Math.random().toString(36).substr(2,9)}`,
              source: action.payload.source,
              target: action.payload.target
          };
          // Prevent duplicates
          const exists = edges.some(e => e.source === newEdge.source && e.target === newEdge.target);
          if (!exists) {
              setEdges(prev => [...prev, newEdge]);
          }
      } 
      else if (action.type === 'UPDATE_NODE') {
          setNodes(prev => prev.map(n => n.id === action.payload.id ? { ...n, ...action.payload } : n));
      }

      markActionApplied(messageId, action);
  };

  const handleApplyAll = (actions: CopilotAction[], messageId: string) => {
      actions.forEach(action => {
          if (!action.applied) {
              executeAction(action, messageId);
          }
      });
  };

  const markActionApplied = (messageId: string, action: CopilotAction) => {
      setChatMessages(prev => prev.map(msg => {
          if (msg.id !== messageId) return msg;
          const newActions = msg.actions?.map(a => a === action ? { ...a, applied: true } : a);
          // If applying all, checking reference might fail, so we might need index or ID logic, 
          // but for simple cases strict equality works if passed from map
          // Ideally action should have an ID. For now, simple update:
          return { ...msg, actions: newActions };
      }));
  };


  // --- GLOBAL EVENT LISTENERS ---
  useEffect(() => {
      const handleGlobalMouseMove = (e: MouseEvent) => {
          setMousePos({ x: e.clientX, y: e.clientY });

          if (canvasRef.current) {
              const rect = canvasRef.current.getBoundingClientRect();
              setCanvasMousePos({ 
                  x: e.clientX - rect.left - pan.x, 
                  y: e.clientY - rect.top - pan.y 
              });
          }

          if (draggingNodeId) {
              setNodes(prev => prev.map(n => 
                  n.id === draggingNodeId 
                  ? { ...n, position: { x: n.position.x + e.movementX, y: n.position.y + e.movementY } } 
                  : n
              ));
          }

          if (isPanning) {
              const deltaX = e.clientX - lastPanMouse.x;
              const deltaY = e.clientY - lastPanMouse.y;
              setPan(p => ({ x: p.x + deltaX, y: p.y + deltaY }));
              setLastPanMouse({ x: e.clientX, y: e.clientY });
          }
      };

      const handleGlobalMouseUp = () => {
          setDraggingNodeId(null);
          setConnectingSourceId(null);
          setIsPanning(false);
      };

      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);

      return () => {
          window.removeEventListener('mousemove', handleGlobalMouseMove);
          window.removeEventListener('mouseup', handleGlobalMouseUp);
      };
  }, [draggingNodeId, connectingSourceId, isPanning, lastPanMouse, pan]);


  // --- INTERACTION HANDLERS ---

  const handleMouseDownNode = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setDraggingNodeId(id);
  };

  const handleMouseDownOutput = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      e.preventDefault();
      setConnectingSourceId(id);
  };

  const handleMouseUpOnInput = (e: React.MouseEvent, targetId: string) => {
      e.stopPropagation();
      if (connectingSourceId && connectingSourceId !== targetId) {
          const exists = edges.find(e => e.source === connectingSourceId && e.target === targetId);
          const reverseExists = edges.find(e => e.source === targetId && e.target === connectingSourceId);

          if (!exists && !reverseExists) {
              const newEdge: PromptEdge = {
                  id: `edge-${Date.now()}`,
                  source: connectingSourceId,
                  target: targetId
              };
              setEdges(prev => [...prev, newEdge]);
          }
      }
      setConnectingSourceId(null);
  };

  const handleMouseDownCanvas = (e: React.MouseEvent) => {
      if (e.target === canvasRef.current || (e.target as HTMLElement).tagName === 'svg') {
          setIsPanning(true);
          setLastPanMouse({ x: e.clientX, y: e.clientY });
      }
  };

  // --- CRUD HANDLERS ---

  const handleAddFlow = async () => {
      const startNode: PromptNode = {
          id: `start-${Date.now()}`,
          type: 'start',
          name: t.pb_start_trigger,
          model: 'gemini-3-pro-preview',
          inputVariables: [],
          targetFields: [],
          template: '',
          data: { testInputs: {} },
          position: { x: 50, y: 250 }
      };

      const newFlow: PromptFlow = {
          id: `flow-${Date.now()}`,
          name: t.pb_new_workflow,
          description: t.pb_new_workflow_desc,
          nodes: [startNode],
          edges: [],
          isActive: true
      };
      setFlows([newFlow, ...flows]);
      setSelectedFlowId(newFlow.id);
      await db.savePromptFlow(newFlow);
  };

  const requestDeleteFlow = (id: string, name: string) => {
      setDeleteTarget({ type: 'flow', id, name });
  };

  const requestDeleteNode = (id: string) => {
      const node = nodes.find(n => n.id === id);
      if (node?.type === 'start') {
          alert("Cannot delete the Start Trigger node.");
          return;
      }
      setDeleteTarget({ type: 'node', id, name: node?.name });
  };

  const handleDeleteEdge = (id: string) => {
      setEdges(edges.filter(e => e.id !== id));
  };

  const confirmDelete = async () => {
      if (!deleteTarget) return;

      if (deleteTarget.type === 'flow') {
          await db.deletePromptFlow(deleteTarget.id);
          const remaining = flows.filter(f => f.id !== deleteTarget.id);
          setFlows(remaining);
          if(selectedFlowId === deleteTarget.id) setSelectedFlowId(remaining[0]?.id || '');
      } else if (deleteTarget.type === 'node') {
          setNodes(prev => prev.filter(n => n.id !== deleteTarget.id));
          setEdges(prev => prev.filter(e => e.source !== deleteTarget.id && e.target !== deleteTarget.id));
          if(editingNodeId === deleteTarget.id) setEditingNodeId(null);
      }
      
      setDeleteTarget(null);
  };

  const handleSaveFlow = async () => {
      if(!selectedFlowId) return;
      const currentMeta = flows.find(f => f.id === selectedFlowId)!;
      
      const updatedFlow: PromptFlow = {
          ...currentMeta,
          nodes: nodes, 
          edges: edges
      };
      
      setIsSaving(true);
      await db.savePromptFlow(updatedFlow);
      setFlows(prev => prev.map(f => f.id === updatedFlow.id ? updatedFlow : f));
      setIsSaving(false);
  };

  const handleAddNode = () => {
      if (!selectedFlowId) return;
      const centerX = -pan.x + (canvasRef.current ? canvasRef.current.clientWidth / 2 : 200) - 100; 
      const centerY = -pan.y + (canvasRef.current ? canvasRef.current.clientHeight / 2 : 200) - 50;

      const newNode: PromptNode = {
          id: `node-${Date.now()}`,
          type: 'generation',
          name: `${t.pb_action} ${nodes.length}`,
          model: 'gemini-3-pro-preview', 
          inputVariables: [],
          targetFields: [],
          template: '',
          position: { x: centerX, y: centerY },
          data: { mediaVariables: [] } 
      };
      setNodes([...nodes, newNode]);
      setEditingNodeId(newNode.id);
  };

  const updateNodeData = (id: string, data: Partial<PromptNode>) => {
      setNodes(nodes.map(n => n.id === id ? { ...n, ...data } : n));
  };

  const updateStartNodeTestInput = (key: string, value: string) => {
      if (!editingNode || editingNode.type !== 'start') return;
      const currentData = editingNode.data || { testInputs: {} };
      const currentInputs = currentData.testInputs || {};
      
      updateNodeData(editingNode.id, {
          data: {
              ...currentData,
              testInputs: {
                  ...currentInputs,
                  [key]: value
              }
          }
      });
  };

  // UPDATED: Uploads file to storage and saves URL instead of Base64
  const handleFileUploadMock = async (key: string, file: File) => {
      setUploadingKeys(prev => new Set(prev).add(key));
      try {
          const url = await db.uploadFile(file);
          updateStartNodeTestInput(key, url); 
      } catch (e) {
          console.error("Upload failed", e);
          alert("Failed to upload file.");
      } finally {
          setUploadingKeys(prev => {
              const next = new Set(prev);
              next.delete(key);
              return next;
          });
      }
  };

  const updateFlowMeta = (updates: Partial<PromptFlow>) => {
      setFlows(flows.map(f => f.id === selectedFlowId ? { ...f, ...updates } : f));
  };

  // --- HELPER: Visual Refs Data Structure ---
  const getMediaVars = (node: PromptNode): { key: string, label: string }[] => {
      const raw = node.data?.mediaVariables || [];
      if (raw.length > 0 && typeof raw[0] === 'string') {
          return raw.map((k: string) => ({ key: k, label: 'Reference' }));
      }
      return raw as { key: string, label: string }[];
  };

  const getJsonSchemaPreview = () => {
      if (!editingNode || !editingNode.targetFields || editingNode.targetFields.length === 0) return "{}";
      const schema = { type: "OBJECT", properties: {} as any, required: editingNode.targetFields };
      editingNode.targetFields.forEach(key => {
          schema.properties[key] = buildGenAiSchema(key, allFields);
      });
      return JSON.stringify(schema, null, 2);
  };

  // --- DROP HANDLER FOR VISUAL REFS ---
  const handleDropMedia = (e: React.DragEvent) => {
      e.preventDefault();
      if (!editingNode) return;
      const data = e.dataTransfer.getData('text/plain'); // "{{key}}"
      const key = data.replace(/{{|}}/g, '');
      
      // Validate key exists in inputs
      if (!editingNode.inputVariables.includes(key)) return;
      
      const currentMedia = getMediaVars(editingNode);
      if (currentMedia.some(m => m.key === key)) return;

      updateNodeData(editingNode.id, {
          data: { 
              ...editingNode.data, 
              mediaVariables: [...currentMedia, { key, label: '' }] 
          }
      });
  };

  // --- CUSTOM OUTPUT HANDLER ---
  const handleAddCustomOutput = () => {
      if (!editingNode || !customOutputKey.trim()) return;
      const key = customOutputKey.trim().replace(/\s+/g, '_');
      
      // Prevent duplicates
      if (editingNode.targetFields.includes(key)) {
          setCustomOutputKey('');
          return;
      }

      const newTargets = [...editingNode.targetFields, key];
      updateNodeData(editingNode.id, { targetFields: newTargets });
      setCustomOutputKey('');
  };

  // --- GRAPH EXECUTION ---

  const executeGraph = async () => {
      const apiKey = await getApiKey(); 
      if (!apiKey) { alert("API_KEY missing"); return; }
      const ai = new GoogleGenAI({ apiKey });

      const startNode = nodes.find(n => n.type === 'start');
      if (!startNode) {
          alert("No Start Node found in this flow.");
          return;
      }

      setIsRunning(true);
      setExecutionLogs({}); 
      
      const context: Record<string, string> = {};
      const testInputs = startNode.data?.testInputs || {};
      
      Array.from(requiredStartInputs).forEach((key: any) => {
          context[key] = testInputs[key] || ''; 
      });
      
      setExecutionLogs(prev => ({...prev, [startNode.id]: { status: 'success', output: 'Triggered' }}));

      const nodeStatus: Record<string, 'pending' | 'running' | 'completed' | 'error'> = {};
      nodes.forEach(n => nodeStatus[n.id] = n.type === 'start' ? 'completed' : 'pending');
      
      let active = true;

      while(active) {
          const runnable: PromptNode[] = [];
          
          for(const node of nodes) {
              if (nodeStatus[node.id] !== 'pending') continue;
              const parentEdges = edges.filter(e => e.target === node.id);
              if (parentEdges.length === 0) continue; 
              const allParentsDone = parentEdges.every(e => nodeStatus[e.source] === 'completed');
              if (allParentsDone) runnable.push(node);
          }

          if (runnable.length === 0) {
              const anyRunning = Object.values(nodeStatus).includes('running');
              if (!anyRunning) active = false; 
              else await new Promise(r => setTimeout(r, 500));
              continue; 
          }

          // Force Sequential Execution within the runnable batch to avoid rate limits
          for (const node of runnable) {
              nodeStatus[node.id] = 'running';
              setExecutionLogs(prev => ({...prev, [node.id]: { status: 'running' }}));

              try {
                  // 1. Prepare Context & Prompt
                  let filledPrompt = node.template;
                  // Ensure array
                  (node.inputVariables || []).forEach(v => {
                      const val = context[v] || `[Missing ${v}]`;
                      filledPrompt = filledPrompt.replace(new RegExp(`{{${v}}}`, 'g'), val);
                  });

                  let contextHeader = '';
                  if (node.inputVariables && node.inputVariables.length > 0) {
                      const definitions = node.inputVariables.map(key => {
                          const field = allFields.find(f => f.key === key);
                          return field && field.description ? `- ${key}: ${field.description}` : null;
                      }).filter(Boolean);
                      if (definitions.length > 0) {
                          contextHeader = `[Context Definitions - Business Data Meanings]\n${definitions.join('\n')}\n\n`;
                      }
                  }
                  
                  const finalPromptText = contextHeader + filledPrompt;

                  // 3. Execution
                  let outputText = '';
                  const targetFields = node.targetFields || [];
                  const mediaVars = getMediaVars(node);
                  let requestPayload: any = {};

                  // PRE-PROCESS: RESOLVE MEDIA URLs TO BASE64
                  const resolvedMediaVars = await Promise.all(mediaVars.map(async (item) => {
                      const val = context[item.key];
                      const resolvedData = await resolveMediaInput(typeof val === 'string' ? val : ''); 
                      return { ...item, resolvedData };
                  }));

                  if (node.model.includes('veo')) {
                      // VEO: Video Generation
                      const isMultiRef = node.model === 'veo-3.1-generate-preview';
                      const userConfig = node.data?.config || {};
                      
                      const payload: any = {
                          model: node.model,
                          prompt: finalPromptText,
                          config: { 
                              numberOfVideos: 1, 
                              resolution: userConfig.resolution || '720p', 
                              aspectRatio: userConfig.aspectRatio || '16:9' 
                          }
                      };

                      if (resolvedMediaVars.length > 0) {
                          if (isMultiRef) {
                              payload.config.referenceImages = resolvedMediaVars.map(m => {
                                  const parsed = parseDataUrl(m.resolvedData || '');
                                  if (!parsed) return null;
                                  return {
                                      image: { imageBytes: parsed.data, mimeType: parsed.mimeType },
                                      referenceType: 'ASSET'
                                  };
                              }).filter(Boolean);
                          } else {
                              const firstImage = resolvedMediaVars[0];
                              const parsed = parseDataUrl(firstImage.resolvedData || '');
                              if (parsed) {
                                  payload.image = { imageBytes: parsed.data, mimeType: parsed.mimeType };
                              }
                          }
                      }
                      
                      requestPayload = payload;
                      setExecutionLogs(prev => ({...prev, [node.id]: { ...prev[node.id], requestPayload }}));

                      let operation = await ai.models.generateVideos(payload);
                      while (!operation.done) {
                          await new Promise(resolve => setTimeout(resolve, 5000));
                          operation = await ai.operations.getVideosOperation({operation: operation});
                      }
                      const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
                      if(downloadLink) outputText = downloadLink;
                      else throw new Error("Video generation failed or returned no URI");
                  } 
                  else {
                      // GEMINI (Text/Vision/Image) - Unified Multipart Logic
                      const parts: any[] = [{ text: finalPromptText }];
                      
                      resolvedMediaVars.forEach(item => {
                          const rawData = item.resolvedData;
                          if (!rawData) {
                              parts.push({ text: `\n[System Warning: Media variable '${item.key}' is empty or undefined.]` });
                              return;
                          }

                          const parsed = parseDataUrl(rawData);
                          if (parsed) {
                              // Interleave Labels if present to give context
                              if (item.label) parts.push({ text: `\n[Reference Image: ${item.label}]` });
                              
                              parts.push({
                                  inlineData: { mimeType: parsed.mimeType, data: parsed.data }
                              });
                          } else {
                              parts.push({ text: `\n[System Warning: Media variable '${item.key}' contains invalid or corrupted Data URI format.]` });
                          }
                      });

                      // --- CONFIGURATION FACTORY ---
                      // Pass userConfig from node.data.config
                      const config = getModelConfig(node.model, targetFields, allFields, node.data?.config);

                      requestPayload = { model: node.model, contents: { parts }, config };
                      setExecutionLogs(prev => ({...prev, [node.id]: { ...prev[node.id], requestPayload }}));

                      const response = await ai.models.generateContent({
                          model: node.model,
                          contents: { parts },
                          config
                      });

                      db.logModelUsage('PromptBuilder', node.model, { type: 'node_execution', config }).catch(console.error);

                      if (node.model.includes('image')) {
                          const resParts = response.candidates?.[0]?.content?.parts || [];
                          const imgPart = resParts.find((p: any) => p.inlineData);
                          outputText = imgPart ? `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}` : "No image generated";
                      } else {
                          // Improved Text Handling: Check for JSON or fallback to raw
                          const rawText = response.text || '';
                          outputText = rawText; // Default to full output

                          if (targetFields.length > 0) {
                              try {
                                  const parsedData = JSON.parse(rawText);
                                  Object.keys(parsedData).forEach(key => {
                                      if (targetFields.includes(key)) context[key] = parsedData[key];
                                  });
                              } catch (e) {
                                  // Fallback: If JSON parse fails but we have exactly 1 target field,
                                  // assume the model returned raw text for that field.
                                  if (targetFields.length === 1) {
                                      context[targetFields[0]] = rawText;
                                  }
                              }
                          }
                      }
                  }

                  // If this node produced an image output (e.g. Gemini Image or Veo), update the context
                  // We check logic inside the block above, but double check here for unified output update
                  const isVisualOutput = outputText.startsWith('data:image') || outputText.startsWith('https:');
                  if (isVisualOutput && targetFields.length > 0) {
                       context[targetFields[0]] = outputText;
                  }
                  
                  nodeStatus[node.id] = 'completed';
                  setExecutionLogs(prev => ({...prev, [node.id]: { status: 'success', output: outputText, requestPayload }}));
              } catch(e: any) {
                  console.error(e);
                  nodeStatus[node.id] = 'error';
                  setExecutionLogs(prev => ({...prev, [node.id]: { status: 'error', error: e.message, requestPayload: prev[node.id]?.requestPayload }}));
              }
          }
      }
      setIsRunning(false);
  };

  // Helper variables
  const selectedFlowMeta = flows.find(f => f.id === selectedFlowId);
  const editingNode = nodes.find(n => n.id === editingNodeId);
  const allFieldsOptions = allFields; 

  const isEditingVisualModel = editingNode && supportsMultimodalInput(editingNode.model);

  return (
    <div className="flex h-full bg-gray-50 overflow-hidden relative">
      
      {/* 1. SIDEBAR: FLOW LIST (No changes) */}
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col shrink-0 z-20 shadow-lg">
          <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h2 className="font-bold text-gray-800 flex items-center gap-2 text-sm">
                  <Workflow size={16} className="text-indigo-600"/> {t.prompt_flows}
              </h2>
              <button onClick={handleAddFlow} className="p-1 bg-white border border-gray-200 text-indigo-600 rounded hover:bg-indigo-50 transition-colors">
                  <Plus size={14} />
              </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {isLoading ? (
                  <div className="flex justify-center p-4"><Loader2 className="animate-spin text-indigo-500" /></div>
              ) : flows.map(flow => (
                  <div 
                      key={flow.id} 
                      onClick={() => setSelectedFlowId(flow.id)}
                      className={`p-2 rounded-lg cursor-pointer border transition-all group ${selectedFlowId === flow.id ? 'bg-indigo-50 border-indigo-200 shadow-sm' : 'bg-white border-transparent hover:border-gray-200 hover:bg-gray-50'}`}
                  >
                      <div className="flex justify-between items-center mb-1">
                          <span className="text-[9px] font-mono text-gray-400">{flow.id.slice(-4)}</span>
                          <button 
                              onClick={(e) => { e.stopPropagation(); requestDeleteFlow(flow.id, flow.name); }}
                              className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                              <Trash2 size={12} />
                          </button>
                      </div>
                      <div className={`font-bold text-xs ${selectedFlowId === flow.id ? 'text-indigo-900' : 'text-gray-700'}`}>{flow.name}</div>
                      <div className="flex items-center gap-1 mt-1">
                          <span className="text-[9px] bg-gray-100 text-gray-500 px-1 rounded">{flow.nodes?.length || 0} nodes</span>
                          {flow.nodes.some(n => n.type === 'start') && <span className="text-[9px] bg-green-50 text-green-600 px-1 rounded flex items-center"><Zap size={8} className="mr-0.5"/> Trigger</span>}
                      </div>
                  </div>
              ))}
          </div>
      </div>

      {/* 2. MAIN CANVAS AREA (No changes to canvas render logic) */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative bg-slate-50 min-w-0">
          {selectedFlowId ? (
              <>
                  {/* Toolbar */}
                  <div className="h-14 bg-white border-b border-gray-200 px-4 flex justify-between items-center shrink-0 z-10 shadow-sm">
                      <div className="flex items-center gap-2 overflow-hidden">
                          <input 
                              className="font-bold text-gray-800 border-none focus:ring-0 p-0 bg-transparent text-sm w-48 focus:border-b focus:border-indigo-300 truncate"
                              value={selectedFlowMeta?.name || ''}
                              onChange={(e) => updateFlowMeta({ name: e.target.value })}
                          />
                          <span className="text-gray-300">|</span>
                          <input 
                              className="text-xs text-gray-500 border-none focus:ring-0 p-0 w-64 bg-transparent focus:border-b focus:border-indigo-300 truncate"
                              value={selectedFlowMeta?.description || ''}
                              onChange={(e) => updateFlowMeta({ description: e.target.value })}
                              placeholder="Description..."
                          />
                      </div>
                      <div className="flex gap-2 shrink-0">
                          {/* COPILOT TOGGLE */}
                          <button
                              onClick={() => { setShowCopilot(!showCopilot); setEditingNodeId(null); }}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-bold transition-colors shadow-sm text-xs ${showCopilot ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-600 border border-indigo-200 hover:bg-indigo-50'}`}
                          >
                              <MessageSquare size={14} /> {t.pb_copilot}
                          </button>

                          <button 
                              onClick={executeGraph} 
                              disabled={isRunning}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-bold transition-colors shadow-sm text-xs ${isRunning ? 'bg-gray-100 text-gray-400' : 'bg-green-600 text-white hover:bg-green-700'}`}
                          >
                              {isRunning ? <Loader2 size={14} className="animate-spin"/> : <Play size={14} />} {t.btn_run_test}
                          </button>
                          <button onClick={handleSaveFlow} disabled={isSaving} className="flex items-center gap-1.5 bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded-md font-bold hover:bg-gray-50 transition-colors shadow-sm text-xs">
                              {isSaving ? <Loader2 className="animate-spin" size={14}/> : <Save size={14} />} {t.save}
                          </button>
                          <button onClick={handleAddNode} className="flex items-center gap-1.5 bg-indigo-600 text-white px-3 py-1.5 rounded-md font-bold hover:bg-indigo-700 transition-colors shadow-sm text-xs">
                              <Plus size={14} /> {t.pb_action}
                          </button>
                      </div>
                  </div>

                  {/* INFINITE CANVAS */}
                  <div 
                      ref={canvasRef}
                      className={`flex-1 overflow-hidden relative ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
                      onMouseDown={handleMouseDownCanvas}
                      style={{
                          backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)',
                          backgroundSize: '20px 20px',
                          backgroundPosition: `${pan.x}px ${pan.y}px`
                      }}
                  >
                      {/* SVG LAYER FOR EDGES */}
                      <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
                          <defs>
                              <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                                  <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
                              </marker>
                              <marker id="arrowhead-active" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                                  <polygon points="0 0, 10 3.5, 0 7" fill="#6366f1" />
                              </marker>
                          </defs>
                          <g transform={`translate(${pan.x}, ${pan.y})`}>
                              {edges.map(edge => {
                                  const sourceNode = nodes.find(n => n.id === edge.source);
                                  const targetNode = nodes.find(n => n.id === edge.target);
                                  if (!sourceNode || !targetNode) return null;
                                  
                                  const sPos = { x: sourceNode.position.x + 240, y: sourceNode.position.y + 60 };
                                  const tPos = { x: targetNode.position.x, y: targetNode.position.y + 60 };
                                  
                                  return (
                                      <g key={edge.id} className="group pointer-events-auto">
                                          <path 
                                              d={getEdgePath(sPos, tPos)} 
                                              stroke="transparent" 
                                              strokeWidth="20" 
                                              fill="none" 
                                              className="cursor-pointer"
                                              onDoubleClick={() => handleDeleteEdge(edge.id)} 
                                          >
                                              <title>Double click to remove</title>
                                          </path>
                                          <path 
                                              d={getEdgePath(sPos, tPos)} 
                                              stroke="#cbd5e1" 
                                              strokeWidth="3" 
                                              fill="none" 
                                              markerEnd="url(#arrowhead)"
                                              className="group-hover:stroke-red-400 transition-colors pointer-events-none"
                                          />
                                      </g>
                                  );
                              })}
                              {connectingSourceId && (
                                  (() => {
                                      const sourceNode = nodes.find(n => n.id === connectingSourceId);
                                      if(sourceNode) {
                                          const sPos = { x: sourceNode.position.x + 240, y: sourceNode.position.y + 60 };
                                          return <path d={getEdgePath(sPos, canvasMousePos)} stroke="#6366f1" strokeWidth="2" strokeDasharray="5,5" fill="none" markerEnd="url(#arrowhead-active)"/>;
                                      }
                                  })()
                              )}
                          </g>
                      </svg>

                      {/* HTML LAYER FOR NODES */}
                      <div className="absolute inset-0 pointer-events-none" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
                          {nodes.map(node => {
                              const logs = executionLogs[node.id];
                              const isError = logs?.status === 'error';
                              const isSuccess = logs?.status === 'success';
                              const isRunning = logs?.status === 'running';
                              const isSelected = editingNodeId === node.id;
                              const isStart = node.type === 'start';
                              
                              const isConnecting = !!connectingSourceId;
                              const isSelf = connectingSourceId === node.id;

                              return (
                                  <div 
                                      key={node.id}
                                      className={`absolute pointer-events-auto w-60 rounded-xl shadow-lg border-2 flex flex-col group transition-transform duration-75 
                                      ${isSelected ? 'border-indigo-500 ring-4 ring-indigo-500/10 z-20' : isError ? 'border-red-400' : isRunning ? 'border-indigo-400' : isSuccess ? 'border-green-400' : 'border-slate-200 hover:border-slate-300'}
                                      ${isStart ? 'bg-emerald-50 border-emerald-200' : 'bg-white'}
                                      `}
                                      style={{ left: node.position.x, top: node.position.y }}
                                      onClick={() => { setEditingNodeId(node.id); setShowCopilot(false); }}
                                  >
                                      {/* Input Handle */}
                                      {!isStart && (
                                          <div 
                                              className="absolute -left-4 top-[50px] w-8 h-8 flex items-center justify-center z-30 pointer-events-auto"
                                              onMouseUp={(e) => handleMouseUpOnInput(e, node.id)}
                                          >
                                              <div className={`w-3.5 h-3.5 rounded-full border-2 transition-all ${isConnecting && !isSelf ? 'bg-indigo-100 border-indigo-500 scale-125 animate-pulse' : 'bg-slate-100 border-slate-300 group-hover:border-slate-400'}`}></div>
                                          </div>
                                      )}

                                      {/* Output Handle */}
                                      <div 
                                          className="absolute -right-4 top-[50px] w-8 h-8 flex items-center justify-center z-30 cursor-crosshair pointer-events-auto"
                                          onMouseDown={(e) => handleMouseDownOutput(e, node.id)}
                                      >
                                          <div className={`w-3.5 h-3.5 border-2 rounded-full hover:bg-indigo-500 hover:border-indigo-600 transition-colors ${isStart ? 'bg-emerald-100 border-emerald-400' : 'bg-slate-100 border-slate-300'}`}></div>
                                      </div>

                                      {/* Header */}
                                      <div 
                                          className={`p-3 border-b rounded-t-lg cursor-grab active:cursor-grabbing flex justify-between items-center ${isStart ? 'bg-emerald-100 border-emerald-200' : 'border-slate-100 bg-white'}`}
                                          onMouseDown={(e) => handleMouseDownNode(e, node.id)}
                                      >
                                          <div className="flex items-center gap-2 overflow-hidden">
                                              {isRunning ? <Loader2 size={14} className="animate-spin text-indigo-600"/> : isSuccess ? <CheckCircle size={14} className="text-green-500"/> : isStart ? <Zap size={14} className="text-emerald-600 fill-emerald-100"/> : <Bot size={14} className="text-slate-400"/>}
                                              <span className={`text-xs font-bold truncate ${isStart ? 'text-emerald-800' : 'text-slate-700'}`}>{node.name}</span>
                                          </div>
                                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                              <Edit3 size={12} className="text-slate-400 cursor-pointer hover:text-indigo-600" onClick={() => setEditingNodeId(node.id)}/>
                                          </div>
                                      </div>

                                      {/* Body */}
                                      <div className={`p-3 rounded-b-lg ${isStart ? 'bg-emerald-50/50' : 'bg-slate-50/50'}`}>
                                          {isStart ? (
                                               <div className="text-[10px] text-emerald-600 italic">
                                                   {t.pb_start_desc}
                                               </div>
                                          ) : (
                                              <>
                                                <div className="text-[10px] font-mono text-slate-500 bg-white px-2 py-1 rounded border border-slate-100 truncate mb-2">
                                                    {(node.model || '').replace('gemini-', '').replace('veo-', 'Veo ').replace('-preview', '')}
                                                </div>
                                                <div className="flex flex-wrap gap-1 mb-2">
                                                    {(node.inputVariables || []).length === 0 && <span className="text-[9px] text-slate-300 italic">{t.pb_no_inputs}</span>}
                                                    {(node.inputVariables || []).slice(0,3).map(v => (
                                                        <span key={v} className="text-[9px] bg-indigo-50 text-indigo-600 px-1 rounded border border-indigo-100">{v}</span>
                                                    ))}
                                                    {(node.inputVariables || []).length > 3 && <span className="text-[9px] text-slate-400">+{node.inputVariables.length-3}</span>}
                                                </div>
                                                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                                                    <div className="flex items-center text-[10px] text-slate-500">
                                                        <ArrowRight size={10} className="mr-1"/>
                                                        <span className="truncate max-w-[100px] font-medium text-indigo-600">
                                                            {node.targetFields && node.targetFields.length > 0 
                                                                ? `${node.targetFields.length} ${t.pb_outputs}` 
                                                                : t.pb_no_outputs
                                                            }
                                                        </span>
                                                    </div>
                                                </div>
                                              </>
                                          )}
                                      </div>
                                  </div>
                              );
                          })}
                      </div>
                  </div>
              </>
          ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-400 bg-slate-50">
                  <Workflow size={64} className="mb-4 text-gray-300" strokeWidth={1.5} />
                  <p>{t.msg_select_flow}</p>
              </div>
          )}
      </div>

      {/* NODE EDITOR SIDEBAR */}
      {editingNode && !showCopilot && (
          <div className="w-96 bg-white border-l border-gray-200 shadow-2xl flex flex-col h-full shrink-0 z-30 animate-fade-in-up">
              <div className={`p-4 border-b border-gray-100 flex justify-between items-center ${editingNode.type === 'start' ? 'bg-emerald-50' : 'bg-gray-50'}`}>
                  <h3 className={`font-bold flex items-center gap-2 text-sm ${editingNode.type === 'start' ? 'text-emerald-800' : 'text-gray-800'}`}>
                      {editingNode.type === 'start' ? <Zap size={16} /> : <Settings size={16}/>}
                      {editingNode.type === 'start' ? t.pb_config_trigger : t.pb_config_node}
                  </h3>
                  <div className="flex items-center gap-1">
                      <button onClick={() => requestDeleteNode(editingNode.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"><Trash2 size={16}/></button>
                      <button onClick={() => setEditingNodeId(null)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded"><X size={18}/></button>
                  </div>
              </div>

              {/* Added pb-20 to ensure content is not cut off at the bottom */}
              <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar pb-20">
                  
                  {/* Name */}
                  <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5">{t.node_name}</label>
                      <input 
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-indigo-500 outline-none"
                          value={editingNode.name}
                          onChange={(e) => updateNodeData(editingNode.id, { name: e.target.value })}
                      />
                  </div>

                  {/* --- START NODE EDITOR: AUTO-CALCULATED INPUTS --- */}
                  {editingNode.type === 'start' && (
                      <div className="space-y-4">
                          <div className="bg-blue-50 text-blue-700 text-xs p-3 rounded-lg border border-blue-100 mb-4">
                              <span className="font-bold block mb-1">{t.pb_context_title}</span>
                              {t.pb_context_desc}
                          </div>
                          
                          {Array.from(requiredStartInputs).length === 0 ? (
                              <div className="text-gray-400 italic text-xs text-center py-4">{t.pb_no_inputs}</div>
                          ) : (
                              Array.from(requiredStartInputs).map((key: any) => {
                                  const fieldDef = allFields.find(f => f.key === key);
                                  const label = fieldDef?.label || key;
                                  const type = fieldDef?.type || 'text';
                                  const val: string = editingNode.data?.testInputs?.[key] || '';

                                  return (
                                      <div key={key} className="space-y-1">
                                          <label className="text-xs font-bold text-gray-700 flex items-center gap-2">
                                              <span className="bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-mono text-[10px]">{key}</span>
                                              {label}
                                          </label>
                                          
                                          {/* Render Input based on Global Registry Type */}
                                          {type === 'image' || type === 'file' || type === 'video' ? (
                                              <div className="border border-gray-300 border-dashed rounded-lg p-3 bg-gray-50 space-y-2">
                                                  {val ? (
                                                      <div className="relative group">
                                                          {type === 'image' ? (
                                                              <img src={val || undefined} className="w-full h-32 object-cover rounded border border-gray-200" alt="Preview"/>
                                                          ) : type === 'video' ? (
                                                              <video src={val || undefined} className="w-full h-32 object-cover rounded border border-gray-200" controls />
                                                          ) : (
                                                              <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 p-2 rounded">
                                                                  <LinkIcon size={12}/> <a href={val} target="_blank" className="underline truncate">{val}</a>
                                                              </div>
                                                          )}
                                                          <button 
                                                              onClick={() => updateStartNodeTestInput(key, '')}
                                                              className="absolute top-1 right-1 bg-white rounded-full p-1 shadow-sm text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                                          >
                                                              <X size={12}/>
                                                          </button>
                                                      </div>
                                                  ) : (
                                                      <div className="text-center py-2 text-gray-400 text-xs">
                                                          {uploadingKeys.has(key) ? (
                                                              <div className="flex items-center justify-center gap-2 text-indigo-500">
                                                                  <Loader2 size={14} className="animate-spin"/> {t.pb_uploading}
                                                              </div>
                                                          ) : (
                                                              <span>{t.pb_no_file}</span>
                                                          )}
                                                      </div>
                                                  )}
                                                  
                                                  {!val && !uploadingKeys.has(key) && (
                                                      <label className="flex items-center justify-center gap-2 cursor-pointer bg-white border border-gray-200 py-1.5 rounded text-xs font-medium hover:bg-gray-50 text-gray-600 transition-colors">
                                                          <UploadCloud size={14}/> {t.pb_upload}
                                                          <input type="file" className="hidden" accept={type === 'image' ? "image/*" : type === 'video' ? "video/*" : "*"} onChange={(e) => e.target.files && handleFileUploadMock(key, e.target.files[0])} />
                                                      </label>
                                                  )}
                                              </div>
                                          ) : type === 'textarea' || type === 'richtext' ? (
                                              <textarea 
                                                  className="w-full border border-gray-300 rounded px-2 py-1 text-xs min-h-[60px]"
                                                  value={val}
                                                  onChange={(e) => updateStartNodeTestInput(key, e.target.value)}
                                                  placeholder={t.pb_enter_text}
                                              />
                                          ) : (
                                              <input 
                                                  className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                                                  value={val}
                                                  onChange={(e) => updateStartNodeTestInput(key, e.target.value)}
                                                  type={type === 'number' ? 'number' : 'text'}
                                              />
                                          )}
                                      </div>
                                  );
                              })
                          )}
                      </div>
                  )}

                  {/* --- GENERATION NODE EDITOR --- */}
                  {editingNode.type !== 'start' && (
                      <>
                          {/* 1. INPUTS SELECTION */}
                          <div className="p-3 bg-indigo-50/50 rounded-lg border border-indigo-100">
                              <label className="block text-xs font-bold text-indigo-800 uppercase mb-2 flex items-center gap-1">
                                  <Variable size={12}/> {t.lbl_inputs}
                              </label>
                              
                              <div className="text-[10px] text-gray-500 mb-2">{t.pb_select_vars}</div>
                              <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto custom-scrollbar">
                                  {allFieldsOptions.map(field => {
                                      const isChecked = editingNode.inputVariables.includes(field.key);
                                      const isOutput = editingNode.targetFields?.includes(field.key);
                                      if (isOutput) return null; // Hide if is output

                                      return (
                                          <button 
                                              key={field.key} 
                                              onClick={() => {
                                                  const newInputs = isChecked
                                                      ? editingNode.inputVariables.filter(k => k !== field.key)
                                                      : [...editingNode.inputVariables, field.key];
                                                  updateNodeData(editingNode.id, { inputVariables: newInputs });
                                              }}
                                              className={`px-2 py-1 rounded text-[10px] font-medium border transition-all flex items-center gap-1 ${isChecked ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 hover:border-indigo-300'}`}
                                          >
                                              {field.label}
                                              {isChecked && <CheckCircle size={8} />}
                                          </button>
                                      );
                                  })}
                              </div>
                          </div>

                          {/* 2. OUTPUTS */}
                          <div className="p-3 bg-purple-50/50 rounded-lg border border-purple-100">
                              <label className="block text-xs font-bold text-purple-800 uppercase mb-2 flex items-center gap-1">
                                  <ArrowRight size={12}/> {t.lbl_output}
                              </label>
                              <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto custom-scrollbar mb-2">
                                  {allFieldsOptions.map(field => {
                                      const currentTargets = editingNode.targetFields || [];
                                      const isChecked = currentTargets.includes(field.key);
                                      
                                      // Logic: Cannot select as output if already selected as input
                                      if (editingNode.inputVariables.includes(field.key)) return null;

                                      const category = getFieldCategory(field);
                                      const currentCategory = currentTargets.length > 0 ? getFieldCategory(allFields.find(f => f.key === currentTargets[0])) : null;
                                      
                                      let isDisabled = false;
                                      if (currentCategory) {
                                          if (currentCategory === 'video' && field.key !== currentTargets[0]) isDisabled = true;
                                          if (currentCategory === 'image' && field.key !== currentTargets[0]) isDisabled = true;
                                          if (currentCategory === 'text' && category !== 'text') isDisabled = true;
                                      }

                                      return (
                                          <button 
                                              key={field.key} 
                                              disabled={isDisabled && !isChecked}
                                              onClick={() => {
                                                  let newTargets = [...currentTargets];
                                                  if (category === 'video' || category === 'image') {
                                                      if (isChecked) newTargets = []; 
                                                      else newTargets = [field.key];
                                                  } else {
                                                      if (currentCategory === 'video' || currentCategory === 'image') {
                                                          newTargets = [field.key];
                                                      } else {
                                                          if (isChecked) newTargets = newTargets.filter(k => k !== field.key);
                                                          else newTargets.push(field.key);
                                                      }
                                                  }

                                                  let model: AiModelType = editingNode.model;
                                                  const newCategory = newTargets.length > 0 ? getFieldCategory(allFields.find(f => f.key === newTargets[0])) : 'text';
                                                  const validModels = getModelsForCategory(newCategory).map(m => m.value);
                                                  if (!validModels.includes(model)) model = validModels[0];
                                                  
                                                  updateNodeData(editingNode.id, { targetFields: newTargets, model });
                                              }}
                                              className={`px-2 py-1 rounded text-[10px] font-medium border transition-all flex items-center gap-1.5 
                                              ${isChecked ? 'bg-purple-600 text-white border-purple-600' : isDisabled ? 'opacity-40 cursor-not-allowed bg-gray-50 text-gray-400 border-gray-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                                          >
                                              {getCategoryIcon(category, 10)}
                                              {field.label}
                                              {isChecked && <CheckCircle size={8} className="ml-auto"/>}
                                          </button>
                                      );
                                  })}
                              </div>
                              {/* Custom / Temporary Output Adder */}
                              <div className="mt-2 pt-2 border-t border-purple-200">
                                  <label className="text-[10px] text-purple-700 font-bold mb-1 block">{t.pb_custom_output}</label>
                                  <div className="flex gap-1">
                                      <input 
                                          className="flex-1 text-xs border border-purple-200 rounded px-2 py-1 focus:ring-1 focus:ring-purple-500 outline-none"
                                          placeholder="e.g. summary_chunk"
                                          value={customOutputKey}
                                          onChange={(e) => setCustomOutputKey(e.target.value)}
                                          onKeyDown={(e) => e.key === 'Enter' && handleAddCustomOutput()}
                                      />
                                      <button onClick={handleAddCustomOutput} className="bg-purple-600 text-white p-1 rounded hover:bg-purple-700"><Plus size={14}/></button>
                                  </div>
                                  <div className="flex flex-wrap gap-1 mt-2">
                                      {editingNode.targetFields.filter(tf => !allFields.some(f => f.key === tf)).map(tf => (
                                          <span key={tf} className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded text-[10px] flex items-center border border-purple-200">
                                              {tf}
                                              <button onClick={() => updateNodeData(editingNode.id, { targetFields: editingNode.targetFields.filter(k => k !== tf) })} className="ml-1 hover:text-red-500"><X size={10}/></button>
                                          </span>
                                      ))}
                                  </div>
                              </div>
                          </div>

                          {/* 3. MODEL */}
                          <div>
                              <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5">{t.pb_model}</label>
                              <select 
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-indigo-500 outline-none bg-white"
                                  value={editingNode.model}
                                  onChange={(e) => updateNodeData(editingNode.id, { model: e.target.value as AiModelType })}
                              >
                                  {(() => {
                                      const currentTarget = editingNode.targetFields?.[0];
                                      const currentField = allFields.find(f => f.key === currentTarget);
                                      const category = getFieldCategory(currentField);
                                      return getModelsForCategory(category).map(opt => (
                                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                                      ));
                                  })()}
                              </select>
                          </div>

                          {/* 3.1 MODEL CONFIGURATION (NEW) */}
                          {(editingNode.model.includes('image') || editingNode.model.includes('veo')) && (
                              <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 mt-2 space-y-3">
                                  <label className="block text-xs font-bold text-gray-500 uppercase flex items-center gap-1">
                                      <Settings size={12}/> {t.pb_gen_params}
                                  </label>
                                  
                                  {/* Aspect Ratio */}
                                  <div>
                                      <label className="block text-[10px] text-gray-500 mb-1">{t.pb_aspect_ratio}</label>
                                      <div className="flex flex-wrap gap-1">
                                          {(editingNode.model.includes('veo') ? ["16:9", "9:16"] : ["1:1", "3:4", "4:3", "9:16", "16:9"]).map(ratio => (
                                              <button
                                                  key={ratio}
                                                  onClick={() => {
                                                      const currentConfig = editingNode.data?.config || {};
                                                      updateNodeData(editingNode.id, { 
                                                          data: { ...editingNode.data, config: { ...currentConfig, aspectRatio: ratio } } 
                                                      });
                                                  }}
                                                  className={`px-2 py-1 text-[10px] rounded border ${editingNode.data?.config?.aspectRatio === ratio ? 'bg-indigo-100 border-indigo-300 text-indigo-700 font-bold' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-100'}`}
                                              >
                                                  {ratio}
                                              </button>
                                          ))}
                                      </div>
                                  </div>

                                  {/* Resolution / Size */}
                                  {(!editingNode.model.includes('flash-image')) && (
                                      <div>
                                          <label className="block text-[10px] text-gray-500 mb-1">
                                              {editingNode.model.includes('veo') ? t.pb_resolution : t.pb_image_size}
                                          </label>
                                          <div className="flex flex-wrap gap-1">
                                              {(editingNode.model.includes('veo') ? ["720p", "1080p"] : ["1K", "2K", "4K"]).map(res => (
                                                  <button
                                                      key={res}
                                                      onClick={() => {
                                                          const currentConfig = editingNode.data?.config || {};
                                                          const key = editingNode.model.includes('veo') ? 'resolution' : 'imageSize';
                                                          updateNodeData(editingNode.id, { 
                                                              data: { ...editingNode.data, config: { ...currentConfig, [key]: res } } 
                                                          });
                                                      }}
                                                      className={`px-2 py-1 text-[10px] rounded border ${
                                                          (editingNode.data?.config?.[editingNode.model.includes('veo') ? 'resolution' : 'imageSize'] === res) 
                                                          ? 'bg-indigo-100 border-indigo-300 text-indigo-700 font-bold' 
                                                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-100'
                                                      }`}
                                                  >
                                                      {res}
                                                  </button>
                                              ))}
                                          </div>
                                      </div>
                                  )}
                              </div>
                          )}

                          {/* 4. PROMPT & VISUAL REFERENCES */}
                          <div>
                              {isEditingVisualModel ? (
                                  <>
                                      {/* VISUAL REFERENCES DROP ZONE */}
                                      <div className="mb-4">
                                          <label className="block text-xs font-bold text-indigo-700 uppercase mb-2 flex items-center gap-1">
                                              <Layers size={12}/> {t.pb_visual_refs}
                                          </label>
                                          
                                          {/* DROP TARGET AREA */}
                                          <div 
                                              className="bg-indigo-50/50 rounded-lg border border-indigo-200 border-dashed p-3 min-h-[80px]"
                                              onDragOver={(e) => e.preventDefault()}
                                              onDrop={handleDropMedia}
                                          >
                                              {getMediaVars(editingNode).length === 0 && (
                                                  <div className="text-[10px] text-indigo-400 mb-2 text-center pointer-events-none">
                                                      {t.pb_drag_media}
                                                  </div>
                                              )}
                                              
                                              <div className="space-y-2">
                                                  {getMediaVars(editingNode).map((item, idx) => (
                                                      <div key={item.key} className="flex items-center gap-2 bg-white p-2 rounded border border-indigo-100 shadow-sm">
                                                          <div className="w-6 h-6 bg-indigo-100 rounded flex items-center justify-center shrink-0">
                                                              <ImageIcon size={12} className="text-indigo-600"/>
                                                          </div>
                                                          <div className="flex-1 min-w-0">
                                                              <div className="text-[10px] font-bold text-gray-700 truncate">{allFields.find(f => f.key === item.key)?.label || item.key}</div>
                                                              <input 
                                                                  className="w-full text-[10px] border-b border-gray-200 focus:border-indigo-500 outline-none bg-transparent placeholder-gray-300"
                                                                  placeholder={t.pb_label_placeholder}
                                                                  value={item.label}
                                                                  onChange={(e) => {
                                                                      const newMedia = [...getMediaVars(editingNode)];
                                                                      newMedia[idx].label = e.target.value;
                                                                      updateNodeData(editingNode.id, {
                                                                          data: { ...editingNode.data, mediaVariables: newMedia }
                                                                      });
                                                                  }}
                                                              />
                                                          </div>
                                                          <button 
                                                              onClick={() => {
                                                                  const newMedia = getMediaVars(editingNode).filter((_, i) => i !== idx);
                                                                  updateNodeData(editingNode.id, {
                                                                      data: { ...editingNode.data, mediaVariables: newMedia }
                                                                  });
                                                              }}
                                                              className="text-gray-300 hover:text-red-500 p-1"
                                                          >
                                                              <X size={12}/>
                                                          </button>
                                                      </div>
                                                  ))}
                                              </div>
                                          </div>
                                      </div>
                                      <label className="text-xs font-bold text-gray-500 uppercase block mb-1">{t.pb_text_prompt}</label>
                                  </>
                              ) : (
                                  <div className="flex justify-between items-center mb-2">
                                      <label className="text-xs font-bold text-gray-500 uppercase">{t.pb_prompt_template}</label>
                                      <button 
                                          onClick={() => setShowJsonPreview(true)}
                                          className="text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-1 rounded border border-gray-200 flex items-center transition-colors"
                                          title="View generated JSON structure"
                                      >
                                          <Code size={10} className="mr-1"/> {t.pb_json_preview}
                                      </button>
                                  </div>
                              )}

                              <textarea 
                                  className="w-full h-48 border border-gray-300 rounded-xl p-3 text-xs font-mono focus:ring-2 focus:ring-indigo-500 outline-none resize-none leading-relaxed bg-slate-50 shadow-inner"
                                  placeholder={isEditingVisualModel ? t.pb_prompt_placeholder_visual : t.pb_prompt_placeholder_text}
                                  value={editingNode.template}
                                  onChange={(e) => updateNodeData(editingNode.id, { template: e.target.value })}
                              />
                              
                              {/* Context Variables (Draggable) */}
                              {editingNode.inputVariables.length > 0 && (
                                  <div className="mt-2 flex flex-wrap gap-2 p-2 bg-gray-50 rounded border border-gray-200">
                                      <div className="w-full text-[9px] text-gray-400 font-bold uppercase mb-1 flex items-center gap-1">
                                          <GripHorizontal size={10} /> {t.pb_available_vars}
                                      </div>
                                      {editingNode.inputVariables.map(key => {
                                          const field = allFields.find(f => f.key === key);
                                          const currentMediaKeys = getMediaVars(editingNode).map(m => m.key);
                                          const isMedia = currentMediaKeys.includes(key);
                                          
                                          return (
                                              <div 
                                                  key={key} 
                                                  draggable
                                                  onDragStart={(e) => {
                                                      e.dataTransfer.setData('text/plain', `{{${key}}}`);
                                                      e.dataTransfer.effectAllowed = 'copy';
                                                  }}
                                                  className={`flex items-center px-2 py-1 rounded text-xs font-medium border cursor-grab active:cursor-grabbing hover:shadow-sm transition-all shadow-sm group relative ${isMedia ? 'bg-indigo-100 text-indigo-800 border-indigo-300 opacity-50' : 'bg-white text-gray-700 border-gray-200 hover:border-indigo-400'}`}
                                              >
                                                  <GripVertical size={10} className="mr-1 opacity-50"/>
                                                  {field?.label || key}
                                                  
                                                  {/* Quick Add to Media Action (Fallback) */}
                                                  {isEditingVisualModel && !isMedia && (
                                                      <button 
                                                          onClick={() => {
                                                              const current = getMediaVars(editingNode);
                                                              updateNodeData(editingNode.id, {
                                                                  data: { ...editingNode.data, mediaVariables: [...current, { key, label: '' }] }
                                                              });
                                                          }}
                                                          className="ml-2 text-indigo-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100"
                                                          title={t.pb_use_visual_ref}
                                                      >
                                                          <ImageIcon size={10} />
                                                      </button>
                                                  )}
                                              </div>
                                          )
                                      })}
                                  </div>
                              )}
                          </div>
                      </>
                  )}

                  {/* Result Preview (Shared) */}
                  {executionLogs[editingNode.id] && (
                      <div className="border-t border-gray-100 pt-4">
                          <div className="flex justify-between items-center mb-2">
                              <label className={`block text-xs font-bold uppercase flex items-center gap-1 ${executionLogs[editingNode.id].status === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                                  {executionLogs[editingNode.id].status === 'success' ? <CheckCircle size={12}/> : <AlertCircle size={12}/>}
                                  {t.lbl_output_preview}
                              </label>
                              
                              {/* DEBUG BUTTON */}
                              {executionLogs[editingNode.id].requestPayload && (
                                  <button 
                                      onClick={() => setShowRequestPreview(true)}
                                      className="text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-1 rounded border border-gray-200 flex items-center transition-colors"
                                  >
                                      <Bug size={10} className="mr-1"/> {t.pb_req_debug}
                                  </button>
                              )}
                          </div>
                          
                          {executionLogs[editingNode.id].status === 'success' && (
                              <div className="bg-green-50/50 border border-green-100 rounded-xl p-3 text-xs font-mono text-gray-700 max-h-40 overflow-y-auto">
                                  {executionLogs[editingNode.id].output?.startsWith('data:image') 
                                      ? <img src={executionLogs[editingNode.id].output || undefined} className="w-full rounded border border-gray-200" />
                                      : executionLogs[editingNode.id].output?.startsWith('https:') && (executionLogs[editingNode.id].output?.includes('.mp4') || executionLogs[editingNode.id].output?.includes('googleapis'))
                                        ? <div className="text-center"><a href={executionLogs[editingNode.id].output} target="_blank" className="underline text-blue-600">View Generated Video</a></div>
                                        : <pre className="whitespace-pre-wrap break-all">{executionLogs[editingNode.id].output}</pre>
                                  }
                              </div>
                          )}
                          
                          {executionLogs[editingNode.id].status === 'error' && (
                              <div className="bg-red-50/50 border border-red-100 rounded-xl p-3 text-xs font-mono text-red-700 max-h-40 overflow-y-auto">
                                  {executionLogs[editingNode.id].error}
                              </div>
                          )}
                      </div>
                  )}
              </div>
          </div>
      )}

      {/* --- COPILOT PANEL (Replaces Node Editor when active) --- */}
      {showCopilot && (
          <div className="w-96 bg-white border-l border-gray-200 shadow-2xl flex flex-col h-full shrink-0 z-30 animate-fade-in-up">
              <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-indigo-50">
                  <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white"><Bot size={18}/></div>
                      <div>
                          <h3 className="font-bold text-indigo-900 text-sm">{t.pb_copilot_title}</h3>
                          <div className="text-[10px] text-indigo-500">{t.pb_copilot_subtitle}</div>
                      </div>
                  </div>
                  <button onClick={() => setShowCopilot(false)} className="text-gray-400 hover:text-gray-600 p-1"><X size={18}/></button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-gray-50" ref={chatScrollRef}>
                  {chatMessages.map(msg => (
                      <div key={msg.id} className={`mb-4 flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                              msg.role === 'user' 
                              ? 'bg-indigo-600 text-white rounded-br-none' 
                              : 'bg-white text-gray-800 border border-gray-100 rounded-bl-none'
                          }`}>
                              <div className="whitespace-pre-wrap">{msg.content}</div>
                              
                              {/* ACTION BUTTONS FOR AI SUGGESTIONS */}
                              {msg.actions && msg.actions.length > 0 && (
                                  <div className="mt-3 space-y-2 border-t border-gray-100 pt-2">
                                      {/* Individual Actions */}
                                      {msg.actions.map((action, idx) => (
                                          <div key={idx} className="bg-gray-50 rounded p-2 text-xs border border-gray-200">
                                              <div className="flex items-center gap-2 font-bold text-indigo-700 mb-1">
                                                  <Sparkles size={12}/> {action.type.replace('_', ' ')}
                                              </div>
                                              <p className="text-gray-600 mb-2 truncate" title={action.description}>{action.description}</p>
                                              <button 
                                                  onClick={() => executeAction(action, msg.id)}
                                                  disabled={action.applied}
                                                  className={`w-full py-1.5 rounded font-bold transition-all text-[10px] ${
                                                      action.applied 
                                                      ? 'bg-green-50 text-green-600 cursor-default border border-green-200' 
                                                      : 'bg-white text-indigo-600 border border-indigo-200 hover:bg-indigo-50'
                                                  }`}
                                              >
                                                  {action.applied ? t.pb_applied : t.pb_apply}
                                              </button>
                                          </div>
                                      ))}
                                      {/* Batch Action */}
                                      {msg.actions.length > 1 && !msg.actions.every(a => a.applied) && (
                                          <button 
                                              onClick={() => handleApplyAll(msg.actions!, msg.id)}
                                              className="w-full py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm font-bold text-xs flex items-center justify-center gap-2 mt-2"
                                          >
                                              <Zap size={12}/> {t.pb_apply_all}
                                          </button>
                                      )}
                                  </div>
                              )}
                          </div>
                      </div>
                  ))}
                  {isCopilotThinking && (
                      <div className="flex justify-start mb-4">
                          <div className="bg-white rounded-2xl rounded-bl-none px-4 py-3 border border-gray-100 flex items-center gap-2">
                              <Loader2 size={16} className="animate-spin text-indigo-500"/>
                              <span className="text-xs text-gray-500">{t.pb_analyzing}</span>
                          </div>
                      </div>
                  )}
              </div>

              <div className="p-3 border-t border-gray-100 bg-white">
                  <form onSubmit={handleSendMessage} className="relative">
                      <textarea 
                          className="w-full border border-gray-300 rounded-xl pl-3 pr-10 py-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none max-h-32"
                          placeholder={t.pb_chat_placeholder}
                          rows={2}
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          onKeyDown={(e) => {
                              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                  e.preventDefault();
                                  handleSendMessage();
                              }
                          }}
                      />
                      <button 
                          type="submit" 
                          disabled={!chatInput.trim() || isCopilotThinking}
                          className="absolute right-2 bottom-2.5 p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                      >
                          <Send size={16}/>
                      </button>
                  </form>
                  <div className="text-[9px] text-gray-400 text-right mt-1 px-1">
                      {t.pb_chat_hint}
                  </div>
              </div>
          </div>
      )}

      {/* JSON PREVIEW MODAL */}
      {showJsonPreview && (
          <div className="absolute inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-2xl w-[500px] animate-fade-in-up border border-gray-200 overflow-hidden flex flex-col max-h-[80vh]">
                  <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                      <h3 className="font-bold text-gray-800 flex items-center gap-2"><FileJson size={18}/> {t.pb_json_schema}</h3>
                      <button onClick={() => setShowJsonPreview(false)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
                  </div>
                  <div className="p-4 bg-slate-900 overflow-auto custom-scrollbar flex-1">
                      <pre className="text-xs font-mono text-green-400 whitespace-pre-wrap">
                          {getJsonSchemaPreview()}
                      </pre>
                  </div>
                  <div className="p-3 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-500 text-center">
                      {t.pb_json_info}
                  </div>
              </div>
          </div>
      )}

      {/* REQUEST DEBUG PREVIEW MODAL */}
      {showRequestPreview && editingNode && executionLogs[editingNode.id]?.requestPayload && (
          <div className="absolute inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-2xl w-[600px] animate-fade-in-up border border-gray-200 overflow-hidden flex flex-col max-h-[80vh]">
                  <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                      <h3 className="font-bold text-gray-800 flex items-center gap-2"><Bug size={18}/> {t.pb_req_payload}</h3>
                      <button onClick={() => setShowRequestPreview(false)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
                  </div>
                  <div className="p-4 bg-slate-900 overflow-auto custom-scrollbar flex-1">
                      <pre className="text-xs font-mono text-cyan-400 whitespace-pre-wrap">
                          {JSON.stringify(executionLogs[editingNode.id].requestPayload, null, 2)}
                      </pre>
                  </div>
              </div>
          </div>
      )}

      {/* CUSTOM DELETE CONFIRMATION MODAL */}
      {deleteTarget && (
          <div className="absolute inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full animate-fade-in-up border border-gray-200">
                  <div className="flex flex-col items-center text-center">
                      <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4 text-red-500">
                          <Trash2 size={24} />
                      </div>
                      <h3 className="text-lg font-bold text-gray-900 mb-2">
                          {deleteTarget.type === 'flow' ? t.pb_delete_flow_title : t.pb_delete_node_title}
                      </h3>
                      <p className="text-sm text-gray-500 mb-6">
                          {t.pb_delete_confirm.replace('{target}', deleteTarget.name || deleteTarget.id)}
                      </p>
                      <div className="flex gap-3 w-full">
                          <button 
                              onClick={() => setDeleteTarget(null)}
                              className="flex-1 py-2 bg-gray-100 text-gray-700 font-bold rounded-lg hover:bg-gray-200 transition-colors text-xs"
                          >
                              {t.pb_cancel}
                          </button>
                          <button 
                              onClick={confirmDelete}
                              className="flex-1 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-colors shadow-lg shadow-red-100 text-xs"
                          >
                              {t.pb_delete}
                          </button>
                      </div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};
