// 宣传覆盖统计：隐患点提醒与运营总览共用的同源计算。
// 两处都调 loadCoverage()，行数据来自同一个 allRows()，村组目录来自同一份
// TOWNSHIP_DIRECTORY，覆盖数因此必然一致，不存在各算各的口径漂移。
import { TOWNSHIP_DIRECTORY, splitGroups } from '@/data/directory'
import { allRows } from '@/data/local-store'

export type HazardReminder = {
  id: string
  code: string
  name: string
  township: string
  missingGroups: string[]
}

export type TownshipCoverage = {
  township: string
  total: number
  covered: number
}

export type CoverageResult = {
  totalGroups: number
  coveredGroups: number
  perTownship: TownshipCoverage[]
  reminders: HazardReminder[]
}

// 只有进行中 / 已完成的宣传批次才算形成覆盖。
const COVERING_STATUSES = ['进行中', '已完成']

export function loadCoverage(): CoverageResult {
  const rows = allRows()
  const covered = new Set<string>()
  for (const row of rows.propaganda ?? []) {
    if (!COVERING_STATUSES.includes(String(row.status))) {
      continue
    }
    for (const group of splitGroups(String(row['覆盖村组'] ?? ''))) {
      covered.add(group)
    }
  }
  const perTownship = Object.entries(TOWNSHIP_DIRECTORY).map(([township, groups]) => ({
    township,
    total: groups.length,
    covered: groups.filter((group) => covered.has(group)).length,
  }))
  const reminders: HazardReminder[] = []
  for (const row of rows.hazard ?? []) {
    const township = String(row['所在乡镇'] ?? '')
    const groups = TOWNSHIP_DIRECTORY[township]
    if (!groups) {
      continue
    }
    const missingGroups = groups.filter((group) => !covered.has(group))
    if (missingGroups.length > 0) {
      reminders.push({
        id: String(row.id),
        code: String(row['隐患点编号'] ?? row.id),
        name: String(row['隐患点名称'] ?? ''),
        township,
        missingGroups,
      })
    }
  }
  return {
    totalGroups: perTownship.reduce((sum, item) => sum + item.total, 0),
    coveredGroups: perTownship.reduce((sum, item) => sum + item.covered, 0),
    perTownship,
    reminders,
  }
}
