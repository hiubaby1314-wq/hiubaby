import React, { useState } from 'react';
import { X, Mic2 } from 'lucide-react';
import { Voice } from '../types.ts';

interface CreateCharacterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (voice: Voice) => void;
}

export const CreateCharacterModal: React.FC<CreateCharacterModalProps> = ({ isOpen, onClose, onSave }) => {
  const [name, setName] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | 'child'>('female');
  const [tagsInput, setTagsInput] = useState('');

  if (!isOpen) return null;

  const handleSave = () => {
    if (!name.trim()) return;
    
    const tags = tagsInput
      .split(/[,，]/)
      .map(t => t.trim())
      .filter(t => t.length > 0)
      .slice(0, 3); // Max 3 tags

    const newVoice: Voice = {
      id: `custom-${Date.now()}`,
      name: name.trim(),
      gender,
      tags: tags.length > 0 ? tags : ['自定义'],
      isCustom: true,
      // No preview audio for custom characters by default
    };

    onSave(newVoice);
    
    // Reset form
    setName('');
    setGender('female');
    setTagsInput('');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-5 border-b border-zinc-800 bg-zinc-900/50">
          <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
            <Mic2 size={20} className="text-blue-400" />
            创建自定义音色
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-100 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">音色名称</label>
            <input 
              type="text" 
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：温柔助手"
              className="w-full px-4 py-3 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder:text-zinc-600"
              maxLength={12}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">声音性别</label>
            <div className="grid grid-cols-3 gap-3">
              {(['male', 'female', 'child'] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => setGender(g)}
                  className={`
                    py-2.5 rounded-xl border text-sm font-medium transition-all
                    ${gender === g 
                      ? 'bg-blue-500/20 border-blue-500 text-blue-400' 
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-600'}
                  `}
                >
                  {g === 'male' ? '男声' : g === 'female' ? '女声' : '儿童'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">音色标签 (用逗号分隔)</label>
            <input 
              type="text" 
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="例如：温柔, 治愈, 助手"
              className="w-full px-4 py-3 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder:text-zinc-600"
            />
            <p className="text-xs text-zinc-500 mt-2">最多支持 3 个标签</p>
          </div>

          <button 
            onClick={handleSave}
            disabled={!name.trim()}
            className={`
              w-full py-3.5 rounded-xl font-bold text-white transition-all mt-4
              ${!name.trim() 
                ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' 
                : 'bg-blue-600 hover:bg-blue-500 shadow-[0_0_15px_rgba(37,99,235,0.3)] hover:shadow-[0_0_20px_rgba(37,99,235,0.5)]'}
            `}
          >
            确认创建
          </button>
        </div>
      </div>
    </div>
  );
};