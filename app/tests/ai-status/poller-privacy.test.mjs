import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const pollerPath = new URL('../../src/main/services/AiStatusPoller.ts', import.meta.url)
const pollerSource = readFileSync(pollerPath, 'utf8')

test('AI status errors are classified without a shared temporary log', () => {
  assert.doesNotMatch(pollerSource, /zinc_status_err|ERROR_LOG_PATH|writeFileSync|tmpdir\s*\(/)
  assert.match(pollerSource, /console\.warn\(`\[zinc\] ai-status \$\{source\}/)
  assert.doesNotMatch(pollerSource, /console\.(?:warn|error|log)\([^\n]*(?:message|stack)/)
})
