import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const locales = ['en-US', 'zh-CN', 'zh-TW', 'es-ES']
const resources = Object.fromEntries(
  locales.map((locale) => [
    locale,
    JSON.parse(
      readFileSync(
        new URL(`../src/renderer/src/lib/i18n/locales/${locale}/translation.json`, import.meta.url),
        'utf8'
      )
    )
  ])
)
const keys = [...new Set(Object.values(resources).flatMap(Object.keys))].sort()
const variables = (text) => (text.match(/\{\{[^}]+\}\}/g) ?? []).sort()

for (const locale of locales) {
  test(`${locale} covers every desktop locale key without empty translations`, () => {
    assert.deepEqual(Object.keys(resources[locale]).sort(), keys)
    for (const key of keys) {
      const value = resources[locale][key]
      assert.equal(typeof value, 'string', key)
      assert.ok(value.trim(), key)
      assert.deepEqual(variables(value), variables(resources['en-US'][key]), key)
    }
  })
}
