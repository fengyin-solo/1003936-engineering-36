# 地质灾害隐患点监测防治管理系统

面向地质灾害隐患点形变裂缝观测、雨量预警、避险搬迁安置与治理工程验收全流程的地质灾害防治数字化管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 隐患点台账 | `hazard` | 隐患点 | 隐患点编号、隐患点名称、灾害类型 |
| 形变观测 | `deformation` | 形变记录 | 记录编号、隐患点编号、观测日期 |
| 裂缝监测 | `crack` | 裂缝测点 | 测点编号、隐患点编号、裂缝编号 |
| 倾斜监测 | `tilt` | 倾斜记录 | 记录编号、测点编号、观测方向 |
| 雨量监测 | `rain_gauge` | 雨量记录 | 记录编号、站点编号、观测时段 |
| 预警阈值 | `threshold` | 预警阈值 | 阈值编号、隐患点编号、监测类型 |
| 预警发布 | `alarm` | 预警通知 | 通知编号、隐患点编号、预警等级 |
| 避险搬迁 | `evacuation` | 搬迁安置户 | 户号、所属隐患点、户主姓名 |
| 巡查排查 | `patrol` | 巡查记录 | 巡查编号、隐患点编号、巡查日期 |
| 治理工程 | `engineering` | 治理工程项目 | 项目编号、隐患点编号、治理方案 |
| 工程验收 | `acceptance` | 验收报告 | 验收编号、项目编号、验收类型 |
| 整改跟踪 | `rectification` | 整改任务 | 任务编号、验收编号、整改内容 |
| 应急演练 | `drill` | 演练记录 | 演练编号、隐患点编号、演练主题 |
| 监测设备 | `device` | 监测设备 | 设备编号、设备类型、所属隐患点 |
| 灾情速报 | `report` | 灾情速报 | 速报编号、隐患点编号、发生时间 |
| 防灾宣传 | `propaganda` | 宣传活动 | 活动编号、宣传主题、宣传方式、所属乡镇、覆盖村组 |
| 承建单位 | `contract` | 承建单位 | 单位编号、单位名称、资质等级 |
| 群测群防培训 | `training` | 培训记录 | 培训编号、培训主题、培训对象 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `geohazard-monitor-prevention:entries` 这一项，或调用 `resetModule(模块)`。

## 存量数据迁移

本地数据带版本号（当前 v2），存在 `geohazard-monitor-prevention:entries` 一个 key 里，
结构是 `{ schemaVersion, rows, history }` 信封。每次启动时 `local-store.ts` 检查版本，
把未执行的迁移（`frontend/src/data/migrations.ts`）按序跑完：

- **整批原子生效**：所有迁移在内存里算完并通过结构校验后，才整封替换落盘；
  任何一步失败，存储原样不动（整批回退），页面继续用迁移前的数据。
- **可重复执行**：迁移按版本号去重，跑过的不会再跑；迁移本身幂等，
  重复执行零变更、不追加记录。
- **可复现诊断**：每次迁移的结果（扫描/改写/补齐/无法归属条数、逐字段变更、
  输入输出指纹）整封覆盖写入 `geohazard-monitor-prevention:diagnostics`；
  迁移前的原始报文备份在 `geohazard-monitor-prevention:backup`（只写一次），
  同样的输入永远得到同样的指纹。运营概览页底部能看到最近一次诊断。
- **环境一致**：迁移代码打进前端 bundle，在 `npm run dev`、`npm run preview`、
  docker 部署里走的是同一份逻辑，不依赖任何环境变量。

当前迁移 `propaganda-coverage-v2`（v1 → v2）修复防灾宣传存量：

1. 旧状态名（如「已结束」「取消」）映射到现行状态，业务字段「活动状态」与系统状态对齐；
2. 「覆盖村组」兼容旧写法（纯数量、占位文本、各种分隔符），归一成规范村组名单；
3. 缺覆盖村组的按「所属乡镇」从基础数据（`frontend/src/data/regions.ts`，乡镇→村组）
   补齐；乡镇缺失的从可识别村组反推；
4. 仍无法归属的记录不丢不编：保留原文、标异常，单独列进诊断报告。

隐患点提醒与宣传覆盖数共用同一份基础数据和同一份宣传记录
（`frontend/src/api/coverage.ts` 的 `buildCoverage`），运营总览、宣传页统计卡
都从这儿取数，口径天然一致。

## 测试

```bash
cd frontend
npm test
```

覆盖：迁移的补齐/归一/无法归属/幂等/回退、覆盖派生口径一致、本地存储引导迁移
（旧数据升级、重复启动不追加、失败回退、损坏报文隔离）。
