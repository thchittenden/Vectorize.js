benchmarks = [];
load('../bin/vectorize.browser.js');
load('../lib/benchmark.js');
load('map_basic.js');

// We don't want to see output from the algorithm.
console.log = function (args) { };

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
    period.toFixed(3) + "ms ± " + moe.toFixed(2) + "%";
}

for (i in benchmarks) {
    var benchmark = benchmarks[i];
    var scalarFn = benchmark.fn;
    var vectorFn = vectorize.me(benchmark.fn);

    // Run the benchmarks.
    var scalarRes = bench(scalarFn, benchmark.args);
    var vectorRes = bench(vectorFn, benchmark.args);

    print('Testing: ' + benchmark.name);
    print('Scalar: ' + scalarRes.period.toFixed(3) + 'ms ± ' + scalarRes.moe.toFixed(3) + '%');
    print('Scalar: ' + vectorRes.period.toFixed(3) + 'ms ± ' + scalarRes.moe.toFixed(3) + '%');
    print('Speedup: ' + (scalarRes.period / vectorRes.period).toFixed(3) + 'x');
    print('');
}
