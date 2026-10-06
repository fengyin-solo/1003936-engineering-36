// 存量数据迁移框架：版本化信封 + 逐个迁移 + 失败整批回退 + 可复现诊断。
//
// 设计要点：
// - 纯函数、不依赖 window/localStorage，浏览器（dev / preview / 部署产物）与
//   Node 验证脚本跑的是同一份代码，三种环境口径一致。
// - 迁移只原地修改传入的副本，绝不追加行；同一版本重复执行是收敛的（幂等）。
// - 任何一步抛错，整个批次作废，调用方拿到的仍是迁移前快照（整批回退）。
// - 诊断报告只含确定性内容：行级决策按 id 排序，校验和为 FNV-1a，
//   同一输入永远得到同一报告，可复现、可比对。
import { GROUP_TO_TOWNSHIP, TOWNSHIP_DIRECTORY, isLegacyPlaceholder, splitGroups } from './directory'
import type { EntryRow } from './types'

// 当前存储版本。v1 = 旧版裸数据（无信封，宣传样例的村组/状态口径不一）。
export const STORAGE_VERSION = 2

export type StorageEnvelope = {
  version: number
  data: Record<string, EntryRow[]>
}

export type RowChange = {
  id: string
  code: string
  field: string
  before: string
  after: string
}

export type UnassignedRow = {
  id: string
  code: string
  reason: string
  raw: string
}

export type MigrationReport = {
  id: string
  name: string
  fromVersion: number
  toVersion: number
  ok: boolean
  repaired: RowChange[]
  statusFixed: RowChange[]
  unassigned: UnassignedRow[]
  warnings: string[]
  inputChecksum: string
  outputChecksum: string
  error?: string
}

export type MigrationOutcome = {
  ok: boolean
  changed: boolean
  version: number
  data: Record<string, EntryRow[]>
  reports: MigrationReport[]
  error?: string
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 键序稳定的序列化：同一数据无论键的写入顺序如何都得到同一字符串。
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
  return `{${entries.join(',')}}`
}

// FNV-1a 32 位校验和：不依赖任何运行时 API，浏览器与 Node 结果一致。
export function checksum(value: unknown): string {
  const text = stableStringify(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

// 兼容两种存储形态：带版本信封的新格式，与旧版裸的「模块 → 行数组」映射。
export function unwrapStorage(raw: unknown): StorageEnvelope {
  if (
    raw !== null &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    typeof (raw as StorageEnvelope).version === 'number' &&
    (raw as StorageEnvelope).data !== null &&
    typeof (raw as StorageEnvelope).data === 'object'
  ) {
    return raw as StorageEnvelope
  }
  return { version: 1, data: (raw ?? {}) as Record<string, EntryRow[]> }
}

// ---------------------------------------------------------------------------
// v1 → v2：防灾宣传样例口径修复
// 旧版问题：「覆盖村组」字段在不同版本里含义不同——有的存乡镇名、有的只存
// 一个村组、有的是占位样例文本；状态值也有「已结束/开展中」等旧写法。
// 修复规则：
// 1. 状态按映射表归一到现行口径（待开展/进行中/已完成/已取消）；
// 2. 能确定所属乡镇的，按行政区划目录把覆盖村组补齐为该镇全部村组；
// 3. 无法归属的（占位文本、目录外乡镇）不猜、不改，单独列入诊断报告。
// ---------------------------------------------------------------------------
const CANONICAL_STATUSES = ['待开展', '进行中', '已完成', '已取消']

const LEGACY_STATUS_MAP: Record<string, string> = {
  计划中: '待开展',
  未开展: '待开展',
  开展中: '进行中',
  已结束: '已完成',
  完成: '已完成',
  取消: '已取消',
}

function migratePropagandaV2(data: Record<string, EntryRow[]>, report: MigrationReport): void {
  const rows = data.propaganda
  if (!Array.isArray(rows)) {
    throw new Error('防灾宣传数据缺失或不是数组，无法安全迁移')
  }
  // 按 id 排序处理，保证行级决策顺序与数据写入顺序无关（可复现）。
  const ordered = [...rows].sort((a, b) => Number(a?.id ?? 0) - Number(b?.id ?? 0))
  for (const row of ordered) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('防灾宣传数据里存在非对象记录，整批回退')
    }
    if (row.id === undefined || row.id === null || String(row.id) === '') {
      throw new Error(`防灾宣传数据里存在缺少 id 的记录：${stableStringify(row)}`)
    }
    const id = String(row.id)
    const code = String(row['活动编号'] ?? id)

    // 1. 状态归一
    const status = String(row.status ?? '')
    if (!CANONICAL_STATUSES.includes(status)) {
      const mapped = LEGACY_STATUS_MAP[status]
      if (mapped) {
        report.statusFixed.push({ id, code, field: 'status', before: status, after: mapped })
        row.status = mapped
      } else {
        report.warnings.push(`活动 ${code} 的状态「${status || '(空)'}」无法识别，保留原值`)
      }
    }

    // 2. 按所属乡镇补齐覆盖村组
    const rawGroups = String(row['覆盖村组'] ?? '').trim()
    let township = String(row['所属乡镇'] ?? '').trim()
    if (!TOWNSHIP_DIRECTORY[township]) {
      if (TOWNSHIP_DIRECTORY[rawGroups]) {
        // 旧版口径一：村组字段里存的其实是乡镇名。
        township = rawGroups
      } else {
        // 旧版口径二：村组字段只存了部分村组，由村组反查乡镇。
        const groups = splitGroups(rawGroups)
        const known = groups.map((group) => GROUP_TO_TOWNSHIP[group])
        if (groups.length > 0 && known.every(Boolean) && new Set(known).size === 1) {
          township = known[0]
        }
      }
    }
    if (!TOWNSHIP_DIRECTORY[township]) {
      report.unassigned.push({
        id,
        code,
        reason: isLegacyPlaceholder(rawGroups) ? '旧版占位样例，无归属乡镇' : `所属乡镇「${township || '(空)'}」不在行政区划目录`,
        raw: rawGroups || '(空)',
      })
      continue
    }
    const after = TOWNSHIP_DIRECTORY[township].join('、')
    if (String(row['所属乡镇'] ?? '') !== township || rawGroups !== after) {
      report.repaired.push({ id, code, field: '覆盖村组', before: rawGroups || '(空)', after })
      row['所属乡镇'] = township
      row['覆盖村组'] = after
    }
  }
}

