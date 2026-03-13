
import React, { useState, useEffect, useMemo } from 'react';
import { 
  User, Task, StageDef, TaskTypeConfig, RoleDef, FullUserProfile, 
  FieldDefinition, PromptFlow, Priority, Permission 
} from './types';
import { db, ConnectionStatus } from './services/db';
import { Header, FilterState } from './components/Header';
import { Sidebar, ViewType } from './components/Sidebar';
import { TaskCard } from './components/TaskCard';
import { NewTaskModal } from './components/NewTaskModal';
import { WorkspaceModal } from './components/WorkspaceModal';
import { SettingsModal } from './components/SettingsModal';
import { LoginPage } from './components/LoginPage';
import { StatsView } from './components/StatsView';
import { ModelStatsView } from './components/ModelStatsView';
import { TrashModal } from './components/TrashModal';
import { ProfileModal } from './components/ProfileModal';
import { ArchivedTasksView } from './components/ArchivedTasksView';
import { PromptBuilderView } from './components/PromptBuilderView';
import { ProductManager } from './components/ProductManager';
import { PlaygroundView } from './components/PlaygroundView';
import { DiceManagementView } from './components/DiceManagementView';
import { DiceStormView } from './components/DiceStormView'; 
import { MidnightMissionsView } from './components/MidnightMissionsView'; // New
import { DesignerToolboxView } from './components/DesignerToolboxView';
import { OperatorToolboxView } from './components/OperatorToolboxView';
import { XLabView } from './components/XLabView';
import { ArchiveConfirmModal } from './components/ArchiveConfirmModal';
import { PublicShareView } from './components/PublicShareView';
import { Language, translations } from './i18n';
import { INITIAL_STAGES, INITIAL_FIELDS, INITIAL_TASK_TYPES, INITIAL_ROLES } from './constants';
import { Loader2, Plus, AlertCircle } from 'lucide-react';

