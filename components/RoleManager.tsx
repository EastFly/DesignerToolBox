
import React, { useState, useEffect } from 'react';
import { RoleDef, Permission } from '../types';
import { AVAILABLE_PERMISSIONS } from '../constants';
import { Plus, Trash2, Check, Shield, Lock, Save, Loader2, RotateCcw } from 'lucide-react';
import { Language, translations } from '../i18n';
import { db } from '../services/db';

interface RoleManagerProps {
  roles: RoleDef[];
  setRoles: (roles: RoleDef[]) => void;
  language: Language;
}

export const RoleManager: React.FC<RoleManagerProps> = ({ roles, setRoles, language }) => {
  const t = translations[language];
  
  // Local state to track changes before saving
  const [localRoles, setLocalRoles] = useState<RoleDef[]>(roles);
  const [selectedRole, setSelectedRole] = useState<RoleDef>(roles[0]);
  
  const [isCreating, setIsCreating] = useState(false);
  const [newRoleData, setNewRoleData] = useState({ id: '', name: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Sync with props if they change externally (e.g. initial load) AND we don't have dirty changes
  useEffect(() => {
      if (!hasChanges && roles.length > 0) {
          setLocalRoles(roles);
          if (roles.length > 0 && (!selectedRole || !roles.find(r => r.id === selectedRole.id))) {
              setSelectedRole(roles[0]);
          }
      }
  }, [roles, hasChanges]);

  // Sync selectedRole reference when localRoles updates
  useEffect(() => {
      const current = localRoles.find(r => r.id === selectedRole?.id);
      if (current) setSelectedRole(current);
  }, [localRoles, selectedRole]);

  const handlePermissionToggle = (permKey: Permission) => {
    if (!selectedRole) return;
    
    const hasPermission = selectedRole.permissions.includes(permKey);
    let newPermissions: Permission[];
    
    if (hasPermission) {
      newPermissions = selectedRole.permissions.filter(p => p !== permKey);
    } else {
      newPermissions = [...selectedRole.permissions, permKey];
    }

    const updatedRole = { ...selectedRole, permissions: newPermissions };
    
    // Update Local State Only
    const updatedRoles = localRoles.map(r => r.id === selectedRole.id ? updatedRole : r);
    setLocalRoles(updatedRoles);
    setHasChanges(true);
  };

  const handleCreateRole = async () => {
    if (!newRoleData.id || !newRoleData.name) return;
    
    const newRole: RoleDef = {
      id: newRoleData.id,
      name: newRoleData.name,
      permissions: [],
      isSystem: false
    };

    try {
        await db.createRole(newRole);
        // Add to local state immediately
        const updated = [...localRoles, newRole];
        setLocalRoles(updated);
        setRoles(updated); // Sync parent immediately for Create
        setSelectedRole(newRole);
        setIsCreating(false);
        setNewRoleData({ id: '', name: '' });
    } catch (e) {
        alert('Failed to create role. ID might already exist.');
    }
  };

  const handleDeleteRole = async (id: string) => {
    if (!window.confirm(t.deleteRoleConfirm)) return;
    
    try {
        await db.deleteRole(id);
        const filtered = localRoles.filter(r => r.id !== id);
        setLocalRoles(filtered);
        setRoles(filtered); // Sync parent immediately for Delete
        if (selectedRole.id === id) setSelectedRole(filtered[0]);
    } catch (e) {
        console.error(e);
    }
  };

  const handleSave = async () => {
      setIsSaving(true);
      try {
          await db.saveRoles(localRoles);
          setRoles(localRoles); // Sync to parent/app state
          setHasChanges(false);
          alert(language === 'cn' ? '权限已保存' : 'Permissions saved successfully');
      } catch(e) {
          console.error(e);
          alert('Failed to save roles');
      } finally {
          setIsSaving(false);
      }
  };

  const handleDiscard = () => {
      if(window.confirm('Discard unsaved changes?')) {
          setLocalRoles(roles);
          setHasChanges(false);
      }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 flex overflow-hidden">
          {/* Sidebar List */}
          <div className="w-1/4 bg-gray-50 border-r border-gray-200 flex flex-col shrink-0">
            <div className="p-4 border-b border-gray-200">
               {!isCreating ? (
                 <button 
                   onClick={() => setIsCreating(true)} 
                   className="w-full bg-white border border-gray-300 text-gray-700 py-2 rounded-md hover:bg-gray-100 flex items-center justify-center text-sm font-medium"
                 >
                   <Plus size={16} className="mr-2"/> {t.createRole}
                 </button>
               ) : (
                 <div className="space-y-2 bg-white p-3 rounded shadow-sm border border-indigo-100">
                    <input 
                      className="w-full border border-gray-300 rounded px-2 py-1 text-xs" 
                      placeholder={t.roleIdPlaceholder}
                      value={newRoleData.id}
                      onChange={e => setNewRoleData({...newRoleData, id: e.target.value.replace(/\s+/g, '_')})}
                    />
                    <input 
                      className="w-full border border-gray-300 rounded px-2 py-1 text-xs" 
                      placeholder={t.roleNamePlaceholder}
                      value={newRoleData.name}
                      onChange={e => setNewRoleData({...newRoleData, name: e.target.value})}
                    />
                    <div className="flex gap-2">
                        <button onClick={handleCreateRole} className="flex-1 bg-indigo-600 text-white text-xs py-1 rounded">{t.btn_add}</button>
                        <button onClick={() => setIsCreating(false)} className="flex-1 bg-gray-200 text-gray-700 text-xs py-1 rounded">{t.btn_cancel}</button>
                    </div>
                 </div>
               )}
            </div>
            <div className="flex-1 overflow-y-auto">
               {localRoles.map(role => (
                 <div 
                   key={role.id}
                   onClick={() => setSelectedRole(role)}
                   className={`p-3 cursor-pointer flex justify-between items-center hover:bg-gray-100 ${selectedRole?.id === role.id ? 'bg-indigo-50 border-l-4 border-indigo-600' : ''}`}
                 >
                    <div className="flex items-center">
                        {role.isSystem && <Lock size={12} className="text-gray-400 mr-2"/>}
                        <span className="font-medium text-sm text-gray-700">{role.name}</span>
                    </div>
                    {!role.isSystem && (
                        <button onClick={(e) => {e.stopPropagation(); handleDeleteRole(role.id)}} className="text-gray-400 hover:text-red-500">
                            <Trash2 size={14} />
                        </button>
                    )}
                 </div>
               ))}
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 bg-white p-8 overflow-y-auto">
             {selectedRole && (
                 <>
                     <div className="mb-6 pb-6 border-b border-gray-100">
                         <h3 className="text-2xl font-bold text-gray-800 flex items-center">
                            {selectedRole.name}
                            {selectedRole.isSystem && <span className="ml-3 bg-gray-100 text-gray-500 text-xs px-2 py-1 rounded-full font-normal border border-gray-200 flex items-center"><Shield size={10} className="mr-1"/> {t.systemRole}</span>}
                         </h3>
                         <p className="text-gray-500 text-sm mt-1">Role ID: <span className="font-mono bg-gray-100 px-1 rounded">{selectedRole.id}</span></p>
                     </div>

                     <div>
                         <h4 className="font-bold text-gray-700 mb-4">{t.permissions}</h4>
                         <div className="grid grid-cols-2 gap-4">
                             {AVAILABLE_PERMISSIONS.map(perm => {
                                 const isChecked = selectedRole.permissions.includes(perm.key);
                                 return (
                                     <label 
                                        key={perm.key} 
                                        className={`flex items-center p-3 rounded-lg border cursor-pointer transition-all ${
                                            isChecked 
                                            ? 'bg-indigo-50 border-indigo-200 shadow-sm' 
                                            : 'bg-white border-gray-200 hover:bg-gray-50'
                                        }`}
                                     >
                                         <div className={`w-5 h-5 rounded border flex items-center justify-center mr-3 ${
                                             isChecked ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-gray-300'
                                         }`}>
                                             {isChecked && <Check size={12} className="text-white"/>}
                                         </div>
                                         <input 
                                            type="checkbox" 
                                            className="hidden"
                                            checked={isChecked}
                                            onChange={() => handlePermissionToggle(perm.key)}
                                         />
                                         <div>
                                             <div className="text-sm font-medium text-gray-900">
                                                 {(t as any)[`perm_${perm.key.replace('.', '_')}`] || perm.label}
                                             </div>
                                             <div className="text-xs text-gray-500 font-mono mt-0.5">{perm.key}</div>
                                         </div>
                                     </label>
                                 );
                             })}
                         </div>
                     </div>
                 </>
             )}
          </div>
      </div>

      {/* Footer for Saving */}
      <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-between items-center shrink-0">
          <div className="text-sm text-gray-500 italic">
              {hasChanges ? (language === 'cn' ? '有未保存的更改' : 'Unsaved changes') : ''}
          </div>
          <div className="flex gap-3">
              {hasChanges && (
                  <button 
                    onClick={handleDiscard}
                    className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg font-medium flex items-center transition-colors"
                  >
                      <RotateCcw size={16} className="mr-2"/> {t.cancel}
                  </button>
              )}
              <button 
                  onClick={handleSave} 
                  disabled={!hasChanges || isSaving}
                  className={`px-6 py-2 rounded-lg font-medium flex items-center transition-all shadow-sm ${
                      hasChanges 
                      ? 'bg-indigo-600 text-white hover:bg-indigo-700' 
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  }`}
              >
                {isSaving ? <Loader2 size={16} className="mr-2 animate-spin"/> : <Save size={16} className="mr-2" />}
                {t.save}
              </button>
          </div>
      </div>
    </div>
  );
};
