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
    </div>

    <h3 class="section-title">宣传覆盖与隐患点提醒</h3>
    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">村组覆盖</span>
        <strong class="stat-value">{{ coverage.coveredVillages }}/{{ coverage.totalVillages }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">未覆盖村组</span>
        <strong class="stat-value">{{ coverage.uncoveredVillages }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">隐患点提醒</span>
        <strong class="stat-value">{{ coverage.reminders.length }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>隐患点编号</th><th>隐患点名称</th><th>所在乡镇</th><th>待宣传村组</th></tr>
      </thead>
      <tbody>
        <tr v-for="item in coverage.reminders" :key="item.hazardId">
          <td>{{ item.code }}</td>
          <td>{{ item.name }}</td>
          <td>{{ item.township }}</td>
          <td>{{ item.uncoveredVillages.join('、') }}</td>
        </tr>
        <tr v-if="!coverage.reminders.length">
          <td colspan="4" class="empty-state">宣传已覆盖全部村组，暂无隐患点提醒</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">各模块情况</h3>
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

    <section v-if="diagnostics" class="diag-panel" :class="{ failed: !diagnostics.ok }">
      <h3 class="section-title">存量数据迁移诊断</h3>
      <template v-if="diagnostics.ok">
        <p v-for="report in diagnostics.reports" :key="report.name" class="diag-line">
          迁移「{{ report.name }}」：扫描 {{ report.scanned }} 条，改写 {{ report.changed }} 条，
          补齐村组 {{ report.filled }} 条，状态归一 {{ report.statusNormalized }} 条，
          无法归属 {{ report.unmatched.length }} 条（输入指纹 {{ report.inputDigest }}，输出指纹 {{ report.outputDigest }}）
        </p>
        <p v-if="!diagnostics.reports.length" class="diag-line">数据已是最新版本，无需迁移。</p>
        <table v-if="unmatchedRows.length" class="data-table">
          <thead>
            <tr><th>活动编号</th><th>无法归属原因</th><th>原覆盖村组</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in unmatchedRows" :key="item.rowId">
              <td>{{ item.code || item.rowId }}</td>
              <td>{{ item.reason }}</td>
              <td>{{ item.rawCoverage || '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-for="(warning, index) in warnings" :key="index" class="diag-line warn">{{ warning }}</p>
      </template>
      <template v-else>
        <p class="diag-line error-text">
          迁移「{{ diagnostics.error?.name }}」失败，已整批回退，本地数据保持迁移前状态：{{ diagnostics.error?.message }}
        </p>
      </template>
      <p class="diag-line muted">
        {{ diagnostics.startedAt }} 由 v{{ diagnostics.fromVersion }} 迁往 v{{ diagnostics.toVersion }}；
        迁移前原始报文备份于 localStorage「{{ backupKeyName }}」，可据此复现本次诊断。
      </p>
    </section>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { loadCoverage } from '@/api/coverage'
import { loadOverview } from '@/api/local-service'
import { backupKey, migrationDiagnostics } from '@/data/local-store'
import type { CoverageResult } from '@/api/coverage'
import type { DiagnosticsRecord } from '@/data/migrations'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const coverage = ref<CoverageResult>({ townships: [], totalVillages: 0, coveredVillages: 0, uncoveredVillages: 0, reminders: [] })
const diagnostics = ref<DiagnosticsRecord | null>(null)
const backupKeyName = backupKey()

const unmatchedRows = computed(() => diagnostics.value?.reports.flatMap((report) => report.unmatched) ?? [])
const warnings = computed(() => diagnostics.value?.reports.flatMap((report) => report.warnings) ?? [])

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  coverage.value = loadCoverage()
  diagnostics.value = migrationDiagnostics()
}

onMounted(refresh)
</script>
