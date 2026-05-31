import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('branchPilot', {
  getVersion: () => ipcRenderer.invoke('app:version') as Promise<string>,
  chooseRepositoryFolder: () => ipcRenderer.invoke('repo:chooseFolder') as Promise<string | null>
})
