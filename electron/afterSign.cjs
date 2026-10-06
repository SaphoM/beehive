// electron-builder afterSign hook (wired via package.json's build.afterSign).
//
// electron-builder skips macOS code signing entirely when no paid "Developer
// ID Application" identity is installed (visible in the build log as
// "skipped macOS application code signing") — and skipping signing also
// skips applying hardenedRuntime + entitlements.mac.plist, even though both
// are configured in package.json. Without com.apple.security.device.camera/
// microphone in the binary's entitlements, macOS TCC silently denies camera/
// mic access to the packaged app — no error, no prompt, the button just
// doesn't work. This bit this app once already (found by comparing a
// freshly-built app's `codesign -d --entitlements -` output, which came back
// completely empty, against the working dev-Electron build).
//
// This hook ad-hoc-signs the app with entitlements as a fallback, but only
// when there's no real signing identity available — if a paid Developer ID
// certificate is ever added to this machine, electron-builder will sign
// properly on its own, and overwriting that with an ad-hoc signature here
// would be a regression, not a fix.
const { execFileSync } = require('child_process')
const path = require('path')

module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  const identities = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
  if (/Developer ID Application/.test(identities)) {
    console.log('[afterSign] Real Developer ID identity found — electron-builder already signed properly, skipping ad-hoc re-sign.')
    return
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  console.log(`[afterSign] No Developer ID identity — ad-hoc re-signing with entitlements: ${appPath}`)
  execFileSync('codesign', [
    '--force', '--deep', '--sign', '-',
    '--entitlements', path.join(__dirname, 'entitlements.mac.plist'),
    appPath,
  ], { stdio: 'inherit' })
}
