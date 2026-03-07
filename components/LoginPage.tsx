
import React, { useState } from 'react';
import { User } from '../types';
import { USERS } from '../constants';
import { LayoutGrid, ArrowRight, Database, AlertCircle, Loader2, Mail, Lock, User as UserIcon, Briefcase, HelpCircle, Wrench } from 'lucide-react';
import { db } from '../services/db';
import { SetupWizard } from './SetupWizard';
import { translations, Language } from '../i18n';

interface LoginPageProps {
    onLogin: (user: User) => void;
    currentLanguage: Language;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLogin, currentLanguage }) => {
    const t = translations[currentLanguage];
    
    // UI State
    const [isRegistering, setIsRegistering] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [showEmailFixHelp, setShowEmailFixHelp] = useState(false);
    const [showFixProfileBtn, setShowFixProfileBtn] = useState(false); // New state for profile missing
    
    // Form Data
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [fullName, setFullName] = useState('');
    const [role, setRole] = useState<'PD'|'Ops'|'DD'|'Designer'>('Designer');

    // DB Init State (Wizard logic kept only for auto-triggered errors, not manual button)
    const [showWizard, setShowWizard] = useState(false);
    const [wizardErrorType, setWizardErrorType] = useState<'MISSING_TABLES' | 'RLS_ERROR'>('MISSING_TABLES');

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMsg(null);
        setShowEmailFixHelp(false);
        setShowFixProfileBtn(false);
        setIsLoading(true);

        try {
            if (isRegistering) {
                if (!email || !password || !fullName) {
                    throw new Error(t.fillAllFields);
                }
                
                // Triggers "handle_new_user" in DB which sets status = 'pending'
                await db.signUp(email, password, { full_name: fullName, role });
                
                alert(t.registerSuccess + '\n' + t.accountPending);
                setIsRegistering(false); // Switch back to login
            } else {
                if (!email || !password) {
                    throw new Error(t.fillAllFields);
                }

                // 1. Sign In
                const { user: authUser } = await db.signIn(email, password);
                if (!authUser) throw new Error("Login failed");

                // 2. Fetch Profile & Check Status
                // If this returns null, it means the SQL Trigger didn't run or table doesn't exist
                const profile = await db.getCurrentUserProfile(authUser.id);
                
                if (!profile) {
                   throw new Error('PROFILE_MISSING');
                }

                // 3. Check Approval Status
                if ((profile as any).isPending) {
                    await db.signOut();
                    throw new Error(t.accountPending); // "Account pending approval..."
                }

                // 4. Success
                onLogin(profile);
            }
        } catch (err: any) {
            console.error(err);
            let msg = err.message || t.authError;
            
            // Handle Specific Errors
            if (msg.includes('Email not confirmed')) {
                msg = t.emailNotConfirmed;
                setShowEmailFixHelp(true);
            } else if (msg.includes('Invalid login credentials')) {
                msg = t.invalidCredentials;
            } else if (msg === 'PROFILE_MISSING') {
                msg = t.profileNotFound;
                setShowFixProfileBtn(true);
            } else if (msg.includes('Profile not found')) {
                // Fallback for any legacy error text
                msg = t.profileNotFound;
                setShowFixProfileBtn(true);
            }
            
            setErrorMsg(msg);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4 relative overflow-hidden">
            {/* Background Decorations */}
            <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-indigo-600/30 rounded-full blur-3xl"></div>
            <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-purple-600/30 rounded-full blur-3xl"></div>

            <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl flex overflow-hidden z-10 min-h-[500px]">
                {/* Left: Branding & Info */}
                <div className="w-2/5 bg-indigo-600 text-white p-10 flex flex-col justify-between hidden md:flex">
                    <div>
                        <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center mb-6">
                            <LayoutGrid size={24} className="text-white" />
                        </div>
                        <h1 className="text-3xl font-bold mb-2">{t.appTitle}</h1>
                        <p className="text-indigo-200">{t.subtitle}</p>
                    </div>
                    <div className="space-y-4">
                        <div className="bg-white/10 p-4 rounded-lg backdrop-blur-sm">
                            <h3 className="font-semibold text-sm mb-1">{t.collaborationReady}</h3>
                            <p className="text-xs text-indigo-100 opacity-80">{t.realTimeSync}</p>
                        </div>
                        <p className="text-xs text-indigo-300">{t.version}</p>
                    </div>
                </div>

                {/* Right: Auth Form */}
                <div className="flex-1 p-10 flex flex-col justify-center">
                    <h2 className="text-2xl font-bold text-gray-800 mb-2">
                        {isRegistering ? t.register : t.login}
                    </h2>
                    <p className="text-sm text-gray-500 mb-6">
                        {isRegistering ? t.haveAccount : t.noAccount}{' '}
                        <button 
                            onClick={() => { setIsRegistering(!isRegistering); setErrorMsg(null); setShowEmailFixHelp(false); setShowFixProfileBtn(false); }}
                            className="text-indigo-600 font-medium hover:underline"
                        >
                             {isRegistering ? t.login : t.register}
                        </button>
                    </p>

                    {errorMsg && (
                        <div className="mb-4 p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg flex flex-col items-start gap-2 animate-fade-in-up">
                            <div className="flex items-center">
                                <AlertCircle size={16} className="mr-2 shrink-0" />
                                {errorMsg}
                            </div>
                            {showEmailFixHelp && (
                                <button 
                                    onClick={() => setShowWizard(true)}
                                    className="ml-6 text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200 flex items-center"
                                >
                                    <HelpCircle size={12} className="mr-1"/>
                                    {t.howToDisableEmail}
                                </button>
                            )}
                            {showFixProfileBtn && (
                                <button 
                                    onClick={() => {
                                        setWizardErrorType('RLS_ERROR'); // Use this mode to show the SQL
                                        setShowWizard(true);
                                    }}
                                    className="ml-6 text-xs bg-red-600 text-white px-3 py-1.5 rounded hover:bg-red-700 flex items-center shadow-sm font-bold"
                                >
                                    <Wrench size={12} className="mr-1.5"/>
                                    {t.repairDatabase}
                                </button>
                            )}
                        </div>
                    )}

                    <form onSubmit={handleAuth} className="space-y-4">
                        {isRegistering && (
                            <>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">{t.fullName}</label>
                                    <div className="relative">
                                        <UserIcon size={18} className="absolute left-3 top-2.5 text-gray-400" />
                                        <input 
                                            type="text" 
                                            required
                                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                                            value={fullName}
                                            onChange={e => setFullName(e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">{t.role}</label>
                                    <div className="relative">
                                        <Briefcase size={18} className="absolute left-3 top-2.5 text-gray-400" />
                                        <select 
                                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                                            value={role}
                                            onChange={e => setRole(e.target.value as any)}
                                        >
                                            <option value="Designer">Designer</option>
                                            <option value="PD">Product Director (PD)</option>
                                            <option value="Ops">Operations (Ops)</option>
                                            <option value="DD">Design Director (DD)</option>
                                        </select>
                                    </div>
                                </div>
                            </>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">{t.email}</label>
                            <div className="relative">
                                <Mail size={18} className="absolute left-3 top-2.5 text-gray-400" />
                                <input 
                                    type="email" 
                                    required
                                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">{t.password}</label>
                            <div className="relative">
                                <Lock size={18} className="absolute left-3 top-2.5 text-gray-400" />
                                <input 
                                    type="password" 
                                    required
                                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                />
                            </div>
                        </div>

                        <button 
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 transition-colors flex items-center justify-center disabled:opacity-70"
                        >
                            {isLoading ? <Loader2 className="animate-spin" /> : (
                                <>
                                    {isRegistering ? t.register : t.login} <ArrowRight size={18} className="ml-2"/>
                                </>
                            )}
                        </button>
                    </form>
                </div>
            </div>

            {showWizard && (
                <SetupWizard 
                    language={currentLanguage} 
                    onRetry={() => {
                        setShowWizard(false);
                    }} 
                    onClose={() => setShowWizard(false)}
                    errorType={wizardErrorType}
                />
            )}
        </div>
    );
};
