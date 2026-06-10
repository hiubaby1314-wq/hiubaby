export interface Voice {
  id: string;
  name: string;
  gender: 'male' | 'female' | 'child';
  tags: string[];
  previewAudio?: string;
  isClone?: boolean;
  isCustom?: boolean;
}

export interface Character {
  id: string;
  name: string;
  voiceId: string;
}

export interface ScriptBlock {
  id: string;
  text: string;
  characterId: string;
  emotion?: string;
  speed?: number;
}

export interface DubbingSegment {
  text: string;
  voiceName: string;
  audioDataUrl: string;
}

export interface DubbingHistory {
  id: string;
  text: string; // Summary text or full text for single
  voiceId?: string; // Legacy single voice
  voiceName: string; // "多人配音" or single voice name
  audioDataUrl?: string; // Legacy single audio
  segments?: DubbingSegment[]; // New multi-segment audio
  timestamp: number;
}

export interface CloneSlot {
  id: string;
  name: string;
  createdAt: number;
  isActive: boolean;
}