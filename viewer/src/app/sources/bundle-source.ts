import { shallowReactive, computed, type ComputedRef } from 'vue'
import ExpiryMap from 'expiry-map'
import { ValidFor } from 'pathofexile-dat-schema'

const BUNDLE_DIR = 'Bundles2'

export type WorkspaceMode = 'remote' | 'local-directory'

export interface BundleProgress {
  totalSize: number
  received: number
  bundleName: string
}

export interface BundleSource {
  readonly kind: WorkspaceMode
  readonly displayName: string | null
  readonly validFor: ValidFor
  readonly progress: ComputedRef<BundleProgress | null>
  fetchFile(name: string): Promise<ArrayBufferLike>
}

export class RemoteBundleSource implements BundleSource {
  readonly kind = 'remote' as const

  private patchVer = ''

  private readonly state = shallowReactive({
    totalSize: 0,
    received: 0,
    bundleName: '',
    isDownloading: false,
    active: null as Promise<unknown> | null
  })

  private readonly cache = window.caches.open('bundles')

  private readonly registry = new FinalizationRegistry<string>(name => {
    console.debug(`[Bundle] garbage-collected, name: "${name}"`)
  })

  private readonly weakCache = new ExpiryMap<string, ArrayBufferLike>(20 * 1000)

  get displayName () {
    return this.patchVer || null
  }

  get patchVersion () {
    return this.patchVer
  }

  get validFor () {
    return this.patchVer.startsWith('4.')
      ? ValidFor.PoE2
      : ValidFor.PoE1
  }

  readonly progress = computed(() => {
    return (this.state.isDownloading) ? {
      totalSize: this.state.totalSize,
      received: this.state.received,
      bundleName: this.state.bundleName
    } : null
  })

  async setPatch (version: string) {
    if (this.state.active) {
      await this.state.active
    }
    if (this.patchVer && this.patchVer !== version) {
      this.weakCache.clear()
      await this.clearCache(version)
    }
    this.patchVer = version
  }

  private async clearCache (keepPatch: string) {
    const [major] = keepPatch.split('.', 1)
    const keepPrefix = `/${keepPatch}/`
    const deletePrefix = `/${major}.`

    const cache = await this.cache
    const requests = await cache.keys()
    for (const request of requests) {
      const { pathname } = new URL(request.url)
      if (pathname.startsWith(deletePrefix) && !pathname.startsWith(keepPrefix)) {
        await cache.delete(request)
      }
    }
  }

  async fetchFile (name: string): Promise<ArrayBufferLike> {
    let bundle = this.weakCache.get(name)
    if (bundle && bundle.byteLength !== 0) {
      console.log(`[Bundle] name: "${name}", source: memory.`)
      this.weakCache.set(name, bundle)
      return bundle
    }

    const { state } = this
    if (state.active) {
      await state.active
      return await this.fetchFile(name)
    }

    const promise = this.fetchFileImpl(name)
    state.active = promise
    try {
      bundle = await promise
      this.registry.register(bundle, name)
      this.weakCache.set(name, bundle)
      return bundle
    } catch (e) {
      window.alert('You may need to adjust the patch version.')
      throw e
    } finally {
      state.active = null
    }
  }

  private async fetchFileImpl (name: string): Promise<ArrayBufferLike> {
    const { state, patchVer } = this
    const path = `${patchVer}/${BUNDLE_DIR}/${name}`
    const cache = await this.cache
    let res = await cache.match(path)
    if (res) {
      console.log(`[Bundle] name: "${name}", source: disk cache.`)
    } else {
      console.log(`[Bundle] name: "${name}", source: network.`)

      state.totalSize = 0
      state.received = 0
      state.isDownloading = true
      state.bundleName = name

      res = await fetch(`https://poe-bundles.snos.workers.dev/${path}`)
      if (res.status !== 200) {
        state.isDownloading = false
        throw new Error(`patchcdn: ${res.status} ${res.statusText}`)
      }
      state.totalSize = Number(res.headers.get('content-length'))

      let buf: Uint8Array<ArrayBuffer>
      try {
        const reader = res.body!.getReader()
        const chunks = [] as Uint8Array<ArrayBuffer>[]
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          state.received += value.length
        }

        buf = new Uint8Array(state.received)
        let bufPos = 0
        for (const chunk of chunks) {
          buf.set(chunk, bufPos)
          bufPos += chunk.length
        }
      } finally {
        state.isDownloading = false
      }

      await cache.put(path, new Response(buf, {
        headers: {
          'content-length': String(buf.byteLength),
          'content-type': 'application/octet-stream'
        }
      }))
      return buf.buffer
    }
    return await res.arrayBuffer()
  }
}

export class LocalDirectoryBundleSource implements BundleSource {
  readonly kind = 'local-directory' as const
  readonly progress = computed<BundleProgress | null>(() => null)

  private rootHandle: FileSystemDirectoryHandle | null = null
  private bundlesHandle: FileSystemDirectoryHandle | null = null
  private gameRootName = ''
  private gameValidFor = ValidFor.PoE1

  get displayName () {
    return this.gameRootName || null
  }

  get validFor () {
    return this.gameValidFor
  }

  async setRootHandle (handle: FileSystemDirectoryHandle) {
    const bundlesHandle = await handle.getDirectoryHandle(BUNDLE_DIR)
    await bundlesHandle.getFileHandle('_.index.bin')

    this.rootHandle = handle
    this.bundlesHandle = bundlesHandle
    this.gameRootName = handle.name
    this.gameValidFor = inferValidForFromDirectoryName(handle.name)
  }

  getRootHandle () {
    return this.rootHandle
  }

  async fetchFile (name: string): Promise<ArrayBufferLike> {
    if (!this.bundlesHandle) {
      throw new Error('The local game directory is not initialized.')
    }

    const fileHandle = await getFileHandleByPath(this.bundlesHandle, name)
    const file = await fileHandle.getFile()
    return await file.arrayBuffer()
  }
}

async function getFileHandleByPath (root: FileSystemDirectoryHandle, filePath: string): Promise<FileSystemFileHandle> {
  const parts = filePath.split('/').filter(Boolean)
  let dir = root
  for (const part of parts.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(part)
  }
  return await dir.getFileHandle(parts[parts.length - 1])
}

export function inferValidForFromDirectoryName (name: string) {
  return /\bpoe\s*2\b|path of exile 2/i.test(name)
    ? ValidFor.PoE2
    : ValidFor.PoE1
}
