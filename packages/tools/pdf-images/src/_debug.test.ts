import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { it } from 'vitest'
import { runImagesToPdf } from './images.worker'

it('debug', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dbg-'))
  await mkdir(join(root, 'out'), { recursive: true })
  const canvas = createCanvas(30, 20)
  canvas.getContext('2d').fillRect(0, 0, 30, 20)
  const file = join(root, 'a.png')
  await writeFile(file, canvas.toBuffer('image/png'))
  try {
    const result = await runImagesToPdf(
      {
        inputPaths: [file],
        pageSize: 'auto',
        marginMm: 0,
        outputDir: join(root, 'out'),
        ffmpegPath: 'x'
      },
      { emit: () => undefined },
      {
        runProcess: () =>
          Promise.resolve({
            code: 0,
            signal: null,
            stdout: '',
            stderr: '',
            timedOut: false,
            aborted: false,
            truncated: false
          })
      }
    )
    console.log('OK', result)
  } catch (err) {
    console.log('RAW', err, JSON.stringify(err))
    throw err
  }
})
