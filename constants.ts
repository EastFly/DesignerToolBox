
import { Priority, Stage, Task, User, TaskTypeConfig, RoleDef, Permission, StageDef, FieldDefinition } from './types';
import { addHours } from 'date-fns';

export const USERS: User[] = [
  { id: 'u1', name: 'Alice', role: 'PD', avatar: 'https://i.pravatar.cc/150?u=u1' },
  { id: 'u2', name: 'Bob', role: 'Ops', avatar: 'https://i.pravatar.cc/150?u=u2' },
  { id: 'u3', name: 'Charlie', role: 'DD', avatar: 'https://i.pravatar.cc/150?u=u3' },
  { id: 'u4', name: 'David', role: 'Designer', avatar: 'https://i.pravatar.cc/150?u=u4' },
  { id: 'u5', name: 'Eve', role: 'Designer', avatar: 'https://i.pravatar.cc/150?u=u5' },
];

export const AVAILABLE_PERMISSIONS: {key: Permission, label: string}[] = [
  { key: 'task.create', label: 'Create Tasks' },
  { key: 'task.edit', label: 'Edit Content (Fields, Requirements)' },
  { key: 'task.edit_core', label: 'Edit Core Props (Dates, Priority, Assignee)' }, 
  { key: 'task.move', label: 'Move Task Stage' },
  { key: 'task.delete', label: 'Delete Tasks' },
  { key: 'task.view_all', label: 'View All Tasks (Uncheck to restrict to own)' },
  { key: 'assets.upload', label: 'Upload Assets' },
  { key: 'settings.manage', label: 'Manage Settings & Roles' },
  { key: 'users.approve', label: 'Approve New Users' },
  { key: 'stats.view', label: 'View Statistics Dashboard' },
  { key: 'prompt.manage', label: 'Manage Prompt Builder' }, // Added label
  { key: 'products.manage', label: 'Manage Products' }, // Added
  { key: 'playground.access', label: 'Access Playground' },
  { key: 'dicestorm.access', label: 'Access Dice Storm' },
  { key: 'midnight.access', label: 'Access Midnight Missions' },
  { key: 'dice.manage_global', label: 'Manage Global Style Dice' },
];

// --- VALUE CALCULATION COEFFICIENTS ---
export const PRODUCT_LEVEL_WEIGHTS = {
    'S': 1.5,
    'A': 1.2,
    'B': 1.0,
    'C': 0.8
};

export const DIFFICULTY_WEIGHTS = {
    'High': 1.2,
    'Medium': 1.0,
    'Low': 0.8
};

export const INITIAL_ROLES: RoleDef[] = [
  { 
    id: 'Admin',
    name: 'Administrator',
    permissions: [
      'task.create', 'task.edit', 'task.edit_core', 'task.move', 'task.delete', 'task.view_all', 
      'assets.upload', 'settings.manage', 'users.approve', 'stats.view', 'prompt.manage', 
      'products.manage', 'playground.access', 'dicestorm.access', 'midnight.access', 'dice.manage_global'
    ],
    isSystem: true
  },
  { 
    id: 'PD', 
    name: 'Product Director', 
    permissions: [
      'task.create', 'task.edit', 'task.edit_core', 'task.move', 'task.delete', 'task.view_all', 
      'assets.upload', 'stats.view', 'products.manage', 'playground.access', 'dicestorm.access', 'midnight.access'
    ],
    isSystem: true 
  },
  { 
    id: 'Ops', 
    name: 'Operations', 
    permissions: [
      'task.edit', 'task.edit_core', 'task.move', 'task.view_all', 'assets.upload', 
      'users.approve', 'stats.view', 'products.manage'
    ],
    isSystem: true 
  },
  { 
    id: 'DD', 
    name: 'Design Director', 
    permissions: [
      'task.edit', 'task.edit_core', 'task.move', 'task.view_all', 'assets.upload', 
      'settings.manage', 'stats.view', 'prompt.manage', 'playground.access', 'dicestorm.access', 
      'midnight.access', 'dice.manage_global'
    ],
    isSystem: true 
  },
  { 
    id: 'Designer', 
    name: 'Designer', 
    permissions: ['task.move', 'task.view_all', 'assets.upload', 'playground.access', 'dicestorm.access'], 
    isSystem: true 
  }
];

// --- NEW CONFIGURATION CONSTANTS ---

export const INITIAL_STAGES: StageDef[] = [
  { id: 'backlog', title: 'Backlog', color: 'bg-gray-200', role: 'PD/Ops' },
  { id: 'ai_ops', title: 'AI Ops', color: 'bg-purple-100', role: 'DD' },
  { id: 'review', title: 'Review', color: 'bg-yellow-100', role: 'All' },
  { id: 'doing', title: 'Doing', color: 'bg-blue-100', role: 'Designer' },
  { id: 'qa', title: 'QA', color: 'bg-orange-100', role: 'Ops' },
  { id: 'done', title: 'Done', color: 'bg-green-100', role: 'System' },
];

