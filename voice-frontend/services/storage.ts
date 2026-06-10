import { DubbingHistory, CloneSlot, Voice } from '../types.ts';
import { HISTORY_RETENTION_DAYS } from '../constants.ts';

const HISTORY_KEY = 'chestnut_dubbing_history';
const CLONE_SLOT_KEY = 'chestnut_clone_slot';
const CUSTOM_VOICES_KEY = 'chestnut_custom_voices';

export const storageService = {
  getHistory: (): DubbingHistory[] => {
    try {
      const data = localStorage.getItem(HISTORY_KEY);
      if (!data) return [];
      
      const history: DubbingHistory[] = JSON.parse(data);
      const now = Date.now();
      const retentionMs = HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      
      // Filter out items older than 7 days
      const validHistory = history.filter(item => (now - item.timestamp) <= retentionMs);
      
      // If we filtered items out, update storage
      if (validHistory.length !== history.length) {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(validHistory));
      }
      
      return validHistory.sort((a, b) => b.timestamp - a.timestamp);
    } catch (e) {
      console.error('Failed to parse history', e);
      return [];
    }
  },

  saveHistoryItem: (item: DubbingHistory): void => {
    const history = storageService.getHistory();
    history.unshift(item);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  },

  deleteHistoryItem: (id: string): void => {
    const history = storageService.getHistory();
    const newHistory = history.filter(item => item.id !== id);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
  },

  getCloneSlot: (): CloneSlot | null => {
    try {
      const data = localStorage.getItem(CLONE_SLOT_KEY);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  },

  saveCloneSlot: (slot: CloneSlot): void => {
    localStorage.setItem(CLONE_SLOT_KEY, JSON.stringify(slot));
  },

  deleteCloneSlot: (): void => {
    localStorage.removeItem(CLONE_SLOT_KEY);
  },

  getCustomVoices: (): Voice[] => {
    try {
      const data = localStorage.getItem(CUSTOM_VOICES_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  },

  saveCustomVoice: (voice: Voice): void => {
    const voices = storageService.getCustomVoices();
    voices.push(voice);
    localStorage.setItem(CUSTOM_VOICES_KEY, JSON.stringify(voices));
  },

  deleteCustomVoice: (id: string): void => {
    const voices = storageService.getCustomVoices();
    const newVoices = voices.filter(v => v.id !== id);
    localStorage.setItem(CUSTOM_VOICES_KEY, JSON.stringify(newVoices));
  }
};