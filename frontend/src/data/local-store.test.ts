import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { EntryRow } from './types'

type StorageMock = Storage & { map: Map<string, string> }

function createStorageMock(): StorageMock {
  const map = new Map<string, string>()
  return {
    map,
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key)
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value))
    },
  }
}

let mock: StorageMock

const STORAGE_KEY = 'geohazard-monitor-prevention:entries'
const BACKUP_KEY = 'geohazard-monitor-prevention:backup'
const DIAGNOSTICS_KEY = 'geohazard-monitor-prevention:diagnostics'

async function loadStore() {
  vi.resetModules()
  return import('./local-store')
}

async function loadSeed() {
  const { SEED_ROWS } = await import('./seed')
  return SEED_ROWS
}

beforeEach(() => {
  mock = createStorageMock()
  vi.stubGlobal('window', { localStorage: mock })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('本地存储引导迁移', () => {
  it('首次打开：按当前版本播种，不跑迁移', async () => {
    const store = await loadStore()
    const rows = store.allRows()
    const seed = await loadSeed()
    expect(rows.propaganda).toHaveLength(seed.propaganda.length)
    const envelope = JSON.parse(mock.getItem(STORAGE_KEY) as string)
    expect(envelope.schemaVersion).toBe(2)
    expect(store.migrationDiagnostics()).toBeNull()
  })

  it('v1 旧数据：启动即迁移，整封替换，原文备份，诊断落盘', async () => {
    const seed = await loadSeed()
    const legacy = JSON.parse(JSON.stringify(seed)) as Record<string, EntryRow[]>
    legacy.propaganda = [
      { id: 1, status: '已结束', pending: true, abnormal: false, 活动编号: 'PROP-0001', 所属乡镇: '青云镇', 覆盖村组: '', 活动状态: '已结束' },
      { id: 2, status: '进行中', pending: true, abnormal: false, 活动编号: 'PROP-0002', 覆盖村组: '防灾宣传样例2', 活动状态: '防灾宣传样例2' },
    ]
    const raw = JSON.stringify(legacy)
    mock.setItem(STORAGE_KEY, raw)

    const store = await loadStore()
    const rows = store.allRows()
    // 补齐 + 无法归属
    expect(rows.propaganda[0]['覆盖村组']).toBe('青云村、石门村、黄泥村')
    expect(rows.propaganda[0].status).toBe('已完成')
    expect(rows.propaganda[1].abnormal).toBe(true)
    expect(rows.propaganda).toHaveLength(2)
    // 整封替换为 v2 信封
    const envelope = JSON.parse(mock.getItem(STORAGE_KEY) as string)
    expect(envelope.schemaVersion).toBe(2)
    expect(envelope.history).toHaveLength(1)
    expect(envelope.history[0].name).toBe('propaganda-coverage-v2')
    // 迁移前原文备份，可据此复现
    expect(mock.getItem(BACKUP_KEY)).toBe(raw)
    // 诊断落盘：补齐 1 条、无法归属 1 条
    const diagnostics = store.migrationDiagnostics()
    expect(diagnostics?.ok).toBe(true)
    expect(diagnostics?.reports[0].filled).toBe(1)
    expect(diagnostics?.reports[0].unmatched).toHaveLength(1)
  })

  it('重复启动：不再跑迁移，历史不追加，诊断不被覆盖', async () => {
    const seed = await loadSeed()
    const legacy = JSON.parse(JSON.stringify(seed)) as Record<string, EntryRow[]>
    legacy.propaganda = [
      { id: 1, status: '已结束', pending: true, abnormal: false, 活动编号: 'PROP-0001', 所属乡镇: '青云镇', 覆盖村组: '', 活动状态: '已结束' },
    ]
    mock.setItem(STORAGE_KEY, JSON.stringify(legacy))

    const first = await loadStore()
    first.allRows()
    const afterFirst = mock.getItem(STORAGE_KEY) as string
    const diagnosticsAfterFirst = mock.getItem(DIAGNOSTICS_KEY) as string

    // 模拟第二次启动：模块缓存重置，localStorage 不变
    const second = await loadStore()
    const rows = second.allRows()
    expect(mock.getItem(STORAGE_KEY)).toBe(afterFirst)
    expect(mock.getItem(DIAGNOSTICS_KEY)).toBe(diagnosticsAfterFirst)
    const envelope = JSON.parse(afterFirst)
    expect(envelope.history).toHaveLength(1)
    expect(rows.propaganda).toHaveLength(1)
  })

  it('迁移失败：整批回退，存储保持迁移前原样，诊断记录失败原因', async () => {
    const seed = await loadSeed()
    const legacy = JSON.parse(JSON.stringify(seed)) as Record<string, EntryRow[]>
    // 其他模块塞一条非法记录，让迁移后的结构校验必然失败
    legacy.hazard = [{ id: -7, status: '', pending: true, abnormal: false }]
    legacy.propaganda = [
      { id: 1, status: '已结束', pending: true, abnormal: false, 活动编号: 'PROP-0001', 所属乡镇: '青云镇', 覆盖村组: '', 活动状态: '已结束' },
    ]
    const raw = JSON.stringify(legacy)
    mock.setItem(STORAGE_KEY, raw)

    const store = await loadStore()
    const rows = store.allRows()
    // 应用仍可用：内存里是迁移前的数据
    expect(rows.propaganda[0].status).toBe('已结束')
    // 整批回退：STORAGE_KEY 一字未动
    expect(mock.getItem(STORAGE_KEY)).toBe(raw)
    const diagnostics = store.migrationDiagnostics()
    expect(diagnostics?.ok).toBe(false)
    expect(diagnostics?.error?.name).toBe('propaganda-coverage-v2')
    expect(diagnostics?.error?.message).toContain('未通过校验')
    expect(mock.getItem(BACKUP_KEY)).toBe(raw)
  })

  it('报文损坏：隔离原文、留诊断，回退到示例数据', async () => {
    mock.setItem(STORAGE_KEY, '{ 这不是 JSON')
    const store = await loadStore()
    const rows = store.allRows()
    const seed = await loadSeed()
    expect(rows.propaganda).toHaveLength(seed.propaganda.length)
    expect(mock.getItem(BACKUP_KEY)).toBe('{ 这不是 JSON')
    const diagnostics = store.migrationDiagnostics()
    expect(diagnostics?.ok).toBe(false)
    expect(diagnostics?.error?.name).toBe('corrupt-storage')
  })
})
