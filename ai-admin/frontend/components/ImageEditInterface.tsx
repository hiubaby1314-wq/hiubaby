import React, { useState, useRef } from 'react';
import { Upload, Wand2, X, Image as ImageIcon } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { editImage, fileToBase64 } from '../services/geminiService.ts';
import LoadingSpinner from './LoadingSpinner.tsx';
import { useLanguage } from '../contexts/LanguageContext.tsx';

const ImageEditInterface: React.FC = () => {
    const { t, lang } = useLanguage();
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [prompt, setPrompt] = useState('');
    const [resultImage, setResultImage] = useState<string | null>(null);
    const [resultText, setResultText] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (!file.type.startsWith('image/')) {
                setError(t('vision.errorType'));
                return;
            }
            setSelectedFile(file);
            setPreviewUrl(URL.createObjectURL(file));
            setResultImage(null);
            setResultText(null);
            setError(null);
        }
    };

    const clearSelection = () => {
        setSelectedFile(null);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
        setResultImage(null);
        setResultText(null);
        setPrompt('');
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleEdit = async () => {
        if (!selectedFile || !prompt.trim()) return;

        setIsLoading(true);
        setError(null);
        setResultImage(null);
        setResultText(null);

        try {
            const base64Data = await fileToBase64(selectedFile);
            const result = await editImage(base64Data, selectedFile.type, prompt, lang);
            if (result.imageUrl) setResultImage(result.imageUrl);
            if (result.text) setResultText(result.text);
        } catch (err) {
            setError(t('edit.errorAnalyze'));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="h-full flex flex-col gap-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0">
                {/* Left Column: Input */}
                <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 flex flex-col gap-6 overflow-y-auto">
                    <div>
                        <h2 className="text-xl font-semibold text-white mb-2 flex items-center gap-2">
                            <Wand2 className="text-blue-400" />
                            {t('edit.title')}
                        </h2>
                        <p className="text-gray-400 text-sm">{t('edit.subtitle')}</p>
                    </div>

                    {/* Upload Area */}
                    {!previewUrl ? (
                        <div 
                            onClick={() => fileInputRef.current?.click()}
                            className="border-2 border-dashed border-gray-700 rounded-xl p-12 flex flex-col items-center justify-center text-center cursor-pointer hover:border-blue-500 hover:bg-gray-800/50 transition-all group"
                        >
                            <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                <Upload className="w-8 h-8 text-gray-400 group-hover:text-blue-400" />
                            </div>
                            <p className="text-gray-300 font-medium mb-1">{t('edit.upload')}</p>
                            <p className="text-gray-500 text-sm">{t('vision.supports')}</p>
                        </div>
                    ) : (
                        <div className="relative rounded-xl overflow-hidden border border-gray-700 bg-gray-950 flex items-center justify-center min-h-[300px]">
                            <img src={previewUrl} alt="Preview" className="max-w-full max-h-[400px] object-contain" />
                            <button 
                                onClick={clearSelection}
                                className="absolute top-4 right-4 p-2 bg-black/50 hover:bg-red-500/80 text-white rounded-full backdrop-blur-sm transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>
                    )}
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={handleFileSelect} 
                        accept="image/*" 
                        className="hidden" 
                    />

                    {/* Prompt Input */}
                    <div className="mt-auto">
                        <label className="block text-sm font-medium text-gray-300 mb-2">{t('edit.question')}</label>
                        <textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder={t('edit.placeholder')}
                            className="w-full bg-gray-950 border border-gray-700 rounded-xl py-3 px-4 text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none h-24"
                        />
                        <button
                            onClick={handleEdit}
                            disabled={!selectedFile || !prompt.trim() || isLoading}
                            className="w-full mt-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-800 disabled:text-gray-500 text-white py-3 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                        >
                            {isLoading ? <LoadingSpinner size={20} className="text-white" /> : <Wand2 size={20} />}
                            {isLoading ? t('edit.analyzing') : t('edit.analyze')}
                        </button>
                    </div>
                </div>

                {/* Right Column: Output */}
                <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 flex flex-col overflow-hidden">
                    <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                        <ImageIcon className="text-blue-400" size={24} />
                        {t('edit.result')}
                    </h2>
                    
                    <div className="flex-1 overflow-y-auto bg-gray-950 rounded-xl border border-gray-800 p-6 flex flex-col gap-4">
                        {isLoading ? (
                            <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-4">
                                <LoadingSpinner size={40} />
                                <p>{t('edit.processing')}</p>
                            </div>
                        ) : error ? (
                            <div className="h-full flex items-center justify-center text-red-400 text-center">
                                <p>{error}</p>
                            </div>
                        ) : (resultImage || resultText) ? (
                            <>
                                {resultImage && (
                                    <div className="rounded-xl overflow-hidden border border-gray-800 bg-black flex items-center justify-center">
                                        <img src={resultImage} alt="Edited Result" className="max-w-full max-h-[400px] object-contain" />
                                    </div>
                                )}
                                {resultText && (
                                    <div className="prose prose-invert max-w-none bg-gray-900 p-4 rounded-xl border border-gray-800">
                                        <ReactMarkdown>{resultText}</ReactMarkdown>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="h-full flex items-center justify-center text-gray-500 text-center">
                                <p>{t('edit.empty')}</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ImageEditInterface;