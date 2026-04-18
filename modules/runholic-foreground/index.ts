import { requireNativeModule } from "expo-modules-core";

export type NativeRunSession = {
  sessionId: string | null;
  isRunning: boolean;
  isPaused: boolean;
  startedAt: number;
  elapsedMs: number;
  distanceMeters: number;
  notificationVisible: boolean;
};

type RunholicForegroundModuleType = {
  startRun(): void;
  pauseRun(): void;
  resumeRun(): void;
  stopRun(): void;
  getCurrentSession(): NativeRunSession;
  ensureNotification(): void;
};

export default requireNativeModule<RunholicForegroundModuleType>("RunholicForeground");