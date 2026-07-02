// ---------------------------------------------------------------------------
// beehive-ctl — post mouse/keyboard events DIRECTLY to a target app's process
// (CGEventPostToPid) so BeeHive can drive the shared window from its preview:
//   • the physical cursor never moves
//   • the target window responds even while BEHIND the BeeHive window
//   • BeeHive keeps focus, so the meeting controls stay usable
//
// Protocol: one JSON object per stdin line → one JSON response per stdout line.
//   {"cmd":"find","title":"..."}                     → locate window, cache pid+bounds
//   {"cmd":"move","nx":0..1,"ny":0..1}               → hover
//   {"cmd":"click","nx":..,"ny":..,"button":"left|right|middle","double":true?}
//   {"cmd":"scroll","nx":..,"ny":..,"dx":..,"dy":..} → wheel (pixel units)
//   {"cmd":"type","text":"..."}                      → unicode text
//   {"cmd":"key","key":"enter","mods":["cmd",...]}   → named key + modifiers
//
// Requires: Accessibility (event posting) + Screen Recording (window titles),
// both inherited from the parent Electron app's TCC grants.
// Build: clang -fobjc-arc -O2 -framework AppKit -framework ApplicationServices
// ---------------------------------------------------------------------------
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>

static pid_t      targetPid = 0;
static CGWindowID targetWin = 0;
static CGRect     targetBounds;

static void reply(NSDictionary *obj) {
  NSData *d = [NSJSONSerialization dataWithJSONObject:obj options:0 error:nil];
  fwrite(d.bytes, 1, d.length, stdout);
  fputc('\n', stdout);
  fflush(stdout);
}

static NSString *norm(NSString *s) {
  return [[s.lowercaseString stringByTrimmingCharactersInSet:
           NSCharacterSet.whitespaceAndNewlineCharacterSet] copy];
}

static BOOL refreshBounds(void) {
  if (!targetWin) return NO;
  NSArray *list = (__bridge_transfer NSArray *)
      CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, targetWin);
  if (list.count == 0) return NO;
  NSDictionary *b = list[0][(id)kCGWindowBounds];
  targetBounds = CGRectMake([b[@"X"] doubleValue], [b[@"Y"] doubleValue],
                            [b[@"Width"] doubleValue], [b[@"Height"] doubleValue]);
  return targetBounds.size.width > 1 && targetBounds.size.height > 1;
}

static void doFind(NSString *wanted) {
  NSArray *list = (__bridge_transfer NSArray *)CGWindowListCopyWindowInfo(
      kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
      kCGNullWindowID);
  NSString *w = norm(wanted ?: @"");
  NSMutableArray *titles = [NSMutableArray array];
  NSDictionary *best = nil;
  for (NSDictionary *info in list) {
    if ([info[(id)kCGWindowLayer] intValue] != 0) continue;   // normal windows only
    NSDictionary *b = info[(id)kCGWindowBounds];
    if ([b[@"Width"] doubleValue] < 60 || [b[@"Height"] doubleValue] < 60) continue;
    NSString *name  = norm(info[(id)kCGWindowName] ?: @"");
    NSString *owner = norm(info[(id)kCGWindowOwnerName] ?: @"");
    if (name.length) [titles addObject:name];
    else if (owner.length) [titles addObject:[NSString stringWithFormat:@"(%@)", owner]];
    if (best) continue;
    BOOL match = NO;
    if (w.length && name.length &&
        ([name containsString:w] || [w containsString:name])) match = YES;
    // Fallback: owner app name appears in the wanted title (e.g. "… - Pages")
    if (!match && w.length && owner.length && [w containsString:owner]) match = YES;
    if (match) best = info;
  }
  if (!best) {
    reply(@{ @"ok": @NO, @"reason": @"window-not-found", @"titles": titles });
    return;
  }
  targetPid = (pid_t)[best[(id)kCGWindowOwnerPID] intValue];
  targetWin = (CGWindowID)[best[(id)kCGWindowNumber] unsignedIntValue];
  refreshBounds();
  reply(@{ @"ok": @YES,
           @"pid": @(targetPid),
           @"title": (best[(id)kCGWindowName] ?: @""),
           @"owner": (best[(id)kCGWindowOwnerName] ?: @"") });
}

