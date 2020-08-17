// Event emitter
if (typeof $ !== 'function') var $ = {};
if (!('Machine' in $)) {
  $.Machine = function (state) {
    let es = {}, v = Object.values, r = Promise.resolve.bind(Promise); Object.seal(state);
    return Object.assign(this, {
      state () { return state },
      on (t, fn) { (es[t] = es[t] || {})[fn.name] = fn; return this },
      stop (t, fname = '') { t in es && delete es[t][fname] && (v(es[t]).length || delete es[t]); return this },
      emit (t, ...args) { return t in es && v(es[t]).reduce((s, fn) => (fn.apply(s, args), s), state) },
      emitAsync (t, ...args) { return t in es && v(es[t]).reduce((p, fn) => p.then(s => r(fn.apply(s, args)).then(() => s)), r(state)) } }) }
}

// Benchmarking object
$.Performer = function (opt) {
  let perf = new $.Machine({
    throttlingRate: (t => t < .99 && t > 0 ? 1 / (1 - t) : 1.2)(opt.throttlingRate),
    blockDuration: opt.blockDuration || 200,
    abort: false,
    stats: null
  })

  // Start a benchmark
  .on('run', function (obj) {
    if ('tests' in obj && 'until' in obj) {
      this.stats = [];
      if (this.abort) {
        console.log('Aborted')
        return Promise.resolve(obj)
      }
      let { tests, until, setup } = obj, perfCtx = this;
      performance.mark('begin-all');

      // Run each test in order
      return (function seqTests (n) {
        if (n >= tests.length) return obj;
        let i = 0, reps = 1, test = tests[n];
        ['times', 'seconds'].forEach(t => (t in until) && (this[t] = until[t][n] || until[t]));

        // Run setup
        return new Promise(r => r((setup[n] || (() => {}))())).catch(console.log).then(locals => {

          // Measurement loop
          let tot = 0;
          performance.mark('begin-all');
          return (async function throttle () {

            // Test loop
            performance.mark(`${n},${i},+`);
            for (let times = 0; times < reps; times++) await test.bind(locals)();
            performance.mark(`${n},${i},-`);
            performance.measure(`${n},${i},M`, `${n},${i},+`, `${n},${i},-`)

            // Adjust reps to timing
            if (i == 0) {
              if (performance.getEntriesByName(`${n},0,M`)[0].duration < perfCtx.blockDuration) {
                if ('times' in until && reps > times) reps = times;
                else {
                  reps *= 2;
                  performance.clearMarks();
                  performance.clearMeasures()
                  performance.mark('begin-all');
                  return throttle()
                }
              }
              else if ('times' in until && reps != times) reps = Math.ceil(times / Math.ceil(times / reps))
            }
            performance.clearMarks('now M');
            performance.clearMeasures('now M');
            performance.mark('now');
            performance.measure('now M', 'begin-all', 'now');
            tot += performance.getEntriesByName(`${n},${i},M`)[0].duration;
            perf.emit('progress', { testIndex: n, ops: ++i * reps, duration: tot / 1000 });
            if (!perfCtx.abort &&
              (('seconds' in until && performance.getEntriesByName('now M')[0].duration < seconds * 1000 * perfCtx.throttlingRate) ||
              ('times' in until && i * reps < times))
            ) return new Promise(r => setTimeout(r, perfCtx.blockDuration * (perfCtx.throttlingRate - 1))).then(throttle);
            else return Promise.resolve()
          })()

          // Collate data
          .then(() => {
            let stats = { ops: i * reps, duration: tot / 1000, average: tot / (i * reps) };
            perf.emit('benchmark', Object.assign({testIndex: n}, stats));
            perf.emit('result', stats);
            performance.clearMarks();
            performance.clearMeasures();
            if (perfCtx.abort) throw 'Aborted';
          })
        }).then(() => seqTests(n + 1)).catch(e => console.log(e)) // go to next test
      })(0) // end test sequencer
    } else return Promise.resolve();
  })
  .on('result', function (stats) { this.stats.push(stats) })
  .on('abort', function () { this.abort = true });


  // Benchmarking events
  Object.defineProperties(perf, {
    onprogress: { set (fn) { perf.on('progress', fn) } },
    onbenchmark: { set (fn) { perf.on('benchmark', fn) } },
  });

  return Object.assign(perf, {
    run (obj) { return perf.emitAsync('run', obj).then(s => s.stats) },
    abort () { perf.emit('abort') }
  })
}
