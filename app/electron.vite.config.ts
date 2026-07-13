import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          // `statusWorkerEntry` runs inside an Electron `utilityProcess`
          // (see AiStatusPoller / wslRootsAsync) — it needs its own bundled
          // output alongside `index.js`, not just import-graph inclusion,
          // since `utilityProcess.fork()` loads it as a standalone entry file.
          index: resolve(__dirname, 'src/main/index.ts'),
          statusWorkerEntry: resolve(__dirname, 'src/main/statusWorkerEntry.ts')
        }
      }
      // electron-vite 5.0.0's `MainBuildOptions` type is written against
      // vite 6/7's `BuildEnvironmentOptions` (which doesn't exist in this
      // project's pinned vite 5.4.x — only plain `BuildOptions` does), so TS
      // can't see `rollupOptions` on it even though vite itself accepts it
      // fine at runtime (electron-vite's peerDeps span ^5||^6||^7).
    } as unknown as NonNullable<import('electron-vite').UserConfig['main']>['build']
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react(), tailwindcss()]
  }
})
