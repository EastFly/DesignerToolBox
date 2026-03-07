
// ... existing imports ...
import { Task, TaskTypeConfig, User, RoleDef, FullUserProfile, ProfileStatus, StageDef, FieldDefinition, PromptFlow, Product, ProductChangeLog, LifecycleStatus, StyleDice, MidnightMission } from '../types';
import { INITIAL_TASKS, INITIAL_TASK_TYPES, INITIAL_ROLES, INITIAL_STAGES, INITIAL_FIELDS } from '../constants';
import { supabase, BUCKET_NAME, TABLE_TASKS, TABLE_TYPES, TABLE_PROFILES, TABLE_ROLES, TABLE_PRODUCTS, TABLE_STYLE_DICE, TABLE_MIDNIGHT_MISSIONS } from './supabase';
import { compressImage } from '../utils/imageCompression';

// We will use a special table 'system_settings' or reuse 'task_types' with a reserved ID for global config to keep it simple
const GLOBAL_CONFIG_ID = 'GLOBAL_CONFIG';
const TABLE_PROMPT_FLOWS = 'prompt_flows'; // New Table

export type ConnectionStatus = 'CONNECTED' | 'MISSING_TABLES' | 'RLS_ERROR' | 'OFFLINE';

class DatabaseService {
  
  // Check if we can connect and if tables exist/have permissions
  async checkConnection(): Promise<ConnectionStatus> {
    try {
      const { error: taskError } = await supabase.from(TABLE_TASKS).select('id').limit(1);
      
      if (taskError) {
        if (taskError.code === '42P01') return 'MISSING_TABLES';
        if (taskError.code === '42501') return 'RLS_ERROR'; 
        return 'OFFLINE';
      }
      return 'CONNECTED';
    } catch (e) {
      return 'OFFLINE';
    }
  }

  // --- Auth & Profiles (Existing code kept same) ---
  async signUp(email: string, password: string, meta: { full_name: string, role: string }) {
      const { data, error } = await supabase.auth.signUp({
          email, password, options: { data: meta }
      });
      if (error) throw error;
      return data;
  }

