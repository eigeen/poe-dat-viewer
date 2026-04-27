import { openDB, type DBSchema } from 'idb'
import type { ViewerSerializedHeader } from '@/app/dat-viewer/db.js'

const WORKSPACE_DIR = '.poe-dat-viewer'
const HEADERS_DIR = 'headers'
const WORKSPACE_FILE = 'workspace.json'
const HANDLE_KEY = 'local-workspace-handle'

export interface WorkspaceMetadata {
  version: 1
  mode: 'local-directory'
  rootName: string
  validFor: 'poe1' | 'poe2'
  updatedAt: string
}

interface AppStateSchema extends DBSchema {
  'app-state': {
    key: string
    value: {
      key: string
      value: FileSystemDirectoryHandle
    }
  }
}

export class LocalWorkspaceHandleStore {
  private readonly db = openDB<AppStateSchema>('poe-dat-viewer-app-state', 1, {
    upgrade (db) {
      db.createObjectStore('app-state', { keyPath: 'key' })
    }
  })

  async getHandle () {
    return (await (await this.db).get('app-state', HANDLE_KEY))?.value ?? null
  }

  async setHandle (handle: FileSystemDirectoryHandle) {
    await (await this.db).put('app-state', {
      key: HANDLE_KEY,
      value: handle
    })
  }

  async clearHandle () {
    await (await this.db).delete('app-state', HANDLE_KEY)
  }
}

export class LocalWorkspaceStore {
  constructor (
    private readonly rootHandle: FileSystemDirectoryHandle
  ) {}

  async init () {
    await this.getWorkspaceDir(true)
    await this.getHeadersDir(true)
  }

  async readWorkspace () {
    const file = await this.tryReadJsonFile<WorkspaceMetadata>([WORKSPACE_DIR, WORKSPACE_FILE])
    return file
  }

  async writeWorkspace (data: WorkspaceMetadata) {
    await this.writeJsonFile([WORKSPACE_DIR, WORKSPACE_FILE], data)
  }

  async readHeaders (tableName: string) {
    return await this.tryReadJsonFile<ViewerSerializedHeader[]>([
      WORKSPACE_DIR,
      HEADERS_DIR,
      `${sanitizeName(tableName)}.json`
    ])
  }

  async writeHeaders (tableName: string, headers: ViewerSerializedHeader[]) {
    await this.writeJsonFile([
      WORKSPACE_DIR,
      HEADERS_DIR,
      `${sanitizeName(tableName)}.json`
    ], headers)
  }

  async removeHeaders (tableName: string) {
    const dir = await this.getHeadersDir(false)
    if (!dir) return

    try {
      await dir.removeEntry(`${sanitizeName(tableName)}.json`)
    } catch (e) {
      if (!(e instanceof DOMException) || e.name !== 'NotFoundError') {
        throw e
      }
    }
  }

  async queryReadPermission () {
    return await queryPermission(this.rootHandle, { mode: 'read' })
  }

  async queryReadwritePermission () {
    return await queryPermission(this.rootHandle, { mode: 'readwrite' })
  }

  async requestReadPermission () {
    return await requestPermission(this.rootHandle, { mode: 'read' })
  }

  async requestReadwritePermission () {
    return await requestPermission(this.rootHandle, { mode: 'readwrite' })
  }

  private async tryReadJsonFile<T> (path: string[]) {
    try {
      const fileHandle = await getFileHandleByPath(this.rootHandle, path)
      const file = await fileHandle.getFile()
      return JSON.parse(await file.text()) as T
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotFoundError') {
        return null
      }
      throw e
    }
  }

  private async writeJsonFile (path: string[], data: unknown) {
    const fileHandle = await getFileHandleByPath(this.rootHandle, path, true)
    const writable = await fileHandle.createWritable()
    await writable.write(JSON.stringify(data, null, 2))
    await writable.close()
  }

  private async getWorkspaceDir (create: boolean) {
    return await this.rootHandle.getDirectoryHandle(WORKSPACE_DIR, { create })
  }

  private async getHeadersDir (create: boolean) {
    const workspaceDir = await this.getWorkspaceDir(create)
    return await workspaceDir.getDirectoryHandle(HEADERS_DIR, { create })
  }
}

async function getFileHandleByPath (
  root: FileSystemDirectoryHandle,
  path: string[],
  create = false
) {
  let dir = root
  for (const segment of path.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(segment, { create })
  }
  return await dir.getFileHandle(path[path.length - 1], { create })
}

function sanitizeName (name: string) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
}

async function queryPermission (
  handle: FileSystemDirectoryHandle,
  descriptor: FileSystemHandlePermissionDescriptor
) {
  return handle.queryPermission?.(descriptor) ?? 'granted'
}

async function requestPermission (
  handle: FileSystemDirectoryHandle,
  descriptor: FileSystemHandlePermissionDescriptor
) {
  return handle.requestPermission?.(descriptor) ?? 'granted'
}
