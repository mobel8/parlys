const { execSync } = require('child_process');
try {
  console.log('Cleaning dist...');
  execSync('rmdir /s /q dist', { stdio: 'inherit', shell: true });
} catch(e) {}
console.log('Building main process...');
execSync('npx tsc -p tsconfig.main.json', { stdio: 'inherit', shell: true });
console.log('Build complete!');
