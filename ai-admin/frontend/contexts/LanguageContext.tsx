import React, { createContext, useContext, useState, ReactNode } from 'react';
import { Language } from '../types.ts';

interface LanguageContextType {
    lang: Language;
    setLang: (lang: Language) => void;
    t: (key: string) => string;
}

const translations: Record<Language, Record<string, string>> = {
    EN: {
        'app.title': 'Lizi Admin',
        'nav.dashboard': 'Dashboard',
        'nav.chat': 'AI Assistant',
        'nav.vision': 'Vision Analysis',
        'nav.image': 'Image Studio',
        'nav.video': 'Animation Studio',
        'nav.edit': 'AI Canvas Edit',
        'nav.settings': 'Settings',
        'dashboard.title': 'Asset Management Overview',
        'dashboard.subtitle': 'Monitor AI asset generation and site performance for lizisucaiwang.online.',
        'dashboard.calls': 'Assets Generated',
        'dashboard.users': 'Active Members',
        'dashboard.latency': 'System Load',
        'dashboard.uptime': 'Storage Used',
        'dashboard.activity': 'Recent Activity',
        'dashboard.distribution': 'Asset Category Distribution',
        'dashboard.chart.activity': 'Activity chart placeholder',
        'dashboard.chart.usage': 'Usage chart placeholder',
        'chat.greeting': 'Hello! I am the Lizi Admin AI assistant. How can I help you manage assets or generate new content today?',
        'chat.placeholder': 'Type your message...',
        'chat.thinking': 'Thinking...',
        'chat.error': 'Sorry, I encountered an error processing your request.',
        'vision.title': 'Image Analysis',
        'vision.subtitle': 'Upload an image and ask questions about it using Gemini Vision.',
        'vision.upload': 'Click to upload image',
        'vision.supports': 'Supports JPG, PNG, WEBP',
        'vision.question': 'What do you want to know?',
        'vision.placeholder': 'e.g., Describe this image in detail, or extract the text from it...',
        'vision.analyze': 'Analyze Image',
        'vision.analyzing': 'Analyzing...',
        'vision.result': 'Analysis Result',
        'vision.processing': 'Processing image with Gemini...',
        'vision.empty': 'Upload an image and ask a question to see the analysis here.',
        'vision.errorType': 'Please select a valid image file.',
        'vision.errorAnalyze': 'Failed to analyze the image. Please try again.',
        'image.title': 'Image Studio',
        'image.subtitle': 'Describe the image you want to create using Imagen 4.0.',
        'image.placeholder': 'A futuristic city with flying cars at sunset, cyberpunk style...',
        'image.generate': 'Generate',
        'image.generating': 'Generating...',
        'image.recent': 'Recent Generations',
        'image.empty': 'Your generated images will appear here.',
        'image.creating': 'Creating masterpiece...',
        'image.download': 'Download',
        'image.error': 'Failed to generate image. Please try modifying your prompt and try again.',
        'video.title': 'Animation Studio',
        'video.subtitle': 'Create stunning animations and videos from text prompts using Veo 2.0.',
        'video.placeholder': 'A neon hologram of a cat driving at top speed...',
        'video.generate': 'Generate Video',
        'video.generating': 'Generating Video...',
        'video.recent': 'Recent Animations',
        'video.empty': 'Your generated animations will appear here.',
        'video.download': 'Download MP4',
        'video.error': 'Failed to generate video. Please try again.',
        'video.loading.1': 'Initializing video generation engine...',
        'video.loading.2': 'Analyzing prompt and planning scenes...',
        'video.loading.3': 'Rendering frames... This usually takes a few minutes.',
        'video.loading.4': 'Adding final touches and polishing...',
        'video.loading.5': 'Almost there! Wrapping up the video file...',
        'edit.title': 'AI Canvas Edit',
        'edit.subtitle': 'Upload an image and tell AI how to modify or redraw it.',
        'edit.upload': 'Upload base image',
        'edit.question': 'How should we edit this image?',
        'edit.placeholder': 'e.g., Change the background to a sunset, or add a llama next to the person...',
        'edit.analyze': 'Edit Image',
        'edit.analyzing': 'Editing...',
        'edit.result': 'Edited Result',
        'edit.processing': 'Redrawing image with AI...',
        'edit.empty': 'Upload an image and provide instructions to see the edited result here.',
        'edit.errorAnalyze': 'Failed to edit the image. Please try again.',
        'lang.switch': '中文'
    },
    ZH: {
        'app.title': '栗子素材網後台',
        'nav.dashboard': '儀表板',
        'nav.chat': 'AI 助手',
        'nav.vision': '視覺分析',
        'nav.image': '影像工作室',
        'nav.video': '動畫製作',
        'nav.edit': 'AI 繪圖編輯',
        'nav.settings': '設定',
        'dashboard.title': '素材管理總覽',
        'dashboard.subtitle': '監控 lizisucaiwang.online 的 AI 素材生成與網站效能。',
        'dashboard.calls': '總生成素材數',
        'dashboard.users': '活躍會員數',
        'dashboard.latency': '系統負載',
        'dashboard.uptime': '儲存空間使用率',
        'dashboard.activity': '近期活動',
        'dashboard.distribution': '素材分類分佈',
        'dashboard.chart.activity': '活動圖表佔位符',
        'dashboard.chart.usage': '使用量圖表佔位符',
        'chat.greeting': '你好！我是栗子素材網的專屬 AI 助手。今天需要幫忙生成什麼素材或管理網站嗎？',
        'chat.placeholder': '輸入您的訊息...',
        'chat.thinking': '思考中...',
        'chat.error': '抱歉，處理您的請求時發生錯誤。',
        'vision.title': '影像分析',
        'vision.subtitle': '上傳圖片並使用 Gemini Vision 詢問相關問題。',
        'vision.upload': '點擊上傳圖片',
        'vision.supports': '支援 JPG, PNG, WEBP',
        'vision.question': '您想知道什麼？',
        'vision.placeholder': '例如：詳細描述這張圖片，或提取其中的文字...',
        'vision.analyze': '分析圖片',
        'vision.analyzing': '分析中...',
        'vision.result': '分析結果',
        'vision.processing': 'Gemini 正在處理圖片...',
        'vision.empty': '上傳圖片並提出問題以在此查看分析結果。',
        'vision.errorType': '請選擇有效的圖片檔案。',
        'vision.errorAnalyze': '分析圖片失敗，請重試。',
        'image.title': '影像工作室',
        'image.subtitle': '描述您想使用 Imagen 4.0 建立的圖片。',
        'image.placeholder': '夕陽下有著飛行車的未來城市，賽博龐克風格...',
        'image.generate': '生成',
        'image.generating': '生成中...',
        'image.recent': '近期生成',
        'image.empty': '您生成的圖片將顯示於此。',
        'image.creating': '正在創作傑作...',
        'image.download': '下載',
        'image.error': '生成圖片失敗。請嘗試修改您的提示詞並重試。',
        'video.title': '動畫製作',
        'video.subtitle': '使用 Veo 2.0 透過文字提示建立令人驚豔的動畫與影片。',
        'video.placeholder': '一隻全速駕駛的霓虹全息貓咪...',
        'video.generate': '生成動畫',
        'video.generating': '動畫生成中...',
        'video.recent': '近期動畫',
        'video.empty': '您生成的動畫將顯示於此。',
        'video.download': '下載 MP4',
        'video.error': '生成動畫失敗，請重試。',
        'video.loading.1': '正在初始化動畫生成引擎...',
        'video.loading.2': '正在分析提示詞並規劃場景...',
        'video.loading.3': '正在渲染影格... 這通常需要幾分鐘的時間。',
        'video.loading.4': '正在進行最後的修飾與潤色...',
        'video.loading.5': '快完成了！正在封裝影片檔案...',
        'edit.title': 'AI 繪圖編輯',
        'edit.subtitle': '上傳圖片並告訴 AI 如何修改或重新繪製它。',
        'edit.upload': '上傳底圖',
        'edit.question': '我們應該如何編輯這張圖片？',
        'edit.placeholder': '例如：將背景改為夕陽，或在人物旁邊加一隻羊駝...',
        'edit.analyze': '編輯圖片',
        'edit.analyzing': '編輯中...',
        'edit.result': '編輯結果',
        'edit.processing': 'AI 正在重新繪製圖片...',
        'edit.empty': '上傳圖片並提供指示，以在此查看編輯結果。',
        'edit.errorAnalyze': '編輯圖片失敗，請重試。',
        'lang.switch': 'English'
    }
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{children: ReactNode}> = ({ children }) => {
    const [lang, setLang] = useState<Language>('ZH'); // Default to Chinese

    const t = (key: string): string => {
        return translations[lang][key] || key;
    };

    return (
        <LanguageContext.Provider value={{ lang, setLang, t }}>
            {children}
        </LanguageContext.Provider>
    );
};

export const useLanguage = (): LanguageContextType => {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
};