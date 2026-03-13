
export enum Priority {
  P0 = 'P0', // Urgent
  P1 = 'P1', // Normal
  P2 = 'P2', // Low
}

export type WorkStatus = 'not_started' | 'in_progress' | 'completed';

// New: Product Levels and Task Difficulty
export type ProductLevel = 'S' | 'A' | 'B' | 'C';
export type TaskDifficulty = 'High' | 'Medium' | 'Low';

// Global "Pool" of stages.
export interface StageDef {
  id: string;
  title: string;
  color: string; // Tailwind color class for badge
  role: string; // Default role responsibility
}

// Deprecate old Stage enum usage in favor of dynamic strings, 
// but keep for backward compat in legacy code if needed.
export enum Stage {
  BACKLOG = 'backlog',
  AI_OPS = 'ai_ops',
  REVIEW = 'review',
  DOING = 'doing',
  QA = 'qa',
  DONE = 'done',
}

export interface User {
  id: string;
  name: string;
  role: string;
  avatar: string;
}

export type ProfileStatus = 'pending' | 'approved' | 'rejected' | 'blocked';

export interface FullUserProfile extends User {
  email: string;
  status: ProfileStatus;
  createdAt: Date;
}

export type Permission = 
  | 'task.create'
  | 'task.edit'       // Content editing (Fields, Requirements)
  | 'task.edit_core'  // NEW: Core properties (Dates, Priority, Assignee, Value)
  | 'task.delete'
  | 'task.move'
  | 'task.view_all'
  | 'settings.manage'
  | 'users.approve'
  | 'assets.upload'
  | 'stats.view'
  | 'prompt.manage'   // Manage Prompt Flows
  | 'products.manage' // Manage Products
  | 'playground.access' // Access Playground
  | 'xlab.access'       // Access X Lab
  | 'dicestorm.access'  // Access Dice Storm
  | 'midnight.access'   // Access Midnight Missions
  | 'dice.manage_global' // Manage Global Style Dice
  // Sidebar Access
  | 'dashboard.access'
  | 'projects.access'
  | 'dice.access'
  | 'analytics.access'
  | 'settings.access'
  // Settings Tabs
  | 'settings.task_types'
  | 'settings.global_fields'
  | 'settings.global_stages'
  | 'settings.roles'
  | 'settings.users'
  | 'settings.system'
  | 'settings.model_usage';

export interface RoleDef {
  id: string;
  name: string;
  permissions: Permission[];
  isSystem?: boolean;
}

export interface TimelineEvent {
  id: string;
  actor: User;
  action: string;
  timestamp: Date;
  duration?: string;
  isAlert?: boolean;
  type?: 'system' | 'comment';
  imageUrl?: string;
}

// --- Time Tracking System (New v2.7) ---
export type TimeLogType = 'assignment' | 'work';

export interface TimeLog {
  id: string;
  userId: string;
  userName: string; // Snapshot for easier display
  userRole: string; // Snapshot
  stageId: string; // Context
  type: TimeLogType;
  startTime: Date;
  endTime?: Date; // If null, it is currently active
  durationMinutes?: number; // Calculated when closed
}

// --- Dynamic Field System ---

export type InputType = 
  | 'text' | 'textarea' | 'richtext' 
  | 'number' | 'date' | 'datetime' 
  | 'select' | 'multiselect' 
  | 'image' | 'video' | 'file' | 'link' 
  | 'folder'; // New: Grouping mechanism

export interface FieldDefinition {
  key: string; // The data key (e.g., 'sku', 'sellingPoints')
  label: string; // Display Name (e.g., 'Product Code')
  type: InputType;
  options?: string[]; // For select/multiselect
  section: 'identity' | 'assets' | 'ai_assets' | 'requirements' | 'directives' | 'custom'; // UI grouping
  isSystem?: boolean; // If true, key cannot be changed/deleted
  
  // Global AI Defaults
  aiEnabled?: boolean;
  aiCustomPrompt?: string;
  
  // Semantic Description
  description?: string; 

  // Folder / Structure Configuration
  subFields?: FieldDefinition[]; // Recursive definition for 'folder' type

  // Media Configuration (Image/Video)
  mediaConfig?: {
    width?: number;
    height?: number;
    aspectRatio?: string; // e.g. "16:9"
    maxCount?: number;
  };

  // Product Management (New v2.9)
  isProductField?: boolean; // If true, this field is synced with the Product entity
}

