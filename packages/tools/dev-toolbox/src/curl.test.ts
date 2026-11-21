/**
 * @file curl.ts 单测：分词/参数解析/错误分支/三种代码生成
 * @author cuilanchao
 * @date 2026-11-21
 */
import { describe, expect, it } from 'vitest'
import { convertCurl, generateCode, parseCurl, tokenize, type CurlRequest } from './curl'

/** 断言抛出结构化 CURL 解析错误 */
function expectParseError(action: () => unknown, detailPart?: string): void {
  try {
    action()
    throw new Error('应当抛出解析错误')
  } catch (err) {
    const candidate = err as { code?: string; detail?: string }
    expect(candidate.code).toBe('DT_CURL_PARSE_FAILED')
    if (detailPart !== undefined) expect(candidate.detail).toContain(detailPart)
  }
}

describe('tokenize', () => {
  it('单引号/双引号/无引号混合', () => {
    expect(tokenize(`curl 'https://a.com/x' -H "X-A: 1" -d a=1`)).toEqual([
      'curl',
      'https://a.com/x',
      '-H',
      'X-A: 1',
      '-d',
      'a=1'
    ])
  })

  it('反斜杠续行合并为空格', () => {
    expect(tokenize("curl 'https://a.com' \\\n  -H 'X-A: 1'")).toEqual([
      'curl',
      'https://a.com',
      '-H',
      'X-A: 1'
    ])
  })

  it('$’…’ 按普通单引号处理', () => {
    expect(tokenize(`curl $'/a b'`)).toEqual(['curl', '/a b'])
  })

  it('双引号内转义还原', () => {
    expect(tokenize(`curl -d "{\\"a\\":1}"`)).toEqual(['curl', '-d', '{"a":1}'])
  })

  it('空引号保留为空 token', () => {
    expect(tokenize(`curl -H ''`)).toEqual(['curl', '-H', ''])
  })

  it('未闭合引号报错', () => {
    expectParseError(() => tokenize(`curl 'https://a.com`), '引号未闭合')
  })
})

describe('parseCurl', () => {
  it('最简 GET + 请求头', () => {
    const request = parseCurl(`curl 'https://api.example.com/x' -H 'X-A: 1'`)
    expect(request).toMatchObject({
      method: 'GET',
      url: 'https://api.example.com/x',
      headers: [['X-A', '1']],
      body: null,
      insecure: false
    })
  })

  it('多个 -d 以 & 拼接且缺省方法为 POST', () => {
    const request = parseCurl(`curl https://a.com -d 'a=1' --data-raw 'b=2'`)
    expect(request.method).toBe('POST')
    expect(request.body).toBe('a=1&b=2')
  })

  it('-X 覆盖方法并转大写', () => {
    expect(parseCurl('curl -X put https://a.com').method).toBe('PUT')
  })

  it('-I / --head 输出 HEAD', () => {
    expect(parseCurl('curl -I https://a.com').method).toBe('HEAD')
    expect(parseCurl('curl --head https://a.com').method).toBe('HEAD')
  })

  it('-b / -A / -u 转为标准请求头', () => {
    const request = parseCurl(`curl -b 'sid=1' -A 'Lumin/1.0' -u 'user:pass' https://a.com`)
    expect(request.headers).toEqual([
      ['Cookie', 'sid=1'],
      ['User-Agent', 'Lumin/1.0'],
      ['Authorization', 'Basic dXNlcjpwYXNz']
    ])
  })

  it('长参数别名（--request/--header/--cookie/--user-agent/--user）', () => {
    const request = parseCurl(
      `curl --request POST --header 'X-B: 2' --cookie 'a=1' --user-agent 'UA' --user 'u:p' https://a.com`
    )
    expect(request.method).toBe('POST')
    expect(request.headers).toEqual([
      ['X-B', '2'],
      ['Cookie', 'a=1'],
      ['User-Agent', 'UA'],
      ['Authorization', 'Basic dTpw']
    ])
  })

  it('重复请求头全部保留', () => {
    const request = parseCurl(`curl https://a.com -H 'X-A: 1' -H 'X-A: 2'`)
    expect(request.headers).toEqual([
      ['X-A', '1'],
      ['X-A', '2']
    ])
  })

  it('--compressed 忽略、-k 标记 insecure', () => {
    const request = parseCurl(`curl --compressed -k https://a.com`)
    expect(request.insecure).toBe(true)
    expect(request.headers).toEqual([])
  })

  it('首个 token 非 curl 时按 URL 处理', () => {
    expect(parseCurl(`'https://a.com/x' -H 'X-A: 1'`).url).toBe('https://a.com/x')
  })

  it('空输入报错', () => {
    expectParseError(() => parseCurl('   '), '请输入 curl 命令')
  })

  it('缺少 URL 报错', () => {
    expectParseError(() => parseCurl('curl -X GET'), '缺少 URL')
  })

  it('不支持的参数报错并指出参数名', () => {
    expectParseError(() => parseCurl(`curl -F 'file=@a.txt' https://a.com`), '-F')
  })

  it('参数缺少取值报错', () => {
    expectParseError(() => parseCurl('curl -H'), '-H')
  })

  it('请求头缺少冒号报错', () => {
    expectParseError(() => parseCurl(`curl https://a.com -H 'NoColon'`), 'NoColon')
  })
})

describe('generateCode', () => {
  const request: CurlRequest = {
    method: 'POST',
    url: 'https://api.example.com/login',
    headers: [
      ['X-A', '1'],
      ['Content-Type', 'application/json']
    ],
    body: '{"user":"lumin"}',
    insecure: false
  }

  it('fetch 输出含 fetch( 与单引号对象键', () => {
    const code = generateCode(request, 'fetch')
    expect(code).toContain('await fetch(')
    expect(code).toContain("'X-A': '1'")
    expect(code).toContain('body: \'{"user":"lumin"}\'')
  })

  it('axios 输出含 axios( 与 url/method', () => {
    const code = generateCode(request, 'axios')
    expect(code).toContain('await axios({')
    expect(code).toContain("method: 'POST'")
    expect(code).toContain("url: 'https://api.example.com/login'")
  })

  it('python 输出含 requests.request 与 print', () => {
    const code = generateCode(request, 'python')
    expect(code).toContain('requests.request(')
    expect(code).toContain("'POST'")
    expect(code).toContain('print(response.text)')
  })

  it('无 header/body 时不生成空对象', () => {
    const plain: CurlRequest = {
      method: 'GET',
      url: 'https://a.com',
      headers: [],
      body: null,
      insecure: false
    }
    expect(generateCode(plain, 'fetch')).not.toContain('headers:')
    expect(generateCode(plain, 'fetch')).not.toContain('body:')
  })

  it('insecure 生成注释', () => {
    expect(generateCode({ ...request, insecure: true }, 'fetch')).toContain('已忽略 -k')
    expect(generateCode({ ...request, insecure: true }, 'python')).toContain('verify=False')
  })

  it('单引号/反斜杠/换行按字符串转义', () => {
    const tricky: CurlRequest = {
      method: 'POST',
      url: 'https://a.com',
      headers: [['X-Q', "it's"]],
      body: 'line1\nline2\\end',
      insecure: false
    }
    const code = generateCode(tricky, 'fetch')
    expect(code).toContain("it\\'s")
    expect(code).toContain('line1\\nline2\\\\end')
  })

  it('convertCurl 串联解析与生成', () => {
    expect(convertCurl(`curl 'https://a.com' -H 'X-A: 1'`, 'fetch')).toContain("'X-A': '1'")
  })
})
