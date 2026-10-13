#!/usr/bin/env node
// 版本联动检查：CLI Doctor 的四个版本号必须一致。
//
// 仓库约定（见根 README 与 CHANGELOG）：Agent Skill、CLI、Codex 侧栏插件与 DSH 侧栏插件
// 使用同一版本号，分别写在：
//   - package.json        （CLI / npm 包）
//   - SKILL.md            （Agent Skill frontmatter）
//   - plugin.json         （Codex 侧栏插件）
//   - dsh/package.json    （DSH 侧栏插件 bundle）
//
// 这个脚本只在仓库检出里运行；从已发布的 npm 副本运行时缺少根文件，会打印 skip 并以 0 退出，
// 不阻塞任何使用已发布包的人。

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dshDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(dshDir, '..')

/** Read one JSON file's `version`, or undefined when the file is absent or malformed. */
function readJsonVersion(file) {
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, 'utf8')).version
  } catch {
    return undefined
  }
}

/** Read the `version` field out of a SKILL.md YAML frontmatter block. */
function readFrontmatterVersion(file) {
  if (!existsSync(file)) return undefined
  const text = readFileSync(file, 'utf8')
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (block === null) return undefined
  const line = /^version:[ \t]*(.+?)[ \t]*$/m.exec(block[1])
  return line === null ? undefined : line[1].replace(/^["']|["']$/g, '')
}

const rootManifest = join(repoRoot, 'package.json')
if (!existsSync(rootManifest)) {
  process.stdout.write('check-versions: skip — no repository checkout around this package\n')
  process.exit(0)
}

const sources = [
  ['package.json', readJsonVersion(rootManifest)],
  ['SKILL.md', readFrontmatterVersion(join(repoRoot, 'SKILL.md'))],
  ['plugin.json', readJsonVersion(join(repoRoot, 'plugin.json'))],
  ['dsh/package.json', readJsonVersion(join(dshDir, 'package.json'))],
]

const missing = sources.filter(([, version]) => version === undefined)
const versions = [...new Set(sources.map(([, version]) => version))]
const label = (value) => (value === undefined ? '<missing>' : value)

for (const [file, version] of sources) {
  process.stdout.write(`  ${file.padEnd(18)} ${label(version)}\n`)
}

if (missing.length > 0) {
  process.stderr.write(
    `check-versions: FAIL — could not read a version from: ${missing.map(([f]) => f).join(', ')}\n`,
  )
  process.exit(1)
}

if (versions.length > 1) {
  process.stderr.write(
    `check-versions: FAIL — versions are not in lockstep: ${versions.join(' vs ')}\n` +
      'Release policy: Agent Skill, CLI, Codex plugin and DSH plugin share one version.\n',
  )
  process.exit(1)
}

process.stdout.write(`check-versions: ok — all four files are at ${versions[0]}\n`)
