import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SystemMode = 'manual' | 'assisted' | 'autonomous';

interface ModeState {
    mode: SystemMode;
    isModalOpen: boolean;
    setMode: (mode: SystemMode) => void;
    toggleModal: (isOpen: boolean) => void;
}

export const useModeStore = create<ModeState>()(
    persist(
        (set) => ({
            mode: 'manual',
            isModalOpen: false,
            setMode: (mode) => set({ mode }),
            toggleModal: (isOpen) => set({ isModalOpen: isOpen }),
        }),
        {
            name: 'mode-preference',
            partialize: (state) => ({ mode: state.mode }), // Only persist mode
        }
    )
);
