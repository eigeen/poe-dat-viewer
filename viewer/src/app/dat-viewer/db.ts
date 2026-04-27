import { openDB, type DBSchema } from 'idb'
import { type Ref, shallowRef, triggerRef } from 'vue'
import { type SchemaFile, type SchemaTable, SCHEMA_VERSION, ValidFor } from 'pathofexile-dat-schema'
import { fromSerializedHeaders, type Header } from './headers.js'
import type { BundleIndex } from '@/app/patchcdn/index-store.js'
import { readDatFile } from 'pathofexile-dat/dat.js'
import { decompressFileInBundle, analyzeDatFile } from '../worker/interface.js'
import type { LocalWorkspaceStore } from '@/app/workbench/local-workspace.js'
import bundledSchemaUrl from '@/assets/schema.min.json?url'

export type ViewerSerializedHeader =
  Omit<Header, 'offset' | 'length'> & { length?: number }

interface DatSchema {
  name: string
  headers: ViewerSerializedHeader[]
}

interface PoeDatViewerSchema extends DBSchema {
  'dat-schemas': {
    key: DatSchema['name']
    value: DatSchema
  }
}

export interface TableStats {
  name: string
  totalRows: number
  headersValid: boolean
  increasedRowLength: boolean
}

export interface SchemaProvider {
  fetchSchema(): Promise<void>
  findByName(name: string): Promise<ViewerSerializedHeader[]>
  saveHeaders(name: string, headers: Header[]): Promise<void>
  removeHeaders(name: string): Promise<void>
}

export class DatSchemasDatabase implements SchemaProvider {
  private readonly publicSchema = shallowRef<SchemaFile['tables']>([])
  private readonly _isLoading = shallowRef(false)
  get isLoaded () { return this.publicSchema.value.length > 0 }
  get isLoading () { return this._isLoading.value }

  private readonly _tableStats = shallowRef<TableStats[]>([])
  get tableStats () {
    return this._tableStats.value as readonly TableStats[]
  }

  private validFor = ValidFor.PoE1
  private localWorkspace: LocalWorkspaceStore | null = null
  private readonly warnedTables = new Set<string>()
  private _canSaveHeaders = true

  get canSaveHeaders () {
    return this._canSaveHeaders
  }

  constructor (
    private readonly index: BundleIndex
  ) {}

  private readonly db = openDB<PoeDatViewerSchema>('poe-dat-viewer', 3, {
    upgrade (db) {
      if (!db.objectStoreNames.contains('dat-schemas')) {
        db.createObjectStore('dat-schemas', { keyPath: 'name' })
      }
    }
  })

  async fetchSchema () {
    this._isLoading.value = true
    try {
      const response = await fetch('https://poe-bundles.snos.workers.dev/schema.min.json')
      const schema: SchemaFile = await response.json()
      if (schema.version === SCHEMA_VERSION) {
        this.publicSchema.value = schema.tables
      } else {
        console.warn('Latest schema version is not supported.')
      }
    } finally {
      this._isLoading.value = false
    }
  }

  async fetchBundledSchema () {
    if (this.isLoaded) return

    this._isLoading.value = true
    try {
      const response = await fetch(bundledSchemaUrl)
      const schema: SchemaFile = await response.json()
      if (schema.version === SCHEMA_VERSION) {
        this.publicSchema.value = schema.tables
      } else {
        console.warn('Bundled schema version is not supported.')
      }
    } finally {
      this._isLoading.value = false
    }
  }

  setRemoteMode (validFor: ValidFor) {
    this.validFor = validFor
    this.localWorkspace = null
    this._canSaveHeaders = true
    this._tableStats.value = []
  }

  setLocalMode (workspace: LocalWorkspaceStore, validFor: ValidFor, canWrite: boolean) {
    this.validFor = validFor
    this.localWorkspace = workspace
    this._canSaveHeaders = canWrite
    this._tableStats.value = []
  }

  async findSchemaByName (name: string): Promise<DatSchema | undefined> {
    const localSchema = await this.findOverrideByName(name)
    if (localSchema != null) {
      return localSchema
    }

    name = name.toLowerCase()
    const foundByName = this.publicSchema.value
      .filter(s => s.name.toLowerCase() === name)
    const sch = foundByName.find(s => s.validFor & this.validFor) ??
      foundByName.at(0)

    return sch && fromPublicSchema(sch)
  }

  async findByName (name: string): Promise<ViewerSerializedHeader[]> {
    const schema = await this.findSchemaByName(name)
    return schema?.headers ?? []
  }

  async saveHeaders (
    name: string,
    headers: Header[]
  ) {
    const serialized = serializeHeaders(headers)
    if (this.localWorkspace) {
      if (!this._canSaveHeaders) {
        return
      }
      await this.localWorkspace.writeHeaders(name, serialized)
      return
    }

    await (await this.db).put('dat-schemas', {
      name,
      headers: serialized
    })
  }

