#!/usr/local/bin/js
assertEq(isSimdAvailable(), true);
benchmarks = [];
load('../bin/vectorize.browser.js');
load('../lib/benchmark.js');
load('map_basic.js');
load('reductions.js');

// Whether we should output the functions or not.
var debug = scriptArgs.indexOf('-debug') > -1;

// We don't want to see output from the algorithm.
console.log = function (args) { };

Array.prototype.fill = function (val) {
    for (var i = 0; i < this.length; i++) {
        this[i] = val;
    }
    return this;
}

function clone (args) {
    return JSON.parse(JSON.stringify(args));   
}

function bench (benchfn, args) {
    args = clone(args);
    var bench = new Benchmark(function () { benchfn(args) });
    bench.run();
    var period = 1000 * bench.times.period;
    var moe = 100 * bench.stats.moe / bench.times.period;
    return { period: period, moe: moe }; 
}

for (i in benchmarks) {
    var benchmark = benchmarks[i];
    var scalarFn = benchmark.fn;
    var vectorFn = vectorize.me(benchmark.fn).fn;
    var handFn = benchmark.simdfn;

    // Run the benchmarks.
    var scalarRes = bench(scalarFn, benchmark.args);
    var vectorRes = bench(vectorFn, benchmark.args);

    print('Testing: ' + benchmark.name);
    if (debug) {
        print('Scalar: ' + scalarFn);
        print('Vector: ' + vectorFn);
        if (handFn !== undefined) print('Hand:   ' + handFn);
    }
    print('Scalar: ' + scalarRes.period.toFixed(3) + 'ms ± ' + scalarRes.moe.toFixed(3) + '%');
    print('Vector: ' + vectorRes.period.toFixed(3) + 'ms ± ' + vectorRes.moe.toFixed(3) + '%');
    if (handFn !== undefined) {
        // We have a hand tuned SIMD implementation. Report that.
        handRes = bench(handFn, benchmark.args);
        print('Hand:   ' + handRes.period.toFixed(3) + 'ms ± ' + handRes.moe.toFixed(3) + '%');
        print('Slowdown: ' + (vectorRes.period / handRes.period).toFixed(3) + 'x');
    }
    print('Speedup:  ' + (scalarRes.period / vectorRes.period).toFixed(3) + 'x');
    print('');
}
