const { copyFile, access } = require('node:fs/promises')
const { join } = require('node:path')

// REMOVE in mt3k.18, two releases after introduction. CI compiles this source
// artifact before packaging; local packaging deliberately works without it.
module.exports = async ({ appOutDir, electronPlatformName, packager }) => {
  if (electronPlatformName !== 'win32') return
  const source = join(packager.projectDir, 'build', 'mt3k-compat', 'ORBIT.exe')
  try { await access(source) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    console.warn('Skipping optional ORBIT compatibility stub (not compiled locally)')
    return
  }
  await copyFile(source, join(appOutDir, 'ORBIT.exe'))
}