type Migration = {
  version: number
  name: string
  up: (data: Record<string, EntryRow[]>, report: MigrationReport) => void
}

const MIGRATIONS: Migration[] = [
  { version: 2, name: '防灾宣传村组与状态口径修复', up: migratePropagandaV2 },
]

// 执行存量迁移。成功返回升级后的数据；失败返回迁移前快照（整批回退）。
// 幂等：版本已是最新时不产生任何迁移；强制重跑同一迁移也是收敛的，
// 只原地修正、绝不追加行。
export function migrateStorage(raw: unknown): MigrationOutcome {
  const before = unwrapStorage(raw)
  const snapshot = clone(before.data)
  const pending = MIGRATIONS.filter((migration) => migration.version > before.version).sort(
    (a, b) => a.version - b.version,
  )
  if (pending.length === 0) {
    return { ok: true, changed: false, version: before.version, data: snapshot, reports: [] }
  }
  const working = clone(before.data)
  const reports: MigrationReport[] = []
  let version = before.version
  try {
    for (const migration of pending) {
      const report: MigrationReport = {
        id: `v${version}-to-v${migration.version}`,
        name: migration.name,
        fromVersion: version,
        toVersion: migration.version,
        ok: true,
        repaired: [],
        statusFixed: [],
        unassigned: [],
        warnings: [],
        inputChecksum: checksum(working),
        outputChecksum: '',
      }
      migration.up(working, report)
      report.outputChecksum = checksum(working)
      reports.push(report)
      version = migration.version
    }
    return { ok: true, changed: true, version, data: working, reports }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    reports.push({
      id: `v${version}-failed`,
      name: '迁移失败，整批回退',
      fromVersion: before.version,
      toVersion: before.version,
      ok: false,
      repaired: [],
      statusFixed: [],
      unassigned: [],
      warnings: [],
      inputChecksum: checksum(snapshot),
      outputChecksum: checksum(snapshot),
      error: message,
    })
    return { ok: false, changed: false, version: before.version, data: snapshot, reports, error: message }
  }
}
