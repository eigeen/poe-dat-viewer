import { shallowRef, watch } from 'vue'
import { getDirContent, getRootDirs, getFileInfo, readIndexBundle } from 'pathofexile-dat/bundles.js'
import { decompressBundle, decompressFileInBundle, getBatchFileInfo } from '../worker/interface.js'
import type { BundleSource } from '../sources/bundle-source.js'
import * as perf from '@/perf.js'

export class BundleIndex {
  constructor (
    private source: BundleSource
  ) {}

  private readonly index = shallowRef(null as {
    bundlesInfo: Uint8Array
    filesInfo: Uint8Array
    dirsInfo: Uint8Array
    pathReps: Uint8Array
  } | null)

  get isLoaded () {
    return this.index.value != null
  }

  get currentSource () {
    return this.source
  }

  setSource (source: BundleSource) {
    if (this.source === source) return
    this.source = source
    this.index.value = null
  }

  async loadIndex () {
    const indexBin = await this.source.fetchFile('_.index.bin')
    const { slice: indexBundle } = await decompressBundle(indexBin)
    const _index = readIndexBundle(indexBundle)
    const { slice: pathReps } = await decompressBundle(_index.pathRepsBundle.slice().buffer)
    this.index.value = {
      bundlesInfo: _index.bundlesInfo,
      filesInfo: _index.filesInfo,
      dirsInfo: _index.dirsInfo,
      pathReps
    }
  }

  async loadFileContent (fullPath: string) {
    const { bundlesInfo, filesInfo } = this.index.value!
    const location = getFileInfo(fullPath, bundlesInfo, filesInfo)
    if (!location) throw new Error('never')
    const bundleBin = await this.source.fetchFile(location.bundle)

    const { slice } = await decompressFileInBundle(bundleBin.slice(0), location.offset, location.size)
    return slice
  }

  getDirContent (dirPath: string) {
    const { pathReps, dirsInfo } = this.index.value!
    return perf.fn(`[Index] getting "${dirPath}" dir`, () =>
      getDirContent(dirPath, pathReps, dirsInfo))
  }

  getRootDirs () {
    const { pathReps, dirsInfo } = this.index.value!
    return perf.fn('[Index] getting root dirs', () =>
      getRootDirs(pathReps, dirsInfo))
  }

  async getBatchFileInfo (paths: string[]) {
    const { bundlesInfo, filesInfo } = this.index.value!
    return await getBatchFileInfo(paths, bundlesInfo, filesInfo)
  }

  watch (cb: () => void) {
    watch(this.index, cb)
  }
}