static CGPoint pointFor(double nx, double ny) {
  return CGPointMake(targetBounds.origin.x + MAX(0.0, MIN(1.0, nx)) * targetBounds.size.width,
                     targetBounds.origin.y + MAX(0.0, MIN(1.0, ny)) * targetBounds.size.height);
}

static void postMouse(CGEventType type, CGMouseButton btn, CGPoint p, int clickState) {
  CGEventRef e = CGEventCreateMouseEvent(NULL, type, p, btn);
  if (clickState > 0) CGEventSetIntegerValueField(e, kCGMouseEventClickState, clickState);
  CGEventPostToPid(targetPid, e);
  CFRelease(e);
}

// US-layout virtual keycodes for letters/digits (for modifier combos like cmd+C)
static int keycodeForChar(unichar c) {
  switch (c) {
    case 'a': return 0;  case 's': return 1;  case 'd': return 2;  case 'f': return 3;
    case 'h': return 4;  case 'g': return 5;  case 'z': return 6;  case 'x': return 7;
    case 'c': return 8;  case 'v': return 9;  case 'b': return 11; case 'q': return 12;
    case 'w': return 13; case 'e': return 14; case 'r': return 15; case 'y': return 16;
    case 't': return 17; case 'o': return 31; case 'u': return 32; case 'i': return 34;
    case 'p': return 35; case 'l': return 37; case 'j': return 38; case 'k': return 40;
    case 'n': return 45; case 'm': return 46;
    case '1': return 18; case '2': return 19; case '3': return 20; case '4': return 21;
    case '6': return 22; case '5': return 23; case '9': return 25; case '7': return 26;
    case '8': return 28; case '0': return 29;
    default: return -1;
  }
}

static int keycodeForName(NSString *k) {
  static NSDictionary *m;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    m = @{ @"return": @36, @"enter": @36, @"tab": @48, @"space": @49,
           @"backspace": @51, @"delete": @117, @"escape": @53,
           @"left": @123, @"right": @124, @"down": @125, @"up": @126,
           @"home": @115, @"end": @119, @"pageup": @116, @"pagedown": @121 };
  });
  NSNumber *n = m[k.lowercaseString];
  if (n) return n.intValue;
  if (k.length == 1) return keycodeForChar([k.lowercaseString characterAtIndex:0]);
  return -1;
}

static void postKey(int keycode, CGEventFlags flags) {
  CGEventRef d = CGEventCreateKeyboardEvent(NULL, (CGKeyCode)keycode, true);
  CGEventRef u = CGEventCreateKeyboardEvent(NULL, (CGKeyCode)keycode, false);
  CGEventSetFlags(d, flags);
  CGEventSetFlags(u, flags);
  CGEventPostToPid(targetPid, d);
  CGEventPostToPid(targetPid, u);
  CFRelease(d); CFRelease(u);
}

