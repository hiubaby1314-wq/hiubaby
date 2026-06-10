import React, { useState } from 'react';
import { X, Upload, Mic, AlertCircle, CheckCircle2 } from 'lucide-react';
import { CloneSlot } from '../types.ts';

interface CloneModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentSlot: CloneSlot | null;
  onSave: (name: string) => void;
  onDelete: () => void;
}

export const CloneModal: React.FC<CloneModalProps> = ({ isOpen, onClose, currentSlot, onSave, onDelete }) => {
  const [cloneName, setCloneName] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  if (!isOpen) return null;

  const handleSave = () => {
    if (!cloneName.trim()) return;
    setIsUploading(true);
    // Simulate upload and processing time
    setTimeout(() => {
      onSave(cloneName.trim());
      setIsUploading(false);
      setCloneName('');
      onClose();
    }, 1500);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-5 border-b border-zinc-800 bg-zinc-900/50">
          <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
            <Mic size={20} className="text-orange-500" />
            独立声音克隆
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-100 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          {currentSlot ? (
            <div className="space-y-5">
              <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-4 rounded-xl flex items-start gap-3">
                <CheckCircle2 size={20} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-emerald-300">克隆位置已使用</p>
                  <p className="text-sm mt-1 opacity-90">您当前已有一个名为「<span className="text-white font-medium">{currentSlot.name}</span>」的克隆声音。</p>
                </div>
              </div>
              <p className="text-sm text-zinc-400">
                每位会员仅拥有一个独立克隆位置。如需创建新声音，请先删除当前克隆。
              </p>
              <button 
                onClick={onDelete}
                className="w-full py-3 px-4 border border-red-500/30 text-red-400 rounded-xl hover:bg-red-500/10 hover:border-red-500/50 transition-colors font-medium"
              >
                删除当前克隆声音
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="bg-blue-500/10 border border-blue-500/20 text-blue-400 p-3 rounded-lg text-sm flex items-start gap-2">
                <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                <p>上传一段 10-30 秒的清晰干音（无背景音乐），系统将为您生成专属克隆音色。</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">声音名称</label>
                <input 
                  type="text" 
                  value={cloneName}
                  onChange={(e) => setCloneName(e.target.value)}
                  placeholder="例如：我的专属声音"
                  className="w-full px-4 py-3 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-all placeholder:text-zinc-600"
                  maxLength={10}
                />
              </div>

              <div className="border-2 border-dashed border-zinc-700 rounded-xl p-8 text-center hover:bg-zinc-800/50 hover:border-zinc-600 transition-colors cursor-pointer group bg-zinc-950/50">
                <Upload size={32} className="mx-auto text-zinc-500 group-hover:text-orange-400 mb-3 transition-colors" />
                <p className="text-sm font-medium text-zinc-300">点击或拖拽音频文件至此</p>
                <p className="text-xs text-zinc-500 mt-1">支持 WAV, MP3 格式，最大 10MB</p>
              </div>

              <button 
                onClick={handleSave}
                disabled={!cloneName.trim() || isUploading}
                className={`
                  w-full py-3.5 rounded-xl font-bold text-white transition-all
                  ${!cloneName.trim() || isUploading 
                    ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' 
                    : 'bg-orange-600 hover:bg-orange-500 shadow-[0_0_15px_rgba(234,88,12,0.3)] hover:shadow-[0_0_20px_rgba(234,88,12,0.5)]'}
                `}
              >
                {isUploading ? '正在生成克隆模型...' : '开始克隆'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};