  async signIn(email: string, password: string) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
  }

  async signOut() {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
  }

  async resetPasswordEmail(email: string) {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
  }

  // NEW: Get current session user (Persistence)
  async getSessionUser(): Promise<{ id: string, email?: string } | null> {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return null;
      return { id: session.user.id, email: session.user.email };
  }

  async getCurrentUserProfile(userId: string): Promise<FullUserProfile | null> {
      const fetchProfile = async () => {
         const { data, error } = await supabase.from(TABLE_PROFILES).select('*').eq('id', userId).single();
         if (error) return null;
         return data;
      };

      try {
          let data = await fetchProfile();
          if (!data) {
              await new Promise(r => setTimeout(r, 500));
              data = await fetchProfile();
          }
          if (!data) {
              await supabase.rpc('create_profile_if_missing');
              data = await fetchProfile(); 
          }
          if (!data) return null; 
          
          if (data.status !== 'approved') return { ...data, isPending: true } as any; 

          return {
              id: data.id,
              name: data.full_name,
              role: data.role,
              avatar: data.avatar_url,
              email: data.email,
              status: data.status,
              createdAt: new Date(data.created_at)
          };
      } catch (e) {
          return null;
      }
  }

  async getAllProfiles(): Promise<FullUserProfile[]> {
      const { data, error } = await supabase.from(TABLE_PROFILES).select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data.map((p: any) => ({
          id: p.id,
          name: p.full_name,
          email: p.email,
          role: p.role,
          avatar: p.avatar_url,
          status: p.status || 'pending',
          createdAt: new Date(p.created_at)
      }));
  }

  async updateUserProfile(userId: string, updates: { role?: string, status?: ProfileStatus }): Promise<void> {
      const { error } = await supabase.from(TABLE_PROFILES).update(updates).eq('id', userId);
      if (error) throw error;
  }

  async updateSelfProfile(updates: { full_name?: string, avatar_url?: string }): Promise<void> {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not logged in");
      
      const { error } = await supabase.from(TABLE_PROFILES).update(updates).eq('id', user.id);
      if (error) throw error;
  }

  // --- SYSTEM SETTINGS (Fields & Stages) ---
  
  // We store global settings in 'task_types' table under a special reserved ID to avoid adding new tables
  // content: { stages: StageDef[], fields: FieldDefinition[] }
  async getSystemSettings(): Promise<{ stages: StageDef[], fields: FieldDefinition[] }> {
      try {
          const { data, error } = await supabase.from(TABLE_TYPES).select('*').eq('id', GLOBAL_CONFIG_ID).single();
          
          if (error || !data) {
              // Return defaults if not found
              return { stages: INITIAL_STAGES, fields: INITIAL_FIELDS };
          }
          
          return {
              stages: data.fields?.stages || INITIAL_STAGES, // We reuse the 'fields' column (jsonb) to store general config
              fields: data.fields?.fields || INITIAL_FIELDS
          };
      } catch (e) {
          return { stages: INITIAL_STAGES, fields: INITIAL_FIELDS };
      }
  }

  async saveSystemSettings(stages: StageDef[], fields: FieldDefinition[]): Promise<void> {
      const { error } = await supabase.from(TABLE_TYPES).upsert({
          id: GLOBAL_CONFIG_ID,
          name: 'SYSTEM_CONFIG',
          fields: { stages, fields } // Storing in the jsonb column 'fields'
      });
      if (error) throw error;
  }

  // --- Task Types (Configuration) ---

  async getTaskTypes(): Promise<TaskTypeConfig[]> {
    try {
      const { data, error } = await supabase.from(TABLE_TYPES).select('*').neq('id', GLOBAL_CONFIG_ID);
      if (error) throw error;
      if (!data || data.length === 0) return [];

      return data.map((row: any) => ({
        id: row.id,
        name: row.name,
        // Legacy support: if fieldMatrix is missing, construct basic one
        fieldMatrix: row.fields?.fieldMatrix || {}, 
        workflow: row.fields?.workflow || INITIAL_STAGES.map(s => s.id),
        stagePromptFlows: row.fields?.stagePromptFlows || {},
        stageLayouts: row.fields?.stageLayouts || {} // Load Layouts
      }));
    } catch (e) {
      return INITIAL_TASK_TYPES;
    }
  }

  async saveTaskTypes(types: TaskTypeConfig[]): Promise<void> {
    const rows = types.map(t => ({
      id: t.id,
      name: t.name,
      fields: { 
          workflow: t.workflow, 
          fieldMatrix: t.fieldMatrix,
          stagePromptFlows: t.stagePromptFlows || {},
          stageLayouts: t.stageLayouts || {} // Save Layouts
      }
    }));

    const { error } = await supabase.from(TABLE_TYPES).upsert(rows);
    if (error) throw error;
  }

  // --- PROMPT FLOWS (NEW v2.8) ---
  
  async getPromptFlows(): Promise<PromptFlow[]> {
      try {
          const { data, error } = await supabase.from(TABLE_PROMPT_FLOWS).select('*').order('created_at', { ascending: false });
          if (error) throw error;
          return data.map((row: any) => ({
              id: row.id,
              name: row.name,
              description: row.description,
              nodes: row.nodes || [],
              edges: row.edges || [], // Load edges properly
              isActive: row.is_active
          }));
      } catch(e) {
          console.warn("Failed to load prompt flows (Table might be missing)", e);
          return [];
      }
  }

  async savePromptFlow(flow: PromptFlow): Promise<void> {
      const { error } = await supabase.from(TABLE_PROMPT_FLOWS).upsert({
          id: flow.id,
          name: flow.name,
          description: flow.description,
          nodes: flow.nodes,
          edges: flow.edges, // Save edges properly
          is_active: flow.isActive,
          updated_at: new Date()
      });
      if (error) throw error;
  }

  async deletePromptFlow(flowId: string): Promise<void> {
      const { error } = await supabase.from(TABLE_PROMPT_FLOWS).delete().eq('id', flowId);
      if (error) throw error;
  }

  // --- PRODUCTS (NEW v2.9) ---

  async getProducts(): Promise<Product[]> {
      try {
          const { data, error } = await supabase.from(TABLE_PRODUCTS).select('*').order('updated_at', { ascending: false });
          if (error) throw error;
          return data
              .filter((row: any) => !(row.data && row.data.isDeleted))
              .map((row: any) => ({
              id: row.id,
              sku: row.sku,
              name: row.name,
              level: row.level || 'B',
              brands: row.brands || [], // Map columns
              channels: row.channels || [], // Map columns
              data: row.data || {},
              history: row.history || [],
              specs: row.specs || [], // MAP specs
              competitors: row.competitors || [], // MAP competitors
              isDeleted: row.data?.isDeleted || false,
              createdAt: new Date(row.created_at),
              updatedAt: new Date(row.updated_at)
          }));
      } catch (e) {
          console.warn("Products table missing or fetch failed", e);
          return [];
      }
  }

  async saveProduct(product: Product): Promise<void> {
      const { error } = await supabase.from(TABLE_PRODUCTS).upsert({
          id: product.id,
          sku: product.sku,
          name: product.name,
          level: product.level,
          brands: product.brands,
          channels: product.channels,
          data: { ...product.data, isDeleted: product.isDeleted },
          history: product.history,
          specs: product.specs || [], // SAVE specs
          competitors: product.competitors || [], // SAVE competitors
          updated_at: new Date()
      });
      if (error) throw error;
  }

  async deleteProduct(productId: string): Promise<void> {
      const { error } = await supabase.from(TABLE_PRODUCTS).delete().eq('id', productId);
      if (error) throw error;
  }

  // --- PLAYGROUND STYLE DICE (NEW v2.12) ---
  
  async getAllDiceTags(includeAll: boolean = false): Promise<string[]> {
      try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return [];
          
          let query = supabase.from(TABLE_STYLE_DICE).select('description');
          if (!includeAll) {
              query = query.or(`user_id.eq.${user.id},is_global.eq.true`);
          }
          const { data, error } = await query;
          if (error) return [];
          
          const tags = new Set<string>();
          data.forEach((row: any) => {
              if (row.description) {
                  try {
                      const meta = JSON.parse(row.description);
                      meta.tags?.forEach((t: string) => tags.add(t));
                  } catch (e) {}
              }
          });
          return Array.from(tags).sort();
      } catch (e) {
          console.warn("Failed to load tags", e);
          return [];
      }
  }

  async getStyleDicePaginated(
      includeAll: boolean = false,
      page: number = 1,
      pageSize: number = 12,
      searchQuery: string = '',
      tags: string[] = []
  ): Promise<{ data: StyleDice[], count: number }> {
      try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return { data: [], count: 0 };

          let query = supabase.from(TABLE_STYLE_DICE).select('*', { count: 'exact' });
          
          if (!includeAll) {
              query = query.or(`user_id.eq.${user.id},is_global.eq.true`);
          }

          if (searchQuery) {
              query = query.or(`name.ilike.%${searchQuery}%,template.ilike.%${searchQuery}%`);
          }

          if (tags && tags.length > 0) {
              tags.forEach(tag => {
                  query = query.ilike('description', `%"${tag}"%`);
              });
          }

          const from = (page - 1) * pageSize;
          const to = from + pageSize - 1;

          const { data, error, count } = await query.order('created_at', { ascending: false }).range(from, to);
          
          if (error) throw error;
          
          return {
              data: data.map((row: any) => ({
                  id: row.id,
                  userId: row.user_id,
                  name: row.name,
                  description: row.description,
                  template: row.template,
                  coverImage: row.cover_image,
                  createdAt: new Date(row.created_at),
                  isGlobal: row.is_global
              })),
              count: count || 0
          };
      } catch (e) {
          console.warn("Failed to load paginated dice", e);
          return { data: [], count: 0 };
      }
  }

  async getStyleDice(includeAll: boolean = false): Promise<StyleDice[]> {
      try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return [];

          let query = supabase.from(TABLE_STYLE_DICE).select('*');
          
          if (!includeAll) {
              // Normal user: See own dice OR global dice
              query = query.or(`user_id.eq.${user.id},is_global.eq.true`);
          }

          const { data, error } = await query.order('created_at', { ascending: false });
          
          if (error) throw error;
          return data.map((row: any) => ({
              id: row.id,
              userId: row.user_id,
              name: row.name,
              description: row.description,
              template: row.template,
              coverImage: row.cover_image,
              createdAt: new Date(row.created_at),
              isGlobal: row.is_global
          }));
      } catch (e) {
          console.warn("Failed to load dice", e);
          return [];
      }
  }

  async saveStyleDice(dice: StyleDice): Promise<void> {
      const { error } = await supabase.from(TABLE_STYLE_DICE).upsert({
          id: dice.id,
          user_id: dice.userId,
          name: dice.name,
          description: dice.description,
          template: dice.template,
          cover_image: dice.coverImage,
          created_at: dice.createdAt,
          is_global: dice.isGlobal || false
      });
      if (error) throw error;
  }

  async deleteStyleDice(id: string): Promise<void> {
      const { error } = await supabase.from(TABLE_STYLE_DICE).delete().eq('id', id);
      if (error) throw error;
  }

  // --- MIDNIGHT MISSIONS (NEW v2.13) ---
  
  async createMidnightMission(mission: MidnightMission): Promise<void> {
      const { error } = await supabase.from(TABLE_MIDNIGHT_MISSIONS).insert({
          id: mission.id,
          user_id: mission.userId,
          status: 'pending',
          product_name: mission.productName,
          payload: mission.payload,
          result: mission.result || {},
          created_at: new Date(),
          updated_at: new Date()
      });
      if (error) throw error;
  }

  async updateMidnightMission(mission: MidnightMission): Promise<void> {
      const { error } = await supabase.from(TABLE_MIDNIGHT_MISSIONS)
          .update({
              status: mission.status,
              result: mission.result,
              updated_at: new Date()
          })
          .eq('id', mission.id);
      if (error) throw error;
  }

  async getMidnightMissions(): Promise<MidnightMission[]> {
      const { data, error } = await supabase.from(TABLE_MIDNIGHT_MISSIONS)
          .select('*')
          .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data.map((row: any) => ({
          id: row.id,
          userId: row.user_id,
          status: row.status,
          productName: row.product_name,
          payload: row.payload,
          result: row.result,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at)
      }));
  }

  // --- Roles & Tasks (Existing) ---
  async getRoles(): Promise<RoleDef[]> {
      try {
          const { data, error } = await supabase.from(TABLE_ROLES).select('*');
          if (error || !data.length) return INITIAL_ROLES;
          return data.map((r: any) => ({
              id: r.id, name: r.name, permissions: r.permissions, isSystem: r.is_system
          }));
      } catch (e) { return INITIAL_ROLES; }
  }

  async saveRoles(roles: RoleDef[]): Promise<void> {
      // Use upsert to create roles if they don't exist (e.g. first time editing defaults)
      const rows = roles.map(r => ({
          id: r.id, 
          name: r.name, 
          permissions: r.permissions, 
          is_system: r.isSystem || false
      }));
      const { error } = await supabase.from(TABLE_ROLES).upsert(rows);
      if (error) throw error;
  }

  async createRole(role: RoleDef): Promise<void> {
      const { error } = await supabase.from(TABLE_ROLES).insert({
          id: role.id, name: role.name, permissions: role.permissions, is_system: false
      });
      if (error) throw error;
  }

  // Renamed/Deprecated logic: Use saveRoles instead for single updates to be safe with upsert
  async updateRole(role: RoleDef): Promise<void> {
      return this.saveRoles([role]);
  }

  async deleteRole(roleId: string): Promise<void> {
      const { error } = await supabase.from(TABLE_ROLES).delete().eq('id', roleId);
      if (error) throw error;
  }

  async getTasks(): Promise<Task[]> {
    try {
      const { data, error } = await supabase.from(TABLE_TASKS).select('*').order('created_at', { ascending: false });
      if (error) throw error;
      if (!data || data.length === 0) return [];
      
      return data.map((row: any) => {
          // Pass the row-level lifecycle_status if available
          const task = this.hydrateTask(row.content, row.lifecycle_status);
          return task;
      });
    } catch (e) { return []; }
  }

  async getTaskByShareLink(linkId: string): Promise<Task | null> {
    try {
      // Query tasks where the content JSON contains a shareLink with the given ID
      // Note: Supabase JSONB querying syntax for array of objects
      const { data, error } = await supabase
        .from(TABLE_TASKS)
        .select('*')
        .contains('content', { shareLinks: [{ id: linkId }] })
        .limit(1)
        .single();
        
      if (error) {
        console.error("Error fetching task by share link:", error);
        return null;
      }
      if (!data) return null;
      
      return this.hydrateTask(data.content, data.lifecycle_status);
    } catch (e) {
      console.error("Exception fetching task by share link:", e);
      return null;
    }
  }

  async createTask(task: Task): Promise<Task> {
    const { timeLogs, ...contentWithoutLogs } = task;
    // Set lifecycle_status explicitly
    const lifecycleStatus = 'active'; 
    const taskWithStatus = { ...contentWithoutLogs, lifecycleStatus };

    const { error } = await supabase.from(TABLE_TASKS).insert({
        id: task.id, 
        stage: task.stage, 
        content: taskWithStatus,
        time_logs: timeLogs || [],
        lifecycle_status: lifecycleStatus // Column
    });
    if (error) throw error;
    return { ...task, lifecycleStatus };
  }

  async updateTask(updatedTask: Task): Promise<Task> {
    const { timeLogs, ...contentWithoutLogs } = updatedTask;
    // Ensure status aligns with timestamps if manually manipulated, though we prefer explicit status
    let status = updatedTask.lifecycleStatus || 'active';
    if (updatedTask.deletedAt) status = 'deleted';
    else if (updatedTask.archivedAt) status = 'archived';

    const { error } = await supabase.from(TABLE_TASKS).update({
        stage: updatedTask.stage, 
        updated_at: new Date(), 
        content: contentWithoutLogs,
        time_logs: timeLogs || [],
        lifecycle_status: status // Column update
    }).eq('id', updatedTask.id);
    if (error) throw error;
    return updatedTask;
  }

  // --- Deletion, Archiving & Import/Export ---

  async softDeleteTask(taskId: string): Promise<void> {
      const { data } = await supabase.from(TABLE_TASKS).select('content').eq('id', taskId).single();
      if(data) {
          const updatedContent = { 
              ...data.content, 
              deletedAt: new Date(),
              lifecycleStatus: 'deleted' 
          };
          await supabase.from(TABLE_TASKS).update({ 
              content: updatedContent,
              lifecycle_status: 'deleted' 
          }).eq('id', taskId);
      }
  }

  async restoreTask(taskId: string): Promise<void> {
      const { data } = await supabase.from(TABLE_TASKS).select('content').eq('id', taskId).single();
      if(data) {
          const updatedContent = { 
              ...data.content, 
              deletedAt: null, 
              archivedAt: null, // Clear archive too if restoring
              lifecycleStatus: 'active'
          };
          await supabase.from(TABLE_TASKS).update({ 
              content: updatedContent,
              lifecycle_status: 'active'
          }).eq('id', taskId);
      }
  }

  // New: Archive Task
  async archiveTask(taskId: string): Promise<void> {
      const { data } = await supabase.from(TABLE_TASKS).select('content').eq('id', taskId).single();
      if(data) {
          const updatedContent = { 
              ...data.content, 
              archivedAt: new Date(),
              lifecycleStatus: 'archived'
          };
          await supabase.from(TABLE_TASKS).update({ 
              content: updatedContent,
              lifecycle_status: 'archived'
          }).eq('id', taskId);
      }
  }

  // New: Unarchive Task
  async unarchiveTask(taskId: string): Promise<void> {
      const { data } = await supabase.from(TABLE_TASKS).select('content').eq('id', taskId).single();
      if(data) {
          const updatedContent = { 
              ...data.content, 
              archivedAt: null,
              lifecycleStatus: 'active'
          };
          await supabase.from(TABLE_TASKS).update({ 
              content: updatedContent,
              lifecycle_status: 'active'
          }).eq('id', taskId);
      }
  }

  async permanentlyDeleteTask(taskId: string): Promise<void> {
      const { error } = await supabase.from(TABLE_TASKS).delete().eq('id', taskId);
      if (error) throw error;
  }

  async importTasks(tasks: Task[]): Promise<void> {
      if(tasks.length === 0) return;
      const rows = tasks.map(t => {
          const { timeLogs, ...content } = t;
          // Infer status if missing
          let status = t.lifecycleStatus || 'active';
          if (t.deletedAt) status = 'deleted';
          else if (t.archivedAt) status = 'archived';

          return {
              id: t.id,
              stage: t.stage,
              content: { ...content, lifecycleStatus: status },
              time_logs: timeLogs || [],
              created_at: new Date(),
              updated_at: new Date(),
              lifecycle_status: status
          };
      });
      const { error } = await supabase.from(TABLE_TASKS).upsert(rows);
      if(error) throw error;
  }

  // --- OPTIMIZED UPLOAD (Deduplication) ---
  
  // Calculate SHA-256 Hash of file content
  private async calculateFileHash(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async uploadFile(file: File): Promise<string> {
    try {
      // 0. Compress image if it's an image and over 1MB
      const processedFile = await compressImage(file, 1);

      // 1. Calculate Content Hash (SHA-256)
      const hash = await this.calculateFileHash(processedFile);
      
      // 2. Determine Extension & Build Path
      const fileExt = processedFile.name.split('.').pop()?.toLowerCase() || 'bin';
      const filePath = `${hash}.${fileExt}`;

      // 3. Check if file already exists in Storage (Deduplication)
      // Note: `list` returns files in the folder. We look for the exact filename.
      const { data: existingFiles } = await supabase.storage
        .from(BUCKET_NAME)
        .list('', { search: filePath });

      if (existingFiles && existingFiles.length > 0) {
        // Double check exact match (search is partial sometimes)
        const exactMatch = existingFiles.find(f => f.name === filePath);
        if (exactMatch) {
            console.log('Duplicate file detected (Deduplicated), returning existing URL:', filePath);
            const { data: { publicUrl } } = supabase.storage.from(BUCKET_NAME).getPublicUrl(filePath);
            return publicUrl;
        }
      }

      // 4. Upload if new
      // We use the hash as the filename. This ensures uniqueness based on content.
      const { error } = await supabase.storage.from(BUCKET_NAME).upload(filePath, processedFile);
      if (error) throw error;
      
      const { data: { publicUrl } } = supabase.storage.from(BUCKET_NAME).getPublicUrl(filePath);
      return publicUrl;
    } catch (e) {
      console.error('Upload failed, using local blob:', e);
      return URL.createObjectURL(file);
    }
  }

  // --- Seeding ---
  async seedDatabase(): Promise<{success: boolean, error?: any}> {
    try {
        await supabase.from(TABLE_ROLES).upsert(INITIAL_ROLES.map(r => ({
            id: r.id, name: r.name, permissions: r.permissions, is_system: r.isSystem
        })));
        await this.saveSystemSettings(INITIAL_STAGES, INITIAL_FIELDS);

        const typesRows = INITIAL_TASK_TYPES.map(t => ({
            id: t.id, name: t.name, fields: { workflow: t.workflow, fieldMatrix: t.fieldMatrix }
        }));
        await supabase.from(TABLE_TYPES).upsert(typesRows);

        const targetEmail = 'sean.cai@hofan.cn';
        let targetUser: User | null = null;
        
        const { data: profileData } = await supabase.from(TABLE_PROFILES).select('*').eq('email', targetEmail).single();
        if (profileData) {
            targetUser = {
                id: profileData.id,
                name: profileData.full_name,
                role: profileData.role,
                avatar: profileData.avatar_url
            };
        } else {
             const { data: anyUser } = await supabase.from(TABLE_PROFILES).select('*').limit(1).single();
             if (anyUser) {
                 targetUser = {
                    id: anyUser.id,
                    name: anyUser.full_name,
                    role: anyUser.role,
                    avatar: anyUser.avatar_url
                 };
             }
        }

        for (const task of INITIAL_TASKS) {
             const taskToInsert = { ...task };
             if (targetUser) {
                 taskToInsert.owner = targetUser;
                 taskToInsert.timeline = taskToInsert.timeline.map(e => ({...e, actor: targetUser! }));
             }
             
             const { timeLogs, ...content } = taskToInsert;

             await supabase.from(TABLE_TASKS).upsert({
                id: taskToInsert.id, 
                stage: taskToInsert.stage, 
                content: content, 
                time_logs: timeLogs || [],
                created_at: taskToInsert.createdAt, 
                updated_at: new Date(),
                lifecycle_status: 'active'
             });
        }
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e };
    }
  }

  private hydrateTask(json: any, columnStatus?: string): Task {
    const task = JSON.parse(JSON.stringify(json), (key, value) => {
      if (['deadline', 'createdAt', 'startDate', 'timestamp', 'launchDate', 'sampleArrivalDate', 'deletedAt', 'archivedAt', 'startTime', 'endTime'].includes(key) && value) {
        return new Date(value);
      }
      return value;
    });

    if (!task.workStatus) task.workStatus = 'not_started';
    if (!task.tags) task.tags = [];
    if (!task.timeLogs) task.timeLogs = [];
    
    // Lifecycle Hydration Logic
    // Priority: Column > JSON Field > Inference
    if (columnStatus) {
        task.lifecycleStatus = columnStatus;
    } else if (!task.lifecycleStatus) {
        // Fallback Inference
        if (task.deletedAt) task.lifecycleStatus = 'deleted';
        else if (task.archivedAt) task.lifecycleStatus = 'archived';
        else task.lifecycleStatus = 'active';
    }
    
    return task;
  }
}

export const db = new DatabaseService();
