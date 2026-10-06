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
| 防灾宣传 | `propaganda` | 宣传活动 | 活动编号、宣传主题、宣传方式 |
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

存储是带版本的信封 `{ version, data }`。旧版（v1，无信封的裸数据）首次读取时自动执行
`frontend/src/data/migrations.ts` 里的迁移链，升级到 `STORAGE_VERSION`：

- **按所属乡镇补齐村组**：乡镇 → 村组目录在 `frontend/src/data/directory.ts`，是宣传批次与
  隐患点提醒共用的同一份基础数据。旧版「覆盖村组」里存乡镇名或部分村组的，归属后补齐为全镇
  村组；占位样例、目录外乡镇等无法归属的记录不猜不改，单独列入诊断报告。
- **状态归一**：「已结束 / 开展中 / 计划中」等旧写法映射到现行口径（待开展 / 进行中 / 已完成 / 已取消）。
- **幂等**：迁移只原地修正、绝不追加行；版本已最新时不执行，强制重跑同一迁移也是收敛的。
- **整批回退**：迁移在数据副本上进行，任一步失败主键保持原样，应用继续用迁移前数据运行。
- **可复现诊断**：报告含行级决策（按 id 排序）、无法归属清单与 FNV-1a 输入/输出校验和，
  同一输入永远得到同一报告。报告落在 localStorage 的
  `geohazard-monitor-prevention:migration-report`，可在「防灾宣传」页查看并下载；
  迁移前原文备份在 `geohazard-monitor-prevention:backup-v<旧版本>`，可手工回滚。

迁移代码是纯函数、不依赖浏览器 API，本地开发、构建预览与部署产物跑的是同一份源码。
宣传覆盖数由 `frontend/src/api/coverage.ts` 统一计算，运营总览与防灾宣传页的隐患点提醒
都取自这里，两处数字必然一致。

验证迁移（升级、幂等、回退、诊断可复现、端到端存储升级，共 25 项断言）：

```bash
cd frontend
npm run verify:migration   # 或仓库根目录 make verify
```

手工复现一次迁移：在浏览器控制台把旧版数据写回再刷新——

```js
localStorage.setItem('geohazard-monitor-prevention:entries', JSON.stringify({
  propaganda: [{ id: 1, status: '已结束', pending: false, abnormal: false,
    活动编号: 'PROP-0001', 覆盖村组: '青云镇' }],
}))
location.reload()
```
