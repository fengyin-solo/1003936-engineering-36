import { describe, expect, it } from 'vitest'

import {
  MigrationFailure,
  digest,
  runPendingMigrations,
  validateRows,
} from './migrations'
import type { Migration, MigrationReport } from './migrations'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 以当前种子为底，替换防灾宣传模块，模拟各历史版本的存量数据。 */
function legacyRows(propaganda: EntryRow[]): Record<string, EntryRow[]> {
  return { ...clone(SEED_ROWS), propaganda }
}

function emptyReport(): MigrationReport {
  return {
    version: 2,
    name: 'stub',
    scanned: 0,
    changed: 0,
    filled: 0,
    statusNormalized: 0,
    unmatched: [],
    changes: [],
    warnings: [],
    inputDigest: '',
    outputDigest: '',
  }
}

describe('防灾宣传存量迁移', () => {
  it('旧版占位数据：无法归属的单独列出，不丢记录也不追加记录', () => {
    const legacy = legacyRows([
      { id: 1, status: '待开展', pending: true, abnormal: false, 活动编号: 'PROP-0001', 覆盖村组: '防灾宣传样例1', 活动状态: '防灾宣传样例1' },
      { id: 2, status: '进行中', pending: true, abnormal: true, 活动编号: 'PROP-0002', 覆盖村组: '防灾宣传样例2', 活动状态: '防灾宣传样例2' },
      { id: 3, status: '已完成', pending: false, abnormal: false, 活动编号: 'PROP-0003', 覆盖村组: '防灾宣传样例3', 活动状态: '防灾宣传样例3' },
    ])
    const { rows, reports } = runPendingMigrations(legacy, 1)
    const report = reports[0]
    expect(rows.propaganda).toHaveLength(3)
    expect(report.scanned).toBe(3)
    expect(report.unmatched).toHaveLength(3)
    expect(report.unmatched[0]).toMatchObject({ rowId: 1, code: 'PROP-0001', rawCoverage: '防灾宣传样例1' })
    // 无法归属：保留原文待查、标异常，不编造村组
    expect(rows.propaganda[0]['覆盖村组']).toBe('防灾宣传样例1')
    expect(rows.propaganda.every((row) => row.abnormal)).toBe(true)
    // 状态语义归一：业务字段「活动状态」与系统状态对齐
    expect(rows.propaganda[0]['活动状态']).toBe('待开展')
    expect(rows.propaganda[2].pending).toBe(false)
  })

  it('按所属乡镇补齐缺失村组，旧状态名映射到现行状态', () => {
    const legacy = legacyRows([
      { id: 1, status: '已结束', pending: true, abnormal: false, 活动编号: 'PROP-0001', 所属乡镇: '青云镇', 覆盖村组: '', 活动状态: '已结束' },
      { id: 2, status: '进行中', pending: true, abnormal: false, 活动编号: 'PROP-0002', 所属乡镇: '龙潭镇', 覆盖村组: '12', 活动状态: '进行中' },
    ])
    const { rows, reports } = runPendingMigrations(legacy, 1)
    expect(rows.propaganda[0]['覆盖村组']).toBe('青云村、石门村、黄泥村')
    expect(rows.propaganda[0].status).toBe('已完成')
    expect(rows.propaganda[0]['活动状态']).toBe('已完成')
    expect(rows.propaganda[0].pending).toBe(false)
    // 旧版只记覆盖数量、但有乡镇：按乡镇补齐
    expect(rows.propaganda[1]['覆盖村组']).toBe('龙潭村、白岩村、双河村')
    expect(reports[0].filled).toBe(2)
    expect(reports[0].statusNormalized).toBeGreaterThanOrEqual(1)
    expect(reports[0].unmatched).toHaveLength(0)
  })

  it('旧版只记数量又缺乡镇的，进无法归属清单并说明原因', () => {
    const legacy = legacyRows([
      { id: 1, status: '已完成', pending: false, abnormal: false, 活动编号: 'PROP-0009', 覆盖村组: '12', 活动状态: '已完成' },
    ])
    const { reports } = runPendingMigrations(legacy, 1)
    expect(reports[0].unmatched).toHaveLength(1)
    expect(reports[0].unmatched[0].reason).toContain('覆盖数量')
  })

  it('能从覆盖村组反推所属乡镇，并把各种分隔符归一成规范写法', () => {
    const legacy = legacyRows([
      { id: 1, status: '进行中', pending: true, abnormal: false, 活动编号: 'PROP-0001', 覆盖村组: '石门村，青云村', 活动状态: '进行中' },
    ])
    const { rows } = runPendingMigrations(legacy, 1)
    expect(rows.propaganda[0]['所属乡镇']).toBe('青云镇')
    expect(rows.propaganda[0]['覆盖村组']).toBe('青云村、石门村')
  })

  it('可重复执行：第二次运行零变更、不追加，诊断指纹一致', () => {
    const legacy = legacyRows([
      { id: 1, status: '已结束', pending: true, abnormal: false, 活动编号: 'PROP-0001', 所属乡镇: '青云镇', 覆盖村组: '', 活动状态: '已结束' },
      { id: 2, status: '进行中', pending: true, abnormal: false, 活动编号: 'PROP-0002', 覆盖村组: '防灾宣传样例2', 活动状态: '防灾宣传样例2' },
    ])
    const first = runPendingMigrations(legacy, 1)
    const second = runPendingMigrations(first.rows, 1)
    expect(second.reports[0].changed).toBe(0)
    expect(second.reports[0].changes).toHaveLength(0)
    expect(second.reports[0].filled).toBe(0)
    expect(second.rows).toEqual(first.rows)
    expect(second.rows.propaganda).toHaveLength(2)
    // 无法归属的记录再次被如实列出，而不是被复制或静默吞掉
    expect(second.reports[0].unmatched).toHaveLength(1)
    expect(second.reports[0].inputDigest).toBe(second.reports[0].outputDigest)
  })

  it('诊断可复现：同样的输入永远得到同样的报告与指纹', () => {
    const legacy = legacyRows([
      { id: 1, status: '已结束', pending: true, abnormal: false, 活动编号: 'PROP-0001', 所属乡镇: '大庙镇', 覆盖村组: '大庙村、杉木村、未知村', 活动状态: '已结束' },
    ])
    const again = clone(legacy)
    const reportA = runPendingMigrations(legacy, 1).reports[0]
    const reportB = runPendingMigrations(again, 1).reports[0]
    expect(reportA).toEqual(reportB)
    expect(reportA.inputDigest).toBe(digest(legacy.propaganda))
    expect(reportA.warnings.some((text) => text.includes('未知村'))).toBe(true)
  })

  it('迁移执行抛错：整批失败，入参原样保留', () => {
    const legacy = legacyRows([
      { id: 1, status: '待开展', pending: true, abnormal: false, 活动编号: 'PROP-0001', 覆盖村组: '防灾宣传样例1', 活动状态: '防灾宣传样例1' },
    ])
    const before = clone(legacy)
    const boom: Migration = {
      version: 2,
      name: 'boom',
      apply: () => {
        throw new Error('模拟迁移中断')
      },
    }
    expect(() => runPendingMigrations(legacy, 1, [boom])).toThrow(MigrationFailure)
    expect(legacy).toEqual(before)
  })

  it('迁移输出未通过校验：整批失败并说明原因', () => {
    const legacy = legacyRows([
      { id: 1, status: '待开展', pending: true, abnormal: false, 活动编号: 'PROP-0001', 覆盖村组: '防灾宣传样例1', 活动状态: '防灾宣传样例1' },
    ])
    const bad: Migration = {
      version: 2,
      name: 'bad-output',
      apply: (rows) => ({
        rows: { ...rows, propaganda: [{ id: -1, status: '', pending: true, abnormal: false }] },
        report: emptyReport(),
      }),
    }
    expect(() => runPendingMigrations(legacy, 1, [bad])).toThrow(/未通过校验/)
  })
})

describe('迁移输出校验', () => {
  it('当前种子数据本身满足全部不变量', () => {
    expect(() => validateRows(clone(SEED_ROWS))).not.toThrow()
  })

  it('拒绝重复编号与未知乡镇', () => {
    const duplicated = clone(SEED_ROWS)
    duplicated.propaganda = [duplicated.propaganda[0], duplicated.propaganda[0]]
    expect(() => validateRows(duplicated)).toThrow(/重复/)

    const alien = clone(SEED_ROWS)
    alien.propaganda = [{ ...alien.propaganda[0], 所属乡镇: '火星镇' }]
    expect(() => validateRows(alien)).toThrow(/不在基础数据/)
  })
})
