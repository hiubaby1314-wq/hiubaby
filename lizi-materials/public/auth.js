// auth.js - Token-based auth interceptor
// Include this script BEFORE app.js or any other script that makes API calls

(function() {
  function getAuthToken() {
    try {
      const saved = localStorage.getItem('lz_user');
      if (saved) {
        const user = JSON.parse(saved);
        return user.token || null;
      }
    } catch(e) {}
    return null;
  }

  // Save user data with token to localStorage
  window.setAuthUser = function(user, token) {
    user.token = token;
    try { localStorage.setItem('lz_user', JSON.stringify(user)); } catch(e) {}
  };

  // Clear auth data
  window.clearAuthUser = function() {
    try { localStorage.removeItem('lz_user'); } catch(e) {}
  };

  // Restore currentUser from localStorage on page load
  window.getStoredUser = function() {
    try {
      const saved = localStorage.getItem('lz_user');
      if (saved) return JSON.parse(saved);
    } catch(e) {}
    return null;
  };

  // Monkey-patch fetch to automatically include auth token in all API requests
  var originalFetch = window.fetch;
  window.fetch = function(url, options) {
    options = options || {};
    var urlStr = (typeof url === 'string') ? url : url.toString();

    if (urlStr.indexOf('/api/') === 0) {
      var token = getAuthToken();
      if (token) {
        if (!options.headers) {
          options.headers = {};
        }
        if (options.headers instanceof Headers) {
          if (!options.headers.has('x-auth-token')) {
            options.headers.set('x-auth-token', token);
          }
        } else if (Array.isArray(options.headers)) {
          var hasToken = options.headers.some(function(h) { return h[0] === 'x-auth-token'; });
          if (!hasToken) options.headers.push(['x-auth-token', token]);
        } else {
          if (!options.headers['x-auth-token']) {
            options.headers['x-auth-token'] = token;
          }
        }
      }
    }

    return originalFetch.call(this, url, options).then(function(response) {
      if (response.status === 401) {
        try { localStorage.removeItem('lz_user'); } catch(e) {}
        // Check if login modal exists on current page
        setTimeout(function() {
          var loginModal = document.getElementById('loginModal');
          if (loginModal) {
            loginModal.classList.add('active');
            var msg = document.getElementById('loginMsg');
            if (msg) { msg.textContent = '登录已过期，请重新登录'; msg.className = 'modal-msg error'; }
          }
        }, 100);
      }
      return response;
    });
  };
})();
