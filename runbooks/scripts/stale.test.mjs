import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { daysSince, staleState, todayLocal } from './lib/stale.mjs'
import { loadConfig, ConfigError, DEFAULT_CONFIG_PATH } from './lib/config.mjs'

test('daysSince counts whole days', () => {
  assert.equal(daysSince('2026-10-01', '2026-10-20'), 19)
  assert.equal(daysSince('2026-03-01', '2026-03-31'), 30) // crosses a DST change in many zones
})

test('staleState follows the status, the age and the limit', () => {
  const rb = (status, date) => ({ status, lastRun: date ? { date } : null })
  const opts = { today: '2026-10-20', staleDays: 30 }
  assert.deepEqual(staleState(rb('active', '2026-09-20'), opts), { stale: false, age: 30 })
  assert.deepEqual(staleState(rb('active', '2026-09-19'), opts), { stale: true, age: 31 })
  assert.deepEqual(staleState(rb('draft', null), opts), { stale: true, age: null })
  assert.deepEqual(staleState(rb('deprecated', null), opts), { stale: false, age: null })
  assert.deepEqual(staleState(rb('placeholder', null), opts), { stale: false, age: null })
  assert.deepEqual(staleState(rb(null, null), opts), { stale: false, age: null }) // invalid runbook
})

test('todayLocal formats the local date', () => {
  assert.equal(todayLocal(new Date(2026, 9, 5, 23, 59)), '2026-10-05')
})

test('staleDays defaults to 30 and must be a positive integer', () => {
  const load = (extra) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-'))
    fs.mkdirSync(path.join(root, path.dirname(DEFAULT_CONFIG_PATH)), { recursive: true })
    fs.writeFileSync(path.join(root, DEFAULT_CONFIG_PATH), JSON.stringify({ version: 1, ...extra }))
    return loadConfig(root)
  }
  assert.equal(load({}).staleDays, 30)
  assert.equal(load({ staleDays: 7 }).staleDays, 7)
  for (const staleDays of [0, 'x', 1.5]) {
    assert.throws(() => load({ staleDays }), (err) => err instanceof ConfigError && /staleDays must be a positive integer/.test(err.message))
  }
})
