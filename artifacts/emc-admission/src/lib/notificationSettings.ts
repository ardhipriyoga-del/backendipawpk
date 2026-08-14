import { getDB } from './db';

export type NotificationKind = 'ktm' | 'igd' | 'billing' | 'pending' | 'checklist' | 'operating-theatre';
export type NotificationSound = 'chime' | 'double' | 'alert' | 'soft';

export interface NotificationSettings {
  soundEnabled: boolean;
  popupEnabled: boolean;
  volume: number;
  loop: boolean;
  sounds: Record<NotificationKind, NotificationSound>;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  soundEnabled: true,
  popupEnabled: true,
  volume: 0.35,
  loop: false,
  sounds: {
    ktm: 'chime',
    igd: 'double',
    billing: 'alert',
    pending: 'soft',
    checklist: 'soft',
    'operating-theatre': 'chime',
  },
};

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  ktm: 'KTM baru',
  igd: 'Perubahan IGD',
  billing: 'Billing Checker',
  pending: 'Pending Operan',
  checklist: 'Checklist Pasien',
  'operating-theatre': 'Operating Theatre',
};

export const NOTIFICATION_SOUND_LABELS: Record<NotificationSound, string> = {
  chime: 'Chime',
  double: 'Dua nada',
  alert: 'Alert',
  soft: 'Nada lembut',
};

export const NOTIFICATION_KIND_META: Record<NotificationKind, {
  label: string;
  description: string;
  destination: string;
  priority: 'normal' | 'attention';
}> = {
  ktm: {
    label: 'KTM baru',
    description: 'Pasien baru yang masuk antrean KTM.',
    destination: '/monitoring-ktm',
    priority: 'attention',
  },
  igd: {
    label: 'Perubahan IGD',
    description: 'Perubahan status atau antrean pasien IGD.',
    destination: '/igd-ward',
    priority: 'attention',
  },
  billing: {
    label: 'Billing Checker',
    description: 'Tindakan yang membutuhkan pemeriksaan billing.',
    destination: '/billing-checker',
    priority: 'attention',
  },
  pending: {
    label: 'Pending Operan',
    description: 'Operan yang belum ditindaklanjuti.',
    destination: '/pending',
    priority: 'normal',
  },
  checklist: {
    label: 'Checklist Pasien',
    description: 'Checklist pasien yang perlu ditinjau.',
    destination: '/checklist-pasien',
    priority: 'attention',
  },
  'operating-theatre': {
    label: 'Operating Theatre',
    description: 'Rencana tindakan dan pasien Operating Theatre baru.',
    destination: '/pasien-rencana-tindakan',
    priority: 'attention',
  },
};

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const db = await getDB();
  const entry = await db.get('settings', 'notificationSettings');
  return {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...(entry?.value ?? {}),
    sounds: {
      ...DEFAULT_NOTIFICATION_SETTINGS.sounds,
      ...(entry?.value?.sounds ?? {}),
    },
  };
}

export async function saveNotificationSettings(settings: NotificationSettings): Promise<void> {
  const db = await getDB();
  await db.put('settings', { key: 'notificationSettings', value: settings });
}

let activeLoop: ReturnType<typeof setInterval> | null = null;
let activeContext: AudioContext | null = null;
let soundGeneration = 0;
let audioUnlocked = false;
let queuedSound: NotificationKind | null = null;
let audioUnlockListenerInstalled = false;

function installAudioUnlockListener(): void {
  if (audioUnlockListenerInstalled || typeof window === 'undefined') return;
  audioUnlockListenerInstalled = true;
  const unlock = () => {
    audioUnlocked = true;
    if (activeContext) void activeContext.resume().catch(() => undefined);
    const pending = queuedSound;
    queuedSound = null;
    if (pending) void playNotificationSound(pending);
  };
  window.addEventListener('pointerdown', unlock, { once: true, passive: true });
  window.addEventListener('keydown', unlock, { once: true });
  window.addEventListener('touchstart', unlock, { once: true, passive: true });
}

if (typeof window !== 'undefined') installAudioUnlockListener();

function playTone(context: AudioContext, frequency: number, start: number, duration: number, volume: number) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  oscillator.connect(gain);
  gain.connect(context.destination);
  gain.gain.setValueAtTime(Math.max(0.001, volume), start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  oscillator.start(start);
  oscillator.stop(start + duration);
}

function playPattern(sound: NotificationSound, volume: number): void {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  const context = activeContext ?? new AudioContextClass();
  activeContext = context;
  void context.resume();
  const now = context.currentTime;
  const patterns: Record<NotificationSound, number[]> = {
    chime: [880, 1175, 1568],
    double: [660, 990],
    alert: [440, 440, 440],
    soft: [523, 659],
  };
  patterns[sound].forEach((frequency, index) => {
    playTone(context, frequency, now + index * 0.2, 0.18, volume);
  });
}

export function playNotificationPreview(
  sound: NotificationSound,
  volume: number,
): void {
  audioUnlocked = true;
  queuedSound = null;
  stopNotificationSound();
  playPattern(sound, Math.min(1, Math.max(0, volume)));
}

export function stopNotificationSound(): void {
  soundGeneration += 1;
  queuedSound = null;
  if (activeLoop) {
    clearInterval(activeLoop);
    activeLoop = null;
  }
  if (activeContext) {
    void activeContext.suspend();
    activeContext = null;
  }
}

export async function playNotificationSound(kind: NotificationKind): Promise<void> {
  installAudioUnlockListener();
  const generation = soundGeneration;
  const settings = await getNotificationSettings();
  if (generation !== soundGeneration) return;
  if (!settings.soundEnabled) return;
  if (!audioUnlocked) {
    queuedSound = kind;
    return;
  }
  stopNotificationSound();
  const playbackGeneration = soundGeneration;
  playPattern(settings.sounds[kind], settings.volume);
  if (settings.loop) {
    activeLoop = setInterval(() => {
      if (playbackGeneration !== soundGeneration) return;
      playPattern(settings.sounds[kind], settings.volume);
    }, 1600);
  }
}