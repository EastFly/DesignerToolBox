
import React, { useState } from 'react';
import { FullUserProfile, RoleDef, ProfileStatus } from '../types';
import { db } from '../services/db';
import { Language, translations } from '../i18n';
import { Search, Mail, Shield, UserX, UserCheck, RefreshCw, Save, X, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

interface UserManagerProps {
  users: FullUserProfile[];
  roles: RoleDef[];
  setUsers: (users: FullUserProfile[]) => void;
  language: Language;
}

export const UserManager: React.FC<UserManagerProps> = ({ users, roles, setUsers, language }) => {
  const t = translations[language];
  const [search, setSearch] = useState('');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  
  // Track pending changes locally: { [userId]: { role: '...', status: '...' } }
  const [pendingChanges, setPendingChanges] = useState<Record<string, Partial<FullUserProfile>>>({});

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(search.toLowerCase()) || 
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.role.toLowerCase().includes(search.toLowerCase())
  );

  // Update local pending state, do not save to DB yet
  const stageChange = (userId: string, field: keyof FullUserProfile, value: any) => {
      setPendingChanges(prev => ({
          ...prev,
          [userId]: {
              ...prev[userId],
              [field]: value
          }
      }));
  };

  const handleCommitChanges = async (userId: string) => {
      const changes = pendingChanges[userId];
      if (!changes) return;

      setLoadingId(userId);
      try {
          // Perform API Update
          await db.updateUserProfile(userId, { 
              role: changes.role, 
              status: changes.status 
          });

          // Update Parent State
          setUsers(users.map(u => u.id === userId ? { ...u, ...changes } : u));
          
          // Clear Pending State for this user
          const newPending = { ...pendingChanges };
          delete newPending[userId];
          setPendingChanges(newPending);

      } catch (e) {
          alert('Failed to update user');
          console.error(e);
      } finally {
          setLoadingId(null);
      }
  };

  const handleDiscardChanges = (userId: string) => {
      const newPending = { ...pendingChanges };
      delete newPending[userId];
      setPendingChanges(newPending);
  };

  const handleResetPassword = async (email: string) => {
    if(!window.confirm(`Send password reset email to ${email}?`)) return;
    try {
        await db.resetPasswordEmail(email);
        alert(t.resetSent);
    } catch(e) {
        alert('Failed to send reset email');
    }
  };

  const getStatusBadge = (status: ProfileStatus) => {
      switch(status) {
          case 'approved': return <span className="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-bold">{t.statusApproved}</span>;
          case 'pending': return <span className="bg-yellow-100 text-yellow-700 px-2 py-1 rounded text-xs font-bold">{t.statusPending}</span>;
          case 'rejected': return <span className="bg-red-100 text-red-700 px-2 py-1 rounded text-xs font-bold">{t.statusRejected}</span>;
          case 'blocked': return <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs font-bold">{t.statusBlocked}</span>;
      }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Toolbar */}
      <div className="p-6 border-b border-gray-100 flex justify-between items-center">
        <h3 className="text-xl font-bold text-gray-800">{t.userManagement}</h3>
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
          <input 
            type="text" 
            placeholder="Search users..." 
            className="pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-64"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto p-6">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500 text-xs uppercase tracking-wide">
              <th className="py-3 pl-2">{t.fullName}</th>
              <th className="py-3">{t.role}</th>
              <th className="py-3">{t.status}</th>
              <th className="py-3">{t.joined}</th>
              <th className="py-3 text-right">{t.th_actions}</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map(user => {
              const pending = pendingChanges[user.id];
              const displayRole = pending?.role || user.role;
              const displayStatus = pending?.status || user.status;
              const hasChanges = !!pending;

              return (
                <tr key={user.id} className={`border-b border-gray-50 transition-colors ${hasChanges ? 'bg-indigo-50/60' : 'hover:bg-gray-50'}`}>
                  <td className="py-4 pl-2">
                    <div className="flex items-center">
                      <img src={user.avatar || undefined} className="w-8 h-8 rounded-full mr-3 border border-gray-200" alt=""/>
                      <div>
                          <div className="font-medium text-gray-900 text-sm">{user.name}</div>
                          <div className="text-xs text-gray-500 flex items-center"><Mail size={10} className="mr-1"/> {user.email}</div>
                      </div>
                    </div>
                  </td>
                  
                  {/* Role Dropdown */}
                  <td className="py-4">
                    <select 
                      value={displayRole}
                      disabled={loadingId === user.id}
                      onChange={(e) => stageChange(user.id, 'role', e.target.value)}
                      className={`border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 ${
                          pending?.role ? 'border-indigo-300 bg-white font-semibold text-indigo-700' : 'border-gray-200 bg-white'
                      }`}
                    >
                       {roles.map(r => (
                           <option key={r.id} value={r.id}>{r.name}</option>
                       ))}
                    </select>
                  </td>

                  {/* Status Dropdown */}
                  <td className="py-4">
                     <select
                        value={displayStatus}
                        disabled={loadingId === user.id}
                        onChange={(e) => stageChange(user.id, 'status', e.target.value)}
                        className={`border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 mr-2 ${
                            pending?.status ? 'border-indigo-300 bg-white font-semibold text-indigo-700' : 'border-gray-200 bg-white'
                        }`}
                     >
                         <option value="pending">{t.statusPending}</option>
                         <option value="approved">{t.statusApproved}</option>
                         <option value="rejected">{t.statusRejected}</option>
                         <option value="blocked">{t.statusBlocked}</option>
                     </select>
                     {!hasChanges && getStatusBadge(user.status)}
                  </td>

                  <td className="py-4 text-sm text-gray-500">
                      {format(user.createdAt, 'yyyy-MM-dd')}
                  </td>

                  {/* Actions Column */}
                  <td className="py-4 text-right">
                     {loadingId === user.id ? (
                         <div className="flex justify-end pr-2"><Loader2 size={18} className="animate-spin text-indigo-600"/></div>
                     ) : hasChanges ? (
                         <div className="flex justify-end gap-2 animate-fade-in-up">
                             <button 
                                onClick={() => handleCommitChanges(user.id)}
                                className="flex items-center px-3 py-1.5 bg-green-600 text-white rounded text-xs font-bold hover:bg-green-700 shadow-sm"
                                title={t.save}
                             >
                                 <Save size={14} className="mr-1"/> {t.save}
                             </button>
                             <button 
                                onClick={() => handleDiscardChanges(user.id)}
                                className="flex items-center px-2 py-1.5 bg-white border border-gray-300 text-gray-600 rounded text-xs font-bold hover:bg-gray-100"
                                title={t.discardChanges}
                             >
                                 <X size={14}/>
                             </button>
                         </div>
                     ) : (
                         <div className="flex justify-end space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                             {/* Reset Password */}
                             <button onClick={() => handleResetPassword(user.email)} className="text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 p-1 rounded" title={t.resetPassword}>
                                 <RefreshCw size={16}/>
                             </button>
                         </div>
                     )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
