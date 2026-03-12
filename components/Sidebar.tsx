
import React from 'react';
import { LayoutGrid, BarChart2, LogOut, Workflow, Package, Archive, Dices, Zap, Moon, PenTool, Briefcase } from 'lucide-react';
import { User } from '../types';
import { Language, translations } from '../i18n';

export type ViewType = 'board' | 'stats' | 'prompt_builder' | 'products' | 'archived' | 'playground' | 'dice_storm' | 'midnight_missions' | 'dice_management' | 'designer_toolbox' | 'operator_toolbox';

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
  canAccessDiceStorm: boolean;
  canAccessMidnight: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({ 
    currentUser, activeView, setActiveView, language, onLogout, 
    canViewStats, canManageProducts, canManagePrompts,
    canAccessPlayground, canAccessDiceStorm, canAccessMidnight
}) => {
  const t = translations[language];

  const MenuItem = ({ view, icon: Icon, label, disabled = false }: { view: ViewType, icon: any, label: string, disabled?: boolean }) => (
      <button 
          onClick={() => !disabled && setActiveView(view)}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all mb-1 ${
              activeView === view 
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' 
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
          } ${disabled ? 'opacity-50 cursor-not-allowed hidden' : ''}`}
      >
          <Icon size={20} strokeWidth={activeView === view ? 2.5 : 2} />
          <span className="font-medium text-sm">{label}</span>
      </button>
  );

  return (
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col h-full shrink-0">
        {/* Logo Area */}
        <div className="p-6 flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-indigo-200 shadow-lg">
                <LayoutGrid className="text-white w-5 h-5" />
            </div>
            <div>
                <h1 className="text-lg font-bold text-gray-900 leading-none">DesignFlow</h1>
                <span className="text-[10px] text-gray-400 font-medium">Workspace V2.9</span>
            </div>
        </div>

        {/* Navigation */}
        <div className="flex-1 px-4 py-4 space-y-1">
            <div className="text-xs font-bold text-gray-400 uppercase px-3 mb-2 tracking-wider">{t.sidebar_main}</div>
            <MenuItem view="board" icon={LayoutGrid} label={t.appTitle} /> 
            <MenuItem view="stats" icon={BarChart2} label={t.dashboardStats} disabled={!canViewStats} />
            
            {/* Product Management Group */}
            {(canManageProducts || canAccessPlayground || canAccessDiceStorm || canAccessMidnight) && (
                <>
                    <div className="text-xs font-bold text-gray-400 uppercase px-3 mt-6 mb-2 tracking-wider">{t.product_management}</div>
                    <MenuItem view="products" icon={Package} label={t.product_management} disabled={!canManageProducts} />
                    <MenuItem view="playground" icon={Dices} label={t.pg_title} disabled={!canAccessPlayground} />
                    <MenuItem view="dice_management" icon={Dices} label="Dice Management" disabled={!canAccessPlayground} />
                    <MenuItem view="dice_storm" icon={Zap} label={t.ds_title} disabled={!canAccessDiceStorm} />
                    <MenuItem view="midnight_missions" icon={Moon} label="Midnight Missions" disabled={!canAccessMidnight} />
                    <MenuItem view="designer_toolbox" icon={PenTool} label="Designer Toolbox" disabled={!canAccessMidnight} />
                    <MenuItem view="operator_toolbox" icon={Briefcase} label="Operator Toolbox" disabled={!canAccessMidnight} />
                </>
            )}

            <div className="text-xs font-bold text-gray-400 uppercase px-3 mt-6 mb-2 tracking-wider">{t.sidebar_system}</div>
            <MenuItem view="prompt_builder" icon={Workflow} label={t.prompt_builder} disabled={!canManagePrompts} />
            <MenuItem view="archived" icon={Archive} label={t.archivedTasks} />
        </div>

        {/* Bottom Section */}
        <div className="p-4 border-t border-gray-200 mt-auto">
            <div className="flex items-center justify-center text-[10px] text-gray-400 font-mono">
                Build 20260306.2126
            </div>
        </div>
    </div>
  );
};
