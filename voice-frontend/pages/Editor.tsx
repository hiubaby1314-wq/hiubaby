import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { 
  Wand2, Mic, Plus, X, User, ExternalLink, History as HistoryIcon, Users, Sparkles, Smile, Gauge, Mic2, Trash2, UserPlus
} from 'lucide-react';
import { Voice, DubbingHistory, CloneSlot, ScriptBlock, DubbingSegment, Character } from '../types.ts';
import { DEFAULT_VOICES, MAX_TEXT_LENGTH, EMOTIONS, SPEEDS } from '../constants.ts';
import { storageService } from '../services/storage.ts';
import { minimaxService } from '../services/minimax.ts';
import { CloneModal } from '../components/CloneModal.tsx';
import { CreateCharacterModal } from '../components/CreateCharacterModal.tsx';
import { VoiceCard } from '../components/VoiceCard.tsx';

export const Editor = () => {
  // Data State
  const [voices, setVoices] = useState<Voice[]>(DEFAULT_VOICES);
  const [cloneSlot, setCloneSlot] = useState<CloneSlot | null>(null);
  const [customVoices, setCustomVoices] = useState<Voice[]>([]);
  
  // Character State
  const initialCharId = `char-${Date.now()}`;
  const [characters, setCharacters] = useState<Character[]>([
    { id: initialCharId, name: '旁白', voiceId: DEFAULT_VOICES[0].id }
  ]);
  const [activeCharacterId, setActiveCharacterId] = useState<string>(initialCharId);

  // Script Editor State
  const [scriptBlocks, setScriptBlocks] = useState<ScriptBlock[]>([
    { id: `block-${Date.now()}`, text: '', characterId: initialCharId, emotion: 'neutral', speed: 1.0 }
  ]);
  
  // UI State
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0 });
  
  // Modal States
  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
  const [isCreateVoiceModalOpen, setIsCreateVoiceModalOpen] = useState(false);
  
  // Audio Player State
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingIdRef = useRef<string | null>(null);

  // Initialization
  useEffect(() => {
    document.title = "栗子AI配音";
    loadData();
  }, []);

  const loadData = () => {
    const slot = storageService.getCloneSlot();
    const custom = storageService.getCustomVoices();
    
    setCloneSlot(slot);
    setCustomVoices(custom);
    updateVoicesList(slot, custom);
  };

  const updateVoicesList = (slot: CloneSlot | null, custom: Voice[]) => {
    let currentVoices = [...DEFAULT_VOICES];
    
    if (custom.length > 0) {
      currentVoices = [...custom, ...currentVoices];
    }

    if (slot && slot.isActive) {
      const cloneVoice: Voice = {
        id: slot.id,
        name: slot.name,
        gender: 'male',
        tags: ['专属', '克隆'],
        isClone: true,
      };
      currentVoices = [cloneVoice, ...currentVoices];
    }
    
    setVoices(currentVoices);
  };

  // Character Handlers
  const addCharacter = () => {
    const newId = `char-${Date.now()}`;
    const newChar: Character = {
      id: newId,
      name: `角色${characters.length + 1}`,
      voiceId: voices[0].id
    };
    setCharacters([...characters, newChar]);
    setActiveCharacterId(newId);
  };

  const updateCharacter = (id: string, updates: Partial<Character>) => {
    setCharacters(characters.map(c => c.id === id ? { ...c, ...updates } : c));
  };

  const deleteCharacter = (id: string) => {
    if (characters.length <= 1) return;
    const newChars = characters.filter(c => c.id !== id);
    setCharacters(newChars);
    
    if (activeCharacterId === id) {
      setActiveCharacterId(newChars[0].id);
    }
    
    // Reassign blocks that used this character to the first available character
    setScriptBlocks(scriptBlocks.map(b => 
      b.characterId === id ? { ...b, characterId: newChars[0].id } : b
    ));
  };

  // Script Editor Handlers
  const addBlock = () => {
    const lastCharId = scriptBlocks[scriptBlocks.length - 1]?.characterId || characters[0].id;
    const newId = `block-${Date.now()}`;
    setScriptBlocks([
      ...scriptBlocks, 
      { id: newId, text: '', characterId: lastCharId, emotion: 'neutral', speed: 1.0 }
    ]);
    setActiveCharacterId(lastCharId);
  };

  const removeBlock = (id: string) => {
    if (scriptBlocks.length <= 1) return;
    setScriptBlocks(scriptBlocks.filter(b => b.id !== id));
  };

  const updateBlockText = (id: string, text: string) => {
    setScriptBlocks(scriptBlocks.map(b => b.id === id ? { ...b, text: text.slice(0, MAX_TEXT_LENGTH) } : b));
  };

  const updateBlockSettings = (id: string, settings: Partial<ScriptBlock>) => {
    setScriptBlocks(scriptBlocks.map(b => b.id === id ? { ...b, ...settings } : b));
    if (settings.characterId) {
      setActiveCharacterId(settings.characterId);
    }
  };

  const handleVoiceSelect = (voice: Voice) => {
    if (activeCharacterId) {
      updateCharacter(activeCharacterId, { voiceId: voice.id });
    }
  };

  const getVoiceName = (voiceId: string) => {
    return voices.find(v => v.id === voiceId)?.name || '未知音色';
  };

  // Auto-match characters based on text format
  const handleAutoMatch = () => {
    const fullText = scriptBlocks.map(b => b.text).join('\n');
    if (!fullText.trim()) {
      alert('请先输入剧本内容');
      return;
    }

    const lines = fullText.split('\n');
    const newBlocks: ScriptBlock[] = [];
    const newCharacters = [...characters];
    const speakerCharMap = new Map<string, string>();

    // Map existing characters
    newCharacters.forEach(c => speakerCharMap.set(c.name, c.id));

    let voiceIndex = 0;
    let currentBlock: ScriptBlock | null = null;

    lines.forEach((line, index) => {
      if (!line.trim()) return;

      const match = line.match(/^([^:：]{1,10})[:：](.*)$/);
      
      if (match) {
        const speaker = match[1].trim();
        const text = match[2].trim();

        if (!speakerCharMap.has(speaker)) {
          const newCharId = `char-${Date.now()}-${voiceIndex}`;
          newCharacters.push({
            id: newCharId,
            name: speaker,
            voiceId: voices[voiceIndex % voices.length].id
          });
          speakerCharMap.set(speaker, newCharId);
          voiceIndex++;
        }

        if (currentBlock) newBlocks.push(currentBlock);

        currentBlock = {
          id: `block-${Date.now()}-${index}`,
          text: text,
          characterId: speakerCharMap.get(speaker)!,
          emotion: 'neutral',
          speed: 1.0
        };
      } else {
        if (currentBlock) {
          currentBlock.text += '\n' + line;
        } else {
          currentBlock = {
            id: `block-${Date.now()}-${index}`,
            text: line,
            characterId: newCharacters[0].id,
            emotion: 'neutral',
            speed: 1.0
          };
        }
      }
    });

    if (currentBlock) newBlocks.push(currentBlock);

    if (newBlocks.length > 0) {
      setCharacters(newCharacters);
      setScriptBlocks(newBlocks);
      setActiveCharacterId(newBlocks[0].characterId);
    }
  };

  // Generation Handler
  const handleGenerate = async () => {
    const validBlocks = scriptBlocks.filter(b => b.text.trim());
    if (validBlocks.length === 0 || isGenerating) return;

    setIsGenerating(true);
    setGenerationProgress({ current: 0, total: validBlocks.length });
    
    try {
      const segments: DubbingSegment[] = [];
      
      for (let i = 0; i < validBlocks.length; i++) {
        const block = validBlocks[i];
        setGenerationProgress({ current: i + 1, total: validBlocks.length });
        
        const character = characters.find(c => c.id === block.characterId) || characters[0];
        const voice = voices.find(v => v.id === character.voiceId) || voices[0];
        
        const audioDataUrl = await minimaxService.generateAudio(block.text, voice.id);
        
        segments.push({
          text: block.text,
          voiceName: `${character.name} (${voice.name})`,
          audioDataUrl
        });
      }

      const isMulti = segments.length > 1;
      const summaryText = segments.map(s => s.text).join(' ').substring(0, 60) + (segments.map(s=>s.text).join(' ').length > 60 ? '...' : '');
      const voiceName = isMulti ? '多人配音' : segments[0].voiceName;

      const newHistoryItem: DubbingHistory = {
        id: Date.now().toString(),
        text: summaryText,
        voiceName,
        segments,
        timestamp: Date.now()
      };

      storageService.saveHistoryItem(newHistoryItem);
      playAudioSequence(newHistoryItem);
      
    } catch (error) {
      alert('生成失败，请稍后重试。');
      console.error(error);
    } finally {
      setIsGenerating(false);
      setGenerationProgress({ current: 0, total: 0 });
    }
  };

  const playAudioSequence = async (item: DubbingHistory) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

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
      playingIdRef.current = null;
    }
  };

  // Settings Handlers
  const handleSaveClone = (name: string) => {
    const newSlot: CloneSlot = { id: `clone-${Date.now()}`, name, createdAt: Date.now(), isActive: true };
    storageService.saveCloneSlot(newSlot);
    setCloneSlot(newSlot);
    updateVoicesList(newSlot, customVoices);
  };

  const handleDeleteClone = () => {
    storageService.deleteCloneSlot();
    setCloneSlot(null);
    updateVoicesList(null, customVoices);
  };

  const handleSaveCustomVoice = (voice: Voice) => {
    storageService.saveCustomVoice(voice);
    const updatedCustom = storageService.getCustomVoices();
    setCustomVoices(updatedCustom);
    updateVoicesList(cloneSlot, updatedCustom);
  };

  const handleDeleteCustomVoice = (id: string) => {
    storageService.deleteCustomVoice(id);
    const updatedCustom = storageService.getCustomVoices();
    setCustomVoices(updatedCustom);
    updateVoicesList(cloneSlot, updatedCustom);
  };

  const totalChars = scriptBlocks.reduce((acc, block) => acc + block.text.length, 0);
  const isOverLimit = scriptBlocks.some(b => b.text.length > MAX_TEXT_LENGTH);
  
  const activeCharacter = characters.find(c => c.id === activeCharacterId);
  const activeVoiceId = activeCharacter?.voiceId;

  // Group voices by gender
  const femaleVoices = voices.filter(v => v.gender === 'female');
  const maleVoices = voices.filter(v => v.gender === 'male');
  const childVoices = voices.filter(v => v.gender === 'child');

  return (
    <div className="flex flex-col h-screen bg-zinc-950 font-sans text-zinc-100 overflow-hidden">
      
      {/* Top Bar */}
      <div className="h-16 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-md flex items-center justify-between px-6 shadow-sm flex-shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold tracking-wide text-zinc-100 flex items-center gap-2">
            <span className="text-orange-500">栗子AI配音</span>
          </h1>
          <div className="h-4 w-px bg-zinc-700"></div>
          <div className="flex items-center gap-2 text-zinc-400">
            <span className="bg-zinc-800 px-3 py-1 rounded-full text-xs border border-zinc-700">MiniMax 核心引擎</span>
            <span className="bg-zinc-800 px-3 py-1 rounded-full text-xs border border-zinc-700">支持多人对话</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link 
            to="/history" 
            target="_blank"
            className="flex items-center gap-2 px-4 py-2 bg-zinc-800 text-zinc-300 rounded-full hover:bg-zinc-700 hover:text-zinc-100 transition-colors border border-zinc-700 font-medium text-sm"
          >
            <HistoryIcon size={16} className="text-zinc-400" />
            配音纪录
            <ExternalLink size={14} className="ml-1 opacity-50" />
          </Link>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Left: Character List */}
        <div className="w-[240px] border-r border-zinc-800 bg-zinc-900/30 flex flex-col flex-shrink-0">
          <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
            <h3 className="font-bold text-zinc-100 flex items-center gap-2 text-sm">
              <Users size={16} className="text-orange-500" />
              角色列表
            </h3>
            <button 
              onClick={addCharacter} 
              className="p-1.5 text-zinc-400 hover:text-orange-400 hover:bg-orange-500/10 rounded-lg transition-colors" 
              title="添加角色"
            >
              <Plus size={16} />
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {characters.map(char => (
              <div 
                key={char.id}
                onClick={() => setActiveCharacterId(char.id)}
                className={`p-3 rounded-xl border cursor-pointer transition-all group relative
                  ${activeCharacterId === char.id 
                    ? 'border-orange-500 bg-orange-500/10 shadow-[0_0_10px_rgba(249,115,22,0.1)]' 
                    : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'}
                `}
              >
                <div className="flex items-center justify-between mb-1">
                  <input 
                    value={char.name}
                    onChange={(e) => updateCharacter(char.id, { name: e.target.value })}
                    className="bg-transparent font-bold text-zinc-100 w-full focus:outline-none text-sm"
                    placeholder="角色名称"
                    onClick={(e) => e.stopPropagation()}
                  />
                  {characters.length > 1 && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); deleteCharacter(char.id); }}
                      className="text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <div className="text-xs text-zinc-400 flex items-center gap-1.5">
                  <Mic2 size={12} className={activeCharacterId === char.id ? "text-orange-400" : ""} />
                  <span className="truncate">{getVoiceName(char.voiceId)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Middle: Script Editor */}
        <div className="flex-1 overflow-y-auto p-8 bg-zinc-950">
          <div className="max-w-3xl mx-auto space-y-6">
            
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-4">
                <h2 className="text-2xl font-bold text-zinc-100">剧本编辑</h2>
                <button 
                  onClick={handleAutoMatch}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg hover:bg-blue-500/20 transition-colors text-sm font-medium"
                  title="格式如：张三：你好"
                >
                  <Sparkles size={14} />
                  智能分配角色
                </button>
              </div>
              <span className="text-sm text-zinc-500">总字数: {totalChars}</span>
            </div>

            {/* Script Blocks */}
            <div className="space-y-4">
              {scriptBlocks.map((block) => (
                <div 
                  key={block.id} 
                  onClick={() => setActiveCharacterId(block.characterId)}
                  className={`bg-zinc-900 border rounded-2xl p-5 relative group transition-all cursor-text
                    ${activeCharacterId === block.characterId 
                      ? 'border-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.1)]' 
                      : 'border-zinc-800 hover:border-zinc-700'}
                  `}
                >
                  <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-2">
                      <User size={16} className={activeCharacterId === block.characterId ? "text-orange-500" : "text-zinc-500"} />
                      <select
                        value={block.characterId}
                        onChange={(e) => updateBlockSettings(block.id, { characterId: e.target.value })}
                        className={`bg-zinc-950 border rounded-lg px-2 py-1 text-sm font-medium focus:outline-none cursor-pointer transition-colors
                          ${activeCharacterId === block.characterId ? 'border-orange-500/50 text-orange-400' : 'border-zinc-800 text-zinc-300'}
                        `}
                      >
                        {characters.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>

                    {scriptBlocks.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeBlock(block.id);
                        }}
                        className="text-zinc-600 hover:text-red-400 hover:bg-red-500/10 p-2 rounded-lg transition-colors"
                        title="删除此段落"
                      >
                        <X size={18} />
                      </button>
                    )}
                  </div>
                  
                  <textarea
                    value={block.text}
                    onChange={(e) => updateBlockText(block.id, e.target.value)}
                    placeholder="输入该角色的台词... (支持格式：角色名：台词)"
                    className="w-full bg-transparent resize-none focus:outline-none text-zinc-200 text-lg leading-relaxed placeholder:text-zinc-700"
                    rows={3}
                  />
                  
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-zinc-800/50">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Smile size={14} className="text-zinc-500" />
                        <select
                          value={block.emotion || 'neutral'}
                          onChange={(e) => updateBlockSettings(block.id, { emotion: e.target.value })}
                          className="bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-orange-500 cursor-pointer"
                        >
                          {EMOTIONS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <Gauge size={14} className="text-zinc-500" />
                        <select
                          value={block.speed || 1.0}
                          onChange={(e) => updateBlockSettings(block.id, { speed: parseFloat(e.target.value) })}
                          className="bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-orange-500 cursor-pointer"
                        >
                          {SPEEDS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      </div>
                    </div>
                    <span className={`text-xs ${block.text.length >= MAX_TEXT_LENGTH ? 'text-red-400 font-bold' : 'text-zinc-600'}`}>
                      {block.text.length} / {MAX_TEXT_LENGTH}
                    </span>
                  </div>
                </div>
              ))}

              <button
                onClick={addBlock}
                className="w-full py-4 border-2 border-dashed border-zinc-800 rounded-2xl text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 hover:bg-zinc-900/50 transition-all flex items-center justify-center gap-2 font-medium"
              >
                <Plus size={20} />
                添加对话段落
              </button>
            </div>

            {/* Action Section */}
            <section className="flex justify-center pt-8 pb-12">
              <button
                onClick={handleGenerate}
                disabled={totalChars === 0 || isGenerating || isOverLimit}
                className={`
                  flex items-center gap-3 px-14 py-4 rounded-full text-lg font-bold text-white transition-all transform
                  ${totalChars === 0 || isGenerating || isOverLimit
                    ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed scale-100' 
                    : 'bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-400 hover:scale-105 shadow-[0_0_20px_rgba(234,88,12,0.4)] hover:shadow-[0_0_30px_rgba(234,88,12,0.6)] active:scale-95'}
                `}
              >
                {isGenerating ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    正在生成 ({generationProgress.current}/{generationProgress.total})...
                  </>
                ) : (
                  <>
                    <Wand2 size={24} />
                    立即生成配音
                  </>
                )}
              </button>
            </section>

          </div>
        </div>

        {/* Right: Voice Sidebar (Smaller) */}
        <div className="w-[280px] border-l border-zinc-800 bg-zinc-900/30 flex flex-col flex-shrink-0">
          <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
            <h3 className="font-bold text-zinc-100 flex items-center gap-2 text-sm">
              <Mic2 size={16} className="text-orange-500" />
              音色列表
            </h3>
            <div className="flex gap-1">
              <button 
                onClick={() => setIsCreateVoiceModalOpen(true)} 
                className="p-1.5 text-zinc-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors" 
                title="创建自定义音色"
              >
                <UserPlus size={16} />
              </button>
              <button 
                onClick={() => setIsCloneModalOpen(true)} 
                className="p-1.5 text-zinc-400 hover:text-orange-400 hover:bg-orange-500/10 rounded-lg transition-colors" 
                title={cloneSlot ? '管理克隆声音' : '创建专属克隆'}
              >
                <Mic size={16} />
              </button>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {femaleVoices.length > 0 && (
              <section>
                <h4 className="text-xs font-bold text-zinc-400 mb-2 flex items-center gap-2">
                  <span className="w-1.5 h-3 bg-pink-500 rounded-full"></span>
                  女声 ({femaleVoices.length})
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  {femaleVoices.map(voice => (
                    <VoiceCard 
                      key={voice.id}
                      voice={voice}
                      isSelected={activeVoiceId === voice.id}
                      onSelect={handleVoiceSelect}
                      onDelete={handleDeleteCustomVoice}
                    />
                  ))}
                </div>
              </section>
            )}

            {maleVoices.length > 0 && (
              <section>
                <h4 className="text-xs font-bold text-zinc-400 mb-2 flex items-center gap-2">
                  <span className="w-1.5 h-3 bg-blue-500 rounded-full"></span>
                  男声 ({maleVoices.length})
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  {maleVoices.map(voice => (
                    <VoiceCard 
                      key={voice.id}
                      voice={voice}
                      isSelected={activeVoiceId === voice.id}
                      onSelect={handleVoiceSelect}
                      onDelete={handleDeleteCustomVoice}
                    />
                  ))}
                </div>
              </section>
            )}

            {childVoices.length > 0 && (
              <section>
                <h4 className="text-xs font-bold text-zinc-400 mb-2 flex items-center gap-2">
                  <span className="w-1.5 h-3 bg-green-500 rounded-full"></span>
                  童声 ({childVoices.length})
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  {childVoices.map(voice => (
                    <VoiceCard 
                      key={voice.id}
                      voice={voice}
                      isSelected={activeVoiceId === voice.id}
                      onSelect={handleVoiceSelect}
                      onDelete={handleDeleteCustomVoice}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>

      </div>

      {/* Modals */}
      <CloneModal 
        isOpen={isCloneModalOpen}
        onClose={() => setIsCloneModalOpen(false)}
        currentSlot={cloneSlot}
        onSave={handleSaveClone}
        onDelete={handleDeleteClone}
      />

      <CreateCharacterModal
        isOpen={isCreateVoiceModalOpen}
        onClose={() => setIsCreateVoiceModalOpen(false)}
        onSave={handleSaveCustomVoice}
      />

    </div>
  );
}
