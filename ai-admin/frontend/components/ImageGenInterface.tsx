import React, { useState } from 'react';
import { Sparkles, Download, Image as ImageIcon } from 'lucide-react';
import { generateImage } from '../services/geminiService.ts';
import { GeneratedImage } from '../types.ts';
import LoadingSpinner from './LoadingSpinner.tsx';
import { useLanguage } from '../contexts/LanguageContext.tsx';

const ImageGenInterface: React.FC = () => {
    const { t } = useLanguage();
    const [prompt, setPrompt] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [history, setHistory] = useState<GeneratedImage[]>([]);

    const handleGenerate = async () => {
        if (!prompt.trim() || isLoading) return;

        setIsLoading(true);
        setError(null);

        try {
            const imageUrl = await generateImage(prompt);
            const newImage: GeneratedImage = {
                id: Date.now().toString(),
                url: imageUrl,
                prompt: prompt,
                timestamp: Date.now()
            };
            setHistory(prev => [newImage, ...prev]);
        } catch (err) {
            setError(t('image.error'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleDownload = (url: string, filename: string) => {
        const a = document.createElement('a');
        a.href = url;
        a.download = `generated-${filename}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    return (
        <div className="h-full flex flex-col gap-6">
            {/* Top Control Area */}
            <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6">
                <div className="max-w-3xl mx-auto">
                    <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                        <Sparkles className="text-blue-400" />
                        {t('image.title')}
                    </h2>
                    <p className="text-gray-400 mb-6">{t('image.subtitle')}</p>
                    
                    <div className="flex gap-4">
                        <input
                            type="text"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
                            placeholder={t('image.placeholder')}
                            className="flex-1 bg-gray-950 border border-gray-700 rounded-xl py-4 px-5 text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
                        />
                        <button
                            onClick={handleGenerate}
                            disabled={!prompt.trim() || isLoading}
                            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-800 disabled:text-gray-500 text-white px-8 rounded-xl font-medium transition-colors flex items-center gap-2 whitespace-nowrap"
                        >
                            {isLoading ? <LoadingSpinner size={20} className="text-white" /> : <Sparkles size={20} />}
                            {isLoading ? t('image.generating') : t('image.generate')}
                        </button>
                    </div>
                    {error && <p className="text-red-400 mt-3 text-sm">{error}</p>}
                </div>
            </div>

            {/* Gallery Area */}
            <div className="flex-1 bg-gray-900 rounded-2xl border border-gray-800 p-6 overflow-y-auto">
                <h3 className="text-lg font-medium text-gray-300 mb-6">{t('image.recent')}</h3>
                
                {history.length === 0 && !isLoading ? (
                    <div className="h-64 flex flex-col items-center justify-center text-gray-500 border-2 border-dashed border-gray-800 rounded-xl">
                        <ImageIcon size={48} className="mb-4 opacity-50" />
                        <p>{t('image.empty')}</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {isLoading && (
                            <div className="aspect-square bg-gray-950 rounded-xl border border-gray-800 flex flex-col items-center justify-center animate-pulse">
                                <LoadingSpinner size={32} className="mb-4" />
                                <span className="text-gray-400 text-sm">{t('image.creating')}</span>
                            </div>
                        )}
                        {history.map((img) => (
                            <div key={img.id} className="group relative aspect-square bg-gray-950 rounded-xl border border-gray-800 overflow-hidden">
                                <img 
                                    src={img.url} 
                                    alt={img.prompt} 
                                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
                                    <p className="text-white text-sm line-clamp-2 mb-3">{img.prompt}</p>
                                    <button 
                                        onClick={() => handleDownload(img.url, img.id)}
                                        className="bg-white/20 hover:bg-white/30 backdrop-blur-md text-white py-2 px-4 rounded-lg flex items-center justify-center gap-2 text-sm font-medium transition-colors"
                                    >
                                        <Download size={16} />
                                        {t('image.download')}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ImageGenInterface;