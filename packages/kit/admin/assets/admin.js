document.addEventListener('DOMContentLoaded', function () {
  /* Inject CSRF token into every htmx request */
  document.body.addEventListener('htmx:configRequest', function (e) {
    var t = document.querySelector('meta[name=csrf-token]');
    if (t) e.detail.headers['x-csrf-token'] = t.getAttribute('content');
  });

  /* Allow htmx to swap content on 422 (validation errors) */
  document.body.addEventListener('htmx:beforeSwap', function (e) {
    if (e.detail.xhr.status === 422) {
      e.detail.shouldSwap = true;
      e.detail.isError = false;
    }
  });

  /* Delegated click handler for autocomplete dropdown items */
  document.body.addEventListener('click', function (e) {
    var li = e.target.closest('.admin-autocomplete__item');
    if (!li) return;
    var wrap = li.closest('.form-autocomplete');
    if (!wrap) return;
    var hidden = wrap.querySelector('input[type=hidden]');
    var display = wrap.querySelector('input[type=text]');
    var results = wrap.querySelector('.form-autocomplete__results');
    if (hidden) hidden.value = li.dataset.value || '';
    if (display) {
      display.value = li.textContent.trim();
      display.focus();
    }
    if (results) results.innerHTML = '';
  });
});
