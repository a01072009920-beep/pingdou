(() => {
  // A classic script can run from file://; ES modules and WebSockets need the
  // local HTTP service. Do not start the app when HTML is opened directly.
  if (location.protocol === 'file:') {
    document.getElementById('app-root').hidden = true;
    document.getElementById('startup-notice').hidden = false;
    return;
  }
  const script = document.createElement('script');
  script.type = 'module';
  script.src = './app.mjs';
  document.head.appendChild(script);
})();
