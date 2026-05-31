/// <reference types="vite/client" />

interface Window {
  branchPilot?: {
    getVersion: () => Promise<string>
    chooseRepositoryFolder: () => Promise<string | null>
  }
}
