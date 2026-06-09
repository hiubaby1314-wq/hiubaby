export enum ViewState {
    DASHBOARD = 'DASHBOARD',
    CHAT = 'CHAT',
    VISION = 'VISION',
    IMAGE_GEN = 'IMAGE_GEN',
    VIDEO_GEN = 'VIDEO_GEN',
    IMAGE_EDIT = 'IMAGE_EDIT'
}

export type Language = 'EN' | 'ZH';

export interface Message {
    id: string;
    role: 'user' | 'model';
    text: string;
    timestamp: number;
}

export interface GeneratedImage {
    id: string;
    url: string;
    prompt: string;
    timestamp: number;
}

export interface GeneratedVideo {
    id: string;
    url: string;
    prompt: string;
    timestamp: number;
}