// Configuration for a field in a specific stage
export interface FieldState {
  visible: boolean;
  required: boolean;
  readonly: boolean;
  // AI Configuration (Overrides Global)
  aiEnabled?: boolean;
  aiCustomPrompt?: string; 
}

// NEW: Layout Configuration Item
export interface FieldLayoutItem {
  key: string;
  width?: 'full' | 'half'; // Grid Control
}

export interface TaskTypeConfig {
  id: string;
  name: string;
  
  // The ordered list of Stage IDs that this task type goes through
  workflow: string[]; 
  
  // The Matrix: Map<StageID, Map<FieldKey, FieldState>>
  fieldMatrix: Record<string, Record<string, FieldState>>;

  // Automations mapping. Map<StageID, PromptFlowID>
  stagePromptFlows?: Record<string, string>;

  // NEW: Layout mapping. Map<StageID, FieldLayoutItem[]>
  // If undefined for a stage, fallback to default section grouping
  stageLayouts?: Record<string, FieldLayoutItem[]>; 
}

// --- Prompt Orchestration Types (New v2.9 - Graph Support) ---

export type PromptNodeType = 'start' | 'generation';

// Updated Model Types to include Veo and Flash variants
export type AiModelType = 
  | 'gemini-3-pro-preview' 
  | 'gemini-3-flash-preview'
  | 'gemini-3-pro-image-preview' 
  | 'gemini-2.5-flash-image'
  | 'veo-3.1-generate-preview' 
  | 'veo-3.1-fast-generate-preview';

export interface PromptNode {
  id: string;
  type?: PromptNodeType; // 'start' or 'generation'.
  name: string;
  description?: string;
  model: AiModelType; 
  
  // Input: Which existing task fields provide context
  inputVariables: string[]; 
  
  // The Prompt Template
  template: string;
  
  // Output: Which fields to write the result to
  targetFields: string[]; // UPDATED: Changed from single string to array
  
  // Graph Position (v2.9)
  position: { x: number; y: number };

  // New: Store extra data like test inputs for the start node
  data?: {
    testInputs?: Record<string, string>;
    [key: string]: any;
  };
}

export interface PromptEdge {
  id: string;
  source: string; // Node ID
  target: string; // Node ID
}

export interface PromptFlow {
  id: string;
  name: string;
  description: string;
  nodes: PromptNode[];
  edges: PromptEdge[]; // v2.9: Explicit connections
  isActive: boolean;
}

// Generic container for task content to support dynamic fields
export interface TaskContent {
  [key: string]: any;
}

export interface SellingPoint {
  text: string;
  referenceImage?: string;
}

// --- Product Management (New v2.9) ---
export interface ProductSpec {
    label: string; // e.g., "Battery Life"
    value: string; // e.g., "24 Hours"
}

export interface CompetitorAnalysis {
    name: string;
    url?: string;
    pros: string[];
    cons: string[];
    summary?: string;
}

export interface ProductChangeDetail {
    field: string;
    old: any;
    new: any;
}

export interface ProductChangeLog {
    date: Date;
    taskId?: string;
    taskName?: string;
    actor: User;
    changes: ProductChangeDetail[];
}

export interface Product {
    id: string; // UUID
    sku: string; // Unique Identifier (Business Key)
    name: string;
    
    // Core Attributes
    level?: ProductLevel; 
    brands: string[]; // New: Multi-brand support
    channels: string[]; // New: Multi-channel support (Amazon, Shopify, etc)
    
    // Extended Attributes (Stored in Data JSONB usually, but typed here for frontend)
    specs?: ProductSpec[];
    competitors?: CompetitorAnalysis[];
    
    // Dynamic/Legacy Fields
    data: Record<string, any>; 
    
    // Soft Delete Flag
    isDeleted?: boolean;

    history: ProductChangeLog[]; // Audit Trail
    createdAt: Date;
    updatedAt: Date;
}

// --- Asset Tracking (New v2.10) ---
export interface AssetMetadata {
    source: 'ai' | 'human';
    model?: string; // If AI
    timestamp: Date;
    prompt?: string;
}

// --- Playground & Dice (New v2.12) ---

