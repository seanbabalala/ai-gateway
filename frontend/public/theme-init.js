// FOUC prevention: apply stored theme before first paint.
;(function () {
  var stored = localStorage.getItem('siftgate-theme')
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  var dark = stored === 'dark' || (stored !== 'light' && prefersDark)
  if (dark) document.documentElement.classList.add('dark')
})()
