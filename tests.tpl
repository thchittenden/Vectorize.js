<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Vectorize.js Tests</title>
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
    <script src="lib/simd.js"></script>
    <script src="bin/vectorize.browser.js"></script>
    <script>
        tests = [];
        benchmarks = [];
        function bench (benchfn, arggen, warmup, iters) {
            // Perform warmup.
            for (var i = 0; i < warmup; i++) {
                benchfn(arggen());
            }
            // Run for real.
            var total = 0;
            for (var i = 0; i < iters; i++) {
                var arg = arggen();
                var start = performance.now();
                benchfn(arg);
                var end = performance.now();
                total += (end - start);
            }
            total = (total * 1000) / iters;
            return total;
        };
        function clone (arg) {
            // Apparently this is efficient!
            return JSON.parse(JSON.stringify(arg));
        }
        function makeTestFn (fn, simdfn, arg) {
            // This is necessary as otherwise the closure always refers
            // to the last test in the array! Bah!
            return function (assert) {
                assert.deepEqual(simdfn(clone(arg)), fn(clone(arg)));
            };
        }
        function makeBenchFn (fn, simdfn, args) {
            var warmup = 50;
            var iters = 1000;
            
            return function (assert) {
                assert.ok(true, "Scalar: " + bench(fn, args, warmup, iters) + "ms");
                assert.ok(true, "Vector: " + bench(simdfn, args, warmup, iters) + "ms");
            };
        }
        window.onload = function() {
            // Add tests.
            QUnit.module("Tests");
            for (var i = 0; i < tests.length; i++) {
                var test = tests[i];
                QUnit.test(test.name, makeTestFn(test.fn, vectorize.me(test.fn), test.args));
            }
            // Add benchmarks.
            QUnit.module("Benchmarks");
            for (var i = 0; i < benchmarks.length; i++) {
                var bench = benchmarks[i];
                QUnit.test(bench.name, makeBenchFn(bench.fn, vectorize.me(bench.fn), bench.args));
            }
        };
    </script>
    $(TESTS)
</body>
</html>