// CROSS-BORDER E-COMMERCE STANDARD FIELD LIBRARY
export const INITIAL_FIELDS: FieldDefinition[] = [
  // --- 1. IDENTITY (Basic Product Info) ---
  { key: 'productImage', label: 'Product Image', type: 'image', section: 'identity', isSystem: true }, // NEW CORE FIELD
  { key: 'sku', label: 'SKU / Code', type: 'text', section: 'identity', isSystem: true },
  { key: 'productName', label: 'Product Name', type: 'text', section: 'identity', isSystem: true },
  { key: 'brand', label: 'Brand', type: 'text', section: 'identity', isSystem: true },
  { key: 'model', label: 'Model No.', type: 'text', section: 'identity', isSystem: true },
  { key: 'marketplace', label: 'Marketplace', type: 'select', options: ['Amazon US', 'Amazon EU', 'Amazon JP', 'Shopify', 'TikTok', 'Walmart'], section: 'identity' },
  { key: 'asin', label: 'ASIN / FNSKU', type: 'text', section: 'identity' },
  { key: 'launchDate', label: 'Launch Deadline', type: 'datetime', section: 'identity', isSystem: true },
  
  // --- 2. ASSETS (Files & Logistics) ---
  { key: 'assetLocationUrl', label: 'Asset Cloud Link (Dropbox/Drive)', type: 'link', section: 'assets' },
  { key: 'sampleArrivalDate', label: 'Sample Arrival Date', type: 'date', section: 'assets' },
  { key: 'sampleStatus', label: 'Sample Status', type: 'select', options: ['Not Sent', 'In Transit', 'Arrived', 'Returned'], section: 'assets' },
  { key: 'silkScreenMod', label: 'Silk Screen / Logo Mod', type: 'select', options: ['None (Keep Original)', 'New Design Required', 'Modify Existing'], section: 'assets' },
  { key: '3dModelUrl', label: '3D Model Link (Step/Obj)', type: 'link', section: 'assets' },
  { key: 'competitorVisuals', label: 'Competitor Visual Analysis', type: 'image', section: 'assets' },
  
  // --- 3. REQUIREMENTS (Marketing & Compliance) ---
  { key: 'sellingPoints', label: 'Selling Points', type: 'textarea', section: 'requirements' }, // Handled by special UI
  { key: 'targetAudience', label: 'Target Audience', type: 'text', section: 'requirements' },
  { key: 'pricePoint', label: 'Target Price Point', type: 'text', section: 'requirements' },
  { key: 'keywords', label: 'SEO Keywords', type: 'textarea', section: 'requirements' },
  { key: 'complianceNotes', label: 'Compliance (Battery/Safety)', type: 'textarea', section: 'requirements' },
  
  // --- 4. DIRECTIVES (Design Specs) ---
  { key: 'styleTags', label: 'Style Tags', type: 'text', section: 'directives' },
  { key: 'aiPrompts', label: 'AI Prompts', type: 'textarea', section: 'directives' },
  { key: 'referenceImages', label: 'Moodboard / References', type: 'image', section: 'directives' },
  { key: 'designSOP', label: 'Design SOP / Guidelines', type: 'text', section: 'directives' },
  { key: 'dimensions', label: 'Output Dimensions (px)', type: 'text', section: 'directives' },
  
  // --- 5. CUSTOM (Specs & Misc) ---
  { key: 'jobbuyLink', label: 'Jobbuy/Sourcing Link', type: 'link', section: 'custom' },
  { key: 'costPrice', label: 'Cost Price (RMB)', type: 'text', section: 'custom' },
];

const CORE_FIELDS = ['productImage', 'sku', 'productName', 'brand'];

// Helper to generate a matrix
const generateMatrix = (stages: string[], requiredFields: string[] = []) => {
    const matrix: Record<string, Record<string, any>> = {
        'creation': {},
    };
    
    // Config for Creation Stage
    CORE_FIELDS.forEach(k => matrix['creation'][k] = { visible: true, required: true, readonly: false });
    requiredFields.forEach(k => {
         matrix['creation'][k] = { visible: true, required: false, readonly: false }; // Visible in creation, required logic handled by specific configs if needed
    });

    // Config for All other Stages
    stages.forEach(s => {
        matrix[s] = {};
        CORE_FIELDS.forEach(k => matrix[s][k] = { visible: true, required: false, readonly: true });
        
        requiredFields.forEach(k => {
             matrix[s][k] = { visible: true, required: false, readonly: false };
        });
    });

    return matrix;
};

/*
  WORKFLOW DEFINITIONS
  1. Jobbuy: Simple procurement/listing flow.
  2. Amazon PA+: High standard. All stages. Strict assets.
  3. Amazon A+: Content flow.
*/

// Amazon PA+ (Full Workflow)
const PA_PLUS_WORKFLOW = ['backlog', 'ai_ops', 'review', 'doing', 'qa', 'done'];
const paPlusMatrix = generateMatrix(PA_PLUS_WORKFLOW, [
    'marketplace', 'launchDate', 'assetLocationUrl', 'sampleStatus', 
    'silkScreenMod', '3dModelUrl', 'competitorVisuals', 
    'sellingPoints', 'complianceNotes', 'aiPrompts', 'referenceImages'
]);
// Add specific strict requirements for QA stage in PA+
paPlusMatrix['qa']['complianceNotes'] = { visible: true, required: true, readonly: false };
paPlusMatrix['qa']['productImage'] = { visible: true, required: true, readonly: true };

