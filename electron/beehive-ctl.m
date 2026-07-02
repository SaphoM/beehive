// ---------------------------------------------------------------------------
// beehive-ctl — bring the owning app of a given on-screen window to the
// foreground, given its exact CGWindowNumber (the same ID Electron's
// desktopCapturer already resolved when the user picked what to share).
//
// This is intentionally a ONE-SHOT command-line tool, not a daemon: window
// activation is a single native call (NSRunningApplication activate), so
// there is no need for a persistent process or an event-streaming protocol.
//
// Usage: beehive-ctl activate-window <cgWindowNumber>
// Prints one JSON line to stdout and exits 0 on success, 1 on failure:
//   {"ok":true,"pid":1234,"owner":"Pages"}
//   {"ok":false,"reason":"window-not-found"}
//
// No special permission is required — activating another already-running app
// is a normal Cocoa capability (the same as clicking its Dock icon), unlike
// posting synthetic input events (CGEventPostToPid), which needs Accessibility.
// Reading the window's owner PID via CGWindowList does rely on the same Screen
// Recording permission BeeHive already requires to capture the screen at all.
//
// Build: clang -fobjc-arc -O2 -framework AppKit -framework ApplicationServices
// ---------------------------------------------------------------------------
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc < 3 || strcmp(argv[1], "activate-window") != 0) {
      printf("{\"ok\":false,\"reason\":\"bad-args\"}\n");
      return 1;
    }

    CGWindowID wid = (CGWindowID)strtoull(argv[2], NULL, 10);
    NSArray *list = (__bridge_transfer NSArray *)
        CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, wid);
    if (list.count == 0) {
      printf("{\"ok\":false,\"reason\":\"window-not-found\"}\n");
      return 1;
    }

    NSDictionary *info = list[0];
    pid_t pid = (pid_t)[info[(id)kCGWindowOwnerPID] intValue];
    NSString *owner = info[(id)kCGWindowOwnerName] ?: @"";

    NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
    if (!app) {
      printf("{\"ok\":false,\"reason\":\"app-not-found\"}\n");
      return 1;
    }

    // macOS 14+ deprecated NSApplicationActivateIgnoringOtherApps (it's now the
    // only behaviour and the flag is a no-op) — activateWithOptions:0 is the
    // modern equivalent and works correctly on both old and new macOS.
    BOOL activated = [app activateWithOptions:0];
    printf("{\"ok\":%s,\"pid\":%d,\"owner\":\"%s\"}\n",
           activated ? "true" : "false", pid, owner.UTF8String);
    return activated ? 0 : 1;
  }
}
