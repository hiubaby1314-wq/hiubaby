/**
 * Calls our secure backend proxy to generate audio via MiniMax API.
 * This keeps the API key hidden on the server.
 */
export const minimaxService = {
  generateAudio: async (text: string, voiceId: string, speed: number = 1.0, emotion: string = 'neutral'): Promise<string> => {
    if (!text.trim()) {
      throw new Error('文本不能为空');
    }

    // Determine the correct base path depending on deployment environment
    // In production, this will be '/voice/api/minimax-tts'
    const basePath = import.meta.env.PROD ? '/voice' : '';
    
    const response = await fetch(`${basePath}/api/minimax-tts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: text,
        voice_id: voiceId,
        speed: speed,
        emotion: emotion
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || '語音生成失敗，請稍後再試');
    }

    const data = await response.json();
    
    if (data.audio_base64) {
      return data.audio_base64;
    }
    
    throw new Error('未從伺服器獲取到音頻數據');
  }
};