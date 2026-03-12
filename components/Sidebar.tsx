
import React from 'react';
import { LayoutGrid, BarChart2, LogOut, Workflow, Package, Archive, Dices, Zap, Moon, PenTool, Briefcase, Database, FlaskConical, Sparkles } from 'lucide-react';
import { User } from '../types';
import { Language, translations } from '../i18n';
import { BUILD_VERSION } from '../constants';

export type ViewType = 'board' | 'stats' | 'model_stats' | 'prompt_builder' | 'products' | 'archived' | 'playground' | 'dice_storm' | 'midnight_missions' | 'dice_management' | 'designer_toolbox' | 'operator_toolbox' | 'x_lab';

interface SidebarProps {
  currentUser: User;
  activeView: ViewType;
  setActiveView: (view: ViewType) => void;
  language: Language;
  onLogout: () => void;
  canViewStats: boolean;
  canManageProducts: boolean;
  canManagePrompts: boolean;
  canAccessPlayground: boolean;
  canAccessXLab: boolean;
  canAccessDiceStorm: boolean;
  canAccessMidnight: boolean;
  canAccessDashboard: boolean;
  canAccessDiceManagement: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({ 
    currentUser, activeView, setActiveView, language, onLogout, 
    canViewStats, canManageProducts, canManagePrompts,
    canAccessPlayground, canAccessXLab, canAccessDiceStorm, canAccessMidnight,
    canAccessDashboard, canAccessDiceManagement
}) => {
  const t = translations[language];

  const MenuItem = ({ view, icon: Icon, label, disabled = false }: { view: ViewType, icon: any, label: string, disabled?: boolean }) => {
      const isHighlighted = activeView === view || (view === 'dice_storm' && activeView === 'midnight_missions');
      return (
      <button 
          onClick={() => !disabled && setActiveView(view)}
          className={`w-full items-center gap-3 px-3 py-2.5 rounded-lg transition-all mb-1 ${
              isHighlighted 
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' 
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
          } ${disabled ? 'hidden' : 'flex'}`}
      >
          <Icon size={20} strokeWidth={isHighlighted ? 2.5 : 2} />
          <span className="font-medium text-sm">{label}</span>
      </button>
  )};

  return (
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col h-full shrink-0">
        {/* Logo Area */}
        <div className="p-6">
            <div className="relative w-[100%]">
                <img 
                    src="https://urhguhdryhrgvvhfbxvx.supabase.co/storage/v1/object/public/designflow-assets/Designflow.png" 
                    alt="DesignFlow" 
                    className="w-full h-auto object-contain" 
                    referrerPolicy="no-referrer"
                />
            </div>
        </div>

        {/* Navigation */}
        <div className="flex-1 px-4 py-4 space-y-1">
            <div className="text-xs font-bold text-gray-400 uppercase px-3 mb-2 tracking-wider">{t.sidebar_main}</div>
            <MenuItem view="board" icon={LayoutGrid} label={t.appTitle} disabled={!canAccessDashboard} /> 
            <MenuItem view="stats" icon={BarChart2} label={t.dashboardStats} disabled={!canViewStats} />
            <MenuItem view="model_stats" icon={Database} label={t.modelStats} disabled={!canViewStats} />
            
            {/* Product Management Group */}
            {(canManageProducts || canAccessPlayground || canAccessDiceStorm || canAccessMidnight || canAccessDiceManagement) && (
                <>
                    <div className="text-xs font-bold text-gray-400 uppercase px-3 mt-6 mb-2 tracking-wider">{t.product_management}</div>
                    <MenuItem view="products" icon={Package} label={t.product_management} disabled={!canManageProducts} />
                    <MenuItem view="playground" icon={Dices} label={t.pg_title} disabled={!canAccessPlayground} />
                    <MenuItem view="dice_storm" icon={Zap} label={t.ds_title} disabled={!canAccessDiceStorm} />
                    <MenuItem view="designer_toolbox" icon={PenTool} label={t.dt_title} disabled={!canAccessMidnight} />
                    <MenuItem view="operator_toolbox" icon={Briefcase} label={t.ot_title} disabled={!canAccessMidnight} />
                </>
            )}

            <div className="text-xs font-bold text-gray-400 uppercase px-3 mt-6 mb-2 tracking-wider">{t.sidebar_system}</div>
            <MenuItem view="prompt_builder" icon={Workflow} label={t.prompt_builder} disabled={!canManagePrompts} />
            <MenuItem view="archived" icon={Archive} label={t.archivedTasks} disabled={!canAccessDashboard} />
            
            <div className="text-xs font-bold text-gray-400 uppercase px-3 mt-6 mb-2 tracking-wider flex items-center gap-1">
                <Sparkles size={12} className="text-amber-500" /> {t.xlab_title}
            </div>
            <MenuItem view="x_lab" icon={FlaskConical} label={t.xlab_focus_mode} disabled={!canAccessXLab} />
            
        </div>
    </div>
  );
};
