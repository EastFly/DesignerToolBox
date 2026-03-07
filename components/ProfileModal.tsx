
import React, { useState, useEffect } from 'react';
import { X, User as UserIcon, Mail, Shield, Calendar, Edit2, Save, Upload, Activity, CheckCircle2, Clock, PlayCircle, Hash, LayoutDashboard } from 'lucide-react';
import { User, Task, Priority, FullUserProfile, StageDef } from '../types';
import { Language, translations } from '../i18n';
import { format } from 'date-fns';
import { db } from '../services/db';

interface ProfileModalProps {
  currentUser: FullUserProfile;
  tasks: Task[]; 
  isOpen: boolean;
  onClose: () => void;
  language: Language;
  onUpdateUser: (updatedUser: FullUserProfile) => void;
  allStages: StageDef[];
}

export const ProfileModal: React.FC<ProfileModalProps> = ({ currentUser, tasks, isOpen, onClose, language, onUpdateUser, allStages }) => {
  const t = translations[language];
  
  // Edit State
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(currentUser.name);
  const [isUploading, setIsUploading] = useState(false);
  
  useEffect(() => {
     if(isOpen) {
         setEditName(currentUser.name);
         setIsEditing(false);
     }
  }, [isOpen, currentUser]);

  if (!isOpen) return null;

  // --- STATS CALCULATION ---
  const lastStageId = allStages[allStages.length - 1]?.id || 'done';
  const myTasks = tasks.filter(t => t.owner.id === currentUser.id);
  
  // Active: In Progress AND Not in the last stage
  const activeCount = myTasks.filter(t => t.workStatus === 'in_progress' && t.stage !== lastStageId).length;
  
  // Completed: Status is 'completed' OR it is in the last stage (Completed/Done)
  const completedCount = myTasks.filter(t => t.workStatus === 'completed' || t.stage === lastStageId).length;
  
  const p0Count = myTasks.filter(t => t.priority === Priority.P0 && t.stage !== lastStageId).length;
  
  // Recent Activity Logic
  // 1. Flatten all task timelines
  // 2. Filter by actor = current user
  // 3. Sort desc
  // 4. Slice to a reasonable "Recent" limit (e.g., 50) to avoid performance issues, relying on scroll for access.
  const allEvents = tasks.flatMap(task => 
      task.timeline.map(event => ({ ...event, taskName: task.identity.productName, taskId: task.id }))
  ).filter(e => e.actor.id === currentUser.id)
   .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
   .slice(0, 50);

  const handleSaveProfile = async () => {
      try {
          await db.updateSelfProfile({ full_name: editName });
          onUpdateUser({ ...currentUser, name: editName });
          setIsEditing(false);
      } catch (e) {
          alert("Failed to update profile");
      }
  };

  const handleAvatarUpload = async (file: File) => {
      setIsUploading(true);
      try {
          const url = await db.uploadFile(file);
          await db.updateSelfProfile({ avatar_url: url });
          onUpdateUser({ ...currentUser, avatar: url });
      } catch (e) {
          console.error(e);
          alert("Failed to upload avatar");
      } finally {
          setIsUploading(false);
      }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      {/* Container: Matches WorkspaceModal style (Rounded, Shadow, White) */}
      <div className="bg-white w-full max-w-5xl h-[85vh] rounded-2xl shadow-2xl flex overflow-hidden animate-fade-in-up relative">
         
         {/* Close Button (Floating) */}
         <button 
            onClick={onClose} 
            className="absolute top-4 right-4 z-10 text-gray-400 hover:text-gray-600 p-2 rounded-full hover:bg-gray-100 transition-colors"
         >
             <X size={24}/>
         </button>

         {/* SIDEBAR: IDENTITY (White Background) */}
         <div className="w-80 bg-white border-r border-gray-200 flex flex-col p-8 items-center text-center shrink-0 overflow-y-auto">
             {/* Avatar Area */}
             <div className="relative group mb-6">
                 <div className="w-32 h-32 rounded-full p-1 border-2 border-indigo-100 shadow-sm">
                     <img src={currentUser.avatar || undefined} alt="Profile" className="w-full h-full rounded-full object-cover"/>
                 </div>
                 <label className="absolute bottom-0 right-0 bg-white text-indigo-600 p-2 rounded-full shadow-md border border-gray-100 cursor-pointer hover:bg-indigo-50 transition-colors">
                     {isUploading ? <div className="animate-spin w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full"/> : <Upload size={16} />}
                     <input type="file" className="hidden" accept="image/*" onChange={(e) => e.target.files && handleAvatarUpload(e.target.files[0])} disabled={isUploading}/>
                 </label>
             </div>

             {/* Name & Role */}
             <div className="mb-8 w-full">
                 {isEditing ? (
                     <div className="flex flex-col gap-2">
                         <label className="text-xs font-bold text-gray-400 text-left w-full uppercase">{t.lbl_display_name}</label>
                         <input 
                            className="border border-gray-300 rounded-lg px-3 py-2 text-lg font-bold text-center w-full focus:ring-2 focus:ring-indigo-500 outline-none"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                         />
                     </div>
                 ) : (
                     <h2 className="text-2xl font-bold text-gray-900 mb-2 break-words">{currentUser.name}</h2>
                 )}
                 
                 <span className="inline-flex items-center px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-bold uppercase tracking-wide border border-indigo-100 mt-1">
                    {currentUser.role}
                 </span>
             </div>

             {/* Actions */}
             <div className="w-full mb-8">
                 {isEditing ? (
                     <div className="flex gap-2">
                         <button onClick={handleSaveProfile} className="flex-1 bg-indigo-600 text-white py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2 hover:bg-indigo-700 transition-colors">
                             <Save size={16}/> {t.save}
                         </button>
                         <button onClick={() => setIsEditing(false)} className="flex-1 bg-white border border-gray-200 text-gray-600 py-2.5 rounded-lg font-medium text-sm hover:bg-gray-50 transition-colors">
                             {t.cancel}
                         </button>
                     </div>
                 ) : (
                     <button onClick={() => setIsEditing(true)} className="w-full bg-white border border-gray-300 text-gray-700 py-2.5 rounded-lg font-medium text-sm hover:bg-gray-50 flex items-center justify-center gap-2 transition-colors">
                         <Edit2 size={16}/> {t.editProfile}
                     </button>
                 )}
             </div>

             {/* Meta Info - USING REAL DATA NOW */}
             <div className="w-full space-y-4 text-left border-t border-gray-100 pt-6">
                 <div className="flex items-center text-sm text-gray-600 group">
                     <div className="w-8 flex justify-center"><Mail size={16} className="text-gray-400 group-hover:text-indigo-500 transition-colors"/></div>
                     <span className="truncate flex-1" title={currentUser.email}>{currentUser.email || 'No email'}</span>
                 </div>
                 <div className="flex items-center text-sm text-gray-600 group">
                     <div className="w-8 flex justify-center"><Shield size={16} className="text-gray-400 group-hover:text-indigo-500 transition-colors"/></div>
                     <span>{currentUser.status === 'approved' ? t.lbl_verified : currentUser.status}</span>
                 </div>
                 <div className="flex items-center text-sm text-gray-600 group">
                     <div className="w-8 flex justify-center"><Calendar size={16} className="text-gray-400 group-hover:text-indigo-500 transition-colors"/></div>
                     <span>{t.joined} {currentUser.createdAt ? format(new Date(currentUser.createdAt), 'yyyy/MM/dd') : '-'}</span>
                 </div>
             </div>
         </div>

         {/* MAIN CONTENT: DASHBOARD (Gray Background for Contrast) */}
         <div className="flex-1 bg-gray-50 flex flex-col min-w-0">
             
             {/* Stats Section */}
             <div className="p-8 pb-2">
                 <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center">
                     <LayoutDashboard className="mr-3 text-indigo-600" strokeWidth={2.5}/> {t.dashboardStats}
                 </h2>
                 
                 <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                     {/* Active Card */}
                     <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-col hover:border-indigo-300 transition-colors">
                         <div className="flex justify-between items-start mb-4">
                             <div className="bg-indigo-50 p-2.5 rounded-lg text-indigo-600"><PlayCircle size={20}/></div>
                             <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t.status_in_progress}</span>
                         </div>
                         <div className="text-3xl font-bold text-gray-900 mb-1">{activeCount}</div>
                         <div className="text-xs text-gray-500">{t.stat_active_tasks}</div>
                     </div>

                     {/* Completed Card */}
                     <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-col hover:border-green-300 transition-colors">
                         <div className="flex justify-between items-start mb-4">
                             <div className="bg-green-50 p-2.5 rounded-lg text-green-600"><CheckCircle2 size={20}/></div>
                             <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t.status_completed}</span>
                         </div>
                         <div className="text-3xl font-bold text-gray-900 mb-1">{completedCount}</div>
                         <div className="text-xs text-gray-500">{t.stat_all_time}</div>
                     </div>

                     {/* Urgent Card */}
                     <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-col hover:border-red-300 transition-colors">
                         <div className="flex justify-between items-start mb-4">
                             <div className="bg-red-50 p-2.5 rounded-lg text-red-600"><Hash size={20}/></div>
                             <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Urgent (P0)</span>
                         </div>
                         <div className="text-3xl font-bold text-gray-900 mb-1">{p0Count}</div>
                         <div className="text-xs text-gray-500">{t.stat_requires_attention}</div>
                     </div>
                 </div>
             </div>

             {/* Activity Section (Fill Remaining Space) */}
             <div className="flex-1 px-8 pb-8 min-h-0 flex flex-col">
                 <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center pt-4 sticky top-0 bg-gray-50 z-10">
                     <Clock className="mr-2 text-gray-400" size={20}/> {t.recentActivity}
                 </h3>
                 
                 <div className="flex-1 overflow-y-auto bg-white rounded-xl border border-gray-200 shadow-sm p-0 custom-scrollbar">
                     {allEvents.length === 0 ? (
                         <div className="h-full flex flex-col items-center justify-center text-gray-400 italic">
                             <Activity size={32} className="mb-2 opacity-20"/>
                             No recent activity found.
                         </div>
                     ) : (
                         <div className="divide-y divide-gray-100">
                             {allEvents.map((event, i) => (
                                 <div key={i} className="p-4 flex items-start hover:bg-gray-50 transition-colors group">
                                     <div className="w-24 shrink-0 pt-0.5">
                                         <span className="text-xs font-mono text-gray-400 bg-gray-100 px-2 py-1 rounded inline-block">
                                             {format(new Date(event.timestamp), 'MM-dd HH:mm')}
                                         </span>
                                     </div>
                                     <div className="flex-1 pl-4 border-l-2 border-transparent group-hover:border-indigo-100 transition-colors">
                                         <p className="text-sm text-gray-800">
                                             <span className="font-semibold">{event.action}</span>
                                             <span className="text-gray-300 mx-2">•</span>
                                             <span className="text-indigo-600 font-medium">{event.taskName}</span>
                                         </p>
                                     </div>
                                 </div>
                             ))}
                             {allEvents.length >= 50 && (
                                 <div className="p-4 text-center text-xs text-gray-400 italic bg-gray-50">
                                     Showing last 50 activities.
                                 </div>
                             )}
                         </div>
                     )}
                 </div>
             </div>
         </div>
      </div>
    </div>
  );
};
