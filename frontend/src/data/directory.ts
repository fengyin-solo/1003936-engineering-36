// 行政区划基础数据：乡镇 → 村组目录。
// 这是宣传批次（propaganda.覆盖村组）与隐患点提醒共用的同一份基础数据，
// 任何模块需要「某乡镇下辖哪些村组」都必须从这里取，保证覆盖数口径一致。
export const TOWNSHIP_DIRECTORY: Record<string, string[]> = {
  青云镇: ['青云村', '石门村', '龙潭村', '梨树坪村'],
  白沙镇: ['白沙村', '河口村', '大湾村'],
  青山乡: ['青山村', '磨盘村', '石桥村'],
  龙冈镇: ['龙冈村', '双河村'],
}

// 村组 → 所属乡镇的反查表，迁移归属判断与覆盖统计共用。
export const GROUP_TO_TOWNSHIP: Record<string, string> = Object.fromEntries(
  Object.entries(TOWNSHIP_DIRECTORY).flatMap(([township, groups]) =>
    groups.map((group) => [group, township]),
  ),
)

// 覆盖村组字段的分隔符：中文顿号、中文/英文逗号、分号都按分隔符处理。
export function splitGroups(value: string): string[] {
  return value
    .split(/[、，,；;]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

// 旧版示例数据用「防灾宣传样例N」这类占位文本填充村组字段，不是真实村组。
export function isLegacyPlaceholder(value: string): boolean {
  return value.trim() === '' || /样例\d*/.test(value)
}
