import { describe, expect, it } from 'vitest'

import { buildCoverage, propagandaStats } from './coverage'
import { REGIONS } from '@/data/regions'
import type { EntryRow } from '@/data/types'

function fixtureRows(): Record<string, EntryRow[]> {
  return {
    propaganda: [
      { id: 1, status: '已完成', pending: false, abnormal: false, 活动编号: 'PROP-0001', 所属乡镇: '青云镇', 覆盖村组: '青云村', 活动日期: '2026-10-01', 参与人数: '100' },
      { id: 2, status: '进行中', pending: true, abnormal: false, 活动编号: 'PROP-0002', 所属乡镇: '龙潭镇', 覆盖村组: '龙潭村', 活动日期: '2026-10-02', 参与人数: '50' },
      { id: 3, status: '待开展', pending: true, abnormal: false, 活动编号: 'PROP-0003', 所属乡镇: '青云镇', 覆盖村组: '石门村', 活动日期: '2026-10-03', 参与人数: '30' },
      { id: 4, status: '已取消', pending: false, abnormal: false, 活动编号: 'PROP-0004', 所属乡镇: '龙潭镇', 覆盖村组: '双河村', 活动日期: '2026-09-03', 参与人数: '20' },
    ],
    hazard: [
      { id: 1, status: '在册', pending: true, abnormal: false, 隐患点编号: 'HAZA-0001', 隐患点名称: '甲隐患点', 所在乡镇: '青云镇' },
      { id: 2, status: '监测中', pending: true, abnormal: true, 隐患点编号: 'HAZA-0002', 隐患点名称: '乙隐患点', 所在乡镇: '龙潭镇' },
      { id: 3, status: '已治理', pending: false, abnormal: false, 隐患点编号: 'HAZA-0003', 隐患点名称: '丙隐患点', 所在乡镇: '大庙镇' },
    ],
  }
}

describe('覆盖派生（隐患点提醒与运营总览共用）', () => {
  it('只有进行中、已完成的批次计入覆盖，待开展与已取消不计', () => {
    const coverage = buildCoverage(fixtureRows())
    expect(coverage.coveredVillages).toBe(2) // 青云村、龙潭村
    expect(coverage.totalVillages).toBe(REGIONS.flatMap((region) => region.villages).length)
    expect(coverage.uncoveredVillages).toBe(coverage.totalVillages - 2)
  })

  it('提醒清单与乡镇覆盖口径一致：提醒数 = 有未覆盖村组的隐患点数', () => {
    const coverage = buildCoverage(fixtureRows())
    expect(coverage.reminders).toHaveLength(3)
    const byTownship = new Map(coverage.townships.map((item) => [item.township, item]))
    for (const reminder of coverage.reminders) {
      expect(reminder.uncoveredVillages).toEqual(byTownship.get(reminder.township)?.uncovered)
    }
    // 大庙镇没有任何有效批次，4 个村组全部待宣传
    const damiao = coverage.reminders.find((item) => item.township === '大庙镇')
    expect(damiao?.uncoveredVillages).toEqual(['大庙村', '杉木村', '石桥村', '湾子村'])
  })

  it('覆盖数与提醒数同源：同样的输入再算一遍结果完全相同', () => {
    const rows = fixtureRows()
    expect(buildCoverage(rows)).toEqual(buildCoverage(rows))
  })
})

describe('宣传页统计', () => {
  it('本月活动数、已完成数、覆盖人次都来自同一份宣传记录', () => {
    const stats = propagandaStats(fixtureRows().propaganda, new Date('2026-10-06T08:00:00'))
    expect(stats.monthActivities).toBe(3) // 10 月的三条
    expect(stats.finished).toBe(1)
    expect(stats.reachedPeople).toBe(150) // 已完成 100 + 进行中 50
  })
})
