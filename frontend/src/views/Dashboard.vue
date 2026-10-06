<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">宣传覆盖村组</span>
        <strong class="stat-value">{{ coverage.coveredGroups }} / {{ coverage.totalGroups }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">宣传未覆盖隐患点</span>
        <strong class="stat-value">{{ coverage.reminders.length }}</strong>
      </article>
    </div>
    <p v-if="unassignedCount > 0" class="error-text">
      存量迁移中有 {{ unassignedCount }} 条宣传记录无法归属乡镇，请到「防灾宣传」页查看迁移诊断。
    </p>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据；宣传覆盖数与防灾宣传页的隐患点提醒同源统计</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadCoverage } from '@/api/coverage'
import { loadOverview } from '@/api/local-service'
import { lastMigrationReport } from '@/data/local-store'
import type { CoverageResult } from '@/api/coverage'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const coverage = ref<CoverageResult>({ totalGroups: 0, coveredGroups: 0, perTownship: [], reminders: [] })
const unassignedCount = ref(0)

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  coverage.value = loadCoverage()
  const report = lastMigrationReport()
  unassignedCount.value = report
    ? report.reports.reduce((sum, item) => sum + item.unassigned.length, 0)
    : 0
}

onMounted(refresh)
</script>
