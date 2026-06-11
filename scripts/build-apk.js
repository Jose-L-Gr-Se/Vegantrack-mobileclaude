const { spawnSync } = require('child_process');
const path = require('path');

const task = process.argv[2] || 'assembleRelease';
const isWindows = process.platform === 'win32';
const gradlew = isWindows ? 'gradlew.bat' : './gradlew';

const result = spawnSync(gradlew, [task, '--no-daemon'], {
  cwd: path.join(__dirname, '..', 'android'),
  stdio: 'inherit',
  shell: isWindows,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
