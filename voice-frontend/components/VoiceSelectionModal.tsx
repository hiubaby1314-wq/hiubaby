import React from 'react';
import { X } from 'lucide-react';
import { Voice } from '../types.ts';
import { VoiceCard } from './VoiceCard.tsx';

interface VoiceSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  voices: Voice[];
  selectedVoiceId: string;
  onSelect: (voice: Voice) => void;
  onDeleteCustomVoice: (id: string) => void;
}

export const VoiceSelectionModal: React.FC<VoiceSelectionModalProps> = ({ 
  isOpen, 
  onClose, 
  voices, 
  selectedVoiceId, 
  onSelect,
  onDeleteCustomVoice
}) => {
  if (!isOpen) return null;

  const femaleVoices = voices.filter(v => v.gender === 'female');
  const maleVoices = voices.filter(v => v.gender === 'male');
  const childVoices = voices.filter(v => v.gender === 'child');

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-5 border-b border-zinc-800 bg-zinc-900/80">
          <h2 className="text-lg font-bold text-zinc-100">选择发音人</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-100 transition-colors p-1">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-8">
          {femaleVoices.length > 0 && (
            <section>
              <h4 className="text-sm font-bold text-zinc-400 mb-3 flex items-center gap-2">
                <span className="w-1.5 h-4 bg-pink-500 rounded-full"></span>
                女声 ({femaleVoices.length})
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {femaleVoices.map(voice => (
                  <VoiceCard 
                    key={voice.id}
                    voice={voice}
                    isSelected={selectedVoiceId === voice.id}
                    onSelect={(v) => {
                      onSelect(v);
                      onClose();
                    }}
                    onDelete={onDeleteCustomVoice}
                  />
                ))}
              </div>
            </section>
          )}

          {maleVoices.length > 0 && (
            <section>
              <h4 className="text-sm font-bold text-zinc-400 mb-3 flex items-center gap-2">
                <span className="w-1.5 h-4 bg-blue-500 rounded-full"></span>
                男声 ({maleVoices.length})
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {maleVoices.map(voice => (
                  <VoiceCard 
                    key={voice.id}
                    voice={voice}
                    isSelected={selectedVoiceId === voice.id}
                    onSelect={(v) => {
                      onSelect(v);
                      onClose();
                    }}
                    onDelete={onDeleteCustomVoice}
                  />
                ))}
              </div>
            </section>
          )}

          {childVoices.length > 0 && (
            <section>
              <h4 className="text-sm font-bold text-zinc-400 mb-3 flex items-center gap-2">
                <span className="w-1.5 h-4 bg-green-500 rounded-full"></span>
                童声 ({childVoices.length})
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {childVoices.map(voice => (
                  <VoiceCard 
                    key={voice.id}
                    voice={voice}
                    isSelected={selectedVoiceId === voice.id}
                    onSelect={(v) => {
                      onSelect(v);
                      onClose();
                    }}
                    onDelete={onDeleteCustomVoice}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};