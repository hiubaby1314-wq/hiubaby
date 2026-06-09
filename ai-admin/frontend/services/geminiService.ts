import { GoogleGenAI, Modality } from '@google/genai';
import { Language } from '../types.ts';

// Initialize the SDK. Assuming process.env.API_KEY is available in the environment.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY, vertexai: true });

export const generateChatResponse = async (prompt: string, history: {role: string, parts: {text: string}[]}[] = [], lang: Language = 'ZH'): Promise<string> => {
    try {
        const langInstruction = lang === 'ZH' ? '請務必使用繁體中文回答。' : 'Please answer in English.';
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                ...history,
                { role: 'user', parts: [{ text: prompt }] }
            ],
            config: {
                systemInstruction: `You are a helpful, intelligent AI assistant integrated into a modern web platform. Provide clear, concise, and accurate answers. ${langInstruction}`,
            }
        });
        return response.text || (lang === 'ZH' ? '未生成任何回應。' : 'No response generated.');
    } catch (error) {
        console.error("Error generating chat response:", error);
        throw new Error("Failed to generate response. Please try again.");
    }
};

export const analyzeImage = async (base64Image: string, mimeType: string, prompt: string, lang: Language = 'ZH'): Promise<string> => {
    try {
        const finalPrompt = lang === 'ZH' ? `${prompt}\n\n(請用繁體中文回答)` : prompt;
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: {
                role: 'user',
                parts: [
                    {
                        inlineData: {
                            data: base64Image,
                            mimeType: mimeType,
                        },
                    },
                    { text: finalPrompt },
                ],
            },
        });
        return response.text || (lang === 'ZH' ? '無法分析圖片。' : 'Could not analyze the image.');
    } catch (error) {
        console.error("Error analyzing image:", error);
        throw new Error("Failed to analyze image. Please try again.");
    }
};

export const generateImage = async (prompt: string): Promise<string> => {
    try {
        const response = await ai.models.generateImages({
            model: 'imagen-4.0-generate-001',
            prompt: prompt,
            config: {
                numberOfImages: 1,
                outputMimeType: 'image/jpeg',
                aspectRatio: '1:1',
            },
        });
        
        if (response.generatedImages && response.generatedImages.length > 0) {
             const base64ImageBytes = response.generatedImages[0].image.imageBytes;
             return `data:image/jpeg;base64,${base64ImageBytes}`;
        }
        throw new Error("No image returned from API.");
    } catch (error) {
        console.error("Error generating image:", error);
        throw new Error("Failed to generate image. Please try again.");
    }
};

export const generateVideo = async (prompt: string): Promise<string> => {
    try {
        let operation = await ai.models.generateVideos({
            model: 'veo-2.0-generate-001',
            prompt: prompt,
            config: {
                numberOfVideos: 1
            }
        });
        
        while (!operation.done) {
            await new Promise(resolve => setTimeout(resolve, 10000));
            operation = await ai.operations.getVideosOperation({operation: operation});
        }

        const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
        if (!downloadLink) {
            throw new Error("No video URI returned from API.");
        }
        
        // Append API key to the download link so it can be fetched/displayed
        return `${downloadLink}&key=${process.env.API_KEY}`;
    } catch (error) {
        console.error("Error generating video:", error);
        throw new Error("Failed to generate video. Please try again.");
    }
};

export const editImage = async (base64Image: string, mimeType: string, prompt: string, lang: Language = 'ZH'): Promise<{text?: string, imageUrl?: string}> => {
    try {
        const finalPrompt = lang === 'ZH' ? `${prompt}\n\n(請用繁體中文回答)` : prompt;
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image-preview',
            contents: {
                parts: [
                    {
                        inlineData: {
                            data: base64Image,
                            mimeType: mimeType,
                        },
                    },
                    { text: finalPrompt },
                ],
            },
            config: {
                responseModalities: [Modality.IMAGE, Modality.TEXT],
            },
        });

        let result: {text?: string, imageUrl?: string} = {};
        
        if (response.candidates && response.candidates[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.text) {
                    result.text = part.text;
                } else if (part.inlineData) {
                    const base64ImageBytes = part.inlineData.data;
                    const outMimeType = part.inlineData.mimeType || 'image/png';
                    result.imageUrl = `data:${outMimeType};base64,${base64ImageBytes}`;
                }
            }
        }
        
        return result;
    } catch (error) {
        console.error("Error editing image:", error);
        throw new Error("Failed to edit image. Please try again.");
    }
};

// Helper to convert File to base64
export const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                // Extract just the base64 data part
                const base64Data = reader.result.split(',')[1];
                resolve(base64Data);
            } else {
                reject(new Error('Failed to convert file to base64'));
            }
        };
        reader.onerror = error => reject(error);
    });
};