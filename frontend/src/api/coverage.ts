import { allRows } from '@/data/local-store'
import { REGIONS, townshipOfVillage } from '@/data/regions'
import type { EntryRow } from '@/data/types'

// 覆盖派生：防灾宣传批次与隐患点提醒共用同一份基础数据（regions.ts）和同一份
// 宣传记录，任何页面要展示覆盖数都必须从 buildCoverage 取，保证各处数字一致。

/** 哪些状态的活动算「有效覆盖」：待开展还没发生，已取消不算。 */
export const EFFECTIVE_STATUSES = ['进行中', '已完成']

export type TownshipCoverage = {
  township: string
  villages: string[]
  covered: string[]
  uncovered: string[]
}

export type HazardReminder = {
  hazardId: number
  code: string
  name: string
  township: string
  uncoveredVillages: string[]
}

export type CoverageResult = {
  townships: TownshipCoverage[]
  totalVillages: number
  coveredVillages: number
  uncoveredVillages: number
  reminders: HazardReminder[]
}

function coveredVillageSet(propagandaRows: EntryRow[]): Set<string> {
  const covered = new Set<string>()
  for (const row of propagandaRows) {
    if (!EFFECTIVE_STATUSES.includes(String(row.status))) {
      continue
    }
    for (const token of String(row['覆盖村组'] ?? '').split('、')) {
      const village = token.trim()
      if (village !== '' && townshipOfVillage(village) !== null) {
        covered.add(village)
      }
    }
  }
  return covered
}

/** 从全量行数据派生覆盖情况：纯函数，同样的输入永远得到同样的结果。 */
export function buildCoverage(rows: Record<string, EntryRow[]>): CoverageResult {
  const covered = coveredVillageSet(rows.propaganda ?? [])
  const townships: TownshipCoverage[] = REGIONS.map((region) => ({
    township: region.township,
    villages: region.villages,
    covered: region.villages.filter((village) => covered.has(village)),
    uncovered: region.villages.filter((village) => !covered.has(village)),
  }))
  const uncoveredByTownship = new Map(townships.map((item) => [item.township, item.uncovered]))
  const reminders: HazardReminder[] = []
  for (const row of rows.hazard ?? []) {
    const township = String(row['所在乡镇'] ?? '').trim()
    const uncovered = uncoveredByTownship.get(township)
    if (!uncovered || uncovered.length === 0) {
      continue
    }
    reminders.push({
      hazardId: Number(row.id),
      code: String(row['隐患点编号'] ?? ''),
      name: String(row['隐患点名称'] ?? ''),
      township,
      uncoveredVillages: uncovered,
    })
  }
  reminders.sort((left, right) => left.code.localeCompare(right.code, 'zh-Hans-CN'))
  const totalVillages = townships.reduce((sum, item) => sum + item.villages.length, 0)
  const coveredVillages = townships.reduce((sum, item) => sum + item.covered.length, 0)
  return {
    townships,
    totalVillages,
    coveredVillages,
    uncoveredVillages: totalVillages - coveredVillages,
    reminders,
  }
}

export function loadCoverage(): CoverageResult {
  return buildCoverage(allRows())
}

export type PropagandaStats = {
  monthActivities: number
  finished: number
  reachedPeople: number
}

/** 宣传页统计卡：与覆盖派生一样直接读同一份宣传记录，不再各算各的。 */
export function propagandaStats(rows: EntryRow[], now: Date = new Date()): PropagandaStats {
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  let monthActivities = 0
  let finished = 0
  let reachedPeople = 0
  for (const row of rows) {
    if (String(row['活动日期'] ?? '').startsWith(monthPrefix)) {
      monthActivities += 1
    }
    if (String(row.status) === '已完成') {
      finished += 1
    }
    if (EFFECTIVE_STATUSES.includes(String(row.status))) {
      const people = Number(row['参与人数'])
      if (Number.isFinite(people)) {
        reachedPeople += people
      }
    }
  }
  return { monthActivities, finished, reachedPeople }
}
