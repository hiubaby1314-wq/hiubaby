import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, Download, Trash2, Clock, Users, History as HistoryIcon, FileAudio } from 'lucide-react';
import { DubbingHistory } from '../types.ts';
import { storageService } from '../services/storage.ts';

export const History = () => {
  const [history, setHistory] = useState<DubbingHistory[]>([]);
  const [playingHistoryId, setPlayingHistoryId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Update document title for the new tab
    document.title = "配音纪录 - 栗子AI配音";
    setHistory(storageService.getHistory());
  }, []);

  const playAudioSequence = async (item: DubbingHistory) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (playingHistoryId === item.id) {
      setPlayingHistoryId(null);
      playingIdRef.current = null;
      return;
    }

    setPlayingHistoryId(item.id);
    playingIdRef.current = item.id;

    const segmentsToPlay = item.segments || (item.audioDataUrl ? [{ audioDataUrl: item.audioDataUrl, text: item.text, voiceName: item.voiceName }] : []);

    for (let i = 0; i < segmentsToPlay.length; i++) {
      if (playingIdRef.current !== item.id) break;

      const segment = segmentsToPlay[i];
      await new Promise<void>((resolve) => {
        const audio = new Audio(segment.audioDataUrl);
        audioRef.current = audio;
        
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        
        audio.play().catch(e => {
          console.error("Playback failed", e);
          resolve();
        });
      });
    }

    if (playingIdRef.current === item.id) {
      setPlayingHistoryId(null);
      playingIdRef.current = null;
    }
  };

  const handleDownload = async (item: DubbingHistory) => {
    const segments = item.segments || (item.audioDataUrl ? [{ audioDataUrl: item.audioDataUrl, text: item.text, voiceName: item.voiceName }] : []);
    const safeName = item.text.substring(0, 10).replace(/[^a-zA-Z0-9一-龥]/g, '') || '配音';

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const filename = segments.length > 1 
        ? `${safeName}_段落${i+1}_${segment.voiceName}.wav` 
        : `${safeName}.wav`;

      const a = document.createElement('a');
      a.href = segment.audioDataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      if (segments.length > 1) {
        await new Promise(r => setTimeout(r, 300));
      }
    }
  };

  const handleDeleteHistory = (id: string) => {
    if (playingHistoryId === id && audioRef.current) {
      audioRef.current.pause();
      setPlayingHistoryId(null);
      playingIdRef.current = null;
    }
    storageService.deleteHistoryItem(id);
    setHistory(storageService.getHistory());
  };

  const formatDate = (timestamp: number) => {
    const d = new Date(timestamp);
    return `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-8 overflow-y-auto font-sans">
      <div className="max-w-6xl mx-auto">
        
        <div className="flex items-center justify-between mb-10 border-b border-zinc-800 pb-6">
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <HistoryIcon className="text-orange-500" size={32} />
            配音纪录
          </h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-zinc-400 bg-zinc-900 px-4 py-2 rounded-full border border-zinc-800">
              纪录仅保留 7 天
            </span>
          </div>
        </div>

        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-zinc-600 space-y-4">
            <FileAudio size={64} className="opacity-20" />
            <p className="text-lg">暂无配音纪录</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {history.map(item => (
              <div key={item.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-lg hover:border-zinc-700 transition-all flex flex-col group">
                <div className="flex justify-between items-start mb-4">
                  <span className={`text-xs font-medium px-3 py-1 rounded-full border flex items-center gap-1.5
                    ${item.segments && item.segments.length > 1 
                      ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' 
                      : 'bg-zinc-800 text-zinc-300 border-zinc-700'}`}
                  >
                    {item.segments && item.segments.length > 1 && <Users size={12} />}
                    {item.voiceName}
                  </span>
                  <span className="text-xs text-zinc-500 flex items-center gap-1">
                    <Clock size={12} />
                    {formatDate(item.timestamp)}
                  </span>
                </div>
                
                <p className="text-zinc-300 text-sm leading-relaxed mb-6 flex-1 whitespace-pre-wrap line-clamp-4">
                  {item.text}
                </p>
                
                <div className="flex items-center justify-between pt-4 border-t border-zinc-800/80">
                  <button 
                    onClick={() => playAudioSequence(item)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-colors ${playingHistoryId === item.id ? 'bg-orange-500 text-white shadow-[0_0_15px_rgba(249,115,22,0.4)]' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100'}`}
                  >
                    {playingHistoryId === item.id ? <Square size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                    {playingHistoryId === item.id ? '停止' : '播放'}
                  </button>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleDownload(item)}
                      className="p-2.5 text-zinc-400 bg-zinc-800/50 hover:bg-zinc-700 hover:text-zinc-200 rounded-xl transition-colors"
                      title={item.segments && item.segments.length > 1 ? "批量下载分段 WAV" : "下载 WAV"}
                    >
                      <Download size={18} />
                    </button>
                    <button 
                      onClick={() => handleDeleteHistory(item.id)}
                      className="p-2.5 text-zinc-500 bg-zinc-800/50 hover:bg-red-500/10 hover:text-red-400 rounded-xl transition-colors"
                      title="删除"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};