int main(void) {
  @autoreleasepool {
    char buf[16384];
    while (fgets(buf, sizeof(buf), stdin)) {
      NSData *line = [NSData dataWithBytes:buf length:strlen(buf)];
      NSDictionary *cmd = [NSJSONSerialization JSONObjectWithData:line options:0 error:nil];
      if (![cmd isKindOfClass:NSDictionary.class]) { reply(@{ @"ok": @NO, @"reason": @"bad-json" }); continue; }
      NSString *c = cmd[@"cmd"];

      if ([c isEqualToString:@"find"]) { doFind(cmd[@"title"]); continue; }

      if (!targetPid) { reply(@{ @"ok": @NO, @"reason": @"no-target" }); continue; }

      if ([c isEqualToString:@"move"]) {
        refreshBounds();
        postMouse(kCGEventMouseMoved, kCGMouseButtonLeft,
                  pointFor([cmd[@"nx"] doubleValue], [cmd[@"ny"] doubleValue]), 0);
        reply(@{ @"ok": @YES });

      } else if ([c isEqualToString:@"click"]) {
        refreshBounds();
        CGPoint p = pointFor([cmd[@"nx"] doubleValue], [cmd[@"ny"] doubleValue]);
        NSString *btn = cmd[@"button"] ?: @"left";
        CGMouseButton mb = kCGMouseButtonLeft;
        CGEventType down = kCGEventLeftMouseDown, up = kCGEventLeftMouseUp;
        if ([btn isEqualToString:@"right"])  { mb = kCGMouseButtonRight;  down = kCGEventRightMouseDown; up = kCGEventRightMouseUp; }
        if ([btn isEqualToString:@"middle"]) { mb = kCGMouseButtonCenter; down = kCGEventOtherMouseDown; up = kCGEventOtherMouseUp; }
        BOOL dbl = [cmd[@"double"] boolValue];
        postMouse(kCGEventMouseMoved, mb, p, 0);
        postMouse(down, mb, p, 1); usleep(12000); postMouse(up, mb, p, 1);
        if (dbl) { usleep(30000); postMouse(down, mb, p, 2); usleep(12000); postMouse(up, mb, p, 2); }
        reply(@{ @"ok": @YES });

      } else if ([c isEqualToString:@"scroll"]) {
        refreshBounds();
        CGPoint p = pointFor([cmd[@"nx"] doubleValue], [cmd[@"ny"] doubleValue]);
        int dy = (int)-lround([cmd[@"dy"] doubleValue]);   // wheel: positive = up
        int dx = (int)-lround([cmd[@"dx"] doubleValue]);
        CGEventRef e = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitPixel, 2, dy, dx);
        CGEventSetLocation(e, p);
        CGEventPostToPid(targetPid, e);
        CFRelease(e);
        reply(@{ @"ok": @YES });

      } else if ([c isEqualToString:@"type"]) {
        NSString *text = cmd[@"text"] ?: @"";
        if (text.length) {
          UniChar chars[256];
          NSUInteger len = MIN(text.length, (NSUInteger)256);
          [text getCharacters:chars range:NSMakeRange(0, len)];
          CGEventRef d = CGEventCreateKeyboardEvent(NULL, 0, true);
          CGEventRef u = CGEventCreateKeyboardEvent(NULL, 0, false);
          CGEventKeyboardSetUnicodeString(d, len, chars);
          CGEventKeyboardSetUnicodeString(u, len, chars);
          CGEventPostToPid(targetPid, d);
          CGEventPostToPid(targetPid, u);
          CFRelease(d); CFRelease(u);
        }
        reply(@{ @"ok": @YES });

      } else if ([c isEqualToString:@"key"]) {
        int keycode = keycodeForName(cmd[@"key"] ?: @"");
        if (keycode < 0) { reply(@{ @"ok": @NO, @"reason": @"unknown-key" }); continue; }
        CGEventFlags flags = 0;
        for (NSString *mod in (cmd[@"mods"] ?: @[])) {
          NSString *mm = mod.lowercaseString;
          if ([mm isEqualToString:@"cmd"] || [mm isEqualToString:@"meta"])    flags |= kCGEventFlagMaskCommand;
          if ([mm isEqualToString:@"ctrl"] || [mm isEqualToString:@"control"]) flags |= kCGEventFlagMaskControl;
          if ([mm isEqualToString:@"alt"] || [mm isEqualToString:@"option"])  flags |= kCGEventFlagMaskAlternate;
          if ([mm isEqualToString:@"shift"])                                  flags |= kCGEventFlagMaskShift;
        }
        postKey(keycode, flags);
        reply(@{ @"ok": @YES });

      } else {
        reply(@{ @"ok": @NO, @"reason": @"unknown-cmd" });
      }
    }
  }
  return 0;
}