// Shared GenConfig for Playground/Dice
// UPDATED V2.15: Added targetLanguage and fontStyle
export interface GenConfig {
    model?: string;
    aspectRatio: string;
    allowText: boolean;
    resolution: '1K' | '2K' | '4K' | '512px';
    targetLanguage?: string;
    fontStyle?: string;
    layoutConsistency?: number; // 0-100
    frameShapeVariance?: number; // 0-100
    layoutVariance?: number; // 0-100
    styleVariance?: number; // 0-100
}

// Metadata stored in StyleDice description
export interface DiceMetadata {
    tags: string[];
    config: GenConfig;
    referenceUrls?: {
        layout?: string;
        style?: string;
    };
    selectedSellingPointIndices?: number[];
    productImageIndex?: number;
    
    // New: Advanced Control
    negativePrompt?: string; 
    styleDirectives?: {
        textRendering?: string; // How to handle text if enabled (e.g. "Bold sans-serif, floating 3D")
        featureHighlight?: string; // How to show selling points if NO text (e.g. "Water droplets for waterproof")
        compositionRules?: string; // Strict composition rules (e.g. "Center product, 30% negative space")
    };
    
    // New: Structured Prompt Details (from Playground Plan mode)
    structuredPrompt?: {
        environment?: string;
        lighting?: string;
        composition?: string;
    };
}

export interface StyleDice {
    id: string;
    userId: string; // New: Ownership
    name: string;
    description?: string; // Contains DiceMetadata JSON
    template: string; // The extracted prompt template with {{product}}
    coverImage?: string; // Example result
    createdAt: Date;
    isGlobal?: boolean; // New: Global visibility
}

// --- Midnight Mission (Agent Queue) (New v2.13) ---
export interface ExecutionUnit {
    slotId: string;
    diceName: string;
    model: string;
    prompt: string; // Fully resolved prompt (no variables)
    
    // NEW: Structured calling process for background workers
    structuredCall?: {
        basePrompt: string;
        localPrompt?: string;
        globalPrompt?: string;
        featuresText: string;
        styleDirectiveText: string;
        negativePrompt: string;
    };

    config: {
        aspectRatio: string;
        imageSize: string;
    };
    referenceImages: {
        type: 'product' | 'layout' | 'style';
        url: string; // Must be a valid URL (no Base64)
    }[];
}

export interface MidnightMission {
    id: string;
    userId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    productName: string; // Display snapshot
    payload: {
        tasks: ExecutionUnit[];
    };
    result?: {
        outputs: {
            slotId: string;
            url: string; // Result URL
            error?: string;
        }[];
    };
    createdAt: Date;
    updatedAt: Date;
}

// --- Lifecycle Optimization (New v2.11) ---
export type LifecycleStatus = 'active' | 'archived' | 'deleted';

export interface TaskShareLink {
  id: string; // Unique token for the URL
  taskId: string;
  stageId: string;
  fields: string[]; // Array of field keys to be filled
  status: 'pending' | 'completed';
  expiresAt: Date;
  createdAt: Date;
  createdBy: string;
  submittedAt?: Date;
}

export interface Task {
  id: string;
  type: string;
  priority: Priority;
  stage: string; // Dynamic Stage ID
  workStatus: WorkStatus; // New: Operational Status
  owner: User;
  collaborators?: string[]; // Array of user IDs
  deadline: Date;
  startDate?: Date; 
  createdAt: Date;
  timeSpent?: string; // Legacy manual field
  tags: string[]; // New: Generic Tags for search
  
  // New Value Calculation Fields
  difficulty?: TaskDifficulty;
  estimatedHours?: number;
  productLevel?: ProductLevel; // Synced/Cached from Product

  // Lifecycle Status (Primary Source of Truth for Filtering)
  lifecycleStatus: LifecycleStatus;

  // Timestamps for History
  deletedAt?: Date | null;
  archivedAt?: Date | null;

  // We keep specific buckets for backward compatibility and organized data structure,
  // but the UI will render them based on FieldDefinition.section
  identity: {
      productId?: string; // Explicit link to Product Table
      [key: string]: any;
  };
  assets: any;
  requirements: any;
  directives: any;
  
  // Custom fields go here
  customData: Record<string, any>;

  // New: Track origin of assets (images/videos)
  assetMetadata?: Record<string, AssetMetadata>;

  aiGeneratedImages: string[];
  finalDesigns: string[];
  timeline: TimelineEvent[];
  timeLogs: TimeLog[]; // NEW: Automated time tracking
  shareLinks?: TaskShareLink[]; // NEW: External share links
}
