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
    <script src="bin/vectorize.browser.js"></script>
    <script>
        tests = [];
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
        window.onload = function() {
            // Add tests.
            for (var i = 0; i < tests.length; i++) {
                var test = tests[i];
                var fn = test.fn;
                var simdfn = vectorize.me(test.fn);
                var args = test.args;
                QUnit.test(test.name, makeTestFn(fn, simdfn, args));
            }
        };
    </script>
    $(TESTS)
</body>
</html>
