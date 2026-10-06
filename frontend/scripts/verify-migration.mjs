// 存量迁移验证运行器：用 esbuild（vite 自带依赖）把 TS 验证入口打包到临时文件后执行。
// 迁移源码与浏览器端是同一份，因此这里通过 = dev / preview / 部署环境口径一致。
import { buildSync } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const outfile = path.join(here, '..', 'node_modules', '.cache', 'verify-migration.mjs')

buildSync({
  entryPoints: [path.join(here, 'verify-migration.entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'silent',
})

await import(pathToFileURL(outfile).href)
