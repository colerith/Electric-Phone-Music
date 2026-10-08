import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
if (basename(dirname(here)) !== 'plugins' || !/sillytavern/i.test(pkg.name)) throw Error('请先把仓库克隆到 SillyTavern/plugins/Electric-Phone-Music');
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--ignore-scripts'], { cwd: here, stdio: 'inherit', shell: process.platform === 'win32' });
if (result.status !== 0) throw Error('依赖安装失败，未修改酒馆配置');
const config = resolve(root, 'config.yaml');
const old = await readFile(config, 'utf8');
if (!/^enableServerPlugins:\s*true\s*(?:#.*)?$/m.test(old)) {
  await copyFile(config, config + '.wave-music-' + Date.now() + '.bak');
  const updated = /^enableServerPlugins:.*$/m.test(old) ? old.replace(/^enableServerPlugins:.*$/m, 'enableServerPlugins: true') : old + '\nenableServerPlugins: true\n';
  await writeFile(config, updated);
}
console.log('安装完成。请重启酒馆服务器，再打开电波手机 → 音乐设置；无需另开服务或填写地址。');
