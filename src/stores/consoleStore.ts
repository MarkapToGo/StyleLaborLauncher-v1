import { create } from "zustand";

export interface ConsoleLine {
  id: string;
  line: string;
  stream: "stdout" | "stderr";
  timestamp: number;
}

export interface CrashReport {
  title: string;
  description: string;
  solution: string;
}

interface ConsoleState {
  isGameRunning: boolean;
  pid: number | null;
  profileId: string | null;
  profileName: string | null;
  logs: ConsoleLine[];
  isConsoleOpen: boolean;
  crashReport: CrashReport | null;

  // Actions
  setGameRunning: (running: boolean, profileId?: string, profileName?: string, pid?: number | null) => void;
  addLog: (
    line: string,
    stream: "stdout" | "stderr",
    timestamp: number
  ) => void;
  clearLogs: () => void;
  toggleConsole: () => void;
  openConsole: () => void;
  closeConsole: () => void;
  setCrashReport: (report: CrashReport | null) => void;
}

// Limit max logs to prevent memory issues
const MAX_LOGS = 2000;

export const useConsoleStore = create<ConsoleState>((set, get) => ({
  isGameRunning: false,
  pid: null,
  profileId: null,
  profileName: null,
  logs: [],
  isConsoleOpen: false,
  crashReport: null,

  setGameRunning: (running, profileId, profileName, pid) => {
    set({
      isGameRunning: running,
      pid: pid ?? null,
      profileId: profileId ?? null,
      profileName: profileName ?? null,
      // Clear crash report on new run
      crashReport: running ? null : get().crashReport, 
    });
    // Clear logs when game starts fresh
    if (running) {
      set({ logs: [] });
    }
  },

  addLog: (line, stream, timestamp) => {
    const logs = get().logs;
    const newLog: ConsoleLine = {
      id: `${timestamp}-${Math.random().toString(36).slice(2, 9)}`,
      line,
      stream,
      timestamp,
    };

    // Trim old logs if we exceed max
    const updatedLogs = [...logs, newLog];
    if (updatedLogs.length > MAX_LOGS) {
      updatedLogs.splice(0, updatedLogs.length - MAX_LOGS);
    }

    set({ logs: updatedLogs });
  },

  clearLogs: () => set({ logs: [] }),

  toggleConsole: () => set({ isConsoleOpen: !get().isConsoleOpen }),

  openConsole: () => set({ isConsoleOpen: true }),

  closeConsole: () => set({ isConsoleOpen: false }),

  setCrashReport: (report) => {
    set({ crashReport: report, isConsoleOpen: true }); // Auto open console
  },
}));
