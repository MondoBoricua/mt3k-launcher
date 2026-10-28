import { create } from 'zustand'
import { OLED_CARE_WAKE_SUPPRESS_MS } from '@shared/oledCarePolicy'

interface AttractModeState {
  active: boolean
  lastInputAt: number
  /**
   * La capa OLED está puesta. Vive en el store para que el sondeo del
   * mando la lea sin importar el componente de React.
   */
  oledCover: boolean
  /**
   * Hasta cuándo teclado y puntero comparten la ventana corta de un
   * despertar. Cero significa que no hay ventana armada.
   */
  inputSuppressUntil: number
  touch: () => void
}
export const useAttractModeStore = create<AttractModeState>((set) => ({
  active: false,
  lastInputAt: Date.now(),
  oledCover: false,
  inputSuppressUntil: 0,
  // Si la capa estaba puesta, este despertar la apaga y arma la ventana
  // corta de teclado y puntero. Si no, solo mueve el reloj.
  touch: () => set((state) => {
    const now = Date.now()
    if (!state.oledCover) return { active: false, lastInputAt: now }
    return {
      active: false,
      lastInputAt: now,
      oledCover: false,
      inputSuppressUntil: now + OLED_CARE_WAKE_SUPPRESS_MS
    }
  })
}))
