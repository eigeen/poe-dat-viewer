import { shallowRef, computed } from 'vue'
import { ValidFor } from 'pathofexile-dat-schema'
import { BundleIndex } from '@/app/patchcdn/index-store.js'
import { DatSchemasDatabase } from '@/app/dat-viewer/db.js'
import { TABLES_WEAK_CACHE } from '@/app/dat-viewer/Viewer.js'
import { LocalWorkspaceHandleStore, LocalWorkspaceStore, type WorkspaceMetadata } from './local-workspace.js'
import { LocalDirectoryBundleSource, RemoteBundleSource, type WorkspaceMode } from '@/app/sources/bundle-source.js'
import { resetTabsToImport } from './workbench-core.js'

export class WorkbenchRuntime {
  readonly remoteSource = new RemoteBundleSource()
  readonly localSource = new LocalDirectoryBundleSource()
  readonly index = new BundleIndex(this.remoteSource)
  readonly schemas = new DatSchemasDatabase(this.index)
  private readonly handleStore = new LocalWorkspaceHandleStore()

  readonly mode = shallowRef<WorkspaceMode>('remote')
  readonly localDirectoryName = shallowRef<string | null>(null)
  readonly localCanWrite = shallowRef(true)
  readonly isInitializing = shallowRef(true)

  readonly currentSource = computed(() =>
    this.mode.value === 'local-directory'
      ? this.localSource
      : this.remoteSource
  )

  readonly modeLabel = computed(() =>
    this.mode.value === 'local-directory'
      ? 'Local directory'
      : 'Patch CDN'
  )

  readonly sourceDetails = computed(() => {
    if (this.mode.value === 'local-directory') {
      return this.localDirectoryName.value
    }
    return this.remoteSource.displayName
  })

  async init () {
    try {
      await this.schemas.fetchBundledSchema()
      await this.tryRestoreLocalDirectory()
    } finally {
      this.isInitializing.value = false
    }
  }

  async enterRemoteMode (patch: string) {
    await this.schemas.fetchSchema()
    await this.remoteSource.setPatch(patch)
    this.resetWorkspaceViews()
    this.index.setSource(this.remoteSource)
    this.schemas.setRemoteMode(this.remoteSource.validFor)
    this.mode.value = 'remote'
    this.localDirectoryName.value = null
    this.localCanWrite.value = true
    await this.index.loadIndex()
  }

  async pickLocalDirectory () {
    if (typeof window.showDirectoryPicker !== 'function') {
      throw new Error('This browser does not support opening local directories.')
    }

    const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
    await this.enterLocalMode(handle, { persistHandle: true, allowPermissionPrompt: true })
  }

  async tryRestoreLocalDirectory () {
    const handle = await this.handleStore.getHandle()
    if (!handle) return false

    try {
      await this.enterLocalMode(handle, { persistHandle: false, allowPermissionPrompt: false })
      return true
    } catch (e) {
      console.warn('Failed to restore local workspace.', e)
      if (e instanceof DOMException && e.name === 'NotFoundError') {
        await this.handleStore.clearHandle()
      } else if (e instanceof Error && e.message.includes('Read permission')) {
        window.alert('Local workspace permission expired. Re-open the game directory to continue using local mode.')
      }
      return false
    }
  }

  private async enterLocalMode (
    handle: FileSystemDirectoryHandle,
    opts: { persistHandle: boolean, allowPermissionPrompt: boolean }
  ) {
    const workspace = new LocalWorkspaceStore(handle)
    const readPermission = await ensurePermission(workspace, 'read', opts.allowPermissionPrompt)
    if (readPermission !== 'granted') {
      throw new Error('Read permission was not granted for the selected directory.')
    }

    await this.localSource.setRootHandle(handle)

    const readwritePermission = await ensurePermission(workspace, 'readwrite', opts.allowPermissionPrompt)
    const canWrite = readwritePermission === 'granted'

    if (canWrite) {
      await workspace.init()
      await workspace.writeWorkspace(this.createWorkspaceMetadata(handle.name, this.localSource.validFor))
    }

    await this.schemas.fetchBundledSchema()
    this.resetWorkspaceViews()
    this.index.setSource(this.localSource)
    this.schemas.setLocalMode(workspace, this.localSource.validFor, canWrite)
    this.mode.value = 'local-directory'
    this.localDirectoryName.value = handle.name
    this.localCanWrite.value = canWrite
    await this.index.loadIndex()

    if (opts.persistHandle) {
      await this.handleStore.setHandle(handle)
    }
  }

  private createWorkspaceMetadata (rootName: string, validFor: ValidFor): WorkspaceMetadata {
    return {
      version: 1,
      mode: 'local-directory',
      rootName,
      validFor: validFor === ValidFor.PoE2 ? 'poe2' : 'poe1',
      updatedAt: new Date().toISOString()
    }
  }

  private resetWorkspaceViews () {
    TABLES_WEAK_CACHE.clear()
    resetTabsToImport()
  }
}

async function ensurePermission (
  workspace: LocalWorkspaceStore,
  mode: 'read' | 'readwrite',
  allowPrompt: boolean
) {
  const permission = mode === 'read'
    ? await workspace.queryReadPermission()
    : await workspace.queryReadwritePermission()

  if (permission === 'granted' || !allowPrompt) {
    return permission
  }

  return mode === 'read'
    ? await workspace.requestReadPermission()
    : await workspace.requestReadwritePermission()
}
