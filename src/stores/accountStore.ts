import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Account } from '../types';
import { auth } from '../lib/tauri';

interface AccountState {
  accounts: Account[];
  activeAccount: Account | null;
  isLoading: boolean;
  error: string | null;

  // Login State
  loginStep: 'idle' | 'authorizing' | 'device-code';
  userCode: string | null;
  verificationUri: string | null;
  deviceCode: string | null; // Internal for polling
  message: string | null;

  // Actions
  fetchAccounts: () => Promise<void>;
  startLogin: () => Promise<void>;
  cancelLogin: () => void;
  logout: (uuid: string) => Promise<void>;
  switchAccount: (uuid: string) => Promise<void>;
  refreshToken: (uuid: string) => Promise<void>;
  updateAccountSkin: (uuid: string, skinUrl: string) => void;
  clearError: () => void;
}

export const useAccountStore = create<AccountState>()(
  persist(
    (set, get) => ({
      accounts: [],
      activeAccount: null,
      isLoading: false,
      error: null,

      loginStep: 'idle',
      userCode: null,
      verificationUri: null,
      deviceCode: null,
      message: null,

      updateAccountSkin: (uuid: string, skinUrl: string) => {
        const accounts = get().accounts.map(a =>
          a.uuid === uuid ? { ...a, skinUrl } : a
        );
        const activeAccount = get().activeAccount?.uuid === uuid
          ? { ...get().activeAccount!, skinUrl }
          : get().activeAccount;

        set({ accounts, activeAccount });
      },

      fetchAccounts: async () => {
        set({ isLoading: true, error: null });
        try {
          const fetchedAccounts = await auth.getAccounts();

          // Merge with current state to preserve skinUrl (local override)
          // because fetched accounts from Rust might not have the latest locally applied skin yet
          const currentAccounts = get().accounts;
          const accounts = fetchedAccounts.map(fetched => {
            const existing = currentAccounts.find(a => a.uuid === fetched.uuid);
            if (existing?.skinUrl) {
              return { ...fetched, skinUrl: existing.skinUrl };
            }
            return fetched;
          });

          const activeAccount = accounts.find(a => a.isActive) || null;
          set({ accounts, activeAccount, isLoading: false });
        } catch (error) {
          set({ error: String(error), isLoading: false });
        }
      },

      startLogin: async () => {
        set({ isLoading: true, error: null, loginStep: 'authorizing' });
        try {
          // Get the device code from backend
          const result = await auth.startLogin();

          set({
            userCode: result.user_code,
            verificationUri: result.verification_uri,
            deviceCode: result.device_code, // Store for polling
            message: result.message,
            loginStep: 'device-code',
            isLoading: false
          });

          // Start polling
          const pollInterval = setInterval(async () => {
            const { deviceCode, loginStep } = get();

            // Allow user to cancel
            if (loginStep !== 'device-code' || !deviceCode) {
              clearInterval(pollInterval);
              return;
            }

            try {
              const account = await auth.pollLogin(deviceCode);

              if (account) {
                // Success!
                clearInterval(pollInterval);
                const accounts = [...get().accounts.filter(a => a.uuid !== account.uuid), account];

                // Set as active
                accounts.forEach(a => a.isActive = a.uuid === account.uuid);

                set({
                  accounts,
                  activeAccount: account,
                  isLoading: false,
                  error: null,
                  loginStep: 'idle',
                  userCode: null,
                  verificationUri: null,
                  deviceCode: null,
                  message: null
                });
              }
              // If account is null, it means still waiting (pending/slow_down handled in backend)
            } catch (error) {
              // If error occurs, stop polling and show error INSIDE the modal.
              // Keep the modal open, but clear deviceCode so polling stops.
              clearInterval(pollInterval);
              set({
                error: String(error),
                isLoading: false,
                loginStep: 'device-code',
                deviceCode: null,
              });
            }
          }, (result.interval || 5) * 1000); // Poll every 'interval' seconds (default 5)

        } catch (error) {
          console.error("Login start failed:", error);
          set({
            error: String(error),
            isLoading: false,
            loginStep: 'idle',
            userCode: null,
            verificationUri: null,
            deviceCode: null
          });
        }
      },

      cancelLogin: () => {
        set({
          loginStep: 'idle',
          userCode: null,
          verificationUri: null,
          deviceCode: null, // This stops the poll loop
          message: null,
          error: null
        });
      },

      logout: async (uuid: string) => {
        set({ isLoading: true, error: null });
        try {
          await auth.logout(uuid);
          const accounts = get().accounts.filter(a => a.uuid !== uuid);
          const activeAccount = uuid === get().activeAccount?.uuid
            ? accounts[0] || null
            : get().activeAccount;
          if (activeAccount) {
            activeAccount.isActive = true;
          }
          set({ accounts, activeAccount, isLoading: false });
        } catch (error) {
          set({ error: String(error), isLoading: false });
        }
      },

      switchAccount: async (uuid: string) => {
        set({ isLoading: true, error: null });
        try {
          await auth.switchAccount(uuid);
          const accounts = get().accounts.map(a => ({
            ...a,
            isActive: a.uuid === uuid
          }));
          const activeAccount = accounts.find(a => a.isActive) || null;
          set({ accounts, activeAccount, isLoading: false });
        } catch (error) {
          set({ error: String(error), isLoading: false });
        }
      },

      refreshToken: async (uuid: string) => {
        try {
          const account = await auth.refreshToken(uuid);
          const accounts = get().accounts.map(a =>
            a.uuid === uuid ? account : a
          );
          const activeAccount = account.isActive ? account : get().activeAccount;
          set({ accounts, activeAccount });
        } catch (error) {
          set({ error: String(error) });
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'account-storage',
      partialize: (state) => ({
        accounts: state.accounts,
        activeAccount: state.activeAccount
      }),
    }
  )
);
