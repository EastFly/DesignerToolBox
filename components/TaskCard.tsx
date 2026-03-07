
import React, { useState } from 'react';
import { Clock, AlertTriangle, FileImage, PlayCircle, CheckCircle2, CircleDashed, Archive, Loader2, Zap } from 'lucide-react';
import { Task, Priority, WorkStatus } from '../types';
import { differenceInHours, endOfDay } from 'date-fns';
import { Language, translations } from '../i18n';
import { PRODUCT_LEVEL_WEIGHTS, DIFFICULTY_WEIGHTS } from '../constants';

interface TaskCardProps {
  task: Task;
  onClick: (task: Task) => void;
  language: Language;
  isCompletedStage?: boolean; // New Prop to override status if in final stage
  onArchive?: (taskId: string) => Promise<void>; // Optional archive handler
}

export const TaskCard: React.FC<TaskCardProps> = ({ task, onClick, language, isCompletedStage, onArchive }) => {
  const t = translations[language];
  const [isArchiving, setIsArchiving] = useState(false);
  
  // LOGIC: Deadline is strictly the End of the Day (23:59:59) of the selected date.
  const deadlineEndOfDay = endOfDay(new Date(task.deadline));
  
  // Logic to determine the "comparison time" for deadline calculation
  let comparisonTime = new Date(); // Default to Now (for active tasks)
  const isDone = isCompletedStage || task.workStatus === 'completed';
  
  if (isDone) {
      // Find the last significant event (Completed/Moved to Done)
      const completionEvent = [...task.timeline].reverse().find(e => 
          e.action.includes('Moved to') || e.action.includes('Completed') || e.action.includes('Done') || e.action.includes('完成')
      );
      if (completionEvent) {
          comparisonTime = new Date(completionEvent.timestamp);
      }
  }

  // CALCULATION: 
  // differenceInHours(Left, Right) > 0 means Left is after Right.
  // We want: Deadline - Actual.
  // If Result > 0: Time was remaining. (Finished Early or Active & On Track)
  // If Result < 0: Time passed deadline. (Finished Late or Active & Overdue)
  const hoursDiff = differenceInHours(deadlineEndOfDay, comparisonTime);
  
  // Traffic Light System Logic for Time
  let timeColor = 'text-green-600';
  let timeLeftText = '';
  let borderClass = 'border-l-4 border-l-transparent'; // Default no colored border unless overdue/warning

  if (isDone) {
      // COMPLETED TASK DISPLAY
      if (hoursDiff >= 0) {
          // Finished Early
          timeColor = 'text-green-700 font-bold';
          timeLeftText = language === 'cn' ? `提前 (+${hoursDiff}h)` : `Early (+${hoursDiff}h)`;
      } else {
          // Finished Late
          timeColor = 'text-red-600 font-bold';
          timeLeftText = language === 'cn' ? `延期 (${hoursDiff}h)` : `Late (${hoursDiff}h)`;
      }
  } else {
      // ACTIVE TASK DISPLAY
      if (hoursDiff < 0) {
        borderClass = 'border-l-4 border-l-red-500';
        timeLeftText = `${t.overdue} ${Math.abs(hoursDiff)}h`;
        timeColor = 'text-red-600 font-bold';
      } else if (hoursDiff < 24) {
        borderClass = 'border-l-4 border-l-yellow-500';
        timeLeftText = `${hoursDiff}${t.hoursLeft}`;
        timeColor = 'text-yellow-600 font-medium';
      } else {
        timeLeftText = `${hoursDiff}${t.hoursLeft}`;
      }
  }

  // Calculate Value
  const levelWeight = PRODUCT_LEVEL_WEIGHTS[task.productLevel || 'B'] || 1.0;
  const difficultyWeight = DIFFICULTY_WEIGHTS[task.difficulty || 'Medium'] || 1.0;
  const hours = task.estimatedHours || 4;
  const taskValue = Math.round(hours * levelWeight * difficultyWeight * 10) / 10;

  // Priority Badge
  const getPriorityBadge = (p: Priority) => {
    switch (p) {
      case Priority.P0: return <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-[10px] font-bold rounded uppercase border border-red-200">P0</span>;
      case Priority.P1: return <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded uppercase border border-blue-200">P1</span>;
      case Priority.P2: return <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-[10px] font-bold rounded uppercase border border-gray-200">P2</span>;
    }
  };

  // Status Indicator
  const getStatusIndicator = (s: WorkStatus) => {
      // If we are in the completed stage, force "Done" display
      if (isCompletedStage || s === 'completed') {
          return (
            <div className="flex items-center text-[10px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                <CheckCircle2 size={10} className="mr-1"/> Done
            </div>
          );
      }

      switch(s) {
          case 'in_progress': 
            return (
                <div className="flex items-center text-[10px] font-bold text-green-700 bg-green-50 px-1.5 py-0.5 rounded border border-green-200">
                    <PlayCircle size={10} className="mr-1 fill-green-100"/> In Progress
                </div>
            );
          case 'not_started':
          default:
            return (
                <div className="flex items-center text-[10px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">
                    <CircleDashed size={10} className="mr-1"/> Todo
                </div>
            );
      }
  };

  const handleArchiveClick = async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!onArchive) return;
      if (!window.confirm(t.archiveConfirm)) return;
      
      setIsArchiving(true);
      try {
          await onArchive(task.id);
      } catch (e) {
          console.error("Archive failed", e);
      } finally {
          setIsArchiving(false);
      }
  };

  // Safe access for product image
  const productImages = task.identity && (task.identity as any).productImage;
  const mainProductImage = Array.isArray(productImages) && productImages.length > 0 ? productImages[0] : null;

  return (
    <div 
      onClick={() => onClick(task)}
      className={`relative group rounded-lg shadow-sm hover:shadow-md transition-all p-3 mb-3 cursor-pointer bg-white border border-gray-200 ${borderClass}`}
    >
      {/* Header: Priority & ID & Status */}
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-2">
            {getPriorityBadge(task.priority)}
            <span className="text-[10px] text-gray-400 font-mono">{task.id}</span>
        </div>
        <div className="flex items-center gap-2">
            {/* Value Badge */}
            <div className="flex items-center text-[10px] font-bold text-yellow-700 bg-yellow-50 px-1.5 py-0.5 rounded border border-yellow-200" title={`Value: ${taskValue} (Level ${task.productLevel || 'B'} x Diff ${task.difficulty || 'M'} x ${hours}h)`}>
                <Zap size={8} className="mr-0.5 fill-yellow-400 text-yellow-600"/> {taskValue}
            </div>
            {getStatusIndicator(task.workStatus)}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex gap-3 mb-3">
        {/* Thumbnail Priority: Product Image -> Final Design -> AI -> Asset */}
        <div className="w-16 h-16 bg-gray-100 rounded-md overflow-hidden flex-shrink-0 border border-gray-200 relative">
            {mainProductImage ? (
                 <img src={mainProductImage || undefined} alt="Product" className="w-full h-full object-cover" />
            ) : task.finalDesigns.length > 0 ? (
                 <img src={task.finalDesigns[0] || undefined} alt="Final" className="w-full h-full object-cover" />
            ) : task.aiGeneratedImages.length > 0 ? (
                <img src={task.aiGeneratedImages[0] || undefined} alt="AI" className="w-full h-full object-cover opacity-90" />
            ) : task.assets.originalFiles?.length > 0 ? (
                <img src={task.assets.originalFiles[0] || undefined} alt="Asset" className="w-full h-full object-cover grayscale opacity-70" />
            ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-300">
                    <FileImage size={24} strokeWidth={1.5} />
                </div>
            )}
        </div>
        
        <div className="overflow-hidden flex-1">
            <h3 className="text-sm font-bold text-gray-800 leading-tight mb-1 truncate" title={task.identity.productName}>
                {task.identity.productName}
            </h3>
            <p className="text-xs text-gray-500 mb-1.5 truncate font-mono">
                {task.identity.sku}
            </p>
            {/* TAGS DISPLAY - Showing first 3 tags */}
            <div className="flex flex-wrap gap-1">
                 {(task.tags || []).slice(0, 3).map((tag: string, i: number) => (
                     <span key={i} className="text-[9px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded border border-indigo-100 max-w-[80px] truncate" title={tag}>
                        {tag}
                     </span>
                 ))}
                 {(task.tags?.length || 0) > 3 && (
                     <span className="text-[9px] text-gray-400 px-1">+{task.tags.length - 3}</span>
                 )}
            </div>
        </div>
      </div>

      {/* Footer: SLA & Owner & Archive */}
      <div className="flex justify-between items-end border-t border-gray-50 pt-2">
        <div className={`flex items-center space-x-1 text-xs ${timeColor}`}>
            {isDone ? (
                // Icon for Done state (Check if Early, Alert if Late)
                hoursDiff >= 0 ? <CheckCircle2 size={12}/> : <AlertTriangle size={12}/>
            ) : (
                hoursDiff < 0 ? <AlertTriangle size={12} strokeWidth={2.5} /> : <Clock size={12} />
            )}
            <span className="font-medium">{timeLeftText}</span>
        </div>
        
        <div className="flex items-center gap-2">
             {/* Archive Button (Moved to footer for visibility) */}
             {(isDone && onArchive) && (
                  <button 
                      onClick={handleArchiveClick}
                      disabled={isArchiving}
                      className="text-gray-400 hover:text-indigo-600 p-1 rounded-md transition-colors"
                      title={t.archiveTooltip}
                  >
                      {isArchiving ? <Loader2 size={14} className="animate-spin"/> : <Archive size={14} />}
                  </button>
             )}

             <div className="flex items-center -space-x-2">
                 <div className="w-6 h-6 rounded-full border border-white shadow-sm overflow-hidden" title={`${t.owner}: ${task.owner.name}`}>
                    <img src={task.owner.avatar || undefined} alt={task.owner.name} className="w-full h-full object-cover" />
                 </div>
             </div>
        </div>
      </div>
    </div>
  );
};
