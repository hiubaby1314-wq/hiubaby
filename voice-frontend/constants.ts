import { Voice } from './types.ts';

// A tiny valid WAV file in base64 for preview purposes
export const TINY_WAV_BASE64 = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

export const DEFAULT_VOICES: Voice[] = [
  {
    id: 'male-qn-qingse',
    name: '青涩青年',
    gender: 'male',
    tags: ['自然', '阳光', '解说'],
    previewAudio: TINY_WAV_BASE64
  },
  {
    id: 'female-shaonv',
    name: '甜美少女',
    gender: 'female',
    tags: ['甜美', '活力', '广告'],
    previewAudio: TINY_WAV_BASE64
  },
  {
    id: 'male-zhubo',
    name: '沉稳主播',
    gender: 'male',
    tags: ['专业', '新闻', '有声书'],
    previewAudio: TINY_WAV_BASE64
  },
  {
    id: 'female-yujie',
    name: '知性御姐',
    gender: 'female',
    tags: ['成熟', '温柔', '情感'],
    previewAudio: TINY_WAV_BASE64
  },
  {
    id: 'child-boy',
    name: '调皮男童',
    gender: 'child',
    tags: ['可爱', '童话', '活泼'],
    previewAudio: TINY_WAV_BASE64
  }
];

export const HISTORY_RETENTION_DAYS = 7;
export const MAX_TEXT_LENGTH = 500;

export const EMOTIONS = [
  { value: 'neutral', label: '默认' },
  { value: 'happy', label: '开心' },
  { value: 'sad', label: '悲伤' },
  { value: 'angry', label: '生气' },
  { value: 'fear', label: '恐惧' },
  { value: 'surprise', label: '惊讶' }
];

export const SPEEDS = [
  { value: 0.5, label: '0.5x 极慢' },
  { value: 0.75, label: '0.75x 较慢' },
  { value: 1.0, label: '1.0x 正常' },
  { value: 1.25, label: '1.25x 较快' },
  { value: 1.5, label: '1.5x 极快' },
  { value: 2.0, label: '2.0x 起飞' }
];