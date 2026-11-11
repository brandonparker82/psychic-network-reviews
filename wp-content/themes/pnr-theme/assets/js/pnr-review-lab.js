/* Review Lab: клієнт. Вставлений текст і відповідь ШІ ніколи не йдуть в innerHTML (лише textContent). */
(function () {
  'use strict';
  var root = document.getElementById('rl-app');
  if (!root) return;

  var LOCAL = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && location.port;
  var API = (LOCAL ? 'http://127.0.0.1:8847' : '') + '/api/review-lab/';
  var MIN = 60, MAX = 1200, MAX_RETRY = 2;
  var SAMPLE = 'Absolutely life changing!!! Best psychic network ever, 10/10, everyone must try it right now. The readers are amazing and so accurate. Use my code SAVE20 and sign up today before the offer ends, you will not regret it. Five stars, highly recommend to everyone!!!';
  var SIGNALS = [
    ['specific', 'Specific detail'],
    ['verifiable', 'Checkable claims'],
    ['balance', 'Balance'],
    ['natural', 'Natural wording'],
    ['pressure', 'No sales pressure'],
    ['coherent', 'Story holds together']
  ];

  function $(s) { return root.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(root.querySelectorAll(s)); }
  var ta = $('#rl-text'), countEl = $('#rl-count'), goBtn = $('#rl-go'), sampleBtn = $('#rl-sample'), clearBtn = $('#rl-clear');
  var statusEl = $('#rl-status'), panel = $('#rl-panel'), idle = $('#rl-idle'), result = $('#rl-result');
  var gaugeArc = $('#rl-arc'), scoreEl = $('#rl-score'), bandEl = $('#rl-band'), rowsEl = $('#rl-rows');
  var quoteBox = $('#rl-quote'), quoteText = $('#rl-quote-text'), verdictEl = $('#rl-verdict'), checksEl = $('#rl-checks');
  var echoEl = $('#rl-echo'), tagEl = $('#rl-voice-tag'), retryBtn = $('#rl-retry'), copyBtn = $('#rl-copy');
  var busy = false, ctrl = null, lastSource = '';
  var ARC_LEN = 251.3;

  function radio(name) { var r = root.querySelector('input[name="' + name + '"]:checked'); return r; }
  function voice() { var r = radio('rl-voice'); return r ? r.value : 'inez'; }
  function voiceName() { var r = radio('rl-voice'); return r ? r.getAttribute('data-name') : 'Inez'; }
  function source() { var r = radio('rl-source'); return r ? r.value : 'review-site'; }
  function clean(t) { return String(t).replace(/\s+/g, ' ').trim(); }

  function updateCount() {
    var n = clean(ta.value).length;
    countEl.textContent = n + ' / ' + MAX;
    countEl.classList.toggle('is-bad', n > MAX);
    goBtn.disabled = busy || n < MIN || n > MAX;
  }
  ta.addEventListener('input', updateCount);
  updateCount();

  sampleBtn.addEventListener('click', function () { ta.value = SAMPLE; updateCount(); ta.focus(); });
  clearBtn.addEventListener('click', function () { if (busy && ctrl) ctrl.abort(); ta.value = ''; updateCount(); reset(); });

  // Розбір рядків протоколу SIGNAL|key|N|reason, QUOTE|..., VERDICT|..., CHECK|...
  function parse(text) {
    var out = { signals: {}, quote: '', verdict: '', checks: [] };
    text.split(/\r?\n/).forEach(function (raw) {
      var line = raw.replace(/^[\s*\-•`]+/, '').trim();
      var p = line.split('|');
      var tag = (p[0] || '').trim().toUpperCase();
      if (tag === 'SIGNAL' && p.length >= 4) {
        var key = p[1].trim().toLowerCase();
        var n = parseInt(p[2], 10);
        if (isNaN(n) || n < 1 || n > 5) return;
        if (SIGNALS.some(function (s) { return s[0] === key; })) out.signals[key] = { n: n, why: clean(p.slice(3).join('|')).replace(/^reason\s*[:\-]?\s*/i, '') };
      } else if (tag === 'QUOTE' && p.length >= 2) {
        out.quote = clean(p.slice(1).join('|')).replace(/^["“']+|["”']+$/g, '');
      } else if (tag === 'VERDICT' && p.length >= 2) {
        out.verdict = clean(p.slice(1).join('|'));
      } else if (tag === 'CHECK' && p.length >= 2) {
        var c = clean(p.slice(1).join('|'));
        if (c && out.checks.length < 3) out.checks.push(c);
      }
    });
    return out;
  }
  function usable(d) { return Object.keys(d.signals).length === 6; }
  function complete(d) { return usable(d) && d.verdict.length > 10; }

  function scoreOf(d) {
    var keys = Object.keys(d.signals);
    if (!keys.length) return null;
    var sum = 0;
    keys.forEach(function (k) { sum += d.signals[k].n; });
    return Math.round((sum / keys.length) * 20);
  }
  function bandOf(score, done) {
    if (!done) return 'Measuring...';
    if (score >= 75) return 'Reads like a considered account';
    if (score >= 50) return 'Mixed signals';
    return 'Several signals worth a second look';
  }
  function tone(score) { return score >= 75 ? 'good' : score >= 50 ? 'mid' : 'low'; }

  function buildRows() {
    rowsEl.textContent = '';
    SIGNALS.forEach(function (s) {
      var li = document.createElement('li');
      li.className = 'rl-row';
      li.setAttribute('data-key', s[0]);
      var head = document.createElement('div'); head.className = 'rl-row__head';
      var name = document.createElement('span'); name.className = 'rl-row__name'; name.textContent = s[1];
      var num = document.createElement('span'); num.className = 'rl-row__num'; num.textContent = '–';
      head.appendChild(name); head.appendChild(num);
      var bar = document.createElement('div'); bar.className = 'rl-bar';
      var segs = document.createElement('div'); segs.className = 'rl-bar__segs';
      for (var i = 0; i < 5; i++) { var seg = document.createElement('i'); segs.appendChild(seg); }
      bar.appendChild(segs);
      var why = document.createElement('p'); why.className = 'rl-row__why'; why.textContent = '';
      li.appendChild(head); li.appendChild(bar); li.appendChild(why);
      rowsEl.appendChild(li);
    });
  }

  function render(d, done) {
    SIGNALS.forEach(function (s) {
      var li = rowsEl.querySelector('[data-key="' + s[0] + '"]');
      var sig = d.signals[s[0]];
      if (!li || !sig) return;
      li.classList.add('is-in');
      li.setAttribute('data-tone', sig.n >= 4 ? 'good' : sig.n === 3 ? 'mid' : 'low');
      li.querySelector('.rl-row__num').textContent = sig.n + '/5';
      li.querySelector('.rl-row__why').textContent = sig.why;
      Array.prototype.forEach.call(li.querySelectorAll('.rl-bar__segs i'), function (seg, i) { seg.classList.toggle('on', i < sig.n); });
    });
    var sc = scoreOf(d);
    if (sc !== null) {
      scoreEl.textContent = sc;
      gaugeArc.style.strokeDashoffset = String(ARC_LEN * (1 - sc / 100));
      result.setAttribute('data-tone', tone(sc));
      bandEl.textContent = bandOf(sc, done && usable(d));
    }
    // Фраза лише якщо вона справді є у вставленому тексті.
    var src = lastSource, q = d.quote;
    var at = q.length >= 4 ? src.toLowerCase().indexOf(q.toLowerCase()) : -1;
    if (at >= 0) {
      quoteBox.hidden = false;
      quoteText.textContent = src.substr(at, q.length);
      echoEl.textContent = '';
      echoEl.appendChild(document.createTextNode(src.slice(0, at)));
      var mk = document.createElement('mark'); mk.textContent = src.substr(at, q.length); echoEl.appendChild(mk);
      echoEl.appendChild(document.createTextNode(src.slice(at + q.length)));
    }
    if (d.verdict) { verdictEl.textContent = d.verdict; verdictEl.hidden = false; }
    checksEl.textContent = '';
    d.checks.forEach(function (c) { var li = document.createElement('li'); li.textContent = c; checksEl.appendChild(li); });
    $('#rl-checks-wrap').hidden = !d.checks.length;
  }

  function reset() {
    result.hidden = true; idle.hidden = false; retryBtn.hidden = true; copyBtn.hidden = true;
    statusEl.textContent = ''; quoteBox.hidden = true; verdictEl.hidden = true; verdictEl.textContent = '';
    checksEl.textContent = ''; echoEl.textContent = ''; gaugeArc.style.strokeDashoffset = String(ARC_LEN);
    scoreEl.textContent = '–'; bandEl.textContent = ''; buildRows();
    panel.classList.remove('is-busy');
  }

  // Один запит до Worker; повертає {text, cut}.
  function stream(payload, signal, onText) {
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: signal }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (j) { var e = new Error(j.error || 'The Review Lab is unavailable right now.'); e.fatal = true; throw e; });
      }
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = '', text = '', cut = false;
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return { text: text, cut: cut };
          buf += dec.decode(r.value, { stream: true });
          var i;
          while ((i = buf.indexOf('\n')) >= 0) {
            var line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (line.indexOf('data:') !== 0) continue;
            var pl = line.slice(5).trim();
            if (pl === '[DONE]') continue;
            try { var o = JSON.parse(pl); if (o.t) { text += o.t; onText(text); } if (o.cut) cut = true; } catch (e) { /* неповний рядок */ }
          }
          return pump();
        });
      }
      return pump();
    });
  }

  function run() {
    var text = clean(ta.value);
    if (busy || text.length < MIN || text.length > MAX) return;
    busy = true; goBtn.disabled = true; lastSource = text;
    reset(); idle.hidden = true; result.hidden = false; panel.classList.add('is-busy');
    tagEl.textContent = 'AI analysis by ' + voiceName();
    var payload = { voice: voice(), source: source(), text: text };
    var attempt = 0;
    ctrl = new AbortController();

    function once() {
      statusEl.textContent = attempt ? 'The analysis was cut short. Retrying (' + attempt + '/' + MAX_RETRY + ')...' : 'Running the analysis...';
      return stream(payload, ctrl.signal, function (t) { render(parse(t), false); }).then(function (r) {
        var d = parse(r.text);
        if ((r.cut || !complete(d)) && attempt < MAX_RETRY) { attempt++; buildRows(); return once(); }
        render(d, true);
        statusEl.textContent = usable(d) ? '' : 'Partial result. Please try again.';
        retryBtn.hidden = usable(d);
        copyBtn.hidden = !usable(d);
      });
    }
    once().catch(function (e) {
      if (e && e.name === 'AbortError') return;
      statusEl.textContent = (e && e.fatal) ? e.message : 'Connection problem. Please try again.';
      retryBtn.hidden = false;
    }).then(function () { busy = false; panel.classList.remove('is-busy'); updateCount(); });
  }

  goBtn.addEventListener('click', run);
  retryBtn.addEventListener('click', run);
  copyBtn.addEventListener('click', function () {
    var parts = ['Review Lab (AI analysis by ' + voiceName() + '): ' + scoreEl.textContent + '/100 - ' + bandEl.textContent, verdictEl.textContent];
    Array.prototype.forEach.call(checksEl.children, function (li) { parts.push('- ' + li.textContent); });
    var txt = parts.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { copyBtn.textContent = 'Copied'; setTimeout(function () { copyBtn.textContent = 'Copy summary'; }, 1600); }, function () {});
  });

  buildRows();
})();
