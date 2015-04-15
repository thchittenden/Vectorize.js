<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Vectorize.js Tests</title>
    <link rel="stylesheet" href="http://code.jquery.com/qunit/qunit-1.17.1.css">
    <link rel="stylesheet" href="https://google-code-prettify.googlecode.com/svn/loader/prettify.css">
    <link rel="stylesheet" href="../lib/qunit-print.css">
    <style>
        .test-diff {
            display: none;
        }
    </style>
</head>
<body>
    <div id="qunit"></div>
    <div id="qunit-fixture"></div>
    <script src="http://code.jquery.com/jquery-1.11.2.min.js"></script>
    <script src="http://code.jquery.com/qunit/qunit-1.17.1.js"></script>
    <script src="https://google-code-prettify.googlecode.com/svn/loader/prettify.js"></script>
    <script src="../lib/qunit-print.js"></script>
    <script src="../lib/simd.js"></script>
    <script src="../bin/vectorize.browser.js"></script>
    <script>
        mods = [];
        Array.prototype.fill = function (val) { for (var i = 0; i < this.length; i++) this[i] = val; return this; }
        function clone (arg) {
            // Apparently this is efficient!
            return JSON.parse(JSON.stringify(arg));
        }
        function makeTestFn (test) {
            // This is necessary as otherwise the closure always refers
            // to the last test in the array! Bah!
            return function (assert) {
                try {
                    var scalarFn = test.fn;
                    var vectorFn = vectorize.me(test.fn);
                    QUnit.print("<pre class='prettyprint'>" + scalarFn + "</pre>");
                    QUnit.print("<pre class='prettyprint'>" + vectorFn + "</pre>");
                    var args = test.args;
                    assert.deepEqual(vectorFn(clone(args)), scalarFn(clone(args)));
                } catch (err) {
                    assert.ok(false, 'THROWN: ' + err);
                }
            };
        }
        window.onload = function() {
            // Sort the modules.
            mods.sort(function (a, b) { return a.order - b.order; });

            // Add tests.
            for (var i = 0; i < mods.length; i++) {
                var mod = mods[i];
                QUnit.module(mod.name);
                for (var j = 0; j < mod.tests.length; j++) {
                    var test = mod.tests[j];
                    QUnit.test(test.name, makeTestFn(test));
                }
            }
        };
    </script>
    $(TESTS)
</body>
</html>
