const { execFileSync } = require('node:child_process')
const { lstatSync, readdirSync } = require('node:fs')
const path = require('node:path')

const walk = (dir, callback) => {
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry)
    const stat = lstatSync(fullPath)

    if (stat.isDirectory()) {
      walk(fullPath, callback)
      continue
    }

    callback(fullPath)
  }
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    return
  }

  walk(context.appOutDir, (file) => {
    if (path.basename(file) !== 'Info.plist') {
      return
    }

    execFileSync('plutil', ['-convert', 'xml1', file])
  })
}
