// 行政区划基础数据：乡镇 → 村组，是「防灾宣传批次」与「隐患点提醒」共用的同一份底数。
// 迁移、覆盖统计、提醒派生都只能从这儿取数，任何地方不再各自维护一份村组清单。

export type Region = {
  township: string
  villages: string[]
}

export const REGIONS: Region[] = [
  { township: '青云镇', villages: ['青云村', '石门村', '黄泥村'] },
  { township: '龙潭镇', villages: ['龙潭村', '白岩村', '双河村'] },
  { township: '大庙镇', villages: ['大庙村', '杉木村', '石桥村', '湾子村'] },
]

const TOWNSHIP_SET = new Set(REGIONS.map((region) => region.township))

const VILLAGE_INDEX = new Map<string, string>(
  REGIONS.flatMap((region) => region.villages.map((village) => [village, region.township])),
)

export function isTownship(name: unknown): name is string {
  return typeof name === 'string' && TOWNSHIP_SET.has(name.trim())
}

export function villagesOf(township: string): string[] {
  return REGIONS.find((region) => region.township === township)?.villages ?? []
}

/** 村组名唯一属于一个乡镇；查不到返回 null。 */
export function townshipOfVillage(village: string): string | null {
  return VILLAGE_INDEX.get(village.trim()) ?? null
}

export function allVillages(): string[] {
  return REGIONS.flatMap((region) => region.villages)
}

/** 把一组村组名按基础数据里的乡镇、村组顺序排好，保证同样的集合永远得到同样的字符串。 */
export function canonicalVillageOrder(villages: Iterable<string>): string[] {
  const wanted = new Set([...villages].map((name) => name.trim()))
  return REGIONS.flatMap((region) => region.villages).filter((village) => wanted.has(village))
}
