import React, { useState, useEffect } from 'react';
import { Film, Download, PlayCircle } from 'lucide-react';
import { generateVideo } from '../services/geminiService.ts';
import { GeneratedVideo } from '../types.ts';
import LoadingSpinner from './LoadingSpinner.tsx';
import { useLanguage } from '../contexts/LanguageContext.tsx';

const VideoGenInterface: React.FC = () => {
    const { t } = useLanguage();
    const [prompt, setPrompt] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [history, setHistory] = useState<GeneratedVideo[]>([]);
    const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);

    const loadingMessages = [
        t('video.loading.1'),
        t('video.loading.2'),
        t('video.loading.3'),
        t('video.loading.4'),
        t('video.loading.5')
    ];

    useEffect(() => {
        let interval: number;
        if (isLoading) {
            interval = window.setInterval(() => {
                setLoadingMessageIndex((prev) => (prev + 1) % loadingMessages.length);
            }, 8000); // Change message every 8 seconds
        } else {
            setLoadingMessageIndex(0);
        }
        return () => clearInterval(interval);
    }, [isLoading, loadingMessages.length]);

    const handleGenerate = async () => {
        if (!prompt.trim() || isLoading) return;

        setIsLoading(true);
        setError(null);

        try {
            const videoUrl = await generateVideo(prompt);
            const newVideo: GeneratedVideo = {
                id: Date.now().toString(),
                url: videoUrl,
                prompt: prompt,
                timestamp: Date.now()
            };
            setHistory(prev => [newVideo, ...prev]);
        } catch (err) {
            setError(t('video.error'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleDownload = async (url: string, filename: string) => {
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `animation-${filename}.mp4`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(blobUrl);
        } catch (e) {
            console.error("Download failed", e);
        }
    };

    return (
        <div className="h-full flex flex-col gap-6">
            {/* Top Control Area */}
            <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6">
                <div className="max-w-3xl mx-auto">
                    <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                        <Film className="text-blue-400" />
                        {t('video.title')}
                    </h2>
                    <p className="text-gray-400 mb-6">{t('video.subtitle')}</p>
                    
                    <div className="flex gap-4">
                        <input
                            type="text"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
                            placeholder={t('video.placeholder')}
                            className="flex-1 bg-gray-950 border border-gray-700 rounded-xl py-4 px-5 text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
                        />
                        <button
                            onClick={handleGenerate}
                            disabled={!prompt.trim() || isLoading}
                            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-800 disabled:text-gray-500 text-white px-8 rounded-xl font-medium transition-colors flex items-center gap-2 whitespace-nowrap"
                        >
                            {isLoading ? <LoadingSpinner size={20} className="text-white" /> : <Film size={20} />}
                            {isLoading ? t('video.generating') : t('video.generate')}
                        </button>
                    </div>
                    {error && <p className="text-red-400 mt-3 text-sm">{error}</p>}
                </div>
            </div>

            {/* Gallery Area */}
            <div className="flex-1 bg-gray-900 rounded-2xl border border-gray-800 p-6 overflow-y-auto">
                <h3 className="text-lg font-medium text-gray-300 mb-6">{t('video.recent')}</h3>
                
                {history.length === 0 && !isLoading ? (
                    <div className="h-64 flex flex-col items-center justify-center text-gray-500 border-2 border-dashed border-gray-800 rounded-xl">
                        <PlayCircle size={48} className="mb-4 opacity-50" />
                        <p>{t('video.empty')}</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {isLoading && (
                            <div className="aspect-video bg-gray-950 rounded-xl border border-gray-800 flex flex-col items-center justify-center p-6 text-center">
                                <LoadingSpinner size={40} className="mb-6" />
                                <p className="text-blue-400 font-medium animate-pulse">
                                    {loadingMessages[loadingMessageIndex]}
                                </p>
                            </div>
                        )}
                        {history.map((vid) => (
                            <div key={vid.id} className="group relative aspect-video bg-gray-950 rounded-xl border border-gray-800 overflow-hidden flex flex-col">
                                <video 
                                    src={vid.url} 
                                    controls
                                    loop
                                    className="w-full h-full object-cover bg-black"
                                />
                                <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 to-transparent p-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                                    <p className="text-white text-sm line-clamp-2">{vid.prompt}</p>
                                </div>
                                <button 
                                    onClick={() => handleDownload(vid.url, vid.id)}
                                    className="absolute bottom-4 right-4 bg-black/60 hover:bg-black/80 backdrop-blur-md text-white py-2 px-4 rounded-lg flex items-center justify-center gap-2 text-sm font-medium transition-colors opacity-0 group-hover:opacity-100"
                                >
                                    <Download size={16} />
                                    {t('video.download')}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default VideoGenInterface;