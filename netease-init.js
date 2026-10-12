import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const keyPath = path.join(tmpdir(), 'xeapi_public_key');

export function validXeapiKey(key) {
  return Boolean(
    key &&
    typeof key.sk === 'string' &&
    key.sk.length &&
    typeof key.publicKey === 'string' &&
    Buffer.from(key.publicKey, 'base64').length === 32,
  );
}
function generateConfig() {
  // The upstream generator logs raw failures and has no overall timeout. Isolate it,
  // silence its output and verify the resulting key rather than trusting exit code.
  const entry = require.resolve('@neteasecloudmusicapienhanced/api/generateConfig');
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['-e', 'Promise.resolve(require(process.argv[1])()).then(()=>process.exit(0),()=>process.exit(1))', entry],
      { stdio: 'ignore', windowsHide: true },
    );
    const timer = setTimeout(() => {
      child.kill();
      reject(Error('网易云初始化超时'));
    }, 30000);
    child.once('error', () => {
      clearTimeout(timer);
      reject(Error('网易云初始化进程未能启动'));
    });
    child.once('exit', code => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(Error('网易云初始化未完成'));
    });
  });
}
export function createNeteaseInitializer({
  readKey = async () => JSON.parse(await readFile(keyPath, 'utf8')),
  generate = generateConfig,
  now = Date.now,
} = {}) {
  let pending,
    retryAfter = 0;
  return function ensure() {
    if (pending) return pending;
    pending = (async () => {
      if (validXeapiKey(await readKey().catch(() => null))) return;
      if (now() < retryAfter) throw Error('网易云播放配置暂不可用，请稍后重试');
      try {
        await generate();
        if (!validXeapiKey(await readKey().catch(() => null))) throw Error('网易云 XEAPI 公钥未生成');
        retryAfter = 0;
      } catch {
        retryAfter = now() + 15000;
        throw Error('网易云播放配置初始化失败，请检查服务器网络后重试');
      }
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
export const ensureNeteaseConfig = createNeteaseInitializer();
