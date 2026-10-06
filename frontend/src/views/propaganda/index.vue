<template>
  <section class="page" data-module="propaganda">
    <header class="page-head">
      <div>
        <h2>防灾宣传管理</h2>
        <p class="page-desc">维护宣传活动，围绕活动编号、宣传主题、宣传方式、所属乡镇、覆盖村组做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记宣传活动</button>
        <button class="btn" type="button" @click="exportRows">导出防灾宣传清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无防灾宣传数据，可先登记宣传活动</td>
        </tr>
      </tbody>
    </table>

    <section class="panel">
      <header class="panel-head">
        <h3>隐患点宣传提醒</h3>
        <p class="page-desc">与运营总览共用同一份基础数据：覆盖村组 {{ coverage.coveredGroups }} / {{ coverage.totalGroups }}，以下隐患点所在乡镇仍有村组未覆盖。</p>
      </header>
      <table class="data-table">
        <thead>
          <tr><th>隐患点编号</th><th>隐患点名称</th><th>所在乡镇</th><th>未覆盖村组</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in coverage.reminders" :key="item.id">
            <td>{{ item.code }}</td>
            <td>{{ item.name }}</td>
            <td>{{ item.township }}</td>
            <td>{{ item.missingGroups.join('、') }}</td>
          </tr>
          <tr v-if="!coverage.reminders.length">
            <td colspan="4" class="empty-state">所有在册隐患点所在乡镇的村组均已覆盖</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="migrationReport" class="panel">
      <header class="panel-head">
        <h3>存量迁移诊断</h3>
        <p class="page-desc">
          {{ migrationReport.ok ? '迁移成功' : '迁移失败已整批回退' }}：
          v{{ migrationReport.fromVersion }} → v{{ migrationReport.toVersion }}，
          执行于 {{ migrationReport.executedAt }}
        </p>
      </header>
      <template v-for="report in migrationReport.reports" :key="report.id">
        <p class="status-legend">
          <span class="legend-item">补齐村组：{{ report.repaired.length }}</span>
          <span class="legend-item">状态归一：{{ report.statusFixed.length }}</span>
          <span class="legend-item">无法归属：{{ report.unassigned.length }}</span>
          <span class="legend-item">输入校验：{{ report.inputChecksum }}</span>
          <span class="legend-item">输出校验：{{ report.outputChecksum }}</span>
        </p>
        <table v-if="report.unassigned.length" class="data-table">
          <thead>
            <tr><th>活动编号</th><th>无法归属原因</th><th>原始村组值</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in report.unassigned" :key="item.id">
              <td>{{ item.code }}</td>
              <td>{{ item.reason }}</td>
              <td>{{ item.raw }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="report.error" class="error-text">{{ report.error }}</p>
      </template>
      <footer class="page-foot">
        <span>诊断报告保存在本机 localStorage 的 {{ reportKey }} 键</span>
        <button class="btn ghost" type="button" @click="downloadReport">下载诊断报告</button>
      </footer>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条防灾宣传记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { loadCoverage } from '@/api/coverage'
import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { lastMigrationReport, migrationReportKey } from '@/data/local-store'
import type { StoredMigrationReport } from '@/data/local-store'
import type { CoverageResult } from '@/api/coverage'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('propaganda')
const columns = ["活动编号", "宣传主题", "宣传方式", "所属乡镇", "覆盖村组", "活动日期", "参与人数", "组织人", "活动状态"]
const actions = ["开展活动", "确认完成", "取消活动"]
const statuses = ["待开展", "进行中", "已完成", "已取消"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const coverage = ref<CoverageResult>({ totalGroups: 0, coveredGroups: 0, perTownship: [], reminders: [] })
const migrationReport = ref<StoredMigrationReport | null>(null)
const reportKey = migrationReportKey()

const stats = computed(() => [
  { label: '宣传活动数', value: rows.value.length },
  { label: '已完成数', value: rows.value.filter((row) => String(row.status) === '已完成').length },
  { label: '覆盖村组数', value: coverage.value.coveredGroups },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '宣传活动登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function downloadReport() {
  if (!migrationReport.value) {
    errorMessage.value = '暂无迁移诊断报告'
    return
  }
  const content = JSON.stringify(migrationReport.value, null, 2)
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = '防灾宣传存量迁移诊断报告.json'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    coverage.value = loadCoverage()
    migrationReport.value = lastMigrationReport()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '防灾宣传列表读取失败'
  }
}

onMounted(reload)
</script>