  async removeHeaders (name: string) {
    if (this.localWorkspace) {
      if (!this._canSaveHeaders) {
        return
      }
      await this.localWorkspace.removeHeaders(name)
      return
    }

    await (await this.db).delete('dat-schemas', name)
  }

  async preloadDataTables (totalTables: Ref<number>) {
    const tablesDirPath = this.validFor === ValidFor.PoE2
      ? 'data/balance'
      : 'data'

    const filePaths = this.index.getDirContent(tablesDirPath)
      .files
      .filter(file => file.endsWith('.datc64'))

    totalTables.value = filePaths.length
    this._tableStats.value = []

    const filesInfo = await this.index.getBatchFileInfo(filePaths)

    const byBundle = filesInfo.reduce<Array<{
      name: string
      files: Array<{ fullPath: string, location: { offset: number, size: number } }>
    }>>((byBundle, location, idx) => {
      if (!location) throw new Error('never')
      const found = byBundle.find(bundle => bundle.name === location.bundle)
      const fullPath = filePaths[idx]
      if (found) {
        found.files.push({ fullPath, location })
      } else {
        byBundle.push({
          name: location.bundle,
          files: [{ fullPath: filePaths[idx], location }]
        })
      }
      return byBundle
    }, [])

    for (const bundle of byBundle) {
      let bundleBin = await this.index.currentSource.fetchFile(bundle.name)
      for (const { fullPath, location } of bundle.files) {
        const res = await decompressFileInBundle(bundleBin, location.offset, location.size)
        bundleBin = res.bundle

        const datFile = readDatFile(fullPath, res.slice)
        const columnStats = await analyzeDatFile(datFile, { transfer: true })
        const name = fullPath.replace(tablesDirPath + '/', '').replace('.datc64', '')

        const schema = await this.findSchemaByName(name)
        const headers = fromSerializedHeaders(schema?.headers ?? [], columnStats, datFile)

        this._tableStats.value.push({
          name: schema?.name ?? name,
          totalRows: datFile.rowCount,
          headersValid: (headers != null),
          increasedRowLength: (headers) ? headers.increasedRowLength : false
        })
        triggerRef(this._tableStats)
      }
    }
  }

  private async findOverrideByName (name: string): Promise<DatSchema | undefined> {
    if (this.localWorkspace) {
      try {
        const headers = await this.localWorkspace.readHeaders(name)
        return headers ? { name, headers } : undefined
      } catch (e) {
        if (!this.warnedTables.has(name)) {
          this.warnedTables.add(name)
          window.alert(`WARN: Failed to read local schema override for "${name}". Falling back to bundled schema.`)
        }
        console.warn(e)
        return undefined
      }
    }

    return await (await this.db).get('dat-schemas', name)
  }
}

function serializeHeaders (headers: Header[]) {
  return headers.map<ViewerSerializedHeader>(header => ({
    ...header,
    length: (
      header.type.string ||
      header.type.array ||
      header.type.key ||
      header.type.boolean ||
      header.type.decimal ||
      header.type.integer
    ) ? undefined
      : header.length
  }))
}

function fromPublicSchema (sch: SchemaTable): DatSchema {
  const headers = sch.columns.flatMap<ViewerSerializedHeader>(column => {
    const type: ViewerSerializedHeader['type'] = {
      array: column.array,
      byteView:
        column.type === 'array' ? { array: true }
        : undefined,
      integer:
        column.type === 'u16' ? { unsigned: true, size: 2 }
        : column.type === 'u32' ? { unsigned: true, size: 4 }
        : column.type === 'i16' ? { unsigned: false, size: 2 }
        : column.type === 'i32' ? { unsigned: false, size: 4 }
        : column.type === 'enumrow' ? { unsigned: false, size: 4 }
        : undefined,
      decimal:
        column.type === 'f32' ? { size: 4 }
        : undefined,
      string:
        column.type === 'string' ? {}
        : undefined,
      boolean:
        column.type === 'bool' ? {}
        : undefined,
      key:
        (column.type === 'row' || column.type === 'foreignrow') ? {
          foreign: (column.type === 'foreignrow'),
          table: column.references?.table ?? null,
          viewColumn: null
        }
        : undefined
    }
    if (column.interval) {
      return [{
        name: (column.name) ? `${column.name}[0]` : '',
        type,
        textLength: 4 * 3 - 1
      }, {
        name: (column.name) ? `${column.name}[1]` : '',
        type,
        textLength: 4 * 3 - 1
      }]
    } else {
      return [{
        name: column.name || '',
        type,
        textLength: 4 * 3 - 1
      }]
    }
  })

  return {
    name: sch.name,
    headers
  }
}
