import {
  MigrationFailure,
  SCHEMA_VERSION,
  digest,
  runPendingMigrations,
} from './migrations'
import type { DiagnosticsRecord, MigrationRecord } from './migrations'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// 存储介质是「版本信封」：{ schemaVersion, rows, history } 整体一个 key，
// 每次写入都是整封替换，迁移要么整批生效、要么原样保留（整批回退）。
const STORAGE_KEY = 'geohazard-monitor-prevention:entries'
// 迁移前的原始报文备份：只在首次迁移时写一次，用来复现与人工核对。
const BACKUP_KEY = 'geohazard-monitor-prevention:backup'
// 最近一次迁移诊断：每次迁移整封覆盖（不追加），保证看到的就是最后一跑。
const DIAGNOSTICS_KEY = 'geohazard-monitor-prevention:diagnostics'

type PersistedEnvelope = {
  schemaVersion: number
  rows: Record<string, EntryRow[]>
  history: MigrationRecord[]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function storage(): Storage | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  return window.localStorage
}

function freshEnvelope(): PersistedEnvelope {
  return { schemaVersion: SCHEMA_VERSION, rows: clone(SEED_ROWS), history: [] }
}

function withSeedMerged(rows: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  return { ...clone(SEED_ROWS), ...rows }
}

function persist(envelope: PersistedEnvelope): void {
  const target = storage()
  if (target) {
    target.setItem(STORAGE_KEY, JSON.stringify(envelope))
  }
}

function writeDiagnostics(record: DiagnosticsRecord): void {
  const target = storage()
  if (target) {
    target.setItem(DIAGNOSTICS_KEY, JSON.stringify(record))
  }
}

/** 把历史报文归一成信封：没有版本号的裸数据视为 v1。 */
function normalizeEnvelope(parsed: unknown): PersistedEnvelope | null {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  const candidate = parsed as Record<string, unknown>
  if (typeof candidate.schemaVersion === 'number' && candidate.rows !== null && typeof candidate.rows === 'object') {
    return {
      schemaVersion: candidate.schemaVersion,
      rows: withSeedMerged(candidate.rows as Record<string, EntryRow[]>),
      history: Array.isArray(candidate.history) ? (candidate.history as MigrationRecord[]) : [],
    }
  }
  // v1 裸数据：{ 模块key: 行数组 }
  if (Object.values(candidate).every((value) => Array.isArray(value))) {
    return { schemaVersion: 1, rows: withSeedMerged(candidate as Record<string, EntryRow[]>), history: [] }
  }
  return null
}

/** 启动时把存量数据迁到当前版本：失败整批回退（不落盘），诊断写 DIAGNOSTICS_KEY。 */
function upgrade(envelope: PersistedEnvelope, raw: string): PersistedEnvelope {
  const target = storage()
  const startedAt = new Date().toISOString()
  if (target && target.getItem(BACKUP_KEY) === null) {
    target.setItem(BACKUP_KEY, raw)
  }
  try {
    const { rows, reports } = runPendingMigrations(envelope.rows, envelope.schemaVersion)
    const history: MigrationRecord[] = [
      ...envelope.history,
      ...reports.map((report) => ({
        version: report.version,
        name: report.name,
        appliedAt: startedAt,
        changed: report.changed,
        unmatched: report.unmatched.length,
        outputDigest: report.outputDigest,
      })),
    ]
    const next: PersistedEnvelope = { schemaVersion: SCHEMA_VERSION, rows: withSeedMerged(rows), history }
    persist(next)
    writeDiagnostics({
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      fromVersion: envelope.schemaVersion,
      toVersion: SCHEMA_VERSION,
      reports,
    })
    return next
  } catch (error) {
    const failure =
      error instanceof MigrationFailure
        ? { name: error.migration, message: error.message }
        : { name: 'unknown', message: error instanceof Error ? error.message : String(error) }
    writeDiagnostics({
      ok: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      fromVersion: envelope.schemaVersion,
      toVersion: SCHEMA_VERSION,
      reports: [],
      error: failure,
    })
    // 整批回退：STORAGE_KEY 保持迁移前的原样，内存里继续用迁移前的数据，应用照常可用。
    console.error(`[数据迁移] 整批回退：${failure.name}：${failure.message}`)
    return envelope
  }
}

function readStorage(): PersistedEnvelope {
  const target = storage()
  if (!target) {
    return freshEnvelope()
  }
  const raw = target.getItem(STORAGE_KEY)
  if (!raw) {
    const envelope = freshEnvelope()
    persist(envelope)
    return envelope
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 报文损坏：隔离原文、留诊断，回到示例数据，应用不至于白屏。
    if (target.getItem(BACKUP_KEY) === null) {
      target.setItem(BACKUP_KEY, raw)
    }
    writeDiagnostics({
      ok: false,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      fromVersion: 0,
      toVersion: SCHEMA_VERSION,
      reports: [],
      error: { name: 'corrupt-storage', message: `本地数据无法解析（指纹 ${digest(raw)}），已回退到示例数据` },
    })
    const envelope = freshEnvelope()
    persist(envelope)
    return envelope
  }
  const envelope = normalizeEnvelope(parsed)
  if (!envelope) {
    if (target.getItem(BACKUP_KEY) === null) {
      target.setItem(BACKUP_KEY, raw)
    }
    writeDiagnostics({
      ok: false,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      fromVersion: 0,
      toVersion: SCHEMA_VERSION,
      reports: [],
      error: { name: 'unknown-storage-shape', message: `本地数据结构无法识别（指纹 ${digest(raw)}），已回退到示例数据` },
    })
    const fresh = freshEnvelope()
    persist(fresh)
    return fresh
  }
  if (envelope.schemaVersion >= SCHEMA_VERSION) {
    return envelope
  }
  return upgrade(envelope, raw)
}

let cache: PersistedEnvelope | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache.rows
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const envelope = cache ?? readStorage()
  const next: PersistedEnvelope = { ...envelope, rows: { ...envelope.rows, [key]: rows } }
  cache = next
  persist(next)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

/** 最近一次迁移的诊断记录；从没跑过迁移返回 null。 */
export function migrationDiagnostics(): DiagnosticsRecord | null {
  const target = storage()
  if (!target) {
    return null
  }
  const raw = target.getItem(DIAGNOSTICS_KEY)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as DiagnosticsRecord
  } catch {
    return null
  }
}

export function storageKey(): string {
  return STORAGE_KEY
}

export function diagnosticsKey(): string {
  return DIAGNOSTICS_KEY
}

export function backupKey(): string {
  return BACKUP_KEY
}
