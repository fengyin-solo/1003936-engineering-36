import { MODULES } from './modules'
import { canonicalVillageOrder, isTownship, townshipOfVillage, villagesOf } from './regions'
import type { EntryRow } from './types'

// 数据版本：localStorage 里的存量数据带版本号，启动时按版本补齐未执行的迁移。
// v1 = 早期裸数据（没有版本信封，防灾宣传的「覆盖村组/状态」语义与现行不一致）
// v2 = 防灾宣传存量修复（所属乡镇归一、覆盖村组补齐、状态归一）
export const SCHEMA_VERSION = 2

export type MigrationChange = {
  rowId: number
  field: string
  before: string
  after: string
}

export type UnmatchedRow = {
  rowId: number
  code: string
  reason: string
  rawCoverage: string
}

export type MigrationReport = {
  version: number
  name: string
  /** 扫描的防灾宣传记录数 */
  scanned: number
  /** 有字段被改写的记录数 */
  changed: number
  /** 按所属乡镇补齐了覆盖村组的记录数 */
  filled: number
  /** 状态被归一（含旧状态名映射、活动状态同步）的记录数 */
  statusNormalized: number
  /** 无法归属乡镇、被单独列出的记录 */
  unmatched: UnmatchedRow[]
  /** 逐字段变更明细，按记录顺序排列，内容确定 */
  changes: MigrationChange[]
  warnings: string[]
  /** 迁移前后该模块数据的指纹：同样的输入永远得到同样的诊断 */
  inputDigest: string
  outputDigest: string
}

export type MigrationRecord = {
  version: number
  name: string
  appliedAt: string
  changed: number
  unmatched: number
  outputDigest: string
}

export type DiagnosticsRecord = {
  ok: boolean
  startedAt: string
  finishedAt: string
  fromVersion: number
  toVersion: number
  reports: MigrationReport[]
  error?: { name: string; message: string }
}

type MigrationOutcome = {
  rows: Record<string, EntryRow[]>
  report: MigrationReport
}

export type Migration = {
  version: number
  name: string
  apply(rows: Record<string, EntryRow[]>): MigrationOutcome
}

/** 迁移失败：携带已经算出的诊断信息，存储层据此整批回退并落盘诊断。 */
export class MigrationFailure extends Error {
  readonly migration: string