// Amazon A+ (EBC Content)
const A_PLUS_WORKFLOW = ['backlog', 'doing', 'review', 'qa', 'done'];
const aPlusMatrix = generateMatrix(A_PLUS_WORKFLOW, [
    'marketplace', 'asin', 'sellingPoints', 'styleTags', 'designSOP', 'referenceImages'
]);

// Jobbuy (Sourcing/Listing)
const JOBBUY_WORKFLOW = ['backlog', 'review', 'doing', 'done'];
const jobbuyMatrix = generateMatrix(JOBBUY_WORKFLOW, [
    'jobbuyLink', 'costPrice', 'marketplace', 'launchDate'
]);


export const INITIAL_TASK_TYPES: TaskTypeConfig[] = [
  {
    id: 'amazon_pa_plus',
    name: 'Amazon PA+ (Main Image)',
    workflow: PA_PLUS_WORKFLOW,
    fieldMatrix: paPlusMatrix
  },
  {
    id: 'amazon_a_plus',
    name: 'Amazon A+ (EBC/Content)',
    workflow: A_PLUS_WORKFLOW,
    fieldMatrix: aPlusMatrix
  },
  {
    id: 'jobbuy_listing',
    name: 'Jobbuy (Sourcing)',
    workflow: JOBBUY_WORKFLOW,
    fieldMatrix: jobbuyMatrix
  }
];

const now = new Date();

export const INITIAL_TASKS: Task[] = [
  {
    id: 'T-101',
    type: 'amazon_pa_plus',
    priority: Priority.P0,
    stage: 'doing',
    workStatus: 'in_progress',
    owner: USERS[0],
    deadline: addHours(now, 4),
    createdAt: addHours(now, -48), // was subDays(2)
    tags: ['Urgent', 'Q4 Campaign', 'Elec'],
    lifecycleStatus: 'active',
    productLevel: 'A',
    difficulty: 'High',
    estimatedHours: 8,
    
    identity: {
      sku: 'HO-EP-X100',
      model: 'X100-Pro',
      productName: 'SonicPod X100 ANC Wireless Earbuds',
      brand: 'Hofan Audio',
      marketplace: 'Amazon US',
      asin: 'B08X123456',
      launchDate: addHours(now, 48),
      productImage: ['https://images.unsplash.com/photo-1590658268037-6bf12165a8df?q=80&w=3032&auto=format&fit=crop'],
    },
    assets: {
      hasWhiteBgImages: true,
      assetLocationUrl: 'https://dropbox.com/project/x100',
      sampleStatus: 'Arrived'
    },
    requirements: {
      sellingPoints: [
        { text: 'Active Noise Cancelling (ANC) up to 45dB' },
        { text: '60-Hour Battery Life with Case' },
      ],
      targetAudience: 'Business Travelers',
    },
    directives: {
      aiPrompts: 'Product floating in zero gravity, neon blue rim light, high tech cyberpunk background.',
      styleTags: 'Tech, Premium, Dark Mode',
    },
    customData: {},
    aiGeneratedImages: ['https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?q=80&w=2000&auto=format&fit=crop'],
    finalDesigns: [],
    timeline: [
      { id: 'e1', actor: USERS[0], action: 'Created Task', timestamp: addHours(now, -48) }, // was subDays(2)
      { id: 'e2', actor: USERS[0], action: 'Moved to Doing', timestamp: addHours(now, -5) }, // was subHours(5)
    ],
    timeLogs: []
  },
  {
    id: 'T-103',
    type: 'amazon_a_plus',
    priority: Priority.P2,
    stage: 'backlog',
    workStatus: 'not_started',
    owner: USERS[0],
    deadline: addHours(now, 100),
    createdAt: addHours(now, -24), // was subDays(1)
    tags: ['Gaming', 'RGB'],
    lifecycleStatus: 'active',
    productLevel: 'B',
    difficulty: 'Medium',
    estimatedHours: 4,
    
    identity: {
      sku: 'HO-GM-K88',
      model: 'K88-RGB',
      productName: 'MechWarrior RGB Mechanical Keyboard',
      brand: 'Hofan Gaming',
      marketplace: 'TikTok',
      launchDate: addHours(now, 120),
      productImage: ['https://images.unsplash.com/photo-1595225476474-87563907a212?q=80&w=3271&auto=format&fit=crop'],
    },
    assets: {
      sampleStatus: 'Not Sent'
    },
    requirements: {},
    directives: {},
    customData: {},
    aiGeneratedImages: [],
    finalDesigns: [],
    timeline: [
      { id: 'e4', actor: USERS[0], action: 'Created Task', timestamp: addHours(now, -24) }, // was subDays(1)
    ],
    timeLogs: []
  }
];
