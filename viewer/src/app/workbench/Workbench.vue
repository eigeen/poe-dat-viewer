<template>
  <index-tree />
  <div class="layout-column flex-1 min-w-0">
    <viewer-tabs />
    <div class="layout-column flex-1 min-h-0">
      <component
        v-if="activeTab"
        :is="activeTab.type"
        :args="activeTab.args"
        :key="activeTab.id"
        :ka-scope="activeTab.kaScope"
        v-model:ka-state="activeTab.kaState" />
      <div v-else
        class="bg-gray-50 flex-1 text-lg text-gray-500 flex items-center justify-center"
        >The viewer is ready to fulfill your wishes 👾</div>
    </div>
    <div class="app-footer">
      <div class="truncate">
        <span class="mr-4">Mode: {{ modeLabel }}<template v-if="sourceDetails"> · {{ sourceDetails }}</template><template v-if="isLocalReadonly"> · read-only</template></span>
        <span>Made by Alexander Drozdov, {{ appVersion.slice(0, 7) }} · <a class="q-link text-white border-b" href="https://github.com/SnosMe/poe-dat-viewer">GitHub</a></span>
      </div>
      <a href="https://discord.gg/SJjBdT3" class="flex ml-8"><img src="@/assets/discord-badge.svg" /></a>
    </div>
  </div>
  <download-progress />
</template>

<script lang="ts">
import { defineComponent, computed, provide } from 'vue'
import ViewerTabs from './Tabs.vue'
import IndexTree from './IndexTree.vue'
import DownloadProgress from './DownloadProgress.vue'
import { tabs, activeTabId } from './workbench-core.js'
import { WorkbenchRuntime } from './runtime.js'

export default defineComponent({
  name: 'AppWorkbench',
  components: { IndexTree, ViewerTabs, DownloadProgress },
  setup () {
    const runtime = new WorkbenchRuntime()
    void runtime.init()
    provide('workbench-runtime', runtime)
    provide('bundle-index', runtime.index)
    provide('dat-schemas', runtime.schemas)

    const activeTab = computed(() =>
      tabs.value.find(tab => tab.id === activeTabId.value)
    )

    return {
      activeTab,
      runtime,
      modeLabel: computed(() => runtime.modeLabel.value),
      sourceDetails: computed(() => runtime.sourceDetails.value),
      isLocalReadonly: computed(() =>
        runtime.mode.value === 'local-directory' && !runtime.localCanWrite.value),
      appVersion: import.meta.env.APP_VERSION
    }
  }
})
</script>

<style lang="postcss">
@import "@vscode/codicons/dist/codicon.css";
@tailwind base;
@tailwind utilities;

* {
  outline: none !important;
}

#app {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.5;
}

.layout-column {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.app-footer {
  line-height: 1;
  align-items: center;
  display: flex;
  @apply bg-gray-700;
  @apply text-white;
  @apply p-2;

  img {
    filter: grayscale(0.75);
  }

  &:hover {
    img {
      filter: grayscale(0);
    }
  }
}
</style>