  constructor(migration: string, message: string) {
    super(message)
    this.name = 'MigrationFailure'
    this.migration = migration
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 键序稳定的序列化：诊断指纹不依赖对象键的书写顺序。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
  return `{${entries.join(',')}}`
}

/** FNV-1a 32 位散列：无依赖、跨环境一致，用来给迁移输入输出留可复现的指纹。 */
export function digest(value: unknown): string {
  const text = stableStringify(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** 迁移输出的结构校验：任何一项不满足都视为失败，整批不得落盘。 */
export function validateRows(rows: Record<string, EntryRow[]>): void {
  for (const meta of MODULES) {
    const list = rows[meta.key]
    if (list === undefined) {
      throw new Error(`缺少模块「${meta.key}」的数据`)
    }
    if (!Array.isArray(list)) {
      throw new Error(`模块「${meta.key}」的数据不是数组`)
    }
    const seen = new Set<number>()
    for (const row of list) {
      const id = Number(row?.id)
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error(`模块「${meta.key}」存在非法编号：${String(row?.id)}`)
      }
      if (seen.has(id)) {
        throw new Error(`模块「${meta.key}」编号 ${id} 重复`)
      }
      seen.add(id)
      if (typeof row.status !== 'string' || row.status.trim() === '') {
        throw new Error(`模块「${meta.key}」编号 ${id} 缺少状态`)
      }
      if (typeof row.pending !== 'boolean' || typeof row.abnormal !== 'boolean') {
        throw new Error(`模块「${meta.key}」编号 ${id} 的标记位不是布尔值`)
      }
    }
  }
  // 防灾宣传的业务不变量：正常记录的所属乡镇必须能查到，覆盖村组必须是
  // 基础数据里已知村组的规范写法；无法归属的记录（abnormal=true）豁免，保留原文待查。
  for (const row of rows.propaganda ?? []) {
    const township = String(row['所属乡镇'] ?? '').trim()
    if (township !== '' && !isTownship(township)) {
      throw new Error(`防灾宣传编号 ${String(row.id)} 的所属乡镇「${township}」不在基础数据里`)
    }
    if (row.abnormal) {
      continue
    }
    const coverage = String(row['覆盖村组'] ?? '').trim()
    if (coverage === '') {
      throw new Error(`防灾宣传编号 ${String(row.id)} 既没有覆盖村组也没有列入无法归属`)
    }
    const tokens = coverage.split('、').map((token) => token.trim())
    if (tokens.some((token) => townshipOfVillage(token) === null)) {
      throw new Error(`防灾宣传编号 ${String(row.id)} 的覆盖村组含有未知村组：${coverage}`)
    }
    if (coverage !== canonicalVillageOrder(tokens).join('、')) {
      throw new Error(`防灾宣传编号 ${String(row.id)} 的覆盖村组不是规范写法：${coverage}`)
    }
  }
}

// ---------------------------------------------------------------------------
// v2 迁移：防灾宣传存量修复
// ---------------------------------------------------------------------------

const PROPAGANDA_CURRENT_STATUSES = ['待开展', '进行中', '已完成', '已取消']
const PROPAGANDA_TERMINAL_STATUSES = ['已完成', '已取消']

/** 旧版本里出现过的状态叫法 → 现行状态。 */
const LEGACY_STATUS_MAP: Record<string, string> = {
  未开始: '待开展',
  计划中: '待开展',
  待启动: '待开展',
  进行: '进行中',
  开展中: '进行中',
  完成: '已完成',
  已结束: '已完成',
  办结: '已完成',
  取消: '已取消',
  终止: '已取消',
  已终止: '已取消',
}

type CoverageParse =
  | { kind: 'empty' }
  | { kind: 'numeric'; count: number }
  | { kind: 'text'; known: string[]; unknownTokens: string[] }

/** 兼容各版本的覆盖村组写法：空、纯数字（旧版只记覆盖数量）、多种分隔符的名单。 */
function parseCoverage(raw: unknown): CoverageParse {
  const text = String(raw ?? '').trim()
  if (text === '' || text === '—') {
    return { kind: 'empty' }
  }
  if (/^\d+$/.test(text)) {
    return { kind: 'numeric', count: Number(text) }
  }
  const tokens = text
    .split(/[、，,;；/\s]+/)
    .map((token) => token.trim())
    .filter((token) => token !== '')
  const known: string[] = []
  const unknownTokens: string[] = []
  for (const token of tokens) {
    if (townshipOfVillage(token) !== null) {
      if (!known.includes(token)) {
        known.push(token)
      }
    } else {
      unknownTokens.push(token)
    }
  }
  return { kind: 'text', known, unknownTokens }
}

function migratePropagandaCoverage(rows: Record<string, EntryRow[]>): MigrationOutcome {
  const before = rows.propaganda ?? []
  const changes: MigrationChange[] = []
  const unmatched: UnmatchedRow[] = []
  const warnings: string[] = []
  let changed = 0
  let filled = 0
  let statusNormalized = 0

  const next = before.map((source) => {
    const row = clone(source)
    const rowId = Number(row.id)
    const note = (field: string, after: string) => {
      const previous = String(row[field] ?? '')
      if (previous !== after) {
        changes.push({ rowId, field, before: previous, after })
        row[field] = after
      }
    }

    // 1. 状态归一：旧状态名映射到现行集合，业务字段「活动状态」与系统状态对齐。
    let status = String(row.status ?? '').trim()
    let statusTouched = false
    if (!PROPAGANDA_CURRENT_STATUSES.includes(status)) {
      const mapped = LEGACY_STATUS_MAP[status]
      if (mapped) {
        note('status', mapped)
        status = mapped
        statusTouched = true
      } else {
        warnings.push(`编号 ${rowId} 的状态「${status}」无法识别，保留原值待人工核对`)
      }
    }
    const activityStatus = String(row['活动状态'] ?? '')
    if (activityStatus !== status) {
      note('活动状态', status)
      statusTouched = true
    }
    if (statusTouched) {
      statusNormalized += 1
    }

    // 2. 归属乡镇：优先用记录里已有的合法乡镇，否则从可识别的村组反推。
    const parsed = parseCoverage(row['覆盖村组'])
    const declared = String(row['所属乡镇'] ?? '').trim()
    let township = isTownship(declared) ? declared : ''
    if (township === '' && parsed.kind === 'text' && parsed.known.length > 0) {
      const townships = new Set(parsed.known.map((village) => townshipOfVillage(village)))
      if (townships.size === 1) {
        township = [...townships][0] as string
      }
    }

    // 3. 覆盖村组归一与补齐；无法归属的单独列出，不丢、不编。
    let isUnmatched = false
    if (parsed.kind === 'text' && parsed.known.length > 0) {
      const canonical = canonicalVillageOrder(parsed.known).join('、')
      note('覆盖村组', canonical)
      if (parsed.unknownTokens.length > 0) {
        warnings.push(`编号 ${rowId} 的覆盖村组含未知名称：${parsed.unknownTokens.join('、')}，已按已知村组归一`)
      }
    } else if (township !== '') {
      note('覆盖村组', villagesOf(township).join('、'))
      filled += 1
    } else {
      isUnmatched = true
      const reason =
        parsed.kind === 'numeric'
          ? `旧版本仅记录覆盖数量（${parsed.count} 个），且缺少所属乡镇`
          : '缺少所属乡镇，覆盖村组无法匹配基础数据'
      unmatched.push({
        rowId,
        code: String(row['活动编号'] ?? ''),
        reason,
        rawCoverage: String(row['覆盖村组'] ?? ''),
      })
    }
    if (township !== '') {
      note('所属乡镇', township)
    }

    // 4. 标记位按现行口径重算：终态不再待处理，无法归属的标异常。
    const pending = !PROPAGANDA_TERMINAL_STATUSES.includes(status)
    if (row.pending !== pending) {
      changes.push({ rowId, field: 'pending', before: String(row.pending), after: String(pending) })
      row.pending = pending
    }
    if (row.abnormal !== isUnmatched) {
      changes.push({ rowId, field: 'abnormal', before: String(row.abnormal), after: String(isUnmatched) })
      row.abnormal = isUnmatched
    }

    if (changes.some((entry) => entry.rowId === rowId)) {
      changed += 1
    }
    return row
  })

  const nextRows: Record<string, EntryRow[]> = { ...rows, propaganda: next }
  return {
    rows: nextRows,
    report: {
      version: 2,
      name: 'propaganda-coverage-v2',
      scanned: before.length,
      changed,
      filled,
      statusNormalized,
      unmatched,
      changes,
      warnings,
      inputDigest: digest(before),
      outputDigest: digest(next),
    },
  }
}

export const MIGRATIONS: Migration[] = [
  { version: 2, name: 'propaganda-coverage-v2', apply: migratePropagandaCoverage },
]

/**
 * 依次执行 (fromVersion, SCHEMA_VERSION] 之间的迁移。
 * 纯函数：不改入参；任何一步抛错或输出校验失败都抛 MigrationFailure，
 * 调用方（存储层）据此整批回退——不落盘就算回退完成。
 */
export function runPendingMigrations(
  rows: Record<string, EntryRow[]>,
  fromVersion: number,
  migrations: Migration[] = MIGRATIONS,
): { rows: Record<string, EntryRow[]>; reports: MigrationReport[] } {
  const pending = migrations
    .filter((migration) => migration.version > fromVersion && migration.version <= SCHEMA_VERSION)
    .sort((left, right) => left.version - right.version)
  let current = clone(rows)
  const reports: MigrationReport[] = []
  for (const migration of pending) {
    let outcome: MigrationOutcome
    try {
      outcome = migration.apply(clone(current))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new MigrationFailure(migration.name, `迁移执行中断：${message}`)
    }
    try {
      validateRows(outcome.rows)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new MigrationFailure(migration.name, `迁移输出未通过校验：${message}`)
    }
    current = outcome.rows
    reports.push(outcome.report)
  }
  return { rows: current, reports }
}
