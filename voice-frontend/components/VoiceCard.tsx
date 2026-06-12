import React, { useRef, useState } from 'react';
import { Play, Square, CheckCircle2, Mic, Trash2, User, Loader } from 'lucide-react';
import { Voice } from '../types.ts';
import { minimaxService } from '../services/minimax.ts';

interface VoiceCardProps {
  voice: Voice;
  isSelected: boolean;
  onSelect: (voice: Voice) => void;
  onDelete?: (id: string) => void;
}

const PREVIEW_TEXT = '你好，这是声音试听效果';

export const VoiceCard: React.FC<VoiceCardProps> = ({ voice, isSelected, onSelect, onDelete }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const togglePlay = async (e: React.MouseEvent) => {
    e.stopPropagation();

    // If already playing, stop
    if (audioRef.current && isPlaying) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
      return;
    }

    // Use cached audio if available
    if (audioRef.current) {
      audioRef.current.play().catch(err => console.error('Audio play failed:', err));
      setIsPlaying(true);
      return;
    }

    // Use previewAudio data URL if provided
    if (voice.previewAudio) {
      audioRef.current = new Audio(voice.previewAudio);
      audioRef.current.onended = () => setIsPlaying(false);
      audioRef.current.play().catch(err => console.error('Audio play failed:', err));
      setIsPlaying(true);
      return;
    }

    // Generate TTS preview on-demand via API
    setIsLoading(true);
    try {
      const audioData = await minimaxService.generateAudio(PREVIEW_TEXT, voice.id, 1.0);
      audioRef.current = new Audio(audioData);
      audioRef.current.onended = () => setIsPlaying(false);
      audioRef.current.play().catch(err => console.error('Audio play failed:', err));
      setIsPlaying(true);
    } catch (err) {
      console.error('Preview generation failed:', err);
      alert('试听生成失败，请稍后再试');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      onClick={() => onSelect(voice)}
      className={`
        relative p-2.5 rounded-xl border cursor-pointer transition-all duration-200
        flex flex-col items-center gap-1.5 group
        ${isSelected
          ? 'border-orange-500 bg-orange-500/10 shadow-[0_0_15px_rgba(249,115,22,0.15)]'
          : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700 hover:bg-zinc-800/50'}
      `}
    >
      {isSelected && (
        <div className="absolute top-1.5 right-1.5 text-orange-500">
          <CheckCircle2 size={14} />
        </div>
      )}

      {voice.isCustom && !isSelected && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.(voice.id);
          }}
          className="absolute top-1.5 right-1.5 text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
          title="删除角色"
        >
          <Trash2 size={12} />
        </button>
      )}

      <button
        onClick={togglePlay}
        disabled={isLoading}
        className={`
          w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors mt-0.5
          ${isLoading
            ? 'bg-zinc-800 text-zinc-500 cursor-wait'
            : isPlaying
              ? 'bg-orange-500 text-white shadow-[0_0_10px_rgba(249,115,22,0.4)]'
              : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}
        `}
        title={isLoading ? '生成中...' : isPlaying ? '停止' : '试听'}
      >
        {isLoading
          ? <Loader size={12} className="animate-spin" />
          : isPlaying
            ? <Square size={12} fill="currentColor" />
            : <Play size={12} fill="currentColor" className="ml-0.5" />}
      </button>

      <div className="w-full text-center min-w-0 px-1">
        <h3 className="font-bold text-xs text-zinc-100 flex items-center justify-center gap-1 w-full">
          <span className="truncate">{voice.name}</span>
          {voice.isClone && <Mic size={10} className="text-orange-400 flex-shrink-0" title="克隆声音" />}
          {voice.isCustom && <User size={10} className="text-blue-400 flex-shrink-0" title="自定义角色" />}
        </h3>
      </div>

      <div className="flex flex-wrap justify-center gap-1 mt-auto w-full">
        {voice.tags.slice(0, 1).map(tag => (
          <span key={tag} className="px-1.5 py-0.5 bg-zinc-800 text-zinc-400 text-[9px] rounded-md border border-zinc-700/50 whitespace-nowrap">
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
};
