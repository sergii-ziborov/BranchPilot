/// <reference types="vite/client" />

import type { BranchPilotApi } from './shared/branchPilot'

declare global {
  interface Window {
    branchPilot?: BranchPilotApi
  }
}

export {}