const App: React.FC = () => {
  // --- Auth & Connection State ---
  const [currentUser, setCurrentUser] = useState<FullUserProfile | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('CONNECTED');
  const [isLoading, setIsLoading] = useState(true);

  // --- Data State ---
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<FullUserProfile[]>([]);
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [stages, setStages] = useState<StageDef[]>(INITIAL_STAGES);
  const [fields, setFields] = useState<FieldDefinition[]>(INITIAL_FIELDS);
  const [taskTypes, setTaskTypes] = useState<TaskTypeConfig[]>(INITIAL_TASK_TYPES);
  const [promptFlows, setPromptFlows] = useState<PromptFlow[]>([]);

  // --- UI State ---
  const [activeView, setActiveView] = useState<ViewType>('board');
  const [editingDiceId, setEditingDiceId] = useState<string | null>(null);
  const [language, setLanguage] = useState<Language>('en');
  const [searchQuery, setSearchQuery] = useState('');
  const [publicShareLinkId, setPublicShareLinkId] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    priority: [],
    timeStatus: null,
    assigneeId: null,
    myTasks: false
  });

  // --- Modal States ---
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isTrashOpen, setIsTrashOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  
  // Archive Modal State
  const [taskToArchive, setTaskToArchive] = useState<Task | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);

  // --- Permissions Helper ---
  const can = (permission: Permission): boolean => {
    if (!currentUser) return false;
    if (currentUser.role === 'Admin') return true;
    const userRole = roles.find(r => r.id === currentUser.role);
    return userRole ? userRole.permissions.includes(permission) : false;
  };

  // --- Initialization ---
  useEffect(() => {
    // Check for public share link in URL
    const path = window.location.pathname;
    if (path.startsWith('/share/')) {
      const linkId = path.split('/share/')[1];
      if (linkId) {
        setPublicShareLinkId(linkId);
        setIsLoading(false);
        return; // Don't do normal init if it's a public share view
      }
    }

    const init = async () => {
      setIsLoading(true);
      const status = await db.checkConnection();
      setConnectionStatus(status);

      if (status === 'CONNECTED') {
        try {
          const user = await db.getSessionUser();
          
          const [
            sysSettings, 
            fetchedRoles, 
            fetchedTypes, 
            fetchedFlows,
            currentUserProfile
          ] = await Promise.all([
            db.getSystemSettings(),
            db.getRoles(),
            db.getTaskTypes(),
            db.getPromptFlows(),
            user ? db.getCurrentUserProfile(user.id).catch(() => null) : Promise.resolve(null)
          ]);

          setStages(sysSettings.stages.length > 0 ? sysSettings.stages : INITIAL_STAGES);
          setFields(sysSettings.fields.length > 0 ? sysSettings.fields : INITIAL_FIELDS);
          setRoles(fetchedRoles.length > 0 ? fetchedRoles : INITIAL_ROLES);
          setTaskTypes(fetchedTypes.length > 0 ? fetchedTypes : INITIAL_TASK_TYPES);
          setPromptFlows(fetchedFlows);

          if (currentUserProfile && !(currentUserProfile as any).isPending) {
            setCurrentUser(currentUserProfile);
          }
        } catch (e) {
          console.error("Initialization error", e);
        }
      }
      setIsLoading(false);
    };
    init();
  }, []);

  // --- Data Loading (Post Login) ---
  const loadData = async () => {
    if (!currentUser) return;
    setIsLoading(true);
    try {
      const [fetchedTasks, fetchedUsers] = await Promise.all([
        db.getTasks(),
        db.getAllProfiles()
      ]);
      setTasks(fetchedTasks);
      setUsers(fetchedUsers);
    } catch(e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (currentUser) {
      loadData();
    }
  }, [currentUser?.id]); // Reload when user changes/logs in

  // Auto-redirect if user lands on board but doesn't have dashboard access
  useEffect(() => {
    if (currentUser && roles.length > 0 && activeView === 'board' && !can('dashboard.access')) {
        if (can('products.manage') || can('projects.access')) setActiveView('products');
        else if (can('stats.view') || can('analytics.access')) setActiveView('stats');
        else if (can('prompt.manage')) setActiveView('prompt_builder');
        else if (can('playground.access')) setActiveView('playground');
        else if (can('xlab.access')) setActiveView('x_lab');
        else if (can('dicestorm.access')) setActiveView('dice_storm');
        else if (can('midnight.access')) setActiveView('midnight_missions');
    }
  }, [currentUser, roles, activeView]);

  // --- Handlers ---

  const handleLogin = (user: User) => {
    // Cast User to FullUserProfile if possible, or fetch full profile
    // The LoginPage returns FullUserProfile
    setCurrentUser(user as FullUserProfile);
  };

  const handleLogout = async () => {
    await db.signOut();
    setCurrentUser(null);
    setTasks([]);
  };

  const handleCreateTask = async (taskData: any) => {
    const newTask: Task = {
      ...taskData,
      id: `T-${Date.now()}`,
      stage: taskTypes.find(t => t.id === taskData.type)?.workflow[0] || stages[0].id,
      workStatus: 'not_started',
      owner: currentUser!, // Assign to creator by default or from form
      createdAt: new Date(),
      deadline: taskData.identity.launchDate || new Date(), // Fallback
      timeline: [{ 
        id: `e-${Date.now()}`, 
        actor: currentUser!, 
        action: translations[language].createdTask, 
        timestamp: new Date() 
      }],
      lifecycleStatus: 'active', // Explicit active status
      tags: [],
      aiGeneratedImages: [],
      finalDesigns: [],
      timeLogs: []
    };

    try {
      await db.createTask(newTask);
      setTasks([newTask, ...tasks]);
    } catch (e) {
      console.error("Create task failed", e);
      alert("Failed to create task");
    }
  };

  const handleUpdateTask = async (updatedTask: Task) => {
    // Optimistic update
    setTasks(tasks.map(t => t.id === updatedTask.id ? updatedTask : t));
    if (selectedTask?.id === updatedTask.id) {
        setSelectedTask(updatedTask);
    }
    // DB update handled inside WorkspaceModal usually, but ensuring sync here
    // In this app architecture, WorkspaceModal calls db.updateTask directly then calls this callback.
  };

  const handleMoveStage = async (taskId: string, newStageId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const updatedTask = {
      ...task,
      stage: newStageId,
      timeline: [
        ...task.timeline,
        { 
          id: `e-${Date.now()}`, 
          actor: currentUser!, 
          action: `${translations[language].movedTo} ${stages.find(s => s.id === newStageId)?.title}`, 
          timestamp: new Date() 
        }
      ]
    };

    setTasks(tasks.map(t => t.id === taskId ? updatedTask : t));
    await db.updateTask(updatedTask);
  };

  const handleSoftDeleteTask = async (taskId: string) => {
    // Keep in state but mark as deleted
    setTasks(tasks.map(t => t.id === taskId ? { ...t, deletedAt: new Date(), lifecycleStatus: 'deleted' } : t));
    await db.softDeleteTask(taskId);
  };

  // 1. Opens the Confirmation Modal
  const handleArchiveRequest = async (taskId: string) => {
      const task = tasks.find(t => t.id === taskId);
      if (task) setTaskToArchive(task);
  };

  // 2. Executes Archive after Confirmation
  const executeArchiveTask = async () => {
      if (!taskToArchive) return;
      setIsArchiving(true);
      try {
          await db.archiveTask(taskToArchive.id);
          // Update state with lifecycle status 'archived'
          setTasks(tasks.map(t => t.id === taskToArchive.id ? { ...t, archivedAt: new Date(), lifecycleStatus: 'archived' } : t));
          setTaskToArchive(null);
      } catch (e) {
          console.error(e);
          alert("Archive failed");
      } finally {
          setIsArchiving(false);
      }
  };

  const handleRestoreTask = async (taskId: string) => {
    await db.restoreTask(taskId);
    setTasks(tasks.map(t => t.id === taskId ? { ...t, deletedAt: null, archivedAt: null, lifecycleStatus: 'active' } : t));
  };

  const handleUnarchiveTask = async (taskId: string) => {
    await db.unarchiveTask(taskId);
    setTasks(tasks.map(t => t.id === taskId ? { ...t, archivedAt: null, lifecycleStatus: 'active' } : t));
  };

  const handlePermanentDeleteTask = async (taskId: string) => {
    await db.permanentlyDeleteTask(taskId);
    setTasks(tasks.filter(t => t.id !== taskId));
  };

  const handleSystemReset = async () => {
    await db.seedDatabase();
    window.location.reload();
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string);
        if (Array.isArray(imported)) {
           // Basic validation could go here
           await db.importTasks(imported);
           loadData(); // Refresh
           alert(translations[language].importSuccess);
        } else if (imported.id && imported.type) {
           // Single task
           await db.importTasks([imported]);
           loadData();
           alert(translations[language].importSuccess);
        }
      } catch (err) {
        alert(translations[language].importError);
      }
    };
    reader.readAsText(file);
  };

  // --- Derived State ---
  // Filter Tasks for Board - Now uses lifecycleStatus for cleaner logic
  const filteredTasks = useMemo(() => {
    const hasViewAll = can('task.view_all');

    return tasks.filter(task => {
      // 0. Permission Check (Strict Enforcement)
      if (!hasViewAll && task.owner.id !== currentUser?.id) return false;

      // 1. Must be Active
      if (task.lifecycleStatus !== 'active') return false;

      // 2. Search Query
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch = 
        task.identity.productName.toLowerCase().includes(searchLower) ||
        task.identity.sku?.toLowerCase().includes(searchLower) ||
        task.tags.some(tag => tag.toLowerCase().includes(searchLower));
      
      if (!matchesSearch) return false;

      // 3. Filters
      if (filters.priority.length > 0 && !filters.priority.includes(task.priority)) return false;
      if (filters.assigneeId && task.owner.id !== filters.assigneeId) return false;
      if (filters.myTasks && task.owner.id !== currentUser?.id) return false;
      
      // Time Status Filter
      if (filters.timeStatus) {
        const now = new Date();
        const deadline = new Date(task.deadline);
        const hoursDiff = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);
        
        if (filters.timeStatus === 'overdue' && hoursDiff >= 0) return false;
        if (filters.timeStatus === 'soon' && (hoursDiff < 0 || hoursDiff > 24)) return false;
      }

      return true;
    });
  }, [tasks, searchQuery, filters, currentUser, roles]); // Add roles dependency to recalculate 'can'

  const getActiveTaskCount = (userId: string) => {
    return tasks.filter(t => t.owner.id === userId && t.workStatus === 'in_progress' && t.lifecycleStatus === 'active').length;
  };

  // --- Render ---

  if (publicShareLinkId) {
    return <PublicShareView linkId={publicShareLinkId} language={language} />;
  }

  if (!currentUser) {
    return <LoginPage onLogin={handleLogin} currentLanguage={language} />;
  }

  const t = translations[language];

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden font-sans text-slate-800">
      <Sidebar 
        currentUser={currentUser} 
        activeView={activeView} 
        setActiveView={setActiveView} 
        language={language} 
        onLogout={handleLogout}
        canViewStats={can('stats.view') || can('analytics.access')}
        canManageProducts={can('products.manage') || can('projects.access')}
        canManagePrompts={can('prompt.manage')}
        canAccessPlayground={can('playground.access')}
        canAccessXLab={can('xlab.access')}
        canAccessDiceStorm={can('dicestorm.access')}
        canAccessMidnight={can('midnight.access')}
        canAccessDashboard={can('dashboard.access')}
        canAccessDiceManagement={can('dice.access')}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <Header 
          currentUser={currentUser}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          filters={filters}
          setFilters={setFilters}
          language={language}
          setLanguage={setLanguage}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenProfile={() => setIsProfileOpen(true)}
          onOpenTrash={() => setIsTrashOpen(true)}
          onImport={handleImport}
          connectionStatus={connectionStatus}
          onLogout={handleLogout}
          users={users}
          canViewAll={can('task.view_all')}
          canManageSettings={can('settings.manage') || can('settings.task_types') || can('settings.global_fields') || can('settings.global_stages') || can('settings.roles') || can('settings.users') || can('settings.system') || can('settings.model_usage')}
          onRefresh={loadData}
        />

        <main className="flex-1 overflow-hidden relative">
          {isLoading && (
             <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-50 flex items-center justify-center">
                <Loader2 className="animate-spin text-indigo-600" size={48} />
             </div>
          )}

          {activeView === 'board' && can('dashboard.access') && (
            <div className="h-full overflow-x-auto overflow-y-hidden p-6">
              <div className="flex gap-6 h-full min-w-max">
                {stages.map(stage => {
                  // Filter tasks for this stage
                  const stageTasks = filteredTasks.filter(t => t.stage === stage.id);
                  
                  return (
                    <div key={stage.id} className="w-80 flex flex-col h-full bg-gray-50/50 rounded-xl border border-gray-200/60 max-h-full">
                      {/* Stage Header */}
                      <div className={`p-4 border-b border-gray-100 flex justify-between items-center rounded-t-xl ${stage.color || 'bg-gray-100'} bg-opacity-20`}>
                        <div className="flex items-center gap-2">
                           <span className={`w-2.5 h-2.5 rounded-full ${stage.color ? stage.color.replace('bg-', 'bg-') : 'bg-gray-400'}`}></span>
                           <h3 className="font-bold text-gray-700 text-sm">{(t as any)[stage.id] || stage.title}</h3>
                           <span className="bg-white/50 px-2 py-0.5 rounded-full text-xs font-medium text-gray-500">{stageTasks.length}</span>
                        </div>
                        {stage.id === stages[0].id && can('task.create') && (
                           <button onClick={() => setIsNewTaskModalOpen(true)} className="text-gray-400 hover:text-indigo-600 transition-colors">
                              <Plus size={18} />
                           </button>
                        )}
                      </div>

                      {/* Task List */}
                      <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
                         {stageTasks.map(task => (
                           <TaskCard 
                              key={task.id} 
                              task={task} 
                              onClick={setSelectedTask} 
                              language={language}
                              isCompletedStage={stage.id === stages[stages.length-1].id}
                              onArchive={can('task.delete') ? handleArchiveRequest : undefined}
                           />
                         ))}
                         {stageTasks.length === 0 && (
                           <div className="text-center py-10 text-gray-300 text-xs italic">
                             No tasks
                           </div>
                         )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeView === 'stats' && (can('stats.view') || can('analytics.access')) && (
             <StatsView tasks={tasks} users={users} stages={stages} language={language} />
          )}

          {activeView === 'model_stats' && (can('stats.view') || can('analytics.access')) && (
             <ModelStatsView language={language} />
          )}

          {activeView === 'prompt_builder' && can('prompt.manage') && (
             <PromptBuilderView language={language} allFields={fields} />
          )}

          {activeView === 'products' && (can('products.manage') || can('projects.access')) && (
             <ProductManager language={language} allFields={fields} tasks={tasks} currentUser={currentUser} />
          )}

          {activeView === 'playground' && can('playground.access') && (
             <PlaygroundView 
                language={language} 
                currentUser={currentUser} 
                canManageGlobalDice={can('dice.manage_global')} 
                canAccessDiceManagement={can('dice.access')}
                onNavigateToDiceManagement={() => setActiveView('dice_management')}
                initialDiceId={editingDiceId}
                onClearInitialDiceId={() => setEditingDiceId(null)}
             />
          )}

          {activeView === 'dice_management' && can('dice.access') && (
             <DiceManagementView 
                currentUser={currentUser} 
                canManageGlobalDice={can('dice.manage_global')} 
                language={language} 
                onEditInPlayground={(diceId) => {
                    setEditingDiceId(diceId);
                    setActiveView('playground');
                }}
             />
          )}

          {activeView === 'dice_storm' && can('dicestorm.access') && (
             <DiceStormView 
                language={language} 
                currentUser={currentUser} 
                canManageGlobalDice={can('dice.manage_global')} 
                canAccessMidnight={can('midnight.access')}
                onNavigateToMidnightMissions={() => setActiveView('midnight_missions')}
             />
          )}

          {activeView === 'midnight_missions' && can('midnight.access') && (
             <MidnightMissionsView 
                language={language} 
                onNavigateBack={() => setActiveView('dice_storm')}
             /> 
          )}

          {can('midnight.access') && (
             <div className={activeView === 'designer_toolbox' ? 'h-full' : 'hidden'}>
                <DesignerToolboxView language={language} />
             </div>
          )}

          {can('midnight.access') && (
             <div className={activeView === 'operator_toolbox' ? 'h-full' : 'hidden'}>
                <OperatorToolboxView language={language} />
             </div>
          )}

          {can('xlab.access') && (
             <div className={activeView === 'x_lab' ? 'h-full' : 'hidden'}>
                <XLabView language={language} />
             </div>
          )}

          {activeView === 'archived' && can('dashboard.access') && (
             <ArchivedTasksView 
                archivedTasks={tasks.filter(t => {
                    const isArchived = t.lifecycleStatus === 'archived';
                    const hasViewAll = can('task.view_all');
                    return isArchived && (hasViewAll || t.owner.id === currentUser?.id);
                })} 
                onUnarchive={handleUnarchiveTask}
                onDeleteForever={handlePermanentDeleteTask}
                language={language}
                stages={stages}
             />
          )}

          {/* Fallback for unauthorized access */}
          {((activeView === 'board' && !can('dashboard.access')) ||
            (activeView === 'archived' && !can('dashboard.access')) ||
            (activeView === 'stats' && !can('stats.view') && !can('analytics.access')) ||
            (activeView === 'model_stats' && !can('stats.view') && !can('analytics.access')) ||
            (activeView === 'prompt_builder' && !can('prompt.manage')) ||
            (activeView === 'products' && !can('products.manage') && !can('projects.access')) ||
            (activeView === 'playground' && !can('playground.access')) ||
            (activeView === 'dice_management' && !can('dice.access')) ||
            (activeView === 'dice_storm' && !can('dicestorm.access')) ||
            (activeView === 'midnight_missions' && !can('midnight.access')) ||
            (activeView === 'designer_toolbox' && !can('midnight.access')) ||
            (activeView === 'operator_toolbox' && !can('midnight.access')) ||
            (activeView === 'x_lab' && !can('xlab.access'))) && (
             <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <div className="bg-gray-100 p-6 rounded-full mb-4">
                   <AlertCircle size={48} className="text-gray-400" />
                </div>
                <h2 className="text-xl font-bold text-gray-700 mb-2">Access Denied</h2>
                <p>You do not have permission to view this page.</p>
             </div>
          )}
        </main>
      </div>

      {/* --- MODALS --- */}

      <NewTaskModal 
        isOpen={isNewTaskModalOpen}
        onClose={() => setIsNewTaskModalOpen(false)}
        onSubmit={handleCreateTask}
        currentUser={currentUser}
        language={language}
        taskTypes={taskTypes}
        allFields={fields}
        allStages={stages}
      />

      {selectedTask && (
        <WorkspaceModal 
          task={selectedTask}
          isOpen={!!selectedTask}
          onClose={() => setSelectedTask(null)}
          onMoveStage={handleMoveStage}
          onUpdateTask={handleUpdateTask}
          onDeleteTask={can('task.delete') ? handleSoftDeleteTask : undefined}
          onArchiveTask={handleArchiveRequest}
          currentUser={currentUser}
          language={language}
          
          canEdit={can('task.edit') || currentUser.id === selectedTask.owner.id || can('task.move')}
          
          // Split Permission Logic
          canEditContent={can('task.edit') || currentUser.id === selectedTask.owner.id || can('task.move')}
          canEditCore={can('task.edit_core')}
          
          taskTypes={taskTypes}
          allFields={fields}
          allStages={stages}
          users={users}
          getActiveTaskCount={getActiveTaskCount}
          allTags={Array.from(new Set(tasks.flatMap(t => t.tags || [])))}
          promptFlows={promptFlows}
        />
      )}

      <SettingsModal 
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        language={language}
        taskTypes={taskTypes}
        roles={roles}
        users={users}
        setRoles={setRoles}
        setUsers={setUsers}
        onSaveTaskTypes={async (newTypes) => {
           setTaskTypes(newTypes);
           await db.saveTaskTypes(newTypes);
        }}
        onSaveSystemSettings={async (newStages, newFields) => {
           setStages(newStages);
           setFields(newFields);
           await db.saveSystemSettings(newStages, newFields);
        }}
        allStages={stages}
        allFields={fields}
        currentUser={currentUser}
        canManageTaskTypes={can('settings.manage') || can('settings.task_types')}
        canManageGlobalFields={can('settings.manage') || can('settings.global_fields')}
        canManageGlobalStages={can('settings.manage') || can('settings.global_stages')}
        canManageRoles={can('settings.manage') || can('settings.roles')}
        canManageUsers={can('settings.manage') || can('settings.users') || can('users.approve')}
        canManageSystem={can('settings.manage') || can('settings.system')}
        canManageModelUsage={can('settings.manage') || can('settings.model_usage')}
        onSystemReset={handleSystemReset}
      />

      <TrashModal 
        isOpen={isTrashOpen}
        onClose={() => setIsTrashOpen(false)}
        deletedTasks={tasks.filter(t => t.lifecycleStatus === 'deleted' && (can('task.view_all') || t.owner.id === currentUser?.id))}
        onRestore={handleRestoreTask}
        onPermanentDelete={handlePermanentDeleteTask}
        language={language}
      />

      <ProfileModal 
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        currentUser={currentUser}
        tasks={tasks}
        language={language}
        onUpdateUser={(updated) => {
           setCurrentUser(updated);
           setUsers(users.map(u => u.id === updated.id ? updated : u));
        }}
        allStages={stages}
      />

      {/* Archive Confirmation Modal */}
      {taskToArchive && (
          <ArchiveConfirmModal 
              isOpen={!!taskToArchive}
              onClose={() => setTaskToArchive(null)}
              onConfirm={executeArchiveTask}
              language={language}
              taskName={taskToArchive.identity.productName}
              isArchiving={isArchiving}
          />
      )}

    </div>
  );
};

export default App;
