import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = mkdtempSync(join(tmpdir(), 'zinc-process-cwd-'))
const outfile = join(outDir, 'processCwd.mjs')

globalThis.processCwdFixture = { memory: new Map(), wow64: false, failProbe: false, shortRead: null, closed: 0 }
await build({
  entryPoints: [join(root, 'src/main/processCwd.ts')],
  bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent',
  define: { 'process.platform': '"win32"' },
  plugins: [{
    name: 'mock-koffi',
    setup(builder) {
      builder.onResolve({ filter: /^koffi$/ }, () => ({ path: 'koffi', namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
        contents: `
          const fixture = () => globalThis.processCwdFixture;
          export default {
            load() { return { func(signature) {
              if (signature.includes('OpenProcess')) return () => 1n;
              if (signature.includes('CloseHandle')) return () => { fixture().closed++; return true };
              if (signature.includes('ReadProcessMemory')) return (_, address, buffer, size, bytesRead) => {
                const data = fixture().memory.get(BigInt(address));
                if (!data || data.length < size) return false;
                const count = fixture().shortRead === BigInt(address) ? size - 2 : size;
                data.copy(buffer, 0, 0, count);
                bytesRead[0] = count;
                return true;
              };
              if (signature.includes('NtQueryInformationProcess')) return (_, kind, output) => {
                if (kind === 26) {
                  if (fixture().failProbe) return -1;
                  output.writeBigUInt64LE(fixture().wow64 ? 0x3000n : 0n);
                } else output.PebBaseAddress = 0x2000n;
                return 0;
              };
              return () => false;
            } } },
            struct() { return {} }, sizeof() { return 48 },
            address(value) { return BigInt(value) },
            decode(buffer) { return buffer.readBigUInt64LE() }
          }
        `,
        loader: 'js'
      }))
    }
  }]
})
const { getProcessCwd, getProcessCommandLine } = await import(pathToFileURL(outfile))

test.after(() => {
  delete globalThis.processCwdFixture
  rmSync(outDir, { recursive: true, force: true })
})

function pointer(value, width) {
  const bytes = Buffer.alloc(width)
  if (width === 4) bytes.writeUInt32LE(Number(value))
  else bytes.writeBigUInt64LE(value)
  return bytes
}

function unicode(value, width) {
  const data = Buffer.from(value, 'utf16le')
  const header = Buffer.alloc(width === 4 ? 8 : 16)
  header.writeUInt16LE(data.length, 0)
  header.writeUInt16LE(data.length + 2, 2)
  if (width === 4) header.writeUInt32LE(0x5000, 4)
  else header.writeBigUInt64LE(0x5000n, 8)
  return { data, header }
}

function setFixture(value, { wow64 = false, commandLine = false } = {}) {
  const fixture = globalThis.processCwdFixture
  fixture.memory.clear()
  fixture.wow64 = wow64
  fixture.failProbe = false
  fixture.shortRead = null
  const width = wow64 ? 4 : 8
  const offset = commandLine ? (wow64 ? 0x40 : 0x70) : (wow64 ? 0x24 : 0x38)
  fixture.memory.set(wow64 ? 0x3010n : 0x2020n, pointer(0x4000n, width))
  const { data, header } = unicode(value, width)
  fixture.memory.set(0x4000n + BigInt(offset), header)
  fixture.memory.set(0x5000n, data)
  return fixture
}

test('native x64 PEB keeps drive and UNC roots but trims directory trailing separators', () => {
  for (const path of ['C:\\', '\\\\server\\share\\', '\\\\?\\C:\\']) {
    setFixture(path)
    assert.equal(getProcessCwd(123), path)
  }
  setFixture('C:\\workspace\\')
  assert.equal(getProcessCwd(123), 'C:\\workspace')
})

test('WOW64 uses 32-bit PEB, process parameters and UNICODE_STRING offsets', () => {
  setFixture('D:\\project', { wow64: true })
  assert.equal(getProcessCwd(123), 'D:\\project')
  setFixture('claude.exe --resume abc', { wow64: true, commandLine: true })
  assert.equal(getProcessCommandLine(123), 'claude.exe --resume abc')
})

test('malformed and incomplete reads fail closed rather than decoding partial paths', () => {
  const fixture = setFixture('C:\\work')
  fixture.memory.get(0x4038n).writeUInt16LE(3, 0)
  assert.equal(getProcessCwd(123), null)
  setFixture('C:\\work')
  fixture.memory.get(0x4038n).writeUInt16LE(2, 2)
  assert.equal(getProcessCwd(123), null)
  setFixture('C:\\work')
  fixture.shortRead = 0x5000n
  assert.equal(getProcessCwd(123), null)
  setFixture('C:\\work')
  fixture.failProbe = true
  assert.equal(getProcessCwd(123), null)
  assert.ok(fixture.closed >= 4)
})
