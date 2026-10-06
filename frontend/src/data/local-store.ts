import { SEED_ROWS } from './seed'
import { STORAGE_VERSION, migrateStorage, unwrapStorage } from './migrations'
import type { MigrationReport } from './migrations'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// 存储是带版本的信封 { version, data }：旧版裸数据首次读取时自动迁移升级，
// 迁移前原文备份到 backup 键，失败则主键不动（整批回退），诊断报告落盘可复现。
const STORAGE_KEY = 'geohazard-monitor-prevention:entries'
const REPORT_KEY = 'geohazard-monitor-prevention:migration-report'
const BACKUP_PREFIX = 'geohazard-monitor-prevention:backup-v'

export type StoredMigrationReport = {
  executedAt: string
  ok: boolean
  fromVersion: number
  toVersion: number
  reports: MigrationReport[]
  error?: string
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedEnvelope(): string {
  return JSON.stringify({ version: STORAGE_VERSION, data: clone(SEED_ROWS) })
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

function persistReport(outcome: ReturnType<typeof migrateStorage>, fromVersion: number): void {
  if (!hasStorage() || outcome.reports.length === 0) {
    return
  }
  const record: StoredMigrationReport = {
    executedAt: new Date().toISOString(),
    ok: outcome.ok,
    fromVersion,
    toVersion: outcome.version,
    reports: outcome.reports,
    error: outcome.error,
  }
  try {
    window.localStorage.setItem(REPORT_KEY, JSON.stringify(record))
  } catch {
    // 诊断报告写不进去（如配额满）不影响主流程，控制台已留有错误。
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (!hasStorage()) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, seedEnvelope())
    return fallback
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    window.localStorage.setItem(STORAGE_KEY, seedEnvelope())
    return fallback
  }
  const before = unwrapStorage(parsed)
  if (before.version >= STORAGE_VERSION) {
    return { ...fallback, ...before.data }
  }
  // 旧版数据：执行存量迁移。迁移在副本上进行，失败时主键保持原样。
  const outcome = migrateStorage(parsed)
  persistReport(outcome, before.version)
  if (!outcome.ok) {
    console.error(`[数据迁移] v${before.version} → v${STORAGE_VERSION} 失败，已整批回退：${outcome.error}`)
    return { ...fallback, ...before.data }
  }
  try {
    window.localStorage.setItem(`${BACKUP_PREFIX}${before.version}`, raw)
  } catch {
    // 备份失败不阻断升级，诊断报告里仍有输入校验和可复现。
  }
  const merged = { ...fallback, ...outcome.data }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: outcome.version, data: merged }))
  return merged
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (hasStorage()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, data: next }))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

// 最近一次存量迁移的诊断报告（含无法归属清单与校验和），没有迁移过则为 null。
export function lastMigrationReport(): StoredMigrationReport | null {
  if (!hasStorage()) {
    return null
  }
  const raw = window.localStorage.getItem(REPORT_KEY)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as StoredMigrationReport
  } catch {
    return null
  }
}

export function migrationReportKey(): string {
  return REPORT_KEY
}
