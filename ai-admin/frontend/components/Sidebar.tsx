import React from 'react';
import { LayoutDashboard, MessageSquare, Image as ImageIcon, Sparkles, Settings, Globe, Film, Wand2, Layers } from 'lucide-react';
import { ViewState } from '../types.ts';
import { useLanguage } from '../contexts/LanguageContext.tsx';

interface SidebarProps {
    currentView: ViewState;
    onViewChange: (view: ViewState) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentView, onViewChange }) => {
    const { t, lang, setLang } = useLanguage();

    const navItems = [
        { id: ViewState.DASHBOARD, label: t('nav.dashboard'), icon: LayoutDashboard },
        { id: ViewState.CHAT, label: t('nav.chat'), icon: MessageSquare },
        { id: ViewState.VISION, label: t('nav.vision'), icon: ImageIcon },
        { id: ViewState.IMAGE_GEN, label: t('nav.image'), icon: Sparkles },
        { id: ViewState.VIDEO_GEN, label: t('nav.video'), icon: Film },
        { id: ViewState.IMAGE_EDIT, label: t('nav.edit'), icon: Wand2 },
    ];

    const toggleLanguage = () => {
        setLang(lang === 'EN' ? 'ZH' : 'EN');
    };

    return (
        <div className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col h-full">
            <div className="p-6 flex flex-col gap-1">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center shadow-lg shadow-brand-500/20">
                        <Layers className="w-5 h-5 text-white" />
                    </div>
                    <h1 className="text-xl font-bold text-white tracking-tight">{t('app.title')}</h1>
                </div>
                <a 
                    href="https://lizisucaiwang.online/" 
                    target="_blank" 
                    rel="noreferrer" 
                    className="text-xs text-gray-500 hover:text-brand-500 transition-colors ml-11"
                >
                    lizisucaiwang.online
                </a>
            </div>

            <nav className="flex-1 px-4 space-y-2 mt-2 overflow-y-auto">
                {navItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = currentView === item.id;
                    return (
                        <button
                            key={item.id}
                            onClick={() => onViewChange(item.id)}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                                isActive 
                                    ? 'bg-brand-600/10 text-brand-500 font-medium' 
                                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                            }`}
                        >
                            <Icon className={`w-5 h-5 ${isActive ? 'text-brand-500' : ''}`} />
                            {item.label}
                        </button>
                    );
                })}
            </nav>

            <div className="p-4 border-t border-gray-800 space-y-2">
                <button 
                    onClick={toggleLanguage}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
                >
                    <Globe className="w-5 h-5" />
                    {t('lang.switch')}
                </button>
                <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors">
                    <Settings className="w-5 h-5" />
                    {t('nav.settings')}
                </button>
            </div>
        </div>
    );
};

export default Sidebar;