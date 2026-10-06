// 存量迁移验证入口：在 Node 里跑与浏览器完全相同的迁移源码，
// 断言升级、幂等、整批回退与诊断可复现。由 verify-migration.mjs 打包后执行。
import { TOWNSHIP_DIRECTORY } from '../src/data/directory'
import { STORAGE_VERSION, checksum, migrateStorage, unwrapStorage } from '../src/data/migrations'
import type { EntryRow } from '../src/data/types'

let failures = 0

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  ✓ ${name}`)
  } else {
    failures += 1
    console.error(`  ✗ ${name}`)
    if (detail !== undefined) {
      console.error('    ', JSON.stringify(detail, null, 2))
    }
  }
}

// 构造一份 v1 旧版裸数据：覆盖三种旧口径（村组字段存乡镇、只存一个村组、占位样例）
// 以及旧状态写法「已结束」。
function legacyPayload(): Record<string, EntryRow[]> {
  return {
    hazard: [
      { id: 1, status: '监测中', pending: true, abnormal: false, 隐患点编号: 'HAZA-0001', 所在乡镇: '青云镇' },
    ],
    propaganda: [
      { id: 2, status: '进行中', pending: true, abnormal: false, 活动编号: 'PROP-0002', 覆盖村组: '白沙村' },
      { id: 1, status: '已结束', pending: false, abnormal: false, 活动编号: 'PROP-0001', 覆盖村组: '青云镇' },
      { id: 3, status: '待开展', pending: true, abnormal: false, 活动编号: 'PROP-0003', 覆盖村组: '防灾宣传样例3' },
    ],
  }
}

console.log('1. 旧版数据升级')
const first = migrateStorage(legacyPayload())
check('迁移成功', first.ok, first.error)
check('版本升级到最新', first.version === STORAGE_VERSION, first.version)
const rows = first.data.propaganda
check('行数不变（只原地修复，不追加）', rows.length === 3, rows.length)
const byCode = (code: string) => rows.find((row) => row['活动编号'] === code) as EntryRow
check(
  '村组字段存乡镇的，归属并补齐全镇村组',
  byCode('PROP-0001')['所属乡镇'] === '青云镇' &&
    byCode('PROP-0001')['覆盖村组'] === TOWNSHIP_DIRECTORY['青云镇'].join('、'),
  byCode('PROP-0001'),
)
check(
  '只存一个村组的，反查乡镇并补齐',
  byCode('PROP-0002')['所属乡镇'] === '白沙镇' &&
    byCode('PROP-0002')['覆盖村组'] === TOWNSHIP_DIRECTORY['白沙镇'].join('、'),
  byCode('PROP-0002'),
)
check('旧状态「已结束」归一为「已完成」', byCode('PROP-0001').status === '已完成', byCode('PROP-0001').status)
const report = first.reports[0]
check(
  '占位样例无法归属，单独列出且原行不被篡改',
  report.unassigned.length === 1 &&
    report.unassigned[0].code === 'PROP-0003' &&
    byCode('PROP-0003')['覆盖村组'] === '防灾宣传样例3',
  report.unassigned,
)

console.log('2. 幂等：重复启动不得追加、不得重复修复')
const second = migrateStorage({ version: first.version, data: first.data })
check('已是最新版本时没有迁移可执行', second.ok && !second.changed && second.reports.length === 0)
const forced = migrateStorage({ version: 1, data: first.data })
check('强制重跑同一迁移仍成功', forced.ok, forced.error)
check('重跑后 0 行再修复', forced.reports[0].repaired.length === 0, forced.reports[0].repaired)
check('重跑后行数不变', forced.data.propaganda.length === 3, forced.data.propaganda.length)
check('重跑后数据逐字节一致', checksum(forced.data) === checksum(first.data))

console.log('3. 诊断可复现')
const again = migrateStorage(legacyPayload())
check(
  '同一输入得到同一输入/输出校验和',
  again.reports[0].inputChecksum === report.inputChecksum &&
    again.reports[0].outputChecksum === report.outputChecksum,
  { first: [report.inputChecksum, report.outputChecksum], again: [again.reports[0].inputChecksum, again.reports[0].outputChecksum] },
)
check(
  '行级决策顺序与输入顺序无关（按 id 排序）',
  report.repaired.map((item) => item.id).join(',') === '1,2',
  report.repaired.map((item) => item.id),
)

console.log('4. 失败整批回退')
const broken = { propaganda: [{ 活动编号: 'PROP-X', 覆盖村组: '青云镇' }] }
const failed = migrateStorage(broken)
check('结构损坏时迁移失败', !failed.ok)
check('回退后数据与输入一致', checksum(failed.data) === checksum(unwrapStorage(broken).data))
check('失败报告带可诊断错误信息', typeof failed.error === 'string' && failed.error.includes('id'), failed.error)
check('失败报告标记 ok=false 且版本未推进', failed.reports.at(-1)?.ok === false && failed.version === 1)

console.log('5. 存储形态兼容')
check('旧版裸数据识别为 v1', unwrapStorage(legacyPayload()).version === 1)
check('新版信封原样识别', unwrapStorage({ version: 2, data: {} }).version === 2)

console.log('6. 浏览器存储端到端：旧数据自动升级、备份与诊断落盘')
const store = new Map<string, string>()
const STORAGE_KEY = 'geohazard-monitor-prevention:entries'
;(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: (key: string) => (store.has(key) ? store.get(key) : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
  },
}
store.set(STORAGE_KEY, JSON.stringify(legacyPayload()))
const localStore = await import('../src/data/local-store')
const upgraded = localStore.allRows()
const upgradedRow = upgraded.propaganda.find((row) => row['活动编号'] === 'PROP-0001') as EntryRow
check(
  '首次读取即完成村组补齐',
  upgradedRow['覆盖村组'] === TOWNSHIP_DIRECTORY['青云镇'].join('、'),
  upgradedRow,
)
const persisted = JSON.parse(store.get(STORAGE_KEY) ?? '{}') as { version?: number }
check('主键已写回新版信封', persisted.version === STORAGE_VERSION, persisted)
check(
  '迁移前原文已备份，可手工回滚',
  store.get('geohazard-monitor-prevention:backup-v1') === JSON.stringify(legacyPayload()),
)
const storedReport = localStore.lastMigrationReport()
check(
  '诊断报告已落盘且含无法归属清单',
  storedReport?.ok === true && storedReport.reports[0]?.unassigned.length === 1,
  storedReport,
)

if (failures > 0) {
  console.error(`\n迁移验证失败：${failures} 项未通过`)
  process.exit(1)
}
console.log('\n迁移验证全部通过')
