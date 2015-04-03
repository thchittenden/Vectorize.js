<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Vectorize.js Benchmarks</title>
    <link rel="stylesheet" href="http://code.jquery.com/qunit/qunit-1.17.1.css">
    <style>
        .test-diff {
            visibility: hidden;
            height: 0px;
            position: absolute;
        }
    </style>
</head>
<body>
    <div id="qunit"></div>
    <div id="qunit-fixture"></div>
    <script src="http://code.jquery.com/qunit/qunit-1.17.1.js"></script>
    <script src="../lib/simd.js"></script>
    <script src="../lib/benchmark.js"></script>
    <script src="../bin/vectorize.browser.js"></script>
    <script>
        benchmarks = [];
        function bench (benchfn, args) {
            var bench = new Benchmark(function () { benchfn(args) });
            bench.run();
            var period = 1000 * bench.times.period;
            var moe = 100 * bench.stats.moe / bench.times.period;
            return period.toFixed(3) + "ms ± " + moe.toFixed(2) + "%";
        };
        function makeBenchFn (fn, simdfn, args) {
            return function (assert) {
                assert.ok(true, "Scalar: " + bench(fn, args));
                assert.ok(true, "Vector: " + bench(simdfn, args));
            };
        }
        window.onload = function() {
            // Add benchmarks.
            QUnit.module("Benchmarks");
            for (var i = 0; i < benchmarks.length; i++) {
                var bench = benchmarks[i];
                QUnit.test(bench.name, makeBenchFn(bench.fn, vectorize.me(bench.fn), bench.args));
            }
        };
    </script>
    $(BENCHMARKS)
</body>
</html>
