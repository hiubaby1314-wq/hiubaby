import React, { useState } from 'react';
import Sidebar from './components/Sidebar.tsx';
import Dashboard from './components/Dashboard.tsx';
import ChatInterface from './components/ChatInterface.tsx';
import VisionInterface from './components/VisionInterface.tsx';
import ImageGenInterface from './components/ImageGenInterface.tsx';
import VideoGenInterface from './components/VideoGenInterface.tsx';
import ImageEditInterface from './components/ImageEditInterface.tsx';
import { ViewState } from './types.ts';
import { LanguageProvider } from './contexts/LanguageContext.tsx';

const AppContent: React.FC = () => {
    const [currentView, setCurrentView] = useState<ViewState>(ViewState.DASHBOARD);

    const renderContent = () => {
        switch (currentView) {
            case ViewState.DASHBOARD:
                return <Dashboard />;
            case ViewState.CHAT:
                return <ChatInterface />;
            case ViewState.VISION:
                return <VisionInterface />;
            case ViewState.IMAGE_GEN:
                return <ImageGenInterface />;
            case ViewState.VIDEO_GEN:
                return <VideoGenInterface />;
            case ViewState.IMAGE_EDIT:
                return <ImageEditInterface />;
            default:
                return <Dashboard />;
        }
    };

    return (
        <div className="flex h-screen w-full bg-gray-950 overflow-hidden">
            <Sidebar currentView={currentView} onViewChange={setCurrentView} />
            
            <main className="flex-1 flex flex-col h-full relative">
                {/* Subtle background gradient */}
                <div className="absolute inset-0 bg-gradient-to-br from-blue-900/10 via-transparent to-purple-900/10 pointer-events-none" />
                
                <div className="flex-1 p-8 overflow-y-auto relative z-10">
                    {renderContent()}
                </div>
            </main>
        </div>
    );
};

const App: React.FC = () => {
    return (
        <LanguageProvider>
            <AppContent />
        </LanguageProvider>
    );
};

export default App;