// Responsive zoom-to-fit: render the page at a fixed "design width" (the
// smallest modern phone, 375px = iPhone SE / 13 mini) and let the browser
// scale that layout up or down to match the actual device on load. This
// keeps the in-meeting UI identical across all phone sizes and guarantees
// nothing is ever cut off, regardless of screen width.
//
// --vh is also set to the (scaled) inner height so iOS Safari layouts don't
// hide behind the browser chrome.
//
// Externalized from index.html (was an inline <script>) so the site's CSP
// can use a plain `script-src 'self'` with no 'unsafe-inline' — same code,
// same behavior, just loaded via src= instead of inline.
(function () {
  var DESIGN_WIDTH = 375 // smallest modern iPhone (SE / 13 mini)
  var meta = document.getElementById('viewport-meta')

  function setVH() {
    document.documentElement.style.setProperty('--vh', window.innerHeight + 'px')
  }

  function applyViewport() {
    // Real device width in CSS px — screen.width is unaffected by our override
    var deviceW = (window.screen && window.screen.width) ? window.screen.width : window.innerWidth
    if (deviceW <= 640) {
      // Zoom the 375px design to fit this phone (zooms in on larger phones,
      // out on tiny ones). user-scalable left on for accessibility pinch-zoom.
      meta.setAttribute('content', 'width=' + DESIGN_WIDTH + ', initial-scale=' + (deviceW / DESIGN_WIDTH))
    } else {
      meta.setAttribute('content', 'width=device-width, initial-scale=1.0')
    }
    setVH()
  }

  applyViewport()
  window.addEventListener('resize', setVH)
  window.addEventListener('orientationchange', function () { setTimeout(applyViewport, 150) })
})()
