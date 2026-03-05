export type SOSStatus = 'idle' | 'active' | 'dead-man-switch';

export interface EmergencyContact {
  name: string;
  phone: string;
  priority: number;
}

export interface AppConfig {
  fakeCalculatorCode: string;
  adminCode: string;
  emergencyContacts: EmergencyContact[];
  deadManTimeout: number;
  aiDetection: {
    voice: boolean;
    motion: boolean;
    customVoiceKeyword?: string;
  };
  evidence: {
    audio: boolean;
    camera: boolean;
    video: boolean;
  };
}

export interface Evidence {
  id: string;
  type: 'photo' | 'audio' | 'video';
  timestamp: Date;
  url: string;
  location?: { lat: number; lng: number };
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  label: string;
  status: 'success' | 'info' | 'warning' | 'danger';
}

export interface SOSState {
  status: SOSStatus;
  lastTriggered: Date | null;
  location: { lat: number; lng: number } | null;
  isRecording: boolean;
  evidence: Evidence[];
}
