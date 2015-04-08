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
    <script src="../lib/simd.js"></script>
    <script src="../bin/vectorize.browser.js"></script>
    <script>
        tests = [];
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
                    var args = test.args;
                    assert.deepEqual(vectorFn(clone(args)), scalarFn(clone(args)));
                } catch (err) {
                    assert.ok(false, 'THROWN: ' + err);
                }
            };
        }
        window.onload = function() {
            // Add tests.
            QUnit.module("Tests");
            for (var i = 0; i < tests.length; i++) {
                var test = tests[i];
                QUnit.test(test.name, makeTestFn(test));
            }
        };
    </script>
    $(TESTS)
</body>
</html>
