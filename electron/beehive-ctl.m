// ---------------------------------------------------------------------------
// beehive-ctl — two independent native helpers, dispatched by argv[1]:
//
// activate-window <cgWindowNumber>  (one-shot)
//   Bring the owning app of a given on-screen window to the foreground.
//   Prints one JSON line and exits 0/1.
//
// watch-clicks  (long-running; see the big comment above its section below)
//   Streams every global left-click as one JSON line per event until killed.
//
// Build: clang -fobjc-arc -O2 -framework AppKit -framework ApplicationServices
// ---------------------------------------------------------------------------
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>

static int runActivateWindow(int argc, const char *argv[]) {
  if (argc < 3) {
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

// ---------------------------------------------------------------------------
// watch-clicks — the fix for the Floating Control Dock dropping a presenting
// app's TRUE macOS full-screen slideshow the moment any dock button is
// clicked. Every BrowserWindow-level fix available (type: 'panel',
// focusable: false, acceptsFirstMouse, setIgnoreMouseEvents(false),
// hiddenInMissionControl, skipTransformProcessType) still leaves the dock as
// a REAL window that the WindowServer delivers a REAL click event to — and
// that alone is enough for macOS to end a full-screen Space transition on
// some systems, independent of activation/key-window status. The only way to
// stop that is for the dock window to never receive a real click at all.
//
// So: main.cjs now makes the dock window permanently click-through
// (setIgnoreMouseEvents(true)) — the WindowServer treats every click over it
// as if the window weren't there, so it can never be the trigger. This
// process is how those clicks still reach the dock's own buttons anyway.
//
// First attempt used NSEvent's addGlobalMonitorForEventsMatchingMask — this
// turned out to be wrong: despite older Apple docs suggesting mouse-only
// global monitors are permission-free, modern macOS (Catalina+) gates them
// behind "Input Monitoring" in Privacy & Security, same as keyboard taps.
// With that permission never granted (no prompt is ever shown for a global
// monitor that's silently denied — it just never fires), every dock button
// looked completely dead: the click-through fix stopped it from dropping the
// presentation, but nothing was left to deliver the click to the button.
//
// Fixed by dropping the event-STREAM approach entirely in favor of a plain
// STATE POLL: CGEventSourceButtonState() reports whether the left mouse
// button is physically down RIGHT NOW, and NSEvent.mouseLocation reports the
// current pointer position — both are simple hardware-state queries, not an
// event tap/monitor, and neither requires ANY special permission (the same
// category as reading modifier-key state). Polling at ~120 Hz and diffing
// consecutive samples reconstructs down/up transitions reliably (a real
// click's down-to-up duration is essentially always well over one poll
// period) without ever touching the permission-gated event stream.
//
// NSEvent screen coordinates are BOTTOM-LEFT origin (Cocoa convention);
// Electron's screen coordinates are TOP-LEFT origin — main.cjs does that
// flip using the primary display's height, which it already has via
// screen.getPrimaryDisplay().
// ---------------------------------------------------------------------------
static void printClick(NSString *type, NSPoint p) {
  printf("{\"type\":\"%s\",\"x\":%.2f,\"y\":%.2f}\n", type.UTF8String, p.x, p.y);
  fflush(stdout);
}

static int runWatchClicks(void) {
  setbuf(stdout, NULL); // unbuffered — main.cjs must see each click immediately
  printf("{\"ready\":true}\n");
  fflush(stdout);
  BOOL wasDown = NO;
  while (1) {
    @autoreleasepool {
      BOOL isDown = CGEventSourceButtonState(kCGEventSourceStateCombinedSessionState, kCGMouseButtonLeft);
      if (isDown != wasDown) {
        printClick(isDown ? @"down" : @"up", [NSEvent mouseLocation]);
        wasDown = isDown;
      }
    }
    usleep(8000); // ~120 Hz — comfortably faster than any real click's down/up gap
  }
  return 0;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc >= 2 && strcmp(argv[1], "activate-window") == 0) return runActivateWindow(argc, argv);
    if (argc >= 2 && strcmp(argv[1], "watch-clicks") == 0) return runWatchClicks();
    printf("{\"ok\":false,\"reason\":\"bad-args\"}\n");
    return 1;
  }
}
