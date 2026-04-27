<template>
  <div class="p-4 overflow-auto border-l flex-1 text-base">
    <div class="mb-4 rounded border bg-gray-50 p-3 text-sm text-gray-700">
      <div class="font-semibold">Current source: {{ modeLabel }}<template v-if="sourceDetails"> · {{ sourceDetails }}</template></div>
      <div v-if="isLocalReadonly" class="mt-1 text-amber-700">
        Local workspace is read-only. Schema changes will not be saved until write permission is granted.
      </div>
    </div>
    <div class="flex gap-x-4 items-baseline mt-4">
      <div :class="$style.importVariant">1</div>
      <div>
        <div class="max-w-xl mb-4 font-semibold">Useful when a new league is released. While the update is still downloading, you can review files and fix schema directly from the update servers.</div>
        <div class="inline-flex items-baseline pb-2">
          <div style="width: 200px;" class="my-1">
            <input value="patch(-poe2).poecdn.com/" readonly :class="$style.input" />
            <label :class="$style.label">Patch CDN</label>
          </div>
          <div style="width: 100px;" class="m-1">
            <input v-model.trim="poePatch" placeholder="x.x.x.x.x" :class="$style.input" />
            <label :class="$style.label">Patch #</label>
          </div>
          <div style="width: 220px;" class="my-1">
            <input value="/Bundles2/_.index.bin" readonly :class="$style.input" />
            <label :class="$style.label">Index</label>
          </div>
          <button class="ml-1 py-1 px-3 bg-blue-600 text-white hover:bg-blue-800"
            @click="cdnImport"
            :disabled="isCdnImportRunning"
            :loading="isCdnImportRunning">{{ isCdnImportRunning ? 'Wait...' : 'Import' }}</button>
        </div>
        <div v-if="currentMode !== 'local-directory' && latestPoEPatch">
          <p>
            Latest PoE patch is <code class="px-1 border border-gray-300 rounded">{{ latestPoEPatch.poe }}</code>,
            and version <code class="px-1 border border-gray-300 rounded">{{ latestPoEPatch.poe2 }}</code> for PoE2.
          </p>
          <p v-if="index.isLoaded && sourceDetails !== latestPoEPatch.poe && sourceDetails !== latestPoEPatch.poe2" class="text-red-600">
            You can continue to work with cached files.<br>But don't delay updating the patch version, otherwise you may experience download errors.
          </p>
        </div>
      </div>
    </div>
    <div class="flex gap-x-4 items-baseline mt-4 border-b pb-3">
      <div :class="$style.importVariant">2</div>
      <div class="flex items-baseline gap-x-2 flex-wrap">
        <button
          class="bg-gray-100 py-1 px-2 hover:bg-gray-300 disabled:cursor-not-allowed disabled:text-gray-400"
          :disabled="!canOpenDirectory"
          @click="openLocalDirectory">Open local game directory</button>
        <span class="pr-2">or</span>
        <label
          class="bg-gray-100 py-1 px-2 cursor-pointer hover:bg-gray-300"
          style="width: 200px"
          for="import-local-file">Pick a local dat file</label>
        <input
          class="hidden"
          id="import-local-file"
          type="file"
          accept=".datc64"
          @input="handleFile" />
      </div>
    </div>
    <div class="mt-3 flex gap-x-2 items-center">
      <i v-if="isFetchingSchema" class="codicon codicon-loading animate-spin"></i>
      <i v-else class="codicon codicon-check"></i>
      <div>
        <template v-if="currentMode === 'local-directory'">
          <span v-if="isFetchingSchema"> Loading bundled schema </span>
          <span v-else> Bundled schema ready </span>
        </template>
        <template v-else>
          <span v-if="isFetchingSchema"> Downloading schema from </span>
          <span v-else> Downloaded schema from </span>
          <a href="https://github.com/poe-tool-dev/dat-schema" class="underline" target="_blank">github.com/poe-tool-dev/dat-schema</a>
        </template>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, shallowRef, computed, inject, watch } from 'vue'
import type { BundleIndex } from '@/app/patchcdn/index-store.js'
import type { DatSchemasDatabase } from '@/app/dat-viewer/db.js'
import { openTab } from './workbench-core.js'
import DatViewer from '../dat-viewer/components/DatViewer.vue'
import { WorkbenchRuntime } from './runtime.js'

export default defineComponent({
  setup () {
    const index = inject<BundleIndex>('bundle-index')!
    const db = inject<DatSchemasDatabase>('dat-schemas')!
    const runtime = inject<WorkbenchRuntime>('workbench-runtime')!

    const poePatch = shallowRef(localStorage.getItem('POE_PATCH_VER') || '')
    const latestPoEPatch = shallowRef<{ poe: string, poe2: string } | undefined>()

    watch(() => runtime.isInitializing.value, (initializing) => {
      if (initializing) return

      if (poePatch.value && !index.isLoaded && runtime.mode.value === 'remote') {
        void cdnImport()
      }
      if (!db.isLoaded && runtime.mode.value === 'remote') {
        void db.fetchSchema()
      }
      if (runtime.mode.value === 'remote' && latestPoEPatch.value == null) {
        void getLatestPoEPatch()
      }
    }, { immediate: true })

    async function handleFile (e: Event) {
      const elFile = (e.target as HTMLInputElement).files![0]
      const fileContent = new Uint8Array(await elFile.arrayBuffer())
      const fileName = elFile.name
      openTab({
        id: `file@${fileName}`,
        title: fileName,
        type: DatViewer,
        args: {
          fileContent,
          fullPath: fileName
        }
      })
    }

    async function cdnImport () {
      try {
        await runtime.enterRemoteMode(poePatch.value)
        localStorage.setItem('POE_PATCH_VER', poePatch.value)
      } catch (e) {
        window.alert((e as Error).message)
        throw e
      }
    }

    async function openLocalDirectory () {
      try {
        await runtime.pickLocalDirectory()
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          return
        }
        window.alert((e as Error).message)
      }
    }

    async function getLatestPoEPatch () {
      const res = await fetch('https://poe-versions.obsoleet.org')
      const version = await res.json()
      latestPoEPatch.value = version
    }

    return {
      index,
      currentMode: computed(() => runtime.mode.value),
      modeLabel: computed(() => runtime.modeLabel.value),
      sourceDetails: computed(() => runtime.sourceDetails.value),
      isLocalReadonly: computed(() =>
        runtime.mode.value === 'local-directory' && !runtime.localCanWrite.value),
      poePatch,
      latestPoEPatch,
      canOpenDirectory: computed(() => 'showDirectoryPicker' in window),
      isCdnImportRunning: computed(() => runtime.currentSource.value.progress.value != null),
      isFetchingSchema: computed(() => db.isLoading),
      handleFile,
      cdnImport,
      openLocalDirectory
    }
  }
})
</script>

<style lang="postcss" module>
.input {
  width: 100%;
  @apply py-1 px-2;

  &:not([readonly]) {
    @apply border;

    &:focus {
      @apply border-blue-500;
    }
  }

  &[readonly] {
    @apply border-b;
    @apply bg-gray-100;
  }
}

.label {
  @apply text-xs;
  @apply px-2;
  @apply text-gray-500;
}

.importVariant {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  line-height: 1;
  @apply bg-gray-700 text-gray-200;
  @apply w-8 h-8;
  @apply rounded;
}
</